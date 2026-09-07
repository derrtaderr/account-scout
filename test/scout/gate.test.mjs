import test from "node:test";
import assert from "node:assert/strict";

import { makeHop, CLAIM_KINDS } from "../../src/types.mjs";
import { gateCandidates, citationTier } from "../../src/scout/gate.mjs";

const OWN = "https://northwindrobotics.com/about";
const PRESS = "https://logisticsweekly.example/northwind-series-b";

const hops = [
  makeHop({
    url: OWN,
    title: "About Northwind Robotics",
    fetchedAt: "2026-09-07T12:00:00.000Z",
    content:
      "Northwind Robotics builds warehouse automation for mid-market third-party logistics operators. " +
      "The company was founded in 2019 in Rotterdam by Ines Aldarov and Petro Vance.",
  }),
  makeHop({
    url: PRESS,
    title: "Northwind closes Series B",
    fetchedAt: "2026-09-07T12:00:02.000Z",
    content:
      "Northwind Robotics closed a 24 million euro Series B led by Kettle Row Capital. " +
      "Deployments doubled after the company shifted to a per-pick pricing model.",
  }),
];

const RUN_AT = "2026-09-07T12:00:05.000Z";
const gate = (candidates, domain = "northwindrobotics.com") =>
  gateCandidates({ candidates, hops, domain, runAt: RUN_AT });

const good = {
  text: "Northwind Robotics builds warehouse automation for mid-market 3PLs.",
  kind: "factual",
  citations: [{ url: OWN, quote: "Northwind Robotics builds warehouse automation" }],
};

test("a claim whose quote appears verbatim in fetched content passes the gate", () => {
  const { claims, refusals } = gate([good]);
  assert.equal(refusals.length, 0);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].text, good.text);
  assert.equal(claims[0].kind, "factual");
  assert.equal(claims[0].citations[0].quote, "Northwind Robotics builds warehouse automation");
});

test("a fabricated number is refused, and the reason names the quote that appears nowhere", () => {
  const fabricated = {
    text: "Northwind Robotics raised a $47 million Series C.",
    kind: "numeric",
    citations: [{ url: PRESS, quote: "raised a $47 million Series C led by Harbor Point" }],
  };
  const { claims, refusals } = gate([fabricated]);
  assert.equal(claims.length, 0, "a fabricated number must never reach claims[]");
  assert.equal(refusals.length, 1);
  assert.equal(refusals[0].text, fabricated.text, "the refused text is carried verbatim");
  assert.match(refusals[0].reason, /quote does not appear/);
  assert.match(refusals[0].reason, /raised a \$47 million Series C led by Harbor Point/);
  assert.match(refusals[0].reason, /logisticsweekly\.example/);
});

test("a citation pointing at a URL never fetched this run is refused", () => {
  const unfetched = {
    text: "Northwind Robotics operates a plant in Osaka.",
    kind: "factual",
    citations: [{ url: "https://northwindrobotics.com/osaka", quote: "our Osaka plant opened in 2025" }],
  };
  const { claims, refusals } = gate([unfetched]);
  assert.equal(claims.length, 0);
  assert.match(refusals[0].reason, /never fetched this run/);
  assert.match(refusals[0].reason, /northwindrobotics\.com\/osaka/);
});

test("a candidate carrying no citation at all is refused, never promoted", () => {
  const uncited = { text: "Northwind is the category leader.", kind: "factual", citations: [] };
  const { claims, refusals } = gate([uncited]);
  assert.equal(claims.length, 0);
  assert.equal(refusals.length, 1);
  assert.match(refusals[0].reason, /no citation/i);
});

test("a missing citations field is refused rather than throwing", () => {
  const { claims, refusals } = gate([{ text: "Northwind is growing.", kind: "factual" }]);
  assert.equal(claims.length, 0);
  assert.match(refusals[0].reason, /no citation/i);
});

test("a doctored hop — content edited after recording — turns a passing claim into a refusal", () => {
  const { claims: before } = gate([good]);
  assert.equal(before.length, 1, "precondition: this claim passes against the honest recording");

  const doctored = hops.map((h) =>
    h.url === OWN
      ? makeHop({ ...h, content: h.content.replace("builds warehouse automation", "builds nothing at all") })
      : h,
  );
  const { claims, refusals } = gateCandidates({
    candidates: [good],
    hops: doctored,
    domain: "northwindrobotics.com",
    runAt: RUN_AT,
  });
  assert.equal(claims.length, 0, "a doctored fixture must fail loudly, not pass quietly");
  assert.match(refusals[0].reason, /quote does not appear/);
});

