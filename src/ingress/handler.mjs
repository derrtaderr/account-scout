// The intake, built ON webhook-engine.
//
// The library does the security work — HMAC over the raw bytes, the replay window,
// the atomic idempotency reservation, the dead letter queue — and this file does
// exactly one thing on top of it: turn a delivery that survived all of that into a
// validated ResearchRequest on the job queue.

import { createEngine, DEFAULT_ID_HEADER } from "webhook-engine";
import { makeResearchRequest } from "../types.mjs";
import { createJobQueue } from "./queue.mjs";

/** Marks a body the JSON parser refused, so the failure reaches the handler as a
 *  value instead of escaping as an exception. Symbol-keyed, so no payload field
 *  can forge it. */
const PARSE_FAILURE = Symbol("ingress.parseFailure");

/**
 * Parsing that reports rather than throws.
 *
 * webhook-engine's default `parse` is JSON.parse, and a throw from it answers 400
 * `unparsable` with nothing stored. That is the right default for a library — but a
 * body here arrived from a sender that PASSED verification, so the broken payload is
 * evidence worth keeping and replaying, not noise worth dropping. Returning the
 * failure instead of throwing moves the decision into the handler, whose failures
 * are exactly what the dead letter queue is for.
 *
 * Verification still runs first. This changes where a parse failure lands, never
 * whether an unauthenticated caller gets to reach the parser at all.
 */
function reportingParse(rawText) {
  try {
    return JSON.parse(rawText);
  } catch (error) {
    return { [PARSE_FAILURE]: error.message };
  }
}

/**
 * A failure that will fail identically on every retry. `retryable: false` is
 * webhook-engine's own classifier hook: it sends the delivery to the dead letter
 * queue after one attempt instead of four, because retrying a validation error is
 * four times the load for the same answer.
 */
function permanent(message) {
  const error = new Error(message);
  error.retryable = false;
  return error;
}

/**
 * THE ID COMES FROM THE SIGNED BODY FIRST, AND THE HEADER IS ONLY A FALLBACK.
 *
 * The HMAC covers the timestamp and the body. It does not cover `webhook-id`, so an
 * id read from that header is editable in flight by anything that can rewrite
 * headers — a proxy, a sidecar, a compromised load balancer. Preferring the header
 * would let one signed delivery be re-presented under a fresh id and enqueued a
 * second time, which defeats the replay refusal without ever touching the signature.
 * Reading the body first means the idempotency key is covered by the signature
 * whenever the sender puts it there.
 */
function resolveRequestId(body, headers) {
  const fromBody = body?.requestId ?? body?.id ?? body?.event_id ?? body?.eventId;
  if (typeof fromBody === "string" && fromBody.length > 0) return fromBody;
  const fromHeader = headers.get(DEFAULT_ID_HEADER);
  return typeof fromHeader === "string" && fromHeader.length > 0 ? fromHeader : null;
}

/**
 * @param {object} options
 * @param {string|string[]} options.secret signing key, or several during a rotation
 * @param {string} [options.jobsDir] directory for the JSONL queue
 * @param {object} [options.queue] a pre-built queue, mostly for tests
 */
export function createIngress({ secret, jobsDir = "jobs", queue = createJobQueue({ dir: jobsDir }), ...engineOptions } = {}) {
  const engine = createEngine({
    secret,
    parse: reportingParse,
    eventId: resolveRequestId,
    ...engineOptions,
    handler: async (event) => {
      const parseFailure = event.body?.[PARSE_FAILURE];
      if (typeof parseFailure === "string")
        throw permanent(`body is not valid JSON: ${parseFailure}`);

      // The requestId IS the delivery id, so a replay of the same event resolves to
      // the same idempotency key and cannot produce a second job.
      let request;
      try {
        request = makeResearchRequest({ ...event.body, requestId: event.id });
      } catch (error) {
        throw permanent(`not a research request: ${error.message}`);
      }

      const job = await queue.append(request);
      return { requestId: job.requestId, enqueuedAt: job.enqueuedAt };
    },
  });

  /**
   * The local path. No socket and no signature — there is no remote sender to
   * authenticate — but the request contract and the idempotency key still apply.
   * A convenience door that skipped validation would be the one place a malformed
   * request could reach the scout, which is the whole thing this lane refuses.
   *
   * Unlike the webhook path, a refusal throws rather than dead lettering: the
   * caller is a person at a terminal who can read the message and fix the input.
   *
   * @param {object} input accountName, optional domain, optional questions, requestId
   */
  async function enqueueLocal(input) {
    const request = makeResearchRequest(input);

    const claim = await engine.store.reserve(request.requestId);
    if (claim.state === "done") return claim.result;
    if (claim.state === "in_flight")
      throw new Error(`requestId ${request.requestId} is already being enqueued`);

    try {
      const job = await queue.append(request);
      await engine.store.complete(request.requestId, job);
      return job;
    } catch (error) {
      // The key must not outlive a failed append, or a retry of a transient disk
      // error comes back as a duplicate and the request is lost.
      await engine.store.release(request.requestId);
      throw error;
    }
  }

  const deps = { engine, queue };
  return {
    handleDelivery: (rawBody, headers) => handleDelivery(rawBody, headers, deps),
    enqueueLocal,
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
