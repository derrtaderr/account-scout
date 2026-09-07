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

test("a plain roster term and a plain fake key are redacted — placeholders land, values never", async () => {
  const dir = tempDir();
  const path = join(dir, "northwind.md");
  const egress = createEgress({ roster: ROSTER, allowDomains: ["northwind.example"] });

  // The leak arrived in fetched content and the extractor quoted it: the
  // operator's OTHER client and a key that leaked into a page. Both forms are
  // precise-matchable, so the library's redactor catches them and the write
  // proceeds as a working document carrying typed placeholders.
  const fakeKey = "sk-ant-synthetic-00000000000000000000";
  const quote = `Meridian Dynamics signed a pilot; the demo token was ${fakeKey} per the changelog.`;
  await egress.writeReport(syntheticReport({ quote }), path);

  const written = readFileSync(path, "utf8");
  assert.match(written, /\[client\]/);
  assert.match(written, /\[secret\]/);
  assert.ok(!written.includes("Meridian Dynamics"), "the roster value never lands on disk");
  assert.ok(!written.includes(fakeKey), "the key value never lands on disk");
});

test("a write that trips the gate is REFUSED and the report lands nowhere", async () => {
  const dir = tempDir();
  const path = join(dir, "northwind.md");
  const egress = createEgress({ roster: ROSTER, allowDomains: ["northwind.example"] });

  // Survivor forms — the shapes the precise redactor cannot match: the roster
  // term flattened into an identifier, and a key wrapped by whitespace. The
  // paranoid scan sees both; the guard refuses before the writer runs.
  const quote =
    "Ticket filed under meridian_dynamics with demo token: sk-ant-synth etic00000000000000000000 attached.";
  const report = syntheticReport({ quote });

  await assert.rejects(
    () => egress.writeReport(report, path),
    (err) => {
      assert.equal(err.name, "RedactionRefusal");
      const classes = err.findings.map((f) => f.class);
      assert.ok(classes.includes("client"), `roster survivor flagged (got ${classes})`);
      assert.ok(classes.includes("secret"), `key survivor flagged (got ${classes})`);
      // Keys never values: neither the message nor the findings carry what was caught.
      assert.ok(!/meridian/i.test(err.message), "refusal message never prints the roster value");
      assert.ok(!err.message.includes("sk-ant-synthetic"), "refusal message never prints the key");
      assert.ok(err.findings.every((f) => !("term" in f)), "findings carry positions, never terms");
      return true;
    },
  );

  assert.ok(!existsSync(path), "the refused report landed nowhere");
  assert.deepEqual(readdirSync(dir), [], "nothing else landed either");
});

// --- emitSummary -------------------------------------------------------------

test("emitSummary writes one guarded line and redacts a rostered account name", async () => {
  const written = [];
  const out = { write: (s) => written.push(s) };
  const egress = createEgress({ roster: ROSTER, allowDomains: ["northwind.example"], out });

  const clean = syntheticReport();
  await egress.emitSummary(clean);
  assert.equal(written.length, 1);
  assert.match(written[0], /^account-scout: Northwind Robotics — 1 claim\(s\), 0 refusal\(s\), 1 hop\(s\) \[recorded\]\n$/);

  // A report about the operator's own sensitive client: the name is redacted
  // on the way out, the line still ships as a working summary.
  const sensitive = makeResearchReport2("Meridian Dynamics");
  await egress.emitSummary(sensitive);
  assert.equal(written.length, 2);
  assert.match(written[1], /\[client\]/);
  assert.ok(!written[1].includes("Meridian Dynamics"));
});

test("a summary the gate cannot clean is refused and nothing reaches the stream", async () => {
  const written = [];
  const out = { write: (s) => written.push(s) };
  const egress = createEgress({ roster: ROSTER, out });

  // The account name in a survivor form the redactor cannot match.
  const report = makeResearchReport2("meridian_dynamics");
  await assert.rejects(() => egress.emitSummary(report), { name: "RedactionRefusal" });
  assert.deepEqual(written, [], "the refused summary never touched the stream");
});

/** A minimal report whose account name is attacker/operator-chosen. */
function makeResearchReport2(accountName) {
  const hop = makeHop({
    url: "https://third-party.example/coverage",
    title: "Coverage",
    fetchedAt: "2026-09-07T12:00:00.000Z",
    content: "A synthetic page about a synthetic company, long enough to quote.",
  });
  return buildResearchReport({
    request: makeResearchRequest({ accountName, requestId: "req-egress-2" }),
    hops: [hop],
    claims: [],
    refusals: [],
    meta: { mode: "recorded" },
    generatedAt: "2026-09-07T12:00:05.000Z",
  });
}

// --- replyWriter -------------------------------------------------------------

test("the reply writer hands the server a guarded sender — bodies go out redacted", async () => {
  const sent = [];
  const egress = createEgress({ roster: ROSTER });
  const send = egress.makeReplyWriter((payload) => {
    sent.push(payload);
    return "sent";
  });

  const result = await send({
    url: "https://caller.example/hook",
    body: "Research complete for Meridian Dynamics: 3 claims survived.",
  });
  assert.equal(result, "sent");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://caller.example/hook");
  assert.match(sent[0].body, /\[client\]/);
  assert.ok(!sent[0].body.includes("Meridian Dynamics"));
});

test("a reply the gate cannot clean is refused before the sender is invoked", async () => {
  const sent = [];
  const egress = createEgress({ roster: ROSTER });
  const send = egress.makeReplyWriter((payload) => sent.push(payload));

  await assert.rejects(
    () => send({ url: "https://caller.example/hook", body: "status update re meridian_dynamics onboarding" }),
    { name: "RedactionRefusal" },
  );
  assert.deepEqual(sent, [], "the refused reply never reached the sender");
});

test("serializeReport includes every surface a leak could ride: claims, refusals, hop content", () => {
  const report = syntheticReport({ refusalText: "An uncited would-be claim." });
  const text = serializeReport(report);
  assert.match(text, /An uncited would-be claim\./);
  assert.match(text, /warehouse automation for mid-market logistics operators/);
});
