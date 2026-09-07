// The plug: what the kernel produces has to be usable by the thing it feeds.
//
// Lane B accepts `brief` as an opaque string and lifts its first six word-tokens
// into one aimed hop. That contract is easy to satisfy in the letter and miss
// entirely in the spirit — a brief that opened with a header would hand the
// planner "strategy brief from the gtm architect" as a search query, which is
// six slots spent on nothing. These tests hold the brief to the spirit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { briefFromKernel } from "../../src/kernel/brief.mjs";
import { planHops } from "../../src/scout/planner.mjs";
import { makeResearchRequest } from "../../src/types.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = join(HERE, "..", "..", "fixtures", "gtm-project");

const REQUEST = makeResearchRequest({
  accountName: "Northwind Robotics",
  domain: "northwind-robotics.example",
  requestId: "kernel-plug-1",
});

test("the kernel brief is a string runScout's planner accepts", async () => {
  const { brief } = await briefFromKernel({ projectDir: PROJECT_DIR });

  const hops = planHops({ request: REQUEST, brief, maxHops: 4 });
  assert.ok(hops.some((h) => h.purpose === "strategy-brief"), "the brief aimed no hop");
});

test("the hop the brief aims carries the kernel's beachhead, not a header", async () => {
  const { brief } = await briefFromKernel({ projectDir: PROJECT_DIR });

  const aimed = planHops({ request: REQUEST, brief, maxHops: 4 }).find(
    (h) => h.purpose === "strategy-brief",
  );

  // The six tokens the planner lifts must be strategy the kernel recorded. This
  // is the assertion that fails if the brief ever leads with a label again.
  assert.match(aimed.query, /Northwind Robotics/);
  assert.match(aimed.query, /regional LTL carriers/);
  for (const junk of ["strategy", "brief", "kernel", "WHAT"])
    assert.ok(
      !aimed.query.includes(junk),
      `the aimed hop spent a slot on the word ${junk}: ${aimed.query}`,
    );
});
