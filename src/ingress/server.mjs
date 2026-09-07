// The local HTTP listener. node:http, no framework.
//
// It is deliberately thin, because the only thing it can get wrong is the thing
// that matters: THE BYTES. The HMAC covers the exact octets the sender hashed, so
// the body is collected as a Buffer and handed over untouched. Anything that reads
// the request as text through a decoder, or parses and reserialises it, changes the
// digest and refuses genuine traffic — the failure that gets a receiver "fixed" by
// loosening verification until it stops rejecting anything.

import { createServer } from "node:http";

const MAX_BODY_BYTES = 1_000_000;

/** Collect the raw request bytes, bounded. An unbounded read behind an unauthenticated
 *  endpoint is a memory exhaustion vector with a nice name. */
function readRawBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("request body too large"), { tooLarge: true }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}

/**
 * @param {{handleDelivery: (rawBody: Buffer, headers: object) => Promise<object>}} ingress
 * @returns {import('node:http').Server}
 */
export function createIngressServer(ingress) {
  if (typeof ingress?.handleDelivery !== "function")
    throw new TypeError("createIngressServer needs an ingress with handleDelivery()");

  return createServer(async (req, res) => {
    if (req.method !== "POST") {
      send(res, 405, { outcome: "method_not_allowed", allow: "POST" });
      return;
    }

    let rawBody;
    try {
      rawBody = await readRawBody(req);
    } catch (error) {
      send(res, error.tooLarge ? 413 : 400, {
        outcome: "unreadable_body",
        reason: error.message,
      });
      return;
    }

    try {
      const result = await ingress.handleDelivery(rawBody, req.headers);
      // The engine's status IS the contract, including the deliberate 200 on a dead
      // lettered event: the record is durable, so asking for a redelivery would burn
      // the provider's retry budget for a copy already safely stored.
      const { status, ...body } = result;
      send(res, status, body);
    } catch (error) {
      // Never echo the error body to the caller: an exception raised while handling
      // attacker-controlled bytes can carry fragments of them, and the signature
      // header is in scope here. The reason goes to the operator, not the sender.
      send(res, 500, { outcome: "ingress_error" });
      process.emitWarning(`ingress handler threw: ${error.message}`);
    }
  });
}
