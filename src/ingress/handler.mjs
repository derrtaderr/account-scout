// The intake, built ON webhook-engine.
//
// The library does the security work — HMAC over the raw bytes, the replay window,
// the atomic idempotency reservation, the dead letter queue — and this file does
// exactly one thing on top of it: turn a delivery that survived all of that into a
// validated ResearchRequest on the job queue.

import { createHash } from "node:crypto";
import { createEngine, MemoryDeadLetterQueue } from "webhook-engine";
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
 * A verified sender sent something the contract does not allow. Distinct from a
 * transient handler failure because the answer is a 4xx, not a redelivery: the bytes
 * are authentic and will fail identically forever, so the sender has to change them.
 *
 * The name travels: webhook-engine's error records keep `name`, which is how
 * handleDelivery recognises the class on the far side of the retry boundary.
 */
class SenderContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "SenderContractError";
    this.retryable = false;
  }
}

/**
 * THE JOB KEY COMES FROM THE SIGNED BODY. THERE IS NO HEADER FALLBACK.
 *
 * The HMAC covers the timestamp and the body. It does not cover `webhook-id`, so an
 * id read from that header is editable in flight by anything that can rewrite
 * headers — a proxy, a sidecar, a compromised load balancer.
 *
 * A fallback to the header was not a weaker version of this rule, it was the whole
 * hole: review demonstrated that ONE captured signature over an id-less body,
 * re-presented under `webhook-id: A`, `B`, `C`, produced THREE jobs. The signature
 * never had to be broken. Any middlebox on the path was an unlimited job generator.
 *
 * So the sender contract is now explicit and enforced: the signed body MUST carry
 * `requestId`. We own both ends of this interface, an id inside the HMAC-covered
 * bytes is unforgeable, and a verified body without one is a contract violation that
 * is refused by name rather than quietly keyed off something an attacker controls.
 */
function resolveRequestId(body, headers, rawText) {
  const fromBody = body?.requestId;
  if (typeof fromBody === "string" && fromBody.trim() !== "") return fromBody;

  // No requestId in the signed bytes. The delivery is still VERIFIED, so it carries
  // evidence worth keeping — but there is no sender-supplied key to keep it under,
  // and reaching for the header here is exactly the hole above. The content hash of
  // the signed bytes is a key that requires nothing unsigned: deterministic, so the
  // same bytes always land on the same record, and replay-stable, so a redelivery is
  // recognisably the duplicate it is.
  return `sha256:${createHash("sha256").update(rawText, "utf8").digest("hex")}`;
}

/**
 * Store one record per distinct event id.
 *
 * The engine releases the idempotency key after dead lettering, deliberately, so a
 * manual replay of a dead lettered event is allowed to run. Combined with a key that
 * is the content hash, that means the same malformed bytes redelivered N times push
 * N identical records — and `MemoryDeadLetterQueue` throws rather than evicting when
 * it fills, so a provider retrying broken bytes on a schedule would eventually take
 * the endpoint down with duplicates of one payload.
 *
 * Identical bytes are identical evidence. Keeping the first is keeping all of it.
 * Dedup is derived from what the inner queue actually holds rather than a private
 * Set, so a drained record can be recorded again and the two can never disagree.
 */
function dedupingDeadLetterQueue(inner) {
  return {
    async push(record) {
      const existing = (await inner.list()).find((r) => r.eventId === record.eventId);
      return existing ?? inner.push(record);
    },
    list: (...args) => inner.list(...args),
    get: (...args) => inner.get(...args),
    remove: (...args) => inner.remove(...args),
  };
}

/**
 * @param {object} options
 * @param {string|string[]} options.secret signing key, or several during a rotation
 * @param {string} [options.jobsDir] directory for the JSONL queue
 * @param {object} [options.queue] a pre-built queue, mostly for tests
 * @param {object} [options.dlq] dead letter backend; wrapped for dedup either way
 */
export function createIngress({
  secret,
  jobsDir = "jobs",
  queue = createJobQueue({ dir: jobsDir }),
  dlq = new MemoryDeadLetterQueue(),
  ...engineOptions
} = {}) {
  const engine = createEngine({
    secret,
    parse: reportingParse,
    eventId: resolveRequestId,
    dlq: dedupingDeadLetterQueue(dlq),
    ...engineOptions,
    handler: async (event) => {
      const parseFailure = event.body?.[PARSE_FAILURE];
      if (typeof parseFailure === "string")
        throw new SenderContractError(`body is not valid JSON: ${parseFailure}`);

      // The sender contract, enforced. Never event.id here: for a body with no
      // requestId that value is the content hash, and substituting it would invent
      // the key the sender failed to supply instead of refusing the delivery.
      const requestId = event.body?.requestId;
      if (typeof requestId !== "string" || requestId.trim() === "")
        throw new SenderContractError("the signed body must carry requestId");

      let request;
      try {
        request = makeResearchRequest({ ...event.body, requestId });
      } catch (error) {
        throw new SenderContractError(`not a research request: ${error.message}`);
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
  const result = await deps.engine.receive({ rawBody, headers });

  // webhook-engine answers 200 for a dead lettered event, and its reasoning is
  // right for the case it was written about: the record is durable, so asking the
  // provider to redeliver would burn its retry budget for a copy already safely
  // stored. A sender-contract violation is the other case. The bytes are authentic
  // and permanently wrong, so the sender — not a retry — has to change them, and a
  // 4xx is the only answer that says so. It is terminal at every provider, so it
  // does not reintroduce the redelivery storm the 200 exists to prevent.
  if (result.outcome === "dead_lettered" && result.errors?.[0]?.name === "SenderContractError") {
    return { ...result, status: 400, reason: result.errors[0].message };
  }

  return result;
}
