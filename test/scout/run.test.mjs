// The end-to-end recorded run. Keyless: no Anthropic key in this environment.
delete process.env.ANTHROPIC_API_KEY;

import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { makeResearchRequest, makeHop } from "../../src/types.mjs";
import { recordedProvider } from "../../src/scout/provider-recorded.mjs";
import { runScout } from "../../src/scout/run.mjs";
import { ScoutRefusal } from "../../src/scout/errors.mjs";

const fixture = (slug) => fileURLToPath(new URL(`../../fixtures/${slug}/`, import.meta.url));
const FROZEN_NOW = () => "2026-09-07T12:00:09.000Z";

function requestFor(provider, requestId) {
  return makeResearchRequest({ ...provider.account, requestId });
}

async function runFixture(slug) {
  const provider = recordedProvider(fixture(slug));
  return runScout({ request: requestFor(provider, `req-${slug}`), provider, now: FROZEN_NOW });
}

test("the rich fixture yields four claims and three refusals over four hops", async () => {
  const report = await runFixture("northwind-robotics");
  assert.equal(report.account, "Northwind Robotics");
  assert.equal(report.claims.length, 4);
  assert.equal(report.refusals.length, 3);
  assert.equal(report.hops.length, 4);
});

test("the fabricated funding number never reaches claims, and its refusal names the quote", async () => {
  const report = await runFixture("northwind-robotics");
  assert.ok(
    !report.claims.some((c) => c.text.includes("$47 million")),
    "a fabricated number must not survive a full run",
  );
  const refusal = report.refusals.find((r) => r.text.includes("$47 million Series C"));
  assert.ok(refusal, "the fabricated claim must appear as a refusal, never be dropped");
  assert.match(refusal.reason, /quote does not appear in the fetched content/);
  assert.match(refusal.reason, /\$47 million Series C in March 2026 at a \$310 million valuation/);
});

test("the run carries all three claim kinds and both tiers", async () => {
  const report = await runFixture("northwind-robotics");
  assert.deepEqual([...new Set(report.claims.map((c) => c.kind))].sort(), ["causal", "factual", "numeric"]);
  assert.deepEqual([...new Set(report.claims.map((c) => c.tier))].sort(), ["primary", "secondary"]);
});

test("the hop trail is deduplicated — a page found by two searches is fetched once", async () => {
  const report = await runFixture("northwind-robotics");
  const urls = report.hops.map((h) => h.url);
  assert.equal(new Set(urls).size, urls.length);
  assert.ok(urls.includes("https://northwindrobotics.com/about"));
  assert.ok(urls.includes("https://podcast.example/northwind-ep-42"));
});

test("thin evidence yields a thin honest report, not padding", async () => {
  const report = await runFixture("acme-freight");
  assert.equal(report.claims.length, 1);
  assert.equal(report.refusals.length, 3);
  assert.equal(report.hops.length, 2);
  assert.match(report.claims[0].text, /palletised freight/);
});

test("a recorded report names its mode honestly and names no model", async () => {
  const report = await runFixture("northwind-robotics");
  assert.equal(report.meta.mode, "recorded");
  assert.equal(report.meta.model, undefined);
});

