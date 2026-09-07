#!/usr/bin/env node
// Regenerate the bundled demo artifacts by running the REAL bin against the
// bundled synthetic fixtures, keyless. This is what produces demo/reports/*.md
// and demo/dashboard/index.html — the sample outputs the README points at — so
// those files are never written from memory, they are always real runs.
//
//   node scripts/demo.mjs
//
// Deterministic enough to commit: recorded provider, synthetic fixtures. Only
// the verdict timestamps vary run to run, which the dashboard tolerates.

import { execFileSync } from "node:child_process";
import { rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, "cli.mjs");
const demo = join(root, "demo");
const telemetry = join(demo, "events.jsonl"); // NOT under a telemetry/ dir — that path is gitignored

rmSync(demo, { recursive: true, force: true });
mkdirSync(join(demo, "reports"), { recursive: true });

/** Run the bin, echoing its summary line, failing loudly on a non-zero exit. */
function run(args) {
  const out = execFileSync("node", [cli, ...args], { cwd: root, encoding: "utf8" });
  process.stdout.write(out);
}

const RUNS = [
  { account: "Northwind Robotics", domain: "northwindrobotics.com", fixtures: "fixtures/northwind-robotics", out: "reports/northwind.md", id: "demo-northwind" },
  { account: "Acme Freight", domain: "acmefreight.example", fixtures: "fixtures/acme-freight", out: "reports/acme.md", id: "demo-acme" },
  { account: "Acme Freight", domain: "acmefreight.example", fixtures: "fixtures/e2e-secret", out: "reports/acme-with-secret.md", id: "demo-secret" },
];

for (const r of RUNS) {
  run([
    "run",
    "--account", r.account,
    "--domain", r.domain,
    "--fixtures", r.fixtures,
    "--out", join(demo, r.out),
    "--telemetry", telemetry,
    "--request-id", r.id,
  ]);
}

run(["report", "--telemetry", telemetry, "--out", join(demo, "dashboard", "index.html")]);

process.stdout.write("\ndemo regenerated under demo/ — reports/, dashboard/index.html\n");
