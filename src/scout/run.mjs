// The scout run: plan hops, fetch them, extract candidate claims, gate every
// one of them, build the report. Provider-agnostic — the same code path drives
// the recorded fixture store and the live Claude API, which is the whole point
// of the strategy-benchmark pattern. A run cannot behave differently in CI than
// it does against the real web, because it is literally the same function.
//
// Two behaviours worth naming:
//
// EARLY STOP, and why it tolerates one barren hop. A hop whose search surfaces
// no URL the run has not already fetched has added nothing. But ONE barren hop
// only proves that query overlapped the last one — the planner's hops are aimed
// differently on purpose, and stopping on the first overlap would routinely skip
// the question-aimed and strategy-aimed hops that carry the actual research
// intent. Two barren hops in a row is the signal that the account is exhausted.
//
// FAIL CLOSED. Any provider error — search, fetch, or extraction — aborts the
// run as a ScoutRefusal. It never degrades into a partial report, because a
// partial report is indistinguishable from a thorough one that found less.

import { planHops, DEFAULT_MAX_HOPS } from "./planner.mjs";
import { gateCandidates } from "./gate.mjs";
import { buildResearchReport } from "../report/build.mjs";
import { ScoutRefusal } from "./errors.mjs";

/** Consecutive hops that surface no new URL before the run calls it exhausted. */
export const BARREN_HOPS_BEFORE_STOP = 2;

/** Wrap any provider throw as a refusal, preserving the original message. */
async function closed(step, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ScoutRefusal) throw err;
    throw new ScoutRefusal(`the run failed closed during ${step}: ${err.message}`, { cause: err });
  }
}

/**
 * @param {object} args
 * @param {import("../types.mjs").ResearchRequest} args.request
 * @param {object} args.provider recordedProvider(...) or liveProvider(...)
 * @param {number} [args.maxHops]
 * @param {string} [args.brief] Opaque strategy brief; Lane C supplies it.
 * @param {() => string} [args.now] Injectable clock, for deterministic tests.
 * @returns {Promise<object>} A frozen ResearchReport.
 * @throws {ScoutRefusal} on provider failure, or when the run fetched nothing.
 */
export async function runScout({ request, provider, maxHops = DEFAULT_MAX_HOPS, brief, now = () => new Date().toISOString() }) {
  const plan = planHops({ request, brief, maxHops });

  const hops = [];
  const fetched = new Set();
  let barrenStreak = 0;

  for (const hop of plan) {
    const results = await closed(`search "${hop.query}"`, () => provider.search(hop.query, { purpose: hop.purpose }));

    const fresh = results.filter((r) => r?.url && !fetched.has(r.url));
    if (fresh.length === 0) {
      barrenStreak += 1;
      if (barrenStreak >= BARREN_HOPS_BEFORE_STOP) break;
      continue;
    }
    barrenStreak = 0;

    for (const result of fresh) {
      fetched.add(result.url);
      hops.push(await closed(`fetch ${result.url}`, () => provider.fetchPage(result.url)));
    }
  }

  const candidates = await closed("claim extraction", () =>
    provider.proposeClaims({
      account: request.accountName,
      domain: request.domain,
      questions: request.questions,
      hops,
      brief,
    }),
  );

  const { claims, refusals } = gateCandidates({
    candidates,
    hops,
    domain: request.domain,
    runAt: now(),
  });

  const meta = { mode: provider.mode };
  if (provider.model !== undefined) meta.model = provider.model;

  return buildResearchReport({ request, hops, claims, refusals, meta, generatedAt: now() });
}
