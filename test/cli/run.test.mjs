// Lane E — `scout run`, the one-shot path. It composes the real provider, the
// real scout, and the real gates to a guarded report on disk, and its exit code
// is a contract: 0 delivered, 3 the system refused or blocked (a decision, not a
// crash), 2 bad usage. Driven against the bundled recorded fixture, keyless.

delete process.env.ANTHROPIC_API_KEY;

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseArgs } from "../../src/cli/args.mjs";
import { runCommand } from "../../src/cli/commands.mjs";

const fixture = (slug) => fileURLToPath(new URL(`../../fixtures/${slug}/`, import.meta.url));
const FROZEN_NOW = () => "2026-09-07T12:00:09.000Z";

function io() {
  const out = [];
  const err = [];
  return {
    out,
    err,
    deps: {
      stdout: { write: (s) => out.push(s) },
      stderr: { write: (s) => err.push(s) },
      env: {},
      now: FROZEN_NOW,
    },
  };
}

test("a recorded run delivers a guarded report and exits 0", async () => {
  const dir = mkdtempSync(join(tmpdir(), "as-cli-run-"));
  const opts = parseArgs([
    "run", "--account", "Northwind Robotics",
    "--domain", "northwindrobotics.com",
    "--fixtures", fixture("northwind-robotics"),
    "--out", join(dir, "report.md"),
    "--request-id", "req-run-1",
    "--telemetry", join(dir, "telemetry", "events.jsonl"),
  ]);
  const { out, deps } = io();

  const code = await runCommand(opts, deps);

  assert.equal(code, 0, "a delivered report exits 0");
  assert.ok(existsSync(join(dir, "report.md")));
  assert.match(readFileSync(join(dir, "report.md"), "utf8"), /Northwind Robotics/);
  assert.match(out.join(""), /account-scout: Northwind Robotics/);
});

test("a fabricated claim in the fixture is refused, never delivered, and the run still exits 0", async () => {
  const dir = mkdtempSync(join(tmpdir(), "as-cli-run-"));
  const opts = parseArgs([
    "run", "--account", "Northwind Robotics",
    "--domain", "northwindrobotics.com",
    "--fixtures", fixture("northwind-robotics"),
    "--out", join(dir, "report.md"),
    "--request-id", "req-run-2",
    "--telemetry", join(dir, "telemetry", "events.jsonl"),
  ]);
  const { deps } = io();

  const code = await runCommand(opts, deps);
  assert.equal(code, 0);

  const text = readFileSync(join(dir, "report.md"), "utf8");
  assert.doesNotMatch(text.split("## Refusals")[0], /\$47 million/, "no fabricated number among the claims");
  assert.match(text, /## Refusals \([1-9]/, "the report carries its refusals");
});

test("a missing fixture store refuses and exits 3 — a decision, not a crash", async () => {
  const dir = mkdtempSync(join(tmpdir(), "as-cli-run-"));
  const opts = parseArgs([
    "run", "--account", "Ghost Co",
    "--fixtures", join(dir, "does-not-exist"),
    "--out", join(dir, "report.md"),
    "--telemetry", join(dir, "telemetry", "events.jsonl"),
  ]);
  const { err, deps } = io();

  const code = await runCommand(opts, deps);

  assert.equal(code, 3, "a refusal exits 3");
  assert.match(err.join(""), /refusing rather than researching nothing|cannot read the fixture store/);
  assert.equal(existsSync(join(dir, "report.md")), false, "nothing is written on a refusal");
});

test("--telemetry lands the run's verdict at the given path, not the package default", async () => {
  const dir = mkdtempSync(join(tmpdir(), "as-cli-run-"));
  const telemetry = join(dir, "telemetry", "events.jsonl");
  const opts = parseArgs([
    "run", "--account", "Northwind Robotics",
    "--domain", "northwindrobotics.com",
    "--fixtures", fixture("northwind-robotics"),
    "--out", join(dir, "report.md"),
    "--request-id", "req-run-tel",
    "--telemetry", telemetry,
  ]);
  assert.equal(opts.telemetry, telemetry, "run must parse --telemetry, not ignore it");
  const { deps } = io();

  await runCommand(opts, deps);

  assert.equal(existsSync(telemetry), true, "the verdict is recorded at the requested path");
});

test("an --out that is not a .md path is a usage error, exit 2", async () => {
  const dir = mkdtempSync(join(tmpdir(), "as-cli-run-"));
  const opts = parseArgs([
    "run", "--account", "Northwind Robotics",
    "--fixtures", fixture("northwind-robotics"),
    "--out", join(dir, "report.txt"),
  ]);
  const { err, deps } = io();

  const code = await runCommand(opts, deps);

  assert.equal(code, 2);
  assert.match(err.join(""), /\.md/);
});