test("one bad citation refuses the whole claim — a valid half never launders the other", () => {
  const mixed = {
    text: "Northwind raised a Series B and runs an Osaka plant.",
    kind: "numeric",
    citations: [
      { url: PRESS, quote: "closed a 24 million euro Series B" },
      { url: "https://northwindrobotics.com/osaka", quote: "our Osaka plant opened in 2025" },
    ],
  };
  const { claims, refusals } = gate([mixed]);
  assert.equal(claims.length, 0);
  assert.equal(refusals.length, 1);
  assert.match(refusals[0].reason, /never fetched this run/);
});

test("an unrecognized claim kind is refused, never coerced into a valid one", () => {
  const odd = { text: "Northwind feels promising.", kind: "vibes", citations: [{ url: OWN, quote: "founded in 2019 in Rotterdam" }] };
  const { claims, refusals } = gate([odd]);
  assert.equal(claims.length, 0);
  assert.match(refusals[0].reason, new RegExp(CLAIM_KINDS.join("|")));
});

test("nothing is silently dropped: every candidate lands in claims or refusals", () => {
  const candidates = [
    good,
    { text: "bad quote", kind: "numeric", citations: [{ url: OWN, quote: "nowhere at all in this fetched page" }] },
    { text: "no citations", kind: "causal", citations: [] },
    { text: "bad kind", kind: "nope", citations: [{ url: OWN, quote: "founded in 2019 in Rotterdam" }] },
  ];
  const { claims, refusals } = gate(candidates);
  assert.equal(claims.length + refusals.length, candidates.length);
});

test("tier is primary on the account's own property, secondary on third-party coverage", () => {
  assert.equal(citationTier(OWN, "northwindrobotics.com"), "primary");
  assert.equal(citationTier("https://www.northwindrobotics.com/x", "northwindrobotics.com"), "primary");
  assert.equal(citationTier("https://careers.northwindrobotics.com/x", "northwindrobotics.com"), "primary");
  assert.equal(citationTier(PRESS, "northwindrobotics.com"), "secondary");
  assert.equal(citationTier(OWN, "https://www.northwindrobotics.com"), "primary");
});

test("with no known domain nothing can be called the account's own property", () => {
  assert.equal(citationTier(OWN, undefined), "secondary");
  const { claims } = gateCandidates({ candidates: [good], hops, domain: undefined, runAt: RUN_AT });
  assert.equal(claims[0].tier, "secondary");
});

test("a malformed URL is tiered secondary rather than throwing", () => {
  assert.equal(citationTier("not a url", "northwindrobotics.com"), "secondary");
});

test("a claim resting on any first-party evidence is tiered primary", () => {
  const corroborated = {
    text: "Northwind was founded in 2019 and closed a Series B.",
    kind: "factual",
    citations: [
      { url: PRESS, quote: "closed a 24 million euro Series B" },
      { url: OWN, quote: "founded in 2019 in Rotterdam" },
    ],
  };
  const { claims } = gate([corroborated]);
  assert.equal(claims[0].tier, "primary");
});

test("a passing citation inherits the title and fetchedAt of the hop it binds to", () => {
  const { claims } = gate([good]);
  assert.equal(claims[0].citations[0].title, "About Northwind Robotics");
  assert.equal(claims[0].citations[0].fetchedAt, "2026-09-07T12:00:00.000Z");
});

test("claim ids are stable and traceable to the candidate's position", () => {
  const candidates = [{ text: "no citations", kind: "factual", citations: [] }, good];
  const { claims } = gate(candidates);
  assert.equal(claims[0].id, "c2", "the surviving claim keeps its candidate index");
});

test("an empty quote is refused rather than crashing the gate", () => {
  const { claims, refusals } = gate([{ text: "Northwind exists.", kind: "factual", citations: [{ url: OWN, quote: "" }] }]);
  assert.equal(claims.length, 0);
  assert.equal(refusals.length, 1);
});

test("the gate is a pure function of its inputs — same input, same verdict", () => {
  const a = gate([good]);
  const b = gate([good]);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
});
