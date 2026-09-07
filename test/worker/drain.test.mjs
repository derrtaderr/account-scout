// Lane E — the worker. The seam that turns a verified, queued job into a
// judged, guarded, delivered report. It is the one place ingress, the scout,
// the kernel brief, and the gates meet, so these tests drive the REAL recorded
// provider and the REAL gates rather than stubs — a worker that passed against
// fakes would prove nothing about the system it exists to compose.
//
// The load-bearing behaviours, each with its own test:
//  - an empty queue is idle and touches no provider;
//  - a queued job runs the scout, lands a report, records telemetry, and is
//    marked complete exactly once;
//  - the job is CLAIMED before the work, so a crash mid-run still counts an
//    attempt (the poison exit depends on it);
//  - a ScoutRefusal leaves the job UNcompleted, so the queue can retry it
//    toward the poison exit rather than swallowing it as done;
//  - a defect propagates rather than being converted to a completed job;
//  - the strategy brief reaches the run.

// Keyless: recorded mode needs no Anthropic key, and its absence is the test.
delete process.env.ANTHROPIC_API_KEY;

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { readEvents } from "gtm-agent-evals/dist/index.js";

import { createJobQueue } from "../../src/ingress/queue.mjs";
import { recordedProvider } from "../../src/scout/provider-recorded.mjs";
import { createEgress } from "../../src/gates/egress.mjs";
import { makeResearchRequest } from "../../src/types.mjs";
import { ScoutRefusal } from "../../src/scout/errors.mjs";
import { drainOnce, drainAll } from "../../src/worker/drain.mjs";

const fixture = (slug) => fileURLToPath(new URL(`../../fixtures/${slug}/`, import.meta.url));
const FROZEN_NOW = () => "2026-09-07T12:00:09.000Z";

function makeHarness(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), "as-worker-"));
  const queue = createJobQueue({ dir: join(dir, "jobs") });
  const egress = createEgress({
    allowDomains: ["northwindrobotics.com"],
    out: { write: () => {} },
  });
  const deps = {
    queue,
    providerFor: async () => recordedProvider(fixture("northwind-robotics")),
    reportPathFor: (request) => join(dir, "reports", `${request.requestId}.md`),
    telemetryPath: join(dir, "telemetry", "events.jsonl"),
    egressFor: () => egress,
    now: FROZEN_NOW,
    runIdFor: (request) => `run-${request.requestId}`,
    ...overrides,
  };
  return { dir, queue, egress, deps };
}

test("an empty queue is idle and never reaches for a provider", async () => {
  let providerAsked = false;
  const { deps } = makeHarness({
    providerFor: async () => {
      providerAsked = true;
      throw new Error("must not be called on an idle queue");
    },
  });

  const result = await drainOnce(deps);

  assert.deepEqual(result, { idle: true });
  assert.equal(providerAsked, false, "an idle drain must not construct a provider");
});

test("a queued job runs the scout, lands a report, records telemetry, and completes once", async () => {
  const { queue, deps } = makeHarness();
  const request = makeResearchRequest({
    accountName: "Northwind Robotics",
    domain: "northwindrobotics.com",
    requestId: "req-w1",
  });
  await queue.append(request);

  const result = await drainOnce(deps);

  assert.equal(result.requestId, "req-w1");
  assert.equal(result.result.status, "delivered");
  assert.ok(existsSync(result.result.reportPath), "the report must be on disk");
  assert.match(readFileSync(result.result.reportPath, "utf8"), /Northwind Robotics/);

  const events = readEvents(deps.telemetryPath);
  assert.equal(events.length, 1, "exactly one telemetry event for one run");

  // Completed: the next drain is idle, and a second run does not re-deliver.
  assert.deepEqual(await drainOnce(deps), { idle: true });
});

test("the job is claimed BEFORE the work, so a run that throws still counts an attempt", async () => {
  const { queue, deps } = makeHarness({
    // A provider that blows up mid-run — a defect, not a ScoutRefusal.
    providerFor: async () => ({
      mode: "recorded",
      account: { accountName: "Northwind Robotics" },
      async search() {
        throw new ScoutRefusal("the run failed closed during search: injected");
      },
      async fetchPage() {
        throw new Error("unreached");
      },
      async proposeClaims() {
        throw new Error("unreached");
      },
    }),
  });
  await queue.append(
    makeResearchRequest({ accountName: "Northwind Robotics", requestId: "req-w2" }),
  );

  const result = await drainOnce(deps);

  // A ScoutRefusal is reported, not thrown, and the job is NOT completed.
  assert.equal(result.requestId, "req-w2");
  assert.ok(result.refused, "a ScoutRefusal comes back as a reported refusal");
  assert.match(result.refused, /failed closed/);
  assert.equal(result.attempt, 1, "the attempt was claimed before the failing run");

  // Uncompleted: it is still the next job (until the poison exit takes it).
  const next = await queue.nextJob();
  assert.equal(next?.requestId, "req-w2", "a refused job stays visible for retry");
});

