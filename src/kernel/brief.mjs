// The strategy brief, composed from a kernel the model cannot negotiate with.
//
// runScout takes `brief` as an opaque string. This module is what fills it: a
// small fixed set of gtm-architect read surfaces, called over MCP, rendered into
// one string whose every strategy sentence is something the kernel returned.
//
// THE ONE RULE. This module never writes strategy. It quotes, labels and
// arranges what the envelopes carry, and where the kernel refuses it says so in
// the kernel's own words. A brief that smoothed over a refusal would be telling
// the scout a story the project has not earned, which is the exact failure the
// kernel exists to prevent — and a refusing kernel is the system working.
//
// A NOTE ON THE FIRST LINE. planHops lifts the brief's first six word-tokens
// into a search query, so the opening line is load-bearing rather than
// decorative. It carries the picked beachhead and the surviving USPs — the most
// searchable strategy terms the kernel holds — instead of a header, which would
// have spent all six slots on the word "strategy" and its neighbours.

import { basename, resolve } from "node:path";
import { openKernel } from "./client.mjs";

/** The read surfaces the brief is built from. Confirmed against the server's
 *  own tools/list at runtime rather than trusted, so a catalog that moved is
 *  named rather than silently producing a thinner brief. */
export const DEFAULT_TOOLS = Object.freeze(["gtm_status", "gtm_positioning", "gtm_canvas"]);

/**
 * Read the kernel and compose the strategy brief.
 *
 * Returns a RESULT, never a bare string, because the two failure shapes must
 * stay distinguishable:
 *
 *   { ok: true,  brief, envelopes }  the kernel was read. `brief` may still
 *                                    carry refusals — that is the kernel
 *                                    working, and it is reported, not hidden.
 *   { ok: false, refusal }           the kernel could not be read at all.
 *                                    `brief` is absent, so a caller can never
 *                                    mistake a broken read for "no brief given".
 */
export async function briefFromKernel({
  projectDir,
  serverPath,
  tools = DEFAULT_TOOLS,
  timeoutMs,
} = {}) {
  const projectName = projectDir ? basename(resolve(projectDir)) : "unknown";
  const cannot = (why) => ({
    ok: false,
    refusal: `the gtm-architect kernel could not be read for project ${projectName}: ${why}`,
  });

  let kernel;
  try {
    kernel = await openKernel({ projectDir, serverPath, timeoutMs });
  } catch (err) {
    return cannot(err.message);
  }

  try {
    // Confirm the surfaces exist rather than assuming the names. A tool that
    // moved upstream must fail loudly here, not quietly shrink the brief.
    const catalog = (await kernel.listTools()).map((t) => t.name);
    const missing = tools.filter((t) => !catalog.includes(t));
    if (missing.length)
      return cannot(
        `the server does not expose ${missing.join(", ")}. it exposes: ${catalog.join(", ")}`,
      );

    const envelopes = {};
    for (const tool of tools) envelopes[tool] = await kernel.callTool(tool);

    return { ok: true, brief: compose({ projectName, tools, envelopes }), envelopes };
  } catch (err) {
    return cannot(err.message);
  } finally {
    await kernel.close();
  }
}

/** Double quotes in this file mean ONE thing: the text inside came from the
 *  kernel. Nothing this module authors is ever quoted, so a reader can tell
 *  recorded state from labelling by looking.
 *
 *  A kernel value that already contains a double quote is emitted BARE. The
 *  kernel's longer refusals quote the book they are enforcing, and wrapping
 *  those in another pair would produce nesting that neither a reader nor a
 *  parser can resolve — and escaping them would alter the kernel's own words,
 *  which is the one thing this module must never do. */
const q = (s) => (String(s).includes('"') ? String(s) : `"${s}"`);

function compose({ projectName, tools, envelopes }) {
  const status = envelopes.gtm_status?.data ?? {};
  const positioning = envelopes.gtm_positioning?.data ?? {};
  const lines = [];

  // Line one aims the planner's hop. Kernel terms only.
  const aiming = [
    status.ecp?.segment || status.ecp?.beachhead,
    ...(positioning.usps ?? []).map((u) => u.asset),
  ].filter(Boolean);
  if (aiming.length) lines.push(aiming.join(" "), "");

  lines.push(
    `strategy brief — from the gtm-architect kernel, project ${projectName}, read only. ` +
      `Everything below is recorded kernel state; nothing here is inferred, and quoted text is ` +
      `the kernel's own.`,
    "",
  );

  // What the strategy declares.
  const declares = [];
  if (status.productState) declares.push(`product state: ${status.productState}`);
  if (status.objective?.declared && status.objective.mission)
    declares.push(
      `mission: ${q(status.objective.mission)}` +
        (status.objective.from ? ` (secured ${status.objective.from} to ${status.objective.to})` : ""),
    );
  if (status.ecp?.beachhead) declares.push(`picked beachhead: ${q(status.ecp.beachhead)}`);
  if (status.ecp?.drawn) declares.push(`ECP drawn ${status.ecp.date}`);
  if (status.next) declares.push(`the kernel's own next step: ${q(status.next)}`);
  if (declares.length) lines.push("WHAT THE STRATEGY DECLARES", ...indent(declares), "");

  // What the positioning claims.
  const claims = [];
  if (positioning.story?.statement) claims.push(`position: ${q(positioning.story.statement)}`);
  for (const u of positioning.usps ?? [])
    claims.push(`USP (survives both filters): ${q(u.asset)} — ${q(u.benefit)}`);
  for (const b of positioning.benefits ?? [])
    claims.push(`table stakes (valued, not unique): ${q(b.asset)} — ${q(b.benefit)}`);
  if (claims.length) lines.push("WHAT THE POSITIONING CLAIMS", ...indent(claims), "");

  // What the evidence gates hold open.
  const gates = [];
  if (status.evidence)
    gates.push(
      `${status.evidence.total} graded observations recorded, ${status.evidence.excluded} excluded`,
    );
  for (const d of status.decisions ?? [])
    gates.push(
      `decision ${d.id} ${d.name}: ${d.status}` +
        (d.label && d.label !== d.status ? ` — ${q(d.label)}` : ""),
    );
  if (gates.length) lines.push("WHAT THE EVIDENCE GATES HOLD OPEN", ...indent(gates), "");

  // What the kernel refuses. Its words, whole.
  const refusals = [];
  for (const tool of tools) {
    const env = envelopes[tool];
    if (!env || env.ok !== false) continue;
    for (const p of env.problems ?? [])
      refusals.push(`the kernel refuses ${tool}: ${q(p.message)}`);
  }
  if (refusals.length)
    lines.push(
      "WHAT THE KERNEL REFUSES (a refusal is recorded state, not a gap to fill in)",
      ...indent(refusals),
      "",
    );

  return lines.join("\n").trimEnd();
}

const indent = (xs) => xs.map((x) => `  ${x}`);
