// Lane D — the composed check: evaluate → telemetry → egress-guarded write,
// in that order. Nothing is decided silently: a BLOCK still writes telemetry
// and quarantines the report as .blocked.md; an egress refusal returns a
// structured result naming what refused and why, with the verdict already on
// the record. The unattended path consults the autonomy gate first.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readEvents, autonomyStreak, makeJsonlSink } from "gtm-agent-evals/dist/index.js";

import { makeResearchRequest, makeHop, makeCitation, makeClaim, makeResearchReport } from "../../src/types.mjs";
import { buildResearchReport } from "../../src/report/build.mjs";
import { createEgress } from "../../src/gates/egress.mjs";
import { RESEARCH_CONFIG_ID } from "../../src/gates/evals.mjs";
import { processReport, processUnattended } from "../../src/gates/pipeline.mjs";

const ROSTER = [{ class: "client", match: ["Meridian Dynamics"] }];

function cleanReport({ quote } = {}) {
  const q = quote ?? "Northwind Robotics builds warehouse automation for mid-market logistics operators.";
  const hop = makeHop({
    url: "https://northwind.example/about",
    title: "About Northwind Robotics",
    fetchedAt: "2026-09-07T12:00:00.000Z",
    content: q,
  });
  return buildResearchReport({
    request: makeResearchRequest({ accountName: "Northwind Robotics", domain: "northwind.example", requestId: "req-pipe-1" }),
    hops: [hop],
    claims: [
      makeClaim({
        id: "c1",
        text: "Northwind Robotics builds warehouse automation.",
        kind: "factual",
        tier: "primary",
        citations: [makeCitation({ url: hop.url, title: hop.title, fetchedAt: hop.fetchedAt, quote: q })],
      }),
    ],
    refusals: [],
    meta: { mode: "recorded" },
    generatedAt: "2026-09-07T12:00:05.000Z",
  });
}

/** A report the evals BLOCK: hand-built with zero hops. */
function blockedReport() {
  return makeResearchReport({
    account: "Acme Freight",
    generatedAt: "2026-09-07T12:00:05.000Z",
    claims: [],
    refusals: [],
    hops: [],
    meta: { mode: "recorded" },
  });
}

function makeDeps(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), "as-gates-pipeline-"));
  return {
    dir,
    deps: {
      egress: createEgress({ roster: ROSTER, allowDomains: ["northwind.example"], out: { write: () => {} } }),
      reportPath: join(dir, "report.md"),
      telemetryPath: join(dir, "telemetry", "events.jsonl"),
      runId: "run-pipe-1",
      now: () => "2026-09-07T12:00:06.000Z",
      ...overrides,
    },
  };
}

// --- processReport -----------------------------------------------------------

test("a passing report is delivered: verdict, telemetry, then the guarded write", async () => {
  const { deps } = makeDeps();
  const result = await processReport(cleanReport(), deps);

  assert.equal(result.status, "delivered");
  assert.equal(result.verdict.status, "PASS");
  assert.equal(result.reportPath, deps.reportPath);
  assert.ok(existsSync(deps.reportPath), "the report landed");

  const events = readEvents(deps.telemetryPath);
  assert.equal(events.length, 1);
  assert.equal(events[0].runId, "run-pipe-1");
  assert.equal(events[0].verdict.status, "PASS");
});

test("a BLOCK verdict still writes telemetry and quarantines the report as .blocked.md", async () => {
  const { deps } = makeDeps();
  const result = await processReport(blockedReport(), deps);

  assert.equal(result.status, "quarantined");
  assert.equal(result.refusedBy, "evals");
  assert.equal(result.verdict.status, "BLOCK");
  assert.match(result.reason, /source-step-present/);

  const blockedPath = deps.reportPath.replace(/\.md$/, ".blocked.md");
  assert.equal(result.reportPath, blockedPath);
  assert.ok(existsSync(blockedPath), "the blocked report is quarantined, not dropped");
  assert.ok(!existsSync(deps.reportPath), "nothing lands at the clean path");

  const events = readEvents(deps.telemetryPath);
  assert.equal(events.length, 1, "a BLOCK is still on the record");
  assert.equal(events[0].verdict.status, "BLOCK");
});

test("an egress refusal returns a structured result naming what refused — telemetry kept, nothing on disk", async () => {
  const { deps, dir } = makeDeps();
  // Passes the evals (a hop, a cited claim) but carries an egress survivor.
  const poisoned = cleanReport({
    quote: "Ticket filed under meridian_dynamics covers the rollout in detail.",
  });
  const result = await processReport(poisoned, deps);

  assert.equal(result.status, "refused");
  assert.equal(result.refusedBy, "egress");
  assert.equal(result.verdict.status, "PASS", "the verdict was already decided and recorded");
  assert.match(result.reason, /REFUSING TO PROCEED/);
  assert.ok(!/meridian/i.test(result.reason), "the structured result never carries the value either");

  assert.equal(readEvents(deps.telemetryPath).length, 1, "the verdict stayed on the record");
  assert.ok(!existsSync(deps.reportPath), "the refused report landed nowhere");
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith(".md")), []);
});

// --- the unattended path -----------------------------------------------------

function seedStreak(telemetryPath, statuses) {
  const sink = makeJsonlSink(telemetryPath);
  statuses.forEach((status, i) =>
    sink({
      runId: `seed-${i + 1}`,
      timestamp: `2026-09-07T11:00:0${i}.000Z`,
      configId: RESEARCH_CONFIG_ID,
      archetype: "research",
      verdict: { status, violations: [], reasons: [] },
    }),
  );
}

test("unattended processing refuses before doing ANY work when the streak is unearned", async () => {
  const { deps } = makeDeps();
  seedStreak(deps.telemetryPath, ["PASS", "BLOCK", "PASS"]); // streak 1 of 3

  const result = await processUnattended(cleanReport(), deps);
  assert.equal(result.status, "refused");
  assert.equal(result.refusedBy, "autonomy");
  assert.match(result.reason, /streak 1 of 3 — unattended mode refused/);

  assert.ok(!existsSync(deps.reportPath), "no report was written");
  assert.equal(readEvents(deps.telemetryPath).length, 3, "the refused run added no event");
});

test("unattended processing proceeds once the streak is earned, and says so", async () => {
  const { deps } = makeDeps();
  seedStreak(deps.telemetryPath, ["PASS", "PASS", "PASS"]); // streak 3 of 3

  const result = await processUnattended(cleanReport(), deps);
  assert.equal(result.status, "delivered");
  assert.equal(result.autonomy.allowed, true);
  assert.equal(result.autonomy.streak, 3);
  assert.ok(existsSync(deps.reportPath));
  assert.equal(readEvents(deps.telemetryPath).length, 4, "the run itself joined the record");
  assert.equal(autonomyStreak(readEvents(deps.telemetryPath), RESEARCH_CONFIG_ID), 4);
});
