// Lane E — the top-level dispatch. It parses argv, routes to the command, and
// turns a UsageError into exit 2 with the message on stderr. This is everything
// cli.mjs does except calling process.exit, so it is tested here and the bin
// stays a three-line wrapper nothing can hide a bug in.

delete process.env.ANTHROPIC_API_KEY;

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { main } from "../../src/cli/main.mjs";

const NORTHWIND = fileURLToPath(new URL("../../fixtures/northwind-robotics/", import.meta.url));

function io() {
  const out = [];
  const err = [];
  return { out, err, deps: { stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) }, env: {} } };
}

test("no command exits 2 with a usage message", async () => {
  const { err, deps } = io();
  const code = await main([], deps);
  assert.equal(code, 2);
  assert.match(err.join(""), /run|serve|report/);
});

test("an unknown command exits 2", async () => {
  const { err, deps } = io();
  const code = await main(["frobnicate"], deps);
  assert.equal(code, 2);
  assert.match(err.join(""), /frobnicate/);
});

test("run routes through and delivers, exit 0", async () => {
  const dir = mkdtempSync(join(tmpdir(), "as-main-"));
  const { deps } = io();
  const code = await main(
    [
      "run", "--account", "Northwind Robotics", "--domain", "northwindrobotics.com",
      "--fixtures", NORTHWIND, "--out", join(dir, "r.md"),
      "--telemetry", join(dir, "t.jsonl"), "--request-id", "req-main-1",
    ],
    { ...deps, now: () => "2026-09-07T12:00:09.000Z" },
  );
  assert.equal(code, 0);
  assert.ok(existsSync(join(dir, "r.md")));
});

test("report routes through and writes a dashboard, exit 0", async () => {
  const dir = mkdtempSync(join(tmpdir(), "as-main-"));
  const { deps } = io();
  const code = await main(["report", "--telemetry", join(dir, "none.jsonl"), "--out", join(dir, "d.html")], deps);
  assert.equal(code, 0);
  assert.ok(existsSync(join(dir, "d.html")));
});
