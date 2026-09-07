import test from "node:test";
import assert from "node:assert/strict";

import { makeResearchRequest, makeHop, makeCitation, makeClaim, makeRefusal } from "../../src/types.mjs";
import { buildResearchReport } from "../../src/report/build.mjs";
import { ScoutRefusal } from "../../src/scout/errors.mjs";

const request = makeResearchRequest({
  accountName: "Northwind Robotics",
  domain: "northwindrobotics.com",
  requestId: "req-1",
});

const hop = makeHop({
  url: "https://northwindrobotics.com/about",
  title: "About Northwind Robotics",
  fetchedAt: "2026-09-07T12:00:00.000Z",
  content: "Northwind Robotics builds warehouse automation for mid-market logistics operators.",
});

const claim = makeClaim({
  id: "c1",
  text: "Northwind Robotics builds warehouse automation.",
  kind: "factual",
  tier: "primary",
  citations: [
    makeCitation({
      url: hop.url,
      title: hop.title,
      fetchedAt: hop.fetchedAt,
      quote: "Northwind Robotics builds warehouse automation",
    }),
  ],
});

const refusal = makeRefusal({ text: "Northwind raised $47 million.", reason: "quote does not appear" });

test("a report carries the account, the claims, the refusals and the full hop trail", () => {
  const report = buildResearchReport({
    request,
    hops: [hop],
    claims: [claim],
    refusals: [refusal],
    meta: { mode: "recorded" },
    generatedAt: "2026-09-07T12:00:01.000Z",
  });
  assert.equal(report.account, "Northwind Robotics");
  assert.equal(report.claims.length, 1);
  assert.equal(report.refusals.length, 1);
  assert.equal(report.hops.length, 1);
  assert.equal(report.meta.mode, "recorded");
});

test("a run that fetched zero hops refuses rather than reporting an all-clear", () => {
  assert.throws(
    () =>
      buildResearchReport({
        request,
        hops: [],
        claims: [],
        refusals: [],
        meta: { mode: "recorded" },
      }),
    (err) => {
      assert.ok(err instanceof ScoutRefusal, "a zero-hop run is a refusal, not a crash");
      assert.match(err.message, /researched nothing/);
      return true;
    },
  );
});

test("zero hops still refuses even when claims arrive from somewhere", () => {
  assert.throws(
    () =>
      buildResearchReport({
        request,
        hops: [],
        claims: [claim],
        refusals: [],
        meta: { mode: "recorded" },
      }),
    ScoutRefusal,
  );
});

test("a live report without a model is refused — an unattributed verdict cannot be challenged", () => {
  assert.throws(
    () => buildResearchReport({ request, hops: [hop], claims: [], refusals: [], meta: { mode: "live" } }),
    /model/,
  );
});

test("a live report naming its model is built", () => {
  const report = buildResearchReport({
    request,
    hops: [hop],
    claims: [],
    refusals: [refusal],
    meta: { mode: "live", model: "claude-opus-5" },
  });
  assert.equal(report.meta.model, "claude-opus-5");
});

test("generatedAt defaults to an ISO timestamp when not supplied", () => {
  const report = buildResearchReport({
    request,
    hops: [hop],
    claims: [],
    refusals: [],
    meta: { mode: "recorded" },
  });
  assert.match(report.generatedAt, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
});

test("the report is frozen — a consumer cannot quietly drop a refusal", () => {
  const report = buildResearchReport({
    request,
    hops: [hop],
    claims: [],
    refusals: [refusal],
    meta: { mode: "recorded" },
  });
  assert.throws(() => report.refusals.pop(), TypeError);
});
