// The intake, built ON webhook-engine.
//
// The library does the security work — HMAC over the raw bytes, the replay window,
// the atomic idempotency reservation, the dead letter queue — and this file does
// exactly one thing on top of it: turn a delivery that survived all of that into a
// validated ResearchRequest on the job queue.

import { createEngine } from "webhook-engine";
import { makeResearchRequest } from "../types.mjs";
import { createJobQueue } from "./queue.mjs";

/**
 * @param {object} options
 * @param {string|string[]} options.secret signing key, or several during a rotation
 * @param {string} [options.jobsDir] directory for the JSONL queue
 * @param {object} [options.queue] a pre-built queue, mostly for tests
 */
export function createIngress({ secret, jobsDir = "jobs", queue = createJobQueue({ dir: jobsDir }), ...engineOptions } = {}) {
  const engine = createEngine({
    secret,
    ...engineOptions,
    handler: async (event) => {
      // The requestId IS the delivery id, so a replay of the same event resolves to
      // the same idempotency key and cannot produce a second job.
      const request = makeResearchRequest({ ...event.body, requestId: event.id });
      const job = await queue.append(request);
      return { requestId: job.requestId, enqueuedAt: job.enqueuedAt };
    },
  });

  const deps = { engine, queue };
  return {
    handleDelivery: (rawBody, headers) => handleDelivery(rawBody, headers, deps),
    engine,
    queue,
    store: engine.store,
    dlq: engine.dlq,
  };
}

/**
 * Pure in the sense that matters: no socket, no server, no ambient state. Everything
 * it touches arrives in `deps`, so the whole intake is testable without a port.
 *
 * @param {string|Buffer} rawBody the exact received bytes, before any parsing
 * @param {object} headers
 * @param {{engine: object}} deps
 */
export async function handleDelivery(rawBody, headers, deps) {
  return deps.engine.receive({ rawBody, headers });
}
