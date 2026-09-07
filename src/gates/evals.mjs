// Lane D — evals. A completed ResearchReport becomes a gtm-agent-evals
// AgentRun and is judged by the RESEARCH archetype's deterministic rules in
// rules-only style: the rubric is stripped from the config exactly the way
// that library's own CLI does it for --rules-only, so no key is needed and a
// provider that would need one is handed in as a tripwire that throws if it
// is ever consulted. The verdict lands in JSONL telemetry through the
// library's own sink; timestamps always carry an explicit timezone because
// its reader refuses tz-less ones — that refusal is a feature this lane
// relies on, not a bug it works around.
//
// Import path note: gtm-agent-evals ships TypeScript with no prepare script
// and no `main`/`exports`, so a git install has no dist/ and no root entry.
// The dist/ here was built in place (npx tsc); the real fix is upstream —
// see src/gates/WIRING.md.

import { randomUUID } from "node:crypto";
import {
  evaluate,
  buildRuleRegistry,
  allArchetypeRules,
  makeFakeProvider,
  makeJsonlSink,
  research,
} from "gtm-agent-evals/dist/index.js";

/** The configId every scout run is scored and streak-counted under. */
export const RESEARCH_CONFIG_ID = "account-scout-research";

/** The telemetry path convention for this repo: one JSONL file, repo-root
 *  relative, append-only, written by the library's own sink. */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
// Resolved against the PACKAGE root, not the process cwd: a serve loop or cron
// started from another directory must not scatter the streak across telemetry
// files (review, minor). Pass telemetryPath explicitly to relocate it.
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const TELEMETRY_PATH = resolve(PACKAGE_ROOT, "telemetry", "events.jsonl");

/**
 * Map a completed run to the shape gtm-agent-evals judges.
 *
 * - one `tool_result` step per hop, carrying the fetched content — that is
 *   what sourceStepPresent counts and noUncitedAssertion grounds against;
 * - output = the serialized claims summary, refusals included, because a
 *   refusal is first-class output and the judge must see it too.
 *
 * @param {object} report a frozen ResearchReport
 * @returns {{archetype: string, input: string, output: string, steps: Array, metadata: object}}
 */
export function reportToAgentRun(report) {
  const lines = [];
  lines.push(`Claims (${report.claims.length}):`);
  for (const c of report.claims) {
    lines.push(`- [${c.kind}/${c.tier}] ${c.text} (cites: ${c.citations.map((x) => x.url).join(", ")})`);
  }
  lines.push(`Refusals (${report.refusals.length}):`);
  for (const r of report.refusals) lines.push(`- ${r.text} — ${r.reason}`);

  return {
    archetype: "research",
    input: `Account research: ${report.account}`,
    output: lines.join("\n"),
    steps: report.hops.map((h) => ({ kind: "tool_result", name: "fetch_page", content: h.content })),
    metadata: {
      account: report.account,
      mode: report.meta.mode,
      ...(report.meta.model ? { model: report.meta.model } : {}),
      generatedAt: report.generatedAt,
      claimCount: report.claims.length,
      refusalCount: report.refusals.length,
      hopCount: report.hops.length,
    },
  };
}

/** Trips loudly if the rubric path is ever reached in rules-only mode. With
 *  the rubric stripped, scoreRun returns {} without consulting the provider;
 *  makeFakeProvider({}) throws for ANY requested dimension, so a regression
 *  that reintroduces the rubric fails closed to BLOCK instead of passing. */
const keylessTripwire = makeFakeProvider({});

/**
 * Judge a report with the research archetype's deterministic rules,
 * rules-only style (registry + archetype rules, rubric skipped, keyless).
 *
 * @param {object} report a frozen ResearchReport
 * @returns {Promise<object>} the library's Verdict
 */
export function evaluateReport(report) {
  const config = { ...research.researchConfig, id: RESEARCH_CONFIG_ID, rubric: undefined };
  const registry = { ...buildRuleRegistry({}), ...allArchetypeRules };
  return evaluate(reportToAgentRun(report), config, { registry, provider: keylessTripwire });
}

/**
 * Append one verdict to the telemetry, via the library's own JSONL sink.
 * The timestamp comes from `now()` and MUST carry an explicit timezone
 * (Date.toISOString's trailing Z does); the reader refuses tz-less strings.
 *
 * @param {object} args
 * @param {object} args.verdict
 * @param {string} [args.runId] defaults to a fresh UUID
 * @param {string} [args.configId]
 * @param {string} [args.telemetryPath]
 * @param {() => string} [args.now] injectable clock, ISO with timezone
 * @returns {Promise<object>} the TelemetryEvent as written
 */
export async function recordVerdict({
  verdict,
  runId = randomUUID(),
  configId = RESEARCH_CONFIG_ID,
  telemetryPath = TELEMETRY_PATH,
  now = () => new Date().toISOString(),
  redactText,
}) {
  // Telemetry is a byte exit like any other. Eval rules embed run sentences in
  // their violation messages, so every string is redacted with the same config
  // the report writer uses — events.jsonl is post-redaction by construction.
  const scrub = redactText ?? ((t) => t);
  const recorded = {
    status: verdict.status,
    violations: (verdict.violations ?? []).map((v) => ({ ...v, message: scrub(v.message) })),
    reasons: (verdict.reasons ?? []).map(scrub),
  };
  const event = {
    runId,
    timestamp: now(),
    configId,
    archetype: "research",
    verdict: recorded,
  };
  await makeJsonlSink(telemetryPath)(event);
  return event;
}
