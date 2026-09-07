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
import { createHash } from "node:crypto";
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

/** The DLQ key for a verified delivery whose body carries no requestId. */
function hashKey(rawBody) {
  return `sha256:${createHash("sha256").update(rawBody, "utf8").digest("hex")}`;
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
    requestId: "evt_northwind_001",
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
    { requestId: "evt_forged_001", accountName: "Acme Freight" },
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
    { requestId: "evt_forged_001", accountName: "Acme Freight" },
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

test("a replayed delivery is refused as a duplicate and enqueues exactly one job", async () => {
  const dir = freshDir();
  const ingress = createIngress({ secret: SECRET, jobsDir: dir });

  // The identical bytes, delivered twice. This is not an edge case: every provider
  // redelivers when its 200 is lost on the way back.
  const { rawBody, headers } = signedDelivery({
    requestId: "evt_replay_001",
    accountName: "Lumen Freight",
  });

  const first = await ingress.handleDelivery(rawBody, headers);
  const second = await ingress.handleDelivery(rawBody, headers);

  assert.equal(first.outcome, "processed");
  assert.equal(second.outcome, "duplicate", "the refusal names what was wrong");
  assert.equal(second.eventId, "evt_replay_001");

  assert.equal(readJobs(dir).length, 1, "a replay never produces a second job");
});

test("a delivery replayed outside the timestamp window is refused and enqueues nothing", async () => {
  const dir = freshDir();
  const ingress = createIngress({ secret: SECRET, jobsDir: dir });

  // Correctly signed, but captured an hour ago. The timestamp is bound into the
  // signed payload, so an attacker cannot freshen it without the key.
  const stale = Math.floor(Date.now() / 1000) - 3600;
  const { rawBody, headers } = signedDelivery(
    { requestId: "evt_stale_001", accountName: "Northwind Robotics" },
    { timestamp: stale },
  );

  const result = await ingress.handleDelivery(rawBody, headers);

  assert.equal(result.status, 401);
  assert.equal(result.outcome, "rejected");
  assert.equal(result.reason, "timestamp_out_of_tolerance");
  assert.equal(readJobs(dir).length, 0);
});

test("a verified delivery whose body is not JSON is dead lettered with the reason", async () => {
  const dir = freshDir();
  const ingress = createIngress({ secret: SECRET, jobsDir: dir });

  // Genuinely from the provider — the signature is valid over these bytes. The bytes
  // just are not JSON. A verified sender's broken payload is worth keeping, which is
  // what separates it from the forged delivery above.
  const rawBody = "{not json at all";
  const { headers } = signedDelivery(rawBody);

  const result = await ingress.handleDelivery(rawBody, headers);

  assert.equal(result.outcome, "dead_lettered");
  assert.equal(readJobs(dir).length, 0, "a body that cannot be parsed never becomes a job");

  const records = await ingress.dlq.list();
  assert.equal(records.length, 1);
  // Keyed by the content hash of the signed bytes: an unparsable body has no
  // requestId to be keyed by, and the header is not allowed to supply one.
  assert.equal(records[0].eventId, hashKey(rawBody));
  assert.match(records[0].errors[0].message, /JSON/i, "the refusal names what was wrong");

  // Parsing the same bytes a second time produces the same failure, so retrying is
  // pure cost. The classifier must stop it at one attempt.
  assert.equal(records[0].attempts, 1);
});

test("a verified delivery that fails makeResearchRequest is dead lettered with the reason", async () => {
  const dir = freshDir();
  const ingress = createIngress({ secret: SECRET, jobsDir: dir });

  // Valid JSON, correctly signed, and still not a research request: no accountName.
  const { rawBody, headers } = signedDelivery({
    requestId: "evt_no_account_001",
    domain: "northwind.example",
  });

  const result = await ingress.handleDelivery(rawBody, headers);

  assert.equal(result.outcome, "dead_lettered");
  assert.equal(readJobs(dir).length, 0, "an invalid request never becomes a job");

  const records = await ingress.dlq.list();
  assert.equal(records.length, 1);
  assert.equal(records[0].eventId, "evt_no_account_001");
  assert.match(records[0].errors[0].message, /accountName/);
  assert.equal(records[0].attempts, 1);
});

// F1, the reviewer's demonstrated blocker. The sender contract is decided: the SIGNED
// body must carry requestId. It is inside the HMAC-covered bytes and therefore
// unforgeable, where webhook-id is editable by any middlebox on the path.
test("one signed id-less body replayed under three header ids yields zero jobs", async () => {
  const dir = freshDir();
  const ingress = createIngress({ secret: SECRET, jobsDir: dir });

  // ONE signature over ONE body that carries no requestId. The attacker cannot alter
  // the bytes, but they can rewrite the header freely — so if the header ever decided
  // the job key, this one capture would become an unlimited job generator.
  const { rawBody, headers } = signedDelivery({ accountName: "Northwind Robotics" });

  const statuses = [];
  for (const forgedId of ["A", "B", "C"]) {
    const result = await ingress.handleDelivery(rawBody, { ...headers, "webhook-id": forgedId });
    statuses.push(result.status);
  }

  assert.deepEqual(statuses, [400, 400, 400], "each delivery is refused, naming the contract");
  assert.equal(readJobs(dir).length, 0, "three header ids, zero jobs");
});

test("a verified body with no requestId is refused naming the sender contract", async () => {
  const dir = freshDir();
  const ingress = createIngress({ secret: SECRET, jobsDir: dir });

  const { rawBody, headers } = signedDelivery({ accountName: "Acme Freight" });
  const result = await ingress.handleDelivery(rawBody, headers);

  assert.equal(result.status, 400);
  assert.equal(readJobs(dir).length, 0);

  const records = await ingress.dlq.list();
  assert.equal(records.length, 1, "verified traffic has evidence value, so it is kept");
  assert.match(records[0].errors[0].message, /signed body must carry requestId/);
});

// F2. The DLQ path must not depend on anything unsigned. With the header fallback
// gone, a verified-but-malformed delivery that carries no webhook-id at all still
// has to be recorded — otherwise the "evidence worth keeping" rationale evaporates
// exactly when the sender is most obviously broken.
test("verified garbage with no webhook-id header is dead lettered, keyed by content hash", async () => {
  const dir = freshDir();
  const ingress = createIngress({ secret: SECRET, jobsDir: dir });

  const rawBody = '{"requestId":"evt_trailing"} and then trailing bytes';
  const { headers } = signedDelivery(rawBody);
  assert.equal(headers["webhook-id"], undefined, "nothing unsigned is in play");

  const result = await ingress.handleDelivery(rawBody, headers);

  assert.equal(result.status, 400);
  assert.equal(result.outcome, "dead_lettered");
  assert.equal(readJobs(dir).length, 0);

  const records = await ingress.dlq.list();
  assert.equal(records.length, 1);
  assert.equal(records[0].eventId, hashKey(rawBody));
  assert.match(records[0].errors[0].message, /JSON/i, "the record names what was wrong");
});

test("the same garbage bytes replayed keep exactly one dead letter record", async () => {
  const dir = freshDir();
  const ingress = createIngress({ secret: SECRET, jobsDir: dir });

  const rawBody = "{not json at all";
  const { headers } = signedDelivery(rawBody);

  await ingress.handleDelivery(rawBody, headers);
  await ingress.handleDelivery(rawBody, headers);
  await ingress.handleDelivery(rawBody, headers);

  const records = await ingress.dlq.list();
  assert.equal(records.length, 1, "identical bytes are identical evidence, stored once");
  assert.equal(records[0].eventId, hashKey(rawBody));
  assert.equal(readJobs(dir).length, 0);
});

test("enqueueLocal skips HTTP but not validation", async () => {
  const dir = freshDir();
  const ingress = createIngress({ secret: SECRET, jobsDir: dir });

  const job = await ingress.enqueueLocal({
    accountName: "Northwind Robotics",
    domain: "northwind.example",
    requestId: "local_001",
  });

  assert.equal(job.requestId, "local_001");
  assert.equal(readJobs(dir).length, 1);
  assert.equal(readJobs(dir)[0].request.accountName, "Northwind Robotics");
});

test("a malformed local request is refused exactly as a malformed delivery is", async () => {
  const dir = freshDir();
  const ingress = createIngress({ secret: SECRET, jobsDir: dir });

  // No accountName. The local path has no signature to check, which is precisely why
  // it must not become the door that skips the request contract too.
  await assert.rejects(
    () => ingress.enqueueLocal({ domain: "northwind.example", requestId: "local_bad" }),
    /accountName/,
  );

  assert.equal(readJobs(dir).length, 0, "a refused local request never becomes a job");
});

test("enqueueLocal is idempotent on requestId, so a rerun does not double-enqueue", async () => {
  const dir = freshDir();
  const ingress = createIngress({ secret: SECRET, jobsDir: dir });

  const request = { accountName: "Acme Freight", requestId: "local_rerun" };
  await ingress.enqueueLocal(request);
  await ingress.enqueueLocal(request);

  assert.equal(readJobs(dir).length, 1, "the requestId is the idempotency key on both paths");
});
