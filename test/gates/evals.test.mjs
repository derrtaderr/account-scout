// Lane D — evals. Every completed run is scored by gtm-agent-evals' research
// archetype in rules-only style (deterministic rules, rubric skipped, no key),
// and the verdict lands in JSONL telemetry through that library's own sink.
// The library does the judging; this lane only maps shapes and wires paths.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readEvents, autonomyStreak, makeJsonlSink } from "gtm-agent-evals/dist/index.js";

import { makeResearchRequest, makeHop, makeCitation, makeClaim, makeRefusal, makeResearchReport } from "../../src/types.mjs";
import { buildResearchReport } from "../../src/report/build.mjs";
import { reportToAgentRun, evaluateReport, recordVerdict, RESEARCH_CONFIG_ID } from "../../src/gates/evals.mjs";

function passingReport() {
  const content =
    "Northwind Robotics builds warehouse automation and reported $4.2 million in annual recurring revenue.";
  const hop = makeHop({
    url: "https://northwind.example/about",
    title: "About Northwind Robotics",
    fetchedAt: "2026-09-07T12:00:00.000Z",
    content,
  });
  const claim = makeClaim({
    id: "c1",
    text: "Northwind Robotics reported $4.2 million in ARR.",
    kind: "numeric",
    tier: "primary",
    citations: [
      makeCitation({
        url: hop.url,
        title: hop.title,
        fetchedAt: hop.fetchedAt,
        quote: "reported $4.2 million in annual recurring revenue",
      }),
    ],
  });
  return buildResearchReport({
    request: makeResearchRequest({ accountName: "Northwind Robotics", domain: "northwind.example", requestId: "req-evals-1" }),
    hops: [hop],
    claims: [claim],
    refusals: [makeRefusal({ text: "Northwind runs 40 warehouses.", reason: "citation url was never fetched this run" })],
    meta: { mode: "recorded" },
    generatedAt: "2026-09-07T12:00:05.000Z",
  });
}

/** A report a buggy caller built by hand around the builder's zero-hop
 *  refusal. The frozen contract permits it; the evals must catch it. */
function hopLessReport() {
  return makeResearchReport({
    account: "Acme Freight",
    generatedAt: "2026-09-07T12:00:05.000Z",
    claims: [],
    refusals: [],
    hops: [],
    meta: { mode: "recorded" },
  });
}

// --- the mapping -------------------------------------------------------------

test("reportToAgentRun maps hops to tool_result steps and claims to the output summary", () => {
  const report = passingReport();
  const run = reportToAgentRun(report);

  assert.equal(run.archetype, "research");
  assert.match(run.input, /Northwind Robotics/);

  assert.equal(run.steps.length, report.hops.length);
  for (const [i, step] of run.steps.entries()) {
    assert.equal(step.kind, "tool_result");
    assert.equal(step.name, "fetch_page");
    assert.equal(step.content, report.hops[i].content);
  }

  // The output is the serialized claims summary: claim text AND refusals,
  // because a refusal is first-class output, never dropped.
  assert.match(run.output, /Northwind Robotics reported \$4\.2 million in ARR\./);
  assert.match(run.output, /Northwind runs 40 warehouses\./);
  assert.match(run.output, /citation url was never fetched this run/);

  assert.equal(run.metadata.account, "Northwind Robotics");
  assert.equal(run.metadata.mode, "recorded");
});

// --- the verdicts, keyless ---------------------------------------------------

test("a passing report earns PASS from the research rules with no key in the environment", async () => {
  assert.equal(process.env.ANTHROPIC_API_KEY, undefined, "this test must run keyless");
  const verdict = await evaluateReport(passingReport());
  assert.equal(verdict.status, "PASS");
  assert.deepEqual(verdict.violations, []);
  assert.deepEqual(verdict.scores, {}, "rules-only: the rubric was skipped, nothing was scored");
});

test("a hop-less report built around the builder's refusal is BLOCKed by source-step-present", async () => {
  const verdict = await evaluateReport(hopLessReport());
  assert.equal(verdict.status, "BLOCK");
  assert.ok(
    verdict.violations.some((v) => v.rule === "source-step-present" && v.severity === "block"),
    `expected a source-step-present block, got ${JSON.stringify(verdict.violations)}`,
  );
});

// --- telemetry ---------------------------------------------------------------

test("recordVerdict lands one event the library's own reader accepts and streak-counts", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "as-gates-telemetry-")), "events.jsonl");
  const verdict = await evaluateReport(passingReport());

  const event = await recordVerdict({
    verdict,
    runId: "run-1",
    telemetryPath: path,
    now: () => "2026-09-07T12:00:06.000Z",
  });
  assert.equal(event.configId, RESEARCH_CONFIG_ID);
  assert.match(event.timestamp, /(Z|[+-]\d{2}:\d{2})$/, "timestamps carry an explicit timezone");

  const events = readEvents(path);
  assert.equal(events.length, 1);
  assert.equal(events[0].runId, "run-1");
  assert.equal(events[0].verdict.status, "PASS");
  assert.equal(autonomyStreak(events, RESEARCH_CONFIG_ID), 1);
});

test("the default clock emits a timestamp the reader's strict timezone check accepts", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "as-gates-telemetry-")), "events.jsonl");
  const verdict = await evaluateReport(passingReport());
  await recordVerdict({ verdict, telemetryPath: path });
  // autonomyStreak parses every timestamp strictly; a tz-less one would throw here.
  assert.equal(autonomyStreak(readEvents(path), RESEARCH_CONFIG_ID), 1);
});

test("a tz-less timestamp is refused by the reader — the feature this lane leans on", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "as-gates-telemetry-")), "events.jsonl");
  // Write a corrupt event through the library's own sink, bypassing recordVerdict.
  await makeJsonlSink(path)({
    runId: "run-naive",
    timestamp: "2026-09-07T12:00:06", // machine-local time: ambiguous, refused
    configId: RESEARCH_CONFIG_ID,
    archetype: "research",
    verdict: { status: "PASS", violations: [], reasons: [] },
  });
  const events = readEvents(path);
  assert.throws(
    () => autonomyStreak(events, RESEARCH_CONFIG_ID),
    /explicit timezone/,
    "the streak must never be computed over ambiguous instants",
  );
});
