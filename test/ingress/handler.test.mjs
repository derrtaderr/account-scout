// Lane A — ingress. The thesis under test is fail-closed: a delivery that cannot
// prove itself never becomes a job, and the refusal names what was wrong.
//
// Every secret in this file is synthetic and invented for the test. Nothing here
// is a real key, and no test prints a secret or a raw signature.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signHeader } from "webhook-engine";

import { createIngress } from "../../src/ingress/handler.mjs";

/** Synthetic, invented here, never a real key. */
const SECRET = "whsec_synthetic_lane_a_do_not_use";

function freshDir() {
  return mkdtempSync(join(tmpdir(), "account-scout-ingress-"));
}

/** Build a signed delivery the way a provider would: HMAC over the RAW bytes. */
function signedDelivery(body, { secret = SECRET, timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const rawBody = typeof body === "string" ? body : JSON.stringify(body);
  return {
    rawBody,
    headers: {
      "content-type": "application/json",
      "webhook-signature": signHeader({ rawBody, secret, timestamp }),
    },
  };
}

function readJobs(dir) {
  const path = join(dir, "pending.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

test("a verified delivery becomes exactly one JSONL job carrying the request", async () => {
  const dir = freshDir();
  const ingress = createIngress({ secret: SECRET, jobsDir: dir });

  const { rawBody, headers } = signedDelivery({
    id: "evt_northwind_001",
    accountName: "Northwind Robotics",
    domain: "northwind.example",
    questions: ["who owns revenue operations?"],
  });

  const result = await ingress.handleDelivery(rawBody, headers);

  assert.equal(result.status, 200);
  assert.equal(result.outcome, "processed");

  const jobs = readJobs(dir);
  assert.equal(jobs.length, 1, "exactly one job enqueued");
  assert.equal(jobs[0].request.accountName, "Northwind Robotics");
  assert.equal(jobs[0].request.domain, "northwind.example");
  assert.deepEqual(jobs[0].request.questions, ["who owns revenue operations?"]);
  // The requestId IS the delivery id, so a replay cannot double-enqueue.
  assert.equal(jobs[0].request.requestId, "evt_northwind_001");
});

test("a delivery signed with the wrong secret is refused and enqueues nothing", async () => {
  const dir = freshDir();
  const ingress = createIngress({ secret: SECRET, jobsDir: dir });

  // Signed with a different synthetic key, which is what an attacker has.
  const { rawBody, headers } = signedDelivery(
    { id: "evt_forged_001", accountName: "Acme Freight" },
    { secret: "whsec_synthetic_wrong_key" },
  );

  const result = await ingress.handleDelivery(rawBody, headers);

  assert.equal(result.status, 401);
  assert.equal(result.outcome, "rejected");
  assert.equal(result.reason, "no_matching_signature", "the refusal names what was wrong");
  assert.equal(readJobs(dir).length, 0, "an unverified delivery never becomes a job");

  // And it fills nothing durable either. webhook-engine verifies BEFORE it parses or
  // stores, so an unauthenticated caller can exhaust neither the idempotency store
  // nor the dead letter queue. See the deviation note in src/ingress/WIRING.md.
  assert.equal((await ingress.dlq.list()).length, 0);
});

// The positive control for the test above. Same bytes, same headers, same delivery —
// the only thing that changes is which secret the intake holds. It proves the refusal
// is decided by the signature comparison rather than by something incidental (a
// malformed header, a missing timestamp), which is what would make the test vacuous.
test("the same bytes that were refused are accepted by the intake holding the matching secret", async () => {
  const dir = freshDir();
  const forgedKey = "whsec_synthetic_wrong_key";

  const { rawBody, headers } = signedDelivery(
    { id: "evt_forged_001", accountName: "Acme Freight" },
    { secret: forgedKey },
  );

  const refusing = createIngress({ secret: SECRET, jobsDir: freshDir() });
  assert.equal((await refusing.handleDelivery(rawBody, headers)).status, 401);

  const accepting = createIngress({ secret: forgedKey, jobsDir: dir });
  const result = await accepting.handleDelivery(rawBody, headers);

  assert.equal(result.status, 200);
  assert.equal(result.outcome, "processed");
  assert.equal(readJobs(dir).length, 1);
});
