// The report builder. Thin on purpose: makeResearchReport in the frozen
// contract already validates the shape, so the only judgment this file adds is
// the one the contract cannot express.
//
// That judgment: a run that fetched zero hops must not produce a report at all.
// An empty claims[] with an empty refusals[] reads as "we looked and found
// nothing to worry about", which is exactly the sentence a run that never
// looked must never be able to emit. Researching nothing is a refusal.

import { makeResearchReport } from "../types.mjs";
import { ScoutRefusal } from "../scout/errors.mjs";

/**
 * @param {object} args
 * @param {import("../types.mjs").ResearchRequest} args.request
 * @param {Array<object>} args.hops
 * @param {Array<object>} args.claims
 * @param {Array<object>} args.refusals
 * @param {{mode: string, model?: string}} args.meta
 * @param {string} [args.generatedAt] ISO, defaults to now.
 * @returns {object} A frozen ResearchReport.
 * @throws {ScoutRefusal} when the run fetched nothing.
 */
export function buildResearchReport({ request, hops, claims, refusals, meta, generatedAt }) {
  if (!Array.isArray(hops) || hops.length === 0)
    throw new ScoutRefusal(
      `refusing to report on ${request.accountName}: this run researched nothing ` +
        `(zero hops fetched), and a run that researched nothing must not report an all-clear. ` +
        `Check the provider — in recorded mode the fixture store's searches did not match the ` +
        `planned queries; in live mode no page was reachable.`,
    );

  return makeResearchReport({
    account: request.accountName,
    generatedAt: generatedAt ?? new Date().toISOString(),
    claims,
    refusals,
    hops,
    meta,
  });
}
