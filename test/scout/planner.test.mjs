import test from "node:test";
import assert from "node:assert/strict";

import { makeResearchRequest } from "../../src/types.mjs";
import { planHops, DEFAULT_MAX_HOPS } from "../../src/scout/planner.mjs";

const req = (over = {}) =>
  makeResearchRequest({
    accountName: "Northwind Robotics",
    domain: "northwindrobotics.com",
    requestId: "req-1",
    ...over,
  });

test("the first planned hop is an overview query naming the account", () => {
  const plan = planHops({ request: req() });
  assert.equal(plan[0].purpose, "overview");
  assert.match(plan[0].query, /Northwind Robotics/);
});

test("a known domain earns a hop aimed at the account's own property", () => {
  const plan = planHops({ request: req() });
  const primary = plan.find((h) => h.purpose === "primary");
  assert.ok(primary, "expected a primary-source hop when a domain is known");
  assert.match(primary.query, /northwindrobotics\.com/);
});

test("no domain means no primary-source hop is invented", () => {
  const plan = planHops({ request: req({ domain: undefined }) });
  assert.equal(
    plan.find((h) => h.purpose === "primary"),
    undefined,
  );
});

test("each request question becomes its own focused hop", () => {
  const plan = planHops({
    request: req({ questions: ["who runs revenue", "what is the pricing model"] }),
    maxHops: 8,
  });
  const questions = plan.filter((h) => h.purpose === "question");
  assert.equal(questions.length, 2);
  assert.match(questions[0].query, /who runs revenue/);
  assert.match(questions[1].query, /what is the pricing model/);
});

test("the strategy brief is accepted as an opaque string and aims a hop", () => {
  const plan = planHops({
    request: req(),
    brief: "positioning: warehouse automation for mid-market 3PLs",
    maxHops: 8,
  });
  const aimed = plan.find((h) => h.purpose === "strategy-brief");
  assert.ok(aimed, "expected the brief to aim a hop");
  assert.match(aimed.query, /warehouse automation/);
});

test("the strategy brief outranks generic questions when hops are scarce", () => {
  const plan = planHops({
    request: req({ questions: ["q one", "q two", "q three", "q four", "q five"] }),
    brief: "positioning: warehouse automation",
    maxHops: 4,
  });
  assert.ok(
    plan.some((h) => h.purpose === "strategy-brief"),
    "a scarce plan keeps the declared strategy over a generic question",
  );
});

test("the plan is capped at maxHops, default 4", () => {
  assert.equal(DEFAULT_MAX_HOPS, 4);
  const many = req({ questions: ["a", "b", "c", "d", "e", "f", "g"] });
  assert.equal(planHops({ request: many }).length, 4);
  assert.equal(planHops({ request: many, maxHops: 2 }).length, 2);
});

test("the plan carries no duplicate queries", () => {
  const plan = planHops({
    request: req({ questions: ["company overview", "company overview"] }),
    maxHops: 8,
  });
  const queries = plan.map((h) => h.query);
  assert.equal(new Set(queries).size, queries.length);
});

test("a maxHops below one is refused rather than silently returning nothing", () => {
  assert.throws(() => planHops({ request: req(), maxHops: 0 }), /maxHops/);
});
