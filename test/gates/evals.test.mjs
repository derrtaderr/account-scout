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
import { reportToAgentRun, evaluateReport, RESEARCH_CONFIG_ID } from "../../src/gates/evals.mjs";

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
