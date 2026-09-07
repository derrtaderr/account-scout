// Lane D — autonomy is earned, never assumed. The unattended path (processing
// queue jobs with no human watching) consults this before touching a job.
//
// The whole decision is the library's: readEvents parses the telemetry (and
// refuses corrupt lines and tz-less timestamps loudly rather than counting
// them), autonomyStreak counts consecutive PASSes back from the most recent
// run. This module only compares that number to the gate and words the
// refusal so it NAMES the streak and the gate — an operator reading it knows
// exactly how far from earned the agent is and what resets it.

import { readEvents, autonomyStreak } from "gtm-agent-evals/dist/index.js";
import { TELEMETRY_PATH } from "./evals.mjs";

/** Clean runs required before unattended mode is allowed. */
export const DEFAULT_GATE_N = 3;

/**
 * Decide whether `configId` has earned unattended operation.
 *
 * @param {string} configId whose streak to read
 * @param {object} [opts]
 * @param {string} [opts.telemetryPath] defaults to the repo convention
 * @param {number} [opts.gateN] clean runs required, default 3
 * @returns {{allowed: true, streak: number, gateN: number} |
 *           {allowed: false, streak: number, gateN: number, reason: string}}
 * @throws when the telemetry itself cannot be trusted (corrupt line, tz-less
 *   timestamp) — a gate must never decide over evidence it cannot read.
 */
export function allowUnattended(configId, { telemetryPath = TELEMETRY_PATH, gateN = DEFAULT_GATE_N } = {}) {
  const events = readEvents(telemetryPath);
  const streak = autonomyStreak(events, configId);
  if (streak >= gateN) return { allowed: true, streak, gateN };
  return {
    allowed: false,
    streak,
    gateN,
    reason:
      `streak ${streak} of ${gateN} — unattended mode refused for "${configId}": ` +
      `${gateN} consecutive PASS runs are required before jobs are processed without a human, ` +
      `and any BLOCK resets the count. Run attended until the streak is earned.`,
  };
}
