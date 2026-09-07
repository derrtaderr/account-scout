// The job queue's read side — the contract Lane B (the scout core) consumes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createJobQueue } from "../../src/ingress/queue.mjs";
import { makeResearchRequest } from "../../src/types.mjs";

function freshDir() {
  return mkdtempSync(join(tmpdir(), "account-scout-queue-"));
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

const request = (requestId, accountName) => makeResearchRequest({ accountName, requestId });

test("nextJob returns pending jobs oldest first, and null once drained", async () => {
  const queue = createJobQueue({ dir: freshDir() });

  await queue.append(request("req_001", "Northwind Robotics"));
  await queue.append(request("req_002", "Acme Freight"));

  const first = await queue.nextJob();
  assert.equal(first.requestId, "req_001");

  // Still first: nextJob is a peek, not a pop. Nothing is consumed until the
  // reader says it finished, so a crash mid-research redelivers the job.
  assert.equal((await queue.nextJob()).requestId, "req_001");

  assert.equal(await queue.completeJob("req_001"), true);
  assert.equal((await queue.nextJob()).requestId, "req_002");

  assert.equal(await queue.completeJob("req_002"), true);
  assert.equal(await queue.nextJob(), null, "a drained queue reports empty, never a stale job");
});

test("nextJob hands back the validated request as it was enqueued", async () => {
  const queue = createJobQueue({ dir: freshDir() });
  await queue.append(
    makeResearchRequest({
      accountName: "Lumen Freight",
      domain: "lumen.example",
      questions: ["who owns revenue operations?"],
      requestId: "req_full",
    }),
  );

  const job = await queue.nextJob();

  assert.equal(job.request.accountName, "Lumen Freight");
  assert.equal(job.request.domain, "lumen.example");
  assert.deepEqual(job.request.questions, ["who owns revenue operations?"]);
  assert.equal(typeof job.enqueuedAt, "string");
});

test("completing a job that was never enqueued is refused rather than silently accepted", async () => {
  const queue = createJobQueue({ dir: freshDir() });
  await queue.append(request("req_001", "Northwind Robotics"));

  assert.equal(await queue.completeJob("req_nonexistent"), false);
  assert.equal((await queue.nextJob()).requestId, "req_001", "the real job is untouched");
});

test("the jobs directory is created when it does not exist", async () => {
  // A first run on a clean checkout has no jobs/ at all, and a verified request must
  // not be lost to a missing directory.
  const dir = join(freshDir(), "jobs", "nested");
  const queue = createJobQueue({ dir });

  await queue.append(request("req_001", "Northwind Robotics"));

  assert.equal((await queue.nextJob()).requestId, "req_001");
});

// F4. nextJob is a peek, which means a job that crashes its reader is handed back
// forever. Without an exit, one poison payload stops the queue permanently and the
// only symptom is a scout that never makes progress.
test("a job claimed to the attempt limit is skipped and poisoned exactly once", async () => {
  const dir = freshDir();
  const queue = createJobQueue({ dir, maxAttempts: 3 });

  await queue.append(request("req_poison", "Northwind Robotics"));
  await queue.append(request("req_good", "Acme Freight"));

  // Three claims, no completion: the reader took it and died, three times.
  for (const expected of [1, 2, 3]) {
    const job = await queue.nextJob();
    assert.equal(job.requestId, "req_poison");
    assert.equal(await queue.claimJob("req_poison"), expected, "claimJob reports the attempt");
  }

  // The fourth read steps over it rather than handing back the same landmine.
  assert.equal((await queue.nextJob()).requestId, "req_good", "the queue makes progress again");

  const poisoned = readJsonl(join(dir, "poison.jsonl"));
  assert.equal(poisoned.length, 1, "reported once, never silently dropped and never spammed");
  assert.equal(poisoned[0].requestId, "req_poison");
  assert.equal(poisoned[0].attempts, 3);

  // Reading again must not append a second poison line for the same job.
  await queue.nextJob();
  assert.equal(readJsonl(join(dir, "poison.jsonl")).length, 1);
});

test("a job that completes within the attempt limit is never poisoned", async () => {
  const dir = freshDir();
  const queue = createJobQueue({ dir, maxAttempts: 3 });

  await queue.append(request("req_retried", "Lumen Freight"));

  // Two failed attempts, then success. The ordinary shape of a flaky dependency.
  await queue.claimJob("req_retried");
  await queue.claimJob("req_retried");
  assert.equal((await queue.nextJob()).requestId, "req_retried");
  await queue.claimJob("req_retried");
  await queue.completeJob("req_retried");

  assert.equal(await queue.nextJob(), null);
  assert.equal(existsSync(join(dir, "poison.jsonl")), false, "a completed job is not poison");
});

test("queue state survives a restart, because the file is the state", async () => {
  const dir = freshDir();
  const first = createJobQueue({ dir });
  await first.append(request("req_001", "Northwind Robotics"));
  await first.append(request("req_002", "Acme Freight"));
  await first.completeJob("req_001");

  // A different instance over the same directory: what a restarted scout sees.
  const restarted = createJobQueue({ dir });
  assert.equal((await restarted.nextJob()).requestId, "req_002");
});
