// Lane D — the composed check. One entry point turns a completed run into a
// judged, recorded, guarded artifact: evaluate → telemetry → egress-guarded
// write, in that order, and NOTHING is decided silently.
//
// - The verdict is recorded BEFORE any write is attempted, so the autonomy
//   streak sees every run, including the ones whose reports never landed.
// - A BLOCK verdict quarantines the report as `.blocked.md` — the evidence of
//   what was blocked survives for the human, it just never wears the name of
//   a delivered report. A silent drop would be indistinguishable from a run
//   that never happened.
// - An egress refusal (redaction-gate caught a survivor) becomes a structured
//   result naming what refused and why. The refusal message carries classes
//   and positions, never values — that guarantee is the library's and this
//   module passes it through untouched.
// - Anything else escaping is a defect and is NOT converted to a result; it
//   propagates, per the refusal/defect boundary in src/scout/errors.mjs.

import { RESEARCH_CONFIG_ID, TELEMETRY_PATH, evaluateReport, recordVerdict } from "./evals.mjs";
import { allowUnattended, DEFAULT_GATE_N } from "./autonomy.mjs";

/**
 * @typedef {object} ProcessResult
 * @property {"delivered"|"quarantined"|"refused"} status
 * @property {object} [verdict] the eval verdict (absent only on an autonomy refusal)
 * @property {object} [event] the telemetry event as written
 * @property {string} [reportPath] where the report landed, when it landed
 * @property {"evals"|"egress"|"autonomy"} [refusedBy] which gate said no
 * @property {string} [reason] why, in that gate's own words
 */

/**
 * The composed check: evaluate → telemetry → egress-guarded write.
 *
 * @param {object} report a frozen ResearchReport
 * @param {object} deps
 * @param {object} deps.egress from createEgress — owns the guarded writers
 * @param {string} deps.reportPath where a delivered report lands (".md")
 * @param {string} [deps.telemetryPath]
 * @param {string} [deps.configId]
 * @param {string} [deps.runId]
 * @param {() => string} [deps.now]
 * @returns {Promise<ProcessResult>}
 */
export async function processReport(report, deps) {
  const {
    egress,
    reportPath,
    telemetryPath = TELEMETRY_PATH,
    configId = RESEARCH_CONFIG_ID,
    runId,
    now,
  } = deps;
  if (!egress || !reportPath) {
    throw new Error("processReport needs deps.egress and deps.reportPath — refusing to guess where a report lands");
  }
  if (!reportPath.endsWith(".md")) {
    // A quarantined report renames .md -> .blocked.md; any other extension would
    // silently wear the delivered name. Refused at the door rather than guessed.
    throw new Error(`processReport needs a reportPath ending in .md, got ${reportPath}`);
  }

  const verdict = await evaluateReport(report);

  const blocked = verdict.status === "BLOCK";
  const destination = blocked ? reportPath.replace(/\.md$/, ".blocked.md") : reportPath;

  // Telemetry is recorded AFTER the write attempt, with a delivery-aware status.
  // The streak's promise is "clean, delivered runs" — a run whose report tripped
  // the egress gate shipped nothing and must never count as PASS, or three
  // caught leaks in a row would earn unattended mode (found by review, live).
  let egressRefusal = null;
  try {
    await egress.writeReport(report, destination);
  } catch (err) {
    if (err?.name !== "RedactionRefusal") throw err; // a defect, not a refusal
    egressRefusal = err;
  }

  const recordedVerdict = egressRefusal
    ? Object.freeze({
        status: "BLOCK",
        violations: verdict.violations,
        reasons: Object.freeze([
          `egress refused: ${String(egressRefusal.message).split("\n")[0]}`,
          ...verdict.reasons,
        ]),
      })
    : verdict;
  const event = await recordVerdict({
    verdict: recordedVerdict,
    runId, configId, telemetryPath, now,
    redactText: egress.redactText,
  });

  if (egressRefusal) {
    return {
      status: "refused",
      refusedBy: "egress",
      verdict,
      event,
      reason: egressRefusal.message,
    };
  }

  if (blocked) {
    return {
      status: "quarantined",
      refusedBy: "evals",
      verdict,
      event,
      reportPath: destination,
      reason: verdict.reasons.join("; "),
    };
  }
  return { status: "delivered", verdict, event, reportPath: destination };
}

/**
 * The unattended path: consult the autonomy gate FIRST, before any work. A
 * refused decision does not evaluate, does not write telemetry, does not
 * touch disk — an agent that has not earned unattended mode does nothing
 * unattended, including scoring itself.
 *
 * @param {object} report
 * @param {object} deps as processReport, plus:
 * @param {number} [deps.gateN]
 * @returns {Promise<ProcessResult & {autonomy?: object}>}
 */
export async function processUnattended(report, deps) {
  const {
    telemetryPath = TELEMETRY_PATH,
    configId = RESEARCH_CONFIG_ID,
    gateN = DEFAULT_GATE_N,
  } = deps;

  const decision = allowUnattended(configId, { telemetryPath, gateN });
  if (!decision.allowed) {
    return { status: "refused", refusedBy: "autonomy", reason: decision.reason, autonomy: decision };
  }
  const result = await processReport(report, deps);
  return { ...result, autonomy: decision };
}