test("a defect in the pipeline propagates rather than silently completing the job", async () => {
  // runScout fails CLOSED on any provider throw, wrapping even a raw TypeError
  // as a ScoutRefusal — so a provider-layer defect can never reach the worker
  // as a defect. The genuine defect boundary here is the pipeline: a throw from
  // process() that is NOT a refusal must propagate, and the job must NOT be
  // completed (a defect is not a decision).
  const { queue, deps } = makeHarness({
    process: async () => {
      throw new TypeError("programming error in the pipeline");
    },
  });
  await queue.append(
    makeResearchRequest({
      accountName: "Northwind Robotics",
      domain: "northwindrobotics.com",
      requestId: "req-w3",
    }),
  );

  await assert.rejects(() => drainOnce(deps), /programming error/);

  // The job was not completed — it is still the next job.
  assert.equal((await queue.nextJob())?.requestId, "req-w3");
});

test("an autonomy refusal does NOT complete the job — permission is not a decision about the report", async () => {
  // A refused-by-egress or quarantine is a decision about THIS report's content;
  // re-running decides the same, so the job is done. A refused-by-AUTONOMY is
  // different: the agent lacks permission to run unattended right now, the
  // verified request is untouched, and consuming it would discard work no
  // redelivery is coming for. So it stays for retry, like a ScoutRefusal.
  const { queue, deps } = makeHarness({
    process: async () => ({
      status: "refused",
      refusedBy: "autonomy",
      reason: "unattended mode needs 5 clean runs, the streak is 0",
    }),
  });
  await queue.append(
    makeResearchRequest({
      accountName: "Northwind Robotics",
      domain: "northwindrobotics.com",
      requestId: "req-w5",
    }),
  );

  const result = await drainOnce(deps);
  assert.equal(result.result.refusedBy, "autonomy");

  // Not completed — still the next job.
  assert.equal((await queue.nextJob())?.requestId, "req-w5");
});

test("an egress refusal DOES complete the job — the report's content was decided", async () => {
  const { queue, deps } = makeHarness({
    process: async () => ({
      status: "refused",
      refusedBy: "egress",
      reason: "a survivor tripped the gate",
    }),
  });
  await queue.append(
    makeResearchRequest({
      accountName: "Northwind Robotics",
      domain: "northwindrobotics.com",
      requestId: "req-w6",
    }),
  );

  await drainOnce(deps);
  assert.equal(await queue.nextJob(), null, "an egress decision consumes the job");
});

test("the strategy brief reaches the run", async () => {
  let sawBrief;
  const { queue, deps } = makeHarness({
    briefFor: async () => "STRATEGY: aim hops at warehouse automation buyers.",
    providerFor: async () => {
      const base = recordedProvider(fixture("northwind-robotics"));
      return {
        ...base,
        async proposeClaims(args) {
          sawBrief = args.brief;
          return base.proposeClaims(args);
        },
      };
    },
  });
  await queue.append(
    makeResearchRequest({
      accountName: "Northwind Robotics",
      domain: "northwindrobotics.com",
      requestId: "req-w4",
    }),
  );

  await drainOnce(deps);

  assert.equal(sawBrief, "STRATEGY: aim hops at warehouse automation buyers.");
});

test("drainAll works the queue to empty and returns one result per job", async () => {
  const { queue, deps } = makeHarness();
  for (const id of ["req-a1", "req-a2"]) {
    await queue.append(
      makeResearchRequest({
        accountName: "Northwind Robotics",
        domain: "northwindrobotics.com",
        requestId: id,
      }),
    );
  }

  const results = await drainAll(deps);

  assert.equal(results.length, 2);
  assert.deepEqual(
    results.map((r) => r.requestId).sort(),
    ["req-a1", "req-a2"],
  );
  assert.deepEqual(await drainOnce(deps), { idle: true });
});
