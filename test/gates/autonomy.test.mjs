// Lane D — autonomy is earned, never assumed. allowUnattended reads the
// telemetry with gtm-agent-evals' own readEvents/autonomyStreak and compares
// the streak against gateN. A refusal NAMES the streak and the gate, so the
// operator knows exactly how far from earned the agent is.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeJsonlSink } from "gtm-agent-evals/dist/index.js";

import { allowUnattended, DEFAULT_GATE_N } from "../../src/gates/autonomy.mjs";
import { RESEARCH_CONFIG_ID } from "../../src/gates/evals.mjs";

function telemetryWith(statuses, configId = RESEARCH_CONFIG_ID) {
  const path = join(mkdtempSync(join(tmpdir(), "as-gates-autonomy-")), "events.jsonl");
  const sink = makeJsonlSink(path);
  statuses.forEach((status, i) => {
    sink({
      runId: `run-${i + 1}`,
      timestamp: `2026-09-07T12:00:0${i}.000Z`,
      configId,
      archetype: "research",
      verdict: { status, violations: [], reasons: [] },
    });
  });
  return path;
}

test("the default gate requires 3 clean runs", () => {
  assert.equal(DEFAULT_GATE_N, 3);
});

test("a streak at or past the gate allows unattended mode, naming both numbers", () => {
  const path = telemetryWith(["BLOCK", "PASS", "PASS", "PASS"]);
  const decision = allowUnattended(RESEARCH_CONFIG_ID, { telemetryPath: path });
  assert.equal(decision.allowed, true);
  assert.equal(decision.streak, 3);
  assert.equal(decision.gateN, 3);
});

test("a short streak refuses, and the refusal names the streak and the gate", () => {
  const path = telemetryWith(["PASS", "PASS", "BLOCK", "PASS"]);
  const decision = allowUnattended(RESEARCH_CONFIG_ID, { telemetryPath: path });
  assert.equal(decision.allowed, false);
  assert.equal(decision.streak, 1);
  assert.match(decision.reason, /streak 1 of 3 — unattended mode refused/);
  assert.match(decision.reason, new RegExp(RESEARCH_CONFIG_ID), "the refusal names whose streak it is");
});

test("an empty telemetry file refuses at streak 0 — autonomy is never the default", () => {
  const path = join(mkdtempSync(join(tmpdir(), "as-gates-autonomy-")), "events.jsonl");
  const decision = allowUnattended(RESEARCH_CONFIG_ID, { telemetryPath: path });
  assert.equal(decision.allowed, false);
  assert.equal(decision.streak, 0);
  assert.match(decision.reason, /streak 0 of 3 — unattended mode refused/);
});

test("gateN is tunable and the refusal tracks it", () => {
  const path = telemetryWith(["PASS", "PASS", "PASS", "PASS"]);
  const tighter = allowUnattended(RESEARCH_CONFIG_ID, { telemetryPath: path, gateN: 5 });
  assert.equal(tighter.allowed, false);
  assert.match(tighter.reason, /streak 4 of 5 — unattended mode refused/);
});

test("another config's clean streak earns this config nothing", () => {
  const path = telemetryWith(["PASS", "PASS", "PASS"], "some-other-agent");
  const decision = allowUnattended(RESEARCH_CONFIG_ID, { telemetryPath: path });
  assert.equal(decision.allowed, false);
  assert.equal(decision.streak, 0);
});
