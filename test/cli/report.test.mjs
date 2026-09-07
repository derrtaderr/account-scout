// Lane E — `scout report`, the dashboard. It feeds the scout's OWN telemetry
// (the JSONL the gates write on every run) into gtm-agent-evals' static
// dashboard generator, so the autonomy story — pass rate, streak, per-config
// gate — renders from the same events the autonomy gate reads. The gate line is
// drawn at N=5 to match the scout's autonomy config, not the library default.

delete process.env.ANTHROPIC_API_KEY;

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeJsonlSink } from "gtm-agent-evals/dist/index.js";

import { parseArgs } from "../../src/cli/args.mjs";
import { reportCommand } from "../../src/cli/commands.mjs";
import { RESEARCH_CONFIG_ID } from "../../src/gates/evals.mjs";

function io() {
  const out = [];
  const err = [];
  return {
    out,
    err,
    deps: { stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) } },
  };
}

async function seedTelemetry(path, statuses) {
  const sink = makeJsonlSink(path);
  let i = 0;
  for (const status of statuses) {
    await sink({
      runId: `run-${i}`,
      timestamp: `2026-09-07T12:00:0${i}.000Z`,
      configId: RESEARCH_CONFIG_ID,
      archetype: "research",
      verdict: { status, violations: [], reasons: [] },
    });
    i += 1;
  }
}

test("the dashboard renders from the scout's telemetry and exits 0", async () => {
  const dir = mkdtempSync(join(tmpdir(), "as-cli-report-"));
  const telemetry = join(dir, "telemetry", "events.jsonl");
  await seedTelemetry(telemetry, ["PASS", "PASS", "BLOCK", "PASS"]);

  const opts = parseArgs(["report", "--telemetry", telemetry, "--out", join(dir, "dash.html")]);
  const { out, deps } = io();

  const code = await reportCommand(opts, deps);

  assert.equal(code, 0);
  assert.ok(existsSync(join(dir, "dash.html")));
  const html = readFileSync(join(dir, "dash.html"), "utf8");
  assert.match(html, /Pass rate/);
  assert.match(html, /Total runs/);
  assert.match(html, new RegExp(RESEARCH_CONFIG_ID));
  assert.match(out.join(""), /dash\.html/);
});

test("an empty telemetry store renders an honest empty dashboard, not a crash", async () => {
  const dir = mkdtempSync(join(tmpdir(), "as-cli-report-"));
  const opts = parseArgs([
    "report",
    "--telemetry", join(dir, "telemetry", "events.jsonl"), // does not exist
    "--out", join(dir, "dash.html"),
  ]);
  const { deps } = io();

  const code = await reportCommand(opts, deps);

  assert.equal(code, 0);
  assert.match(readFileSync(join(dir, "dash.html"), "utf8"), /Total runs/);
});
