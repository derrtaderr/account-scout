// Recorded mode is KEYLESS by construction. The delete below is the assertion:
// every test in this file runs with no Anthropic key in the environment, so a
// provider that quietly reached for one would fail here rather than in CI.
delete process.env.ANTHROPIC_API_KEY;

import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { recordedProvider } from "../../src/scout/provider-recorded.mjs";
import { ScoutRefusal } from "../../src/scout/errors.mjs";

const fixture = (slug) => fileURLToPath(new URL(`../../fixtures/${slug}/`, import.meta.url));
const NORTHWIND = fixture("northwind-robotics");

test("the recorded provider needs no API key", async () => {
  assert.equal(process.env.ANTHROPIC_API_KEY, undefined);
  const provider = recordedProvider(NORTHWIND);
  assert.equal(provider.mode, "recorded");
  assert.equal(await provider.search("Northwind Robotics company overview").then((r) => r.length), 2);
});

test("a recorded report names no model — nothing produced it", () => {
  assert.equal(recordedProvider(NORTHWIND).model, undefined);
});

test("the provider exposes the account the fixture was recorded for", () => {
  const { account } = recordedProvider(NORTHWIND);
  assert.equal(account.accountName, "Northwind Robotics");
  assert.equal(account.domain, "northwindrobotics.com");
  assert.deepEqual([...account.questions], ["who leads revenue", "what is the pricing model"]);
});

test("a recorded query replays its recorded results", async () => {
  const results = await recordedProvider(NORTHWIND).search("Northwind Robotics who leads revenue");
  assert.deepEqual(
    results.map((r) => r.url),
    ["https://podcast.example/northwind-ep-42"],
  );
});

test("an unrecorded query returns nothing rather than inventing a result", async () => {
  const results = await recordedProvider(NORTHWIND).search("Northwind Robotics secret skunkworks");
  assert.deepEqual(results, []);
});

test("fetchPage replays a page as a hop the contract accepts", async () => {
  const hop = await recordedProvider(NORTHWIND).fetchPage("https://northwindrobotics.com/about");
  assert.equal(hop.url, "https://northwindrobotics.com/about");
  assert.equal(hop.title, "About — Northwind Robotics");
  assert.equal(hop.fetchedAt, "2026-09-07T12:00:00.000Z");
  assert.match(hop.content, /warehouse automation/);
  assert.throws(() => {
    hop.content = "tampered";
  }, TypeError);
});

test("fetching a page the fixture never recorded refuses instead of returning empty content", async () => {
  await assert.rejects(
    () => recordedProvider(NORTHWIND).fetchPage("https://northwindrobotics.com/osaka"),
    (err) => {
      assert.ok(err instanceof ScoutRefusal);
      assert.match(err.message, /osaka/);
      return true;
    },
  );
});

test("proposeClaims replays the transcript unjudged — the gate does the judging", async () => {
  const candidates = await recordedProvider(NORTHWIND).proposeClaims({ hops: [] });
  assert.equal(candidates.length, 7);
  assert.ok(
    candidates.some((c) => c.text.includes("$47 million Series C")),
    "the fabricated candidate must survive the provider so the gate can be caught not refusing it",
  );
  assert.ok(candidates.some((c) => c.citations.length === 0));
});

test("the transcript carries all three claim kinds", async () => {
  const candidates = await recordedProvider(NORTHWIND).proposeClaims({ hops: [] });
  const kinds = new Set(candidates.map((c) => c.kind));
  assert.deepEqual([...kinds].sort(), ["causal", "factual", "numeric"]);
});

test("a missing fixture directory refuses and names the path", () => {
  assert.throws(
    () => recordedProvider(fixture("no-such-account")),
    (err) => {
      assert.ok(err instanceof ScoutRefusal);
      assert.match(err.message, /no-such-account/);
      return true;
    },
  );
});

test("the sparse fixture records searches that genuinely found nothing", async () => {
  const provider = recordedProvider(fixture("acme-freight"));
  assert.deepEqual(await provider.search("Acme Freight funding news"), []);
  assert.equal((await provider.search("Acme Freight company overview")).length, 2);
  assert.equal((await provider.proposeClaims({ hops: [] })).length, 4);
});

test("a search whose recorded results repeat a URL yields it once", async () => {
  const provider = recordedProvider(fixture("duplicate-results"));
  const results = await provider.search("Northwind Robotics company overview");
  assert.equal(results.length, 1, "a duplicated fixture URL must not become two hops");
});

test("replay is deterministic — two runs of the same fixture agree exactly", async () => {
  const a = await recordedProvider(NORTHWIND).search("Northwind Robotics company overview");
  const b = await recordedProvider(NORTHWIND).search("Northwind Robotics company overview");
  assert.deepEqual(a, b);
});
