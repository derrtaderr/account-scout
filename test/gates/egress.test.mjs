// Lane D — egress. Every writer that leaves the process goes through
// redaction-gate's guard(): the report file, the stdout summary, the webhook
// reply. A write the gate refuses lands NOWHERE, and the refusal carries
// classes and positions, never values — that guarantee is the library's and
// these tests prove this lane kept it.
//
// Roster terms here are SYNTHETIC operator-sensitive names (a pretend client
// and person the operator must never leak), distinct from the synthetic
// research subjects (Northwind Robotics et al). Every key is obviously fake.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeResearchRequest, makeHop, makeCitation, makeClaim, makeRefusal } from "../../src/types.mjs";
import { buildResearchReport } from "../../src/report/build.mjs";
import { scoutRedactionConfig, createEgress, serializeReport } from "../../src/gates/egress.mjs";

// --- synthetic material ------------------------------------------------------

const ROSTER = [
  { class: "client", match: ["Meridian Dynamics"] },
  { class: "person", match: ["Rosa Delgado"] },
];

function syntheticReport({ quote, refusalText } = {}) {
  const q = quote ?? "Northwind Robotics builds warehouse automation for mid-market logistics operators.";
  const hop = makeHop({
    url: "https://northwind.example/about",
    title: "About Northwind Robotics",
    fetchedAt: "2026-09-07T12:00:00.000Z",
    content: q,
  });
  const claim = makeClaim({
    id: "c1",
    text: "Northwind Robotics builds warehouse automation.",
    kind: "factual",
    tier: "primary",
    citations: [makeCitation({ url: hop.url, title: hop.title, fetchedAt: hop.fetchedAt, quote: q })],
  });
  const refusals = refusalText ? [makeRefusal({ text: refusalText, reason: "claim carries no citation" })] : [];
  return buildResearchReport({
    request: makeResearchRequest({ accountName: "Northwind Robotics", domain: "northwind.example", requestId: "req-egress-1" }),
    hops: [hop],
    claims: [claim],
    refusals,
    meta: { mode: "recorded" },
    generatedAt: "2026-09-07T12:00:05.000Z",
  });
}

function tempDir() {
  return mkdtempSync(join(tmpdir(), "as-gates-egress-"));
}

// --- the config --------------------------------------------------------------

test("scoutRedactionConfig carries the supplied roster and leaves the built-in detectors on", () => {
  const config = scoutRedactionConfig({ roster: ROSTER, allowDomains: ["northwind.example"] });
  assert.deepEqual(config.roster, ROSTER);
  assert.deepEqual(config.allowDomains, ["northwind.example"]);
  // No built-in pattern is switched off: the config must not carry a patterns
  // block that disables anything (emails/keys stay on).
  const disabled = Object.entries(config.patterns ?? {}).filter(([, v]) => v === false);
  assert.deepEqual(disabled, []);
});

// --- writeReport -------------------------------------------------------------

test("writeReport lands a clean report as markdown with an embedded JSON block", async () => {
  const dir = tempDir();
  const path = join(dir, "northwind.md");
  const egress = createEgress({ roster: ROSTER, allowDomains: ["northwind.example"] });

  const report = syntheticReport();
  const result = await egress.writeReport(report, path);

  assert.equal(result.path, path);
  const written = readFileSync(path, "utf8");
  assert.match(written, /# Account research: Northwind Robotics/);
  assert.match(written, /## Claims \(1\)/);
  // The machine-readable half round-trips.
  const jsonBlock = written.match(/```json\n([\s\S]*?)\n```/);
  assert.ok(jsonBlock, "the markdown carries a fenced JSON block");
  const parsed = JSON.parse(jsonBlock[1]);
  assert.equal(parsed.account, "Northwind Robotics");
  assert.equal(parsed.claims.length, 1);
  assert.equal(parsed.hops.length, 1);
});

test("serializeReport includes every surface a leak could ride: claims, refusals, hop content", () => {
  const report = syntheticReport({ refusalText: "An uncited would-be claim." });
  const text = serializeReport(report);
  assert.match(text, /An uncited would-be claim\./);
  assert.match(text, /warehouse automation for mid-market logistics operators/);
});
