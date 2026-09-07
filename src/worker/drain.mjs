// Lane E — the worker. The seam that composes the whole system: it takes a
// verified, queued job and drives it through the scout and the gates to a
// judged, guarded, delivered report. Every other boundary already exists and
// is tested in isolation; this is where they meet.
//
// The ORDER is the contract, and each step is here for a failure it prevents:
//
//  1. nextJob() — a PEEK. The job stays visible until completeJob, so a worker
//     that dies mid-run has not consumed a verified request that no redelivery
//     is coming for (the provider already got its 200).
//  2. claimJob() BEFORE the work — the attempt is counted by the claim, so a
//     crash still increments toward the queue's poison exit. A claim written
//     after the work is never written by the crash it exists to count.
//  3. runScout() — a ScoutRefusal (provider failed closed, or researched
//     nothing) is an EXPECTED outcome: it is reported and the job is left
//     UNcompleted, so the queue retries it toward poison rather than swallowing
//     it as done. Any other throw is a DEFECT and propagates untouched — the
//     refusal/defect boundary from src/scout/errors.mjs, upheld here too.
//  4. process() — evaluate → telemetry → egress-guarded write. Its return is a
//     terminal DECISION (delivered / quarantined / refused-by-a-gate). The
//     research happened and the system decided; re-running would decide the
//     same. So every process() return completes the job. Only a throw leaves it
//     for retry.
//
// Everything the worker touches arrives in deps, so a full drain is testable
// without a port, a key, or the network.

import { randomUUID } from "node:crypto";

import { runScout } from "../scout/run.mjs";
import { processReport } from "../gates/pipeline.mjs";
import { ScoutRefusal } from "../scout/errors.mjs";

/**
 * Drive at most one queued job through the whole system.
 *
 * @param {object} deps
 * @param {object} deps.queue a createJobQueue instance
 * @param {(request: object) => Promise<object>} deps.providerFor builds the
 *   provider for a request (recorded picks the fixture; live returns the one
 *   live provider). Not called at all when the queue is idle.
 * @param {(request: object) => object} deps.egressFor the egress for a request —
 *   a factory, not one shared instance, because a report about account A must
 *   allow A's own domain while a report about B allows B's, and one egress
 *   cannot hold both allow-lists at once.
 * @param {(request: object) => string} deps.reportPathFor where a delivered
 *   report for this request lands (must end in ".md")
 * @param {(request: object) => Promise<string|undefined>} [deps.briefFor] the
 *   strategy brief, aimed by the kernel; undefined runs the scout unaimed
 * @param {(report: object, pdeps: object) => Promise<object>} [deps.process]
 *   the pipeline entry point (processReport by default; serve passes the
 *   autonomy-gated one)
 * @param {string} [deps.telemetryPath]
 * @param {string} [deps.configId]
 * @param {(request: object) => string} [deps.runIdFor]
 * @param {number} [deps.maxHops]
 * @param {() => string} [deps.now]
 * @returns {Promise<{idle: true} | {requestId: string, attempt: number, result?: object, refused?: string}>}
 */
export async function drainOnce(deps) {
  const {
    queue,
    providerFor,
    egressFor,
    reportPathFor,
    briefFor,
    process: processFn = processReport,
    telemetryPath,
    configId,
    runIdFor = () => randomUUID(),
    maxHops,
    gateN,
    now = () => new Date().toISOString(),
  } = deps;

  const job = await queue.nextJob();
  if (!job) return { idle: true };

  const request = job.request;
  const attempt = await queue.claimJob(request.requestId);

  const provider = await providerFor(request);
  const brief = briefFor ? await briefFor(request) : undefined;

  let report;
  try {
    report = await runScout({ request, provider, brief, maxHops, now });
  } catch (err) {
    // A ScoutRefusal is an expected failure: report it, leave the job for retry.
    // Anything else is a defect and must not be dressed up as a tidy refusal.
    if (err instanceof ScoutRefusal) {
      return { requestId: request.requestId, attempt, refused: err.message };
    }
    throw err;
  }

  const result = await processFn(report, {
    egress: egressFor(request),
    reportPath: reportPathFor(request),
    telemetryPath,
    configId,
    runId: runIdFor(request),
    gateN,
    now,
  });

  // A decision about the REPORT's content completes the job — delivered,
  // quarantined, or egress-refused all mean "this report was judged, re-running
  // decides the same." An autonomy refusal is NOT such a decision: it says the
  // agent may not run unattended right now, the verified request is untouched,
  // and consuming it would discard work no redelivery is coming for. So it
  // stays visible for retry, exactly like a ScoutRefusal.
  const permissionRefusal = result.status === "refused" && result.refusedBy === "autonomy";
  if (!permissionRefusal) await queue.completeJob(request.requestId);

  return { requestId: request.requestId, attempt, result };
}

/**
 * Drain the queue until it is idle, returning one entry per job worked.
 *
 * A refused job stays visible, so draining it in the same pass would spin until
 * the poison exit — `drainAll` therefore stops at the first job it cannot
 * complete in this pass and hands control back, exactly as a serve loop would
 * (it will come around again on the next tick, letting the attempt count climb
 * toward poison across ticks rather than in a tight spin).
 *
 * @param {object} deps as drainOnce
 * @param {object} [opts]
 * @param {number} [opts.max] a safety bound on jobs worked in one call
 * @returns {Promise<Array<object>>}
 */
export async function drainAll(deps, { max = Infinity } = {}) {
  const worked = [];
  while (worked.length < max) {
    const outcome = await drainOnce(deps);
    if (outcome.idle) break;
    worked.push(outcome);
    // A job left UNcompleted this pass would be handed straight back by nextJob,
    // spinning the loop. Both the ScoutRefusal path (outcome.refused) and an
    // autonomy refusal (uncompleted on purpose) are such jobs — stop and let the
    // caller's cadence drive retries, rather than tight-looping toward poison.
    const autonomyRefusal =
      outcome.result?.status === "refused" && outcome.result?.refusedBy === "autonomy";
    if (outcome.refused || autonomyRefusal) break;
  }
  return worked;
}
