// The brief builder, against the real server and the real fixture.
//
// The brief is the string runScout aims its hops with. Its whole worth is that
// it came from a kernel the model cannot negotiate with, so these tests care
// about one thing above all: every strategy sentence in the brief must be
// traceable to something the kernel actually returned.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { briefFromKernel } from "../../src/kernel/brief.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = join(HERE, "..", "..", "fixtures", "gtm-project");

test("the brief names the kernel and the project it was read from", async () => {
  const result = await briefFromKernel({ projectDir: PROJECT_DIR });

  assert.equal(result.ok, true, result.refusal);
  assert.equal(typeof result.brief, "string");
  assert.match(result.brief, /from the gtm-architect kernel, project gtm-project/);
});

test("the brief carries what the strategy declares, in the kernel's own words", async () => {
  const { brief } = await briefFromKernel({ projectDir: PROJECT_DIR });

  // Each of these is a verbatim substring of the fixture's recorded state, so a
  // brief that paraphrased or invented would fail here.
  assert.match(brief, /twelve regional LTL carriers paying for dock scheduling/);
  assert.match(brief, /regional LTL carriers/); // the picked beachhead
  assert.match(brief, /mvp/); // product state
});

test("the brief carries what the positioning claims, USPs included", async () => {
  const { brief } = await briefFromKernel({ projectDir: PROJECT_DIR });

  assert.match(brief, /gate-clock arrival capture/);
  assert.match(brief, /TMS-agnostic dock calendar/);
  assert.match(brief, /without replacing the TMS they already run/); // the statement
});

test("the brief says which evidence gates are still open", async () => {
  const { brief } = await briefFromKernel({ projectDir: PROJECT_DIR });

  assert.match(brief, /5 graded observation/);
  assert.match(brief, /03 product/);
  assert.match(brief, /no evidence/);
});

test("a refusing surface is carried into the brief in the kernel's own words", async () => {
  const { brief } = await briefFromKernel({ projectDir: PROJECT_DIR });

  // gtm_canvas refuses on this fixture. A refusing kernel is the system working,
  // and the brief has to say so rather than quietly omitting the surface.
  assert.match(brief, /the kernel refuses gtm_canvas:/);
  assert.match(brief, /value-prop\.md is empty/);
});

test("every quoted strategy value in the brief is traceable to the kernel's envelopes", async () => {
  const { brief, envelopes } = await briefFromKernel({ projectDir: PROJECT_DIR });
  const raw = JSON.stringify(envelopes);

  // The anti-invention check. Quotes in the brief pair strictly, so the text
  // inside them is every odd-indexed segment of a split — a scan by regex
  // desynchronizes on a short value and starts capturing the label text
  // BETWEEN two quoted values, which reads as a false accusation of invention.
  //
  // The refusals block is excluded here and checked below, because the kernel's
  // longer refusals quote the book they enforce and so carry their own quotes.
  const declared = brief.split("WHAT THE KERNEL REFUSES")[0];
  const quoted = declared.split('"').filter((_, i) => i % 2 === 1);

  assert.ok(quoted.length >= 5, `the brief quotes only ${quoted.length} values, so it proves little`);
  for (const value of quoted)
    assert.ok(
      raw.includes(value),
      `the brief quotes something no envelope contains, so it was invented: ${JSON.stringify(value)}`,
    );
});

test("each refusal the brief reports is the kernel's message verbatim", async () => {
  const { brief, envelopes } = await briefFromKernel({ projectDir: PROJECT_DIR });

  const block = brief.split("WHAT THE KERNEL REFUSES")[1] ?? "";
  const reported = [...block.matchAll(/the kernel refuses (\w+): (.+)/g)];
  assert.ok(reported.length > 0, "the fixture has a refusing surface; the brief reported none");

  for (const [, tool, raw] of reported) {
    // The brief wraps a kernel value in quotes unless it already carries its
    // own, so the parse has to unwrap before comparing.
    const message = raw.replace(/^"([\s\S]*)"$/, "$1");
    const envelope = envelopes[tool];
    assert.ok(envelope, `the brief reports a refusal from ${tool}, which it never called`);
    assert.equal(envelope.ok, false, `${tool} did not refuse, so the brief invented a refusal`);
    // Compared against the message strings themselves, never a JSON dump of
    // them: these messages quote the book they enforce, and JSON.stringify
    // escapes those quotes, so a dump would report a verbatim carry as a
    // paraphrase.
    const actual = (envelope.problems ?? []).map((p) => p.message);
    assert.ok(
      actual.includes(message),
      `the brief paraphrased a refusal instead of carrying it.\n  brief:  ${message}\n  kernel: ${actual.join(" | ")}`,
    );
  }
});

test("an unreachable kernel refuses, and never returns a silently empty brief", async () => {
  const result = await briefFromKernel({
    projectDir: PROJECT_DIR,
    serverPath: join(HERE, "no-such-server.mjs"),
  });

  assert.equal(result.ok, false);
  assert.equal(result.brief, undefined, "a failed read must not look like an absent brief");
  assert.match(result.refusal, /could not be read/);
});

test("a surface the server does not expose is named, never quietly skipped", async () => {
  const result = await briefFromKernel({
    projectDir: PROJECT_DIR,
    tools: ["gtm_status", "gtm_not_a_real_surface"],
  });

  assert.equal(result.ok, false);
  assert.equal(result.brief, undefined);
  assert.match(result.refusal, /gtm_not_a_real_surface/);
});

test("the fixture the brief reads is synthetic — no real company reaches it", () => {
  const { brief } = { brief: readFileSync(join(PROJECT_DIR, ".gtm", "context.md"), "utf8") };
  for (const forbidden of ["Magnetiz", "magnetiz", "RevWisely", "revwisely"])
    assert.ok(!brief.includes(forbidden), `the fixture names ${forbidden}`);
});
