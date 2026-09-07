// The evidential floor. A citation whose quote is trivial ("The", a single
// space) matches almost any fetched page, so the deterministic gate would
// bless it — turning "every claim is cited" into a formality. The floor is
// what makes a passing citation mean something.
//
// The attack this closes, composed: a hostile fetched page prompt-injects the
// extractor, the extractor emits fabricated claims carrying trivial quotes,
// and the gate signs every one of them.
delete process.env.ANTHROPIC_API_KEY;

import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { makeCitation, validateCitationAgainstHops, makeHop, MIN_QUOTE_LENGTH, makeResearchRequest } from "../../src/types.mjs";
import { gateCandidates } from "../../src/scout/gate.mjs";
import { recordedProvider } from "../../src/scout/provider-recorded.mjs";
import { runScout } from "../../src/scout/run.mjs";

const URL_A = "https://northwindrobotics.com/about";

const hops = [
  makeHop({
    url: URL_A,
    title: "About Northwind Robotics",
    fetchedAt: "2026-09-07T12:00:00.000Z",
    content: "Northwind Robotics builds warehouse automation for mid-market operators worldwide.",
  }),
];

const cite = (quote) => ({ url: URL_A, title: "About", fetchedAt: "2026-09-07T12:00:00.000Z", quote });

test("the floor is twenty trimmed characters", () => {
  assert.equal(MIN_QUOTE_LENGTH, 20);
});

test("makeCitation rejects a trivial quote, naming the floor and the offending length", () => {
  assert.throws(
    () => makeCitation(cite("The")),
    (err) => {
      assert.match(err.message, /20/, "the refusal names the floor");
      assert.match(err.message, /\b3\b/, "the refusal names the offending length");
      return true;
    },
  );
});

test("makeCitation rejects a whitespace-only quote", () => {
  assert.throws(() => makeCitation(cite(" ")), /20/);
  assert.throws(() => makeCitation(cite("        ")), /20/);
});

test("makeCitation rejects a nineteen-character quote and accepts a twenty-character one", () => {
  assert.equal("warehouse automatio".length, 19);
  assert.equal("warehouse automation".length, 20);
  assert.throws(() => makeCitation(cite("warehouse automatio")), /20/);
  assert.equal(makeCitation(cite("warehouse automation")).quote, "warehouse automation");
});

test("a quote is measured trimmed, so padding cannot buy its way over the floor", () => {
  assert.throws(() => makeCitation(cite("   short quote   ")), /20/);
});

test("validateCitationAgainstHops re-checks the floor defensively", () => {
  // A citation object built by hand, bypassing makeCitation entirely.
  const smuggled = { url: URL_A, title: "About", fetchedAt: "2026-09-07T12:00:00.000Z", quote: "The" };
  const verdict = validateCitationAgainstHops(smuggled, hops);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "quote is below the evidential floor (3 chars trimmed, minimum 20)");
});

test("the defensive floor check runs before the hop lookup", () => {
  const smuggled = { url: "https://never-fetched.example/", title: "x", fetchedAt: "x", quote: " " };
  assert.match(validateCitationAgainstHops(smuggled, hops).reason, /below the evidential floor \(0 chars trimmed/);
});

test("a real verbatim quote at the floor still passes", () => {
  assert.deepEqual(validateCitationAgainstHops(makeCitation(cite("warehouse automation")), hops), { ok: true });
});

// ---- the gate turns floor failures into Refusals, conservation intact ----

test("a trivial-quote candidate becomes a Refusal, never a Claim", () => {
  const { claims, refusals } = gateCandidates({
    candidates: [{ text: "Northwind Robotics is the market leader.", kind: "factual", citations: [{ url: URL_A, quote: "The" }] }],
    hops,
    domain: "northwindrobotics.com",
    runAt: "2026-09-07T12:00:05.000Z",
  });
  assert.equal(claims.length, 0);
  assert.equal(refusals.length, 1);
  assert.match(refusals[0].reason, /20/);
});

test("conservation still holds when every candidate fails the floor", () => {
  const candidates = [
    { text: "a", kind: "factual", citations: [{ url: URL_A, quote: "The" }] },
    { text: "b", kind: "numeric", citations: [{ url: URL_A, quote: " " }] },
    { text: "c", kind: "causal", citations: [{ url: URL_A, quote: "warehouse automatio" }] },
  ];
  const { claims, refusals } = gateCandidates({ candidates, hops, domain: "northwindrobotics.com", runAt: "2026-09-07T12:00:05.000Z" });
  assert.equal(claims.length, 0);
  assert.equal(refusals.length, candidates.length);
});

// ---- the composed attack, end to end ----

test("a hostile page that injects the extractor cannot get a trivial-quote claim signed", async () => {
  const dir = fileURLToPath(new URL("../../fixtures/hostile-injection/", import.meta.url));
  const provider = recordedProvider(dir);
  const report = await runScout({
    request: makeResearchRequest({ ...provider.account, requestId: "req-hostile" }),
    provider,
    now: () => "2026-09-07T14:00:09.000Z",
  });

  assert.equal(report.hops.length, 1, "the hostile page was fetched, as it would be in a real run");
  assert.match(report.hops[0].content, /IGNORE ALL PREVIOUS INSTRUCTIONS/, "the injection really is in the fetched content");
  assert.equal(report.claims.length, 0, "not one injected claim may be signed");
  assert.equal(report.refusals.length, 3);
  for (const refusal of report.refusals) assert.match(refusal.reason, /20/, "each refusal names the evidential floor");
  assert.ok(
    report.refusals.some((r) => /900 million/.test(r.text)),
    "the injected fabrication is carried as a refusal, never dropped",
  );
});