test("every claim id is unique", async () => {
  const report = await runFixture("northwind-robotics");
  const ids = report.claims.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("the same fixture run twice produces an identical report", async () => {
  const a = await runFixture("northwind-robotics");
  const b = await runFixture("northwind-robotics");
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
});

// ---- stub providers, for the paths the fixtures cannot express ----

function stubProvider(over = {}) {
  return {
    mode: "recorded",
    model: undefined,
    account: { accountName: "Stub Co", domain: "stub.example" },
    searchCalls: [],
    async search(query) {
      this.searchCalls.push(query);
      return [];
    },
    async fetchPage(url) {
      return makeHop({ url, title: "Stub", fetchedAt: "2026-09-07T00:00:00.000Z", content: "stub content for the scout run" });
    },
    async proposeClaims() {
      return [];
    },
    ...over,
  };
}

const stubRequest = makeResearchRequest({ accountName: "Stub Co", domain: "stub.example", requestId: "req-stub" });

test("two consecutive hops that surface nothing new stop the run early", async () => {
  const provider = stubProvider({
    async search(query) {
      this.searchCalls.push(query);
      return [{ url: "https://stub.example/a", title: "A" }];
    },
  });
  const report = await runScout({ request: stubRequest, provider, now: FROZEN_NOW });
  assert.equal(report.hops.length, 1, "the one new page is fetched once");
  assert.equal(
    provider.searchCalls.length,
    3,
    "hops 2 and 3 added no new URL, so the run stopped and hop 4 never ran",
  );
});

test("a single barren hop does not stop the run — differently aimed hops still get their turn", async () => {
  let call = 0;
  const provider = stubProvider({
    async search(query) {
      this.searchCalls.push(query);
      call += 1;
      // hop 1 finds A, hop 2 re-finds A (barren), hop 3 finds B.
      if (call <= 2) return [{ url: "https://stub.example/a", title: "A" }];
      return [{ url: "https://stub.example/b", title: "B" }];
    },
  });
  const report = await runScout({ request: stubRequest, provider, now: FROZEN_NOW });
  assert.equal(provider.searchCalls.length, 3, "one overlap must not abort the remaining plan");
  assert.deepEqual(
    report.hops.map((h) => h.url),
    ["https://stub.example/a", "https://stub.example/b"],
  );
});

test("an early stop still reports the hops it did fetch", async () => {
  const provider = stubProvider({
    async search(query) {
      this.searchCalls.push(query);
      return [{ url: "https://stub.example/a", title: "A" }];
    },
    async proposeClaims() {
      return [{ text: "Stub Co exists.", kind: "factual", citations: [{ url: "https://stub.example/a", quote: "stub content for the scout" }] }];
    },
  });
  const report = await runScout({ request: stubRequest, provider, now: FROZEN_NOW });
  assert.equal(report.claims.length, 1);
  assert.equal(report.claims[0].tier, "primary");
});

test("a run where every search finds nothing refuses rather than reporting an all-clear", async () => {
  await assert.rejects(
    () => runScout({ request: stubRequest, provider: stubProvider(), now: FROZEN_NOW }),
    (err) => {
      assert.ok(err instanceof ScoutRefusal);
      assert.match(err.message, /researched nothing/);
      return true;
    },
  );
});

test("a provider search failure fails the run closed", async () => {
  const provider = stubProvider({
    async search() {
      throw new Error("upstream exploded");
    },
  });
  await assert.rejects(
    () => runScout({ request: stubRequest, provider, now: FROZEN_NOW }),
    (err) => {
      assert.ok(err instanceof ScoutRefusal, "a provider failure is a refusal, never a partial report");
      assert.match(err.message, /upstream exploded/);
      return true;
    },
  );
});

test("a provider extraction failure fails the run closed", async () => {
  const provider = stubProvider({
    async search() {
      return [{ url: "https://stub.example/a", title: "A" }];
    },
    async proposeClaims() {
      throw new Error("could not parse the model response");
    },
  });
  await assert.rejects(
    () => runScout({ request: stubRequest, provider, now: FROZEN_NOW }),
    (err) => {
      assert.ok(err instanceof ScoutRefusal);
      assert.match(err.message, /could not parse the model response/);
      return true;
    },
  );
});

test("maxHops caps how far a run reaches", async () => {
  let n = 0;
  const provider = stubProvider({
    async search(query) {
      this.searchCalls.push(query);
      return [{ url: `https://stub.example/p${n++}`, title: "P" }];
    },
  });
  const report = await runScout({ request: stubRequest, provider, maxHops: 2, now: FROZEN_NOW });
  assert.equal(report.hops.length, 2);
  assert.equal(provider.searchCalls.length, 2);
});

test("the strategy brief reaches both the planner and the extractor", async () => {
  let seenBrief;
  const provider = stubProvider({
    async search(query) {
      this.searchCalls.push(query);
      return [{ url: "https://stub.example/a", title: "A" }];
    },
    async proposeClaims(ctx) {
      seenBrief = ctx.brief;
      return [];
    },
  });
  const brief = "positioning: cold-start distribution for mid-market operators";
  const report = await runScout({ request: stubRequest, provider, brief, now: FROZEN_NOW });
  assert.equal(seenBrief, brief, "the extractor gets the brief a later lane supplies");
  assert.ok(
    provider.searchCalls.some((q) => /cold-start distribution/.test(q)),
    "the planner aims a hop with the brief",
  );
  assert.equal(report.meta.mode, "recorded");
});

test("the extractor is handed the hops the run actually fetched", async () => {
  let seenHops;
  const provider = stubProvider({
    async search(query) {
      this.searchCalls.push(query);
      return [{ url: "https://stub.example/a", title: "A" }];
    },
    async proposeClaims(ctx) {
      seenHops = ctx.hops;
      return [];
    },
  });
  await runScout({ request: stubRequest, provider, now: FROZEN_NOW });
  assert.equal(seenHops.length, 1);
  assert.equal(seenHops[0].url, "https://stub.example/a");
});
