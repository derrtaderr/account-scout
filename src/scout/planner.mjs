// The hop planner. Turns a ResearchRequest (plus an optional strategy brief a
// later lane supplies) into an ordered, deduplicated list of focused queries.
//
// Deterministic by construction: the same request plans the same hops every
// time, which is what lets the recorded provider key its fixture store on the
// query string and replay a run exactly.
//
// Ordering is the load-bearing part. Overview and the account's own property
// come first because they are the cheapest primary evidence; the declared
// strategy outranks generic questions, so a scarce plan stays aimed by strategy
// rather than by whatever was typed into questions[].

export const DEFAULT_MAX_HOPS = 4;

/** Words lifted from the opaque strategy brief to aim one hop. */
const BRIEF_TERM_COUNT = 6;

function briefTerms(brief) {
  return brief
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, BRIEF_TERM_COUNT)
    .join(" ");
}

/**
 * @param {object} args
 * @param {import("../types.mjs").ResearchRequest} args.request
 * @param {string} [args.brief] Opaque strategy brief. Lane C fills this from
 *   gtm-architect; this lane only needs it to be a string it can aim with.
 * @param {number} [args.maxHops]
 * @returns {Array<{query: string, purpose: string}>}
 */
export function planHops({ request, brief, maxHops = DEFAULT_MAX_HOPS }) {
  if (!Number.isInteger(maxHops) || maxHops < 1)
    throw new Error(`planHops needs a maxHops of at least 1, got ${JSON.stringify(maxHops)}`);
  if (brief !== undefined && typeof brief !== "string")
    throw new Error("planHops brief, when given, is an opaque string");

  const account = request.accountName;
  const candidates = [];

  candidates.push({ query: `${account} company overview`, purpose: "overview" });

  if (request.domain)
    candidates.push({ query: `${account} site:${request.domain}`, purpose: "primary" });

  if (brief && briefTerms(brief))
    candidates.push({ query: `${account} ${briefTerms(brief)}`, purpose: "strategy-brief" });

  for (const question of request.questions ?? [])
    candidates.push({ query: `${account} ${question}`, purpose: "question" });

  candidates.push({ query: `${account} funding news`, purpose: "news" });

  const seen = new Set();
  const plan = [];
  for (const hop of candidates) {
    if (seen.has(hop.query)) continue;
    seen.add(hop.query);
    plan.push(Object.freeze(hop));
    if (plan.length === maxHops) break;
  }
  return plan;
}
