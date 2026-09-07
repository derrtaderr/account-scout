// Lane E — the command implementations. Each takes a parsed, frozen options
// object and an injected `deps` (streams, env, clock, and optional factory
// overrides for tests), composes the real boundaries, and returns an EXIT CODE.
// The code is a contract, the same across every command:
//
//   0  the system did its job and delivered
//   1  an unexpected defect (a bug, not a decision)
//   2  a usage error — bad arguments
//   3  the system REFUSED or BLOCKED — a decision it is supposed to be able to
//      make (a ScoutRefusal, an egress refusal, an autonomy refusal, a
//      quarantine). Exit 3 is not failure; it is the gate working.
//
// Nothing here reads argv or calls process.exit — that is cli.mjs's job. Keeping
// I/O and the exit boundary injected is what makes every command testable
// without a port, a key, or a real process.

import { runScout } from "../scout/run.mjs";
import { processReport } from "../gates/pipeline.mjs";
import { createEgress } from "../gates/egress.mjs";
import { recordedProvider } from "../scout/provider-recorded.mjs";
import { liveProvider } from "../scout/provider-live.mjs";
import { briefFromKernel } from "../kernel/brief.mjs";
import { makeResearchRequest } from "../types.mjs";
import { ScoutRefusal } from "../scout/errors.mjs";
import { UsageError } from "./args.mjs";

export const EXIT = Object.freeze({
  DELIVERED: 0,
  DEFECT: 1,
  USAGE: 2,
  REFUSED: 3,
});

/** A filesystem-safe slug for a default report filename. */
export function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "account";
}

/** Build the provider the mode calls for. Recorded reads its store at
 *  construction and throws a ScoutRefusal if it is missing — that throw is a
 *  decision (exit 3), caught by the command, never a crash. */
export function buildProvider(opts, env) {
  if (opts.mode === "live") return liveProvider(env);
  return recordedProvider(opts.fixtures);
}

/** Resolve the strategy brief, honestly. A kernel that refuses does not fail the
 *  run — the scout proceeds UNAIMED and the refusal is surfaced, exactly as
 *  Lane C carries a kernel refusal rather than hiding it. */
async function resolveBrief(opts, deps) {
  if (!opts.project) return undefined;
  const b = deps.makeBrief ? await deps.makeBrief(opts) : await briefFromKernel({ projectDir: opts.project });
  if (b.ok) return b.brief;
  deps.stderr.write(`kernel brief unavailable, running unaimed: ${b.refusal}\n`);
  return undefined;
}

/**
 * `scout run` — research one account to a guarded report on disk.
 *
 * @param {object} opts a parsed `run` options object
 * @param {object} deps { stdout, stderr, env?, now?, makeProvider?, makeBrief? }
 * @returns {Promise<number>} an EXIT code
 */
export async function runCommand(opts, deps) {
  const {
    stdout,
    stderr,
    env = process.env,
    now = () => new Date().toISOString(),
    makeProvider,
  } = deps;

  try {
    const reportPath = opts.out ?? `reports/${slug(opts.account)}.md`;
    if (!reportPath.endsWith(".md"))
      throw new UsageError(`--out must be a .md path, got ${reportPath}`);

    const requestId = opts.requestId ?? `run-${slug(opts.account)}`;
    const request = makeResearchRequest({
      accountName: opts.account,
      domain: opts.domain,
      questions: opts.questions?.length ? [...opts.questions] : undefined,
      requestId,
    });

    const provider = makeProvider ? await makeProvider(opts) : buildProvider(opts, env);
    const brief = await resolveBrief(opts, deps);

    const report = await runScout({ request, provider, brief, now });

    const egress = createEgress({
      allowDomains: opts.domain ? [opts.domain] : [],
      out: stdout,
    });
    const result = await processReport(report, {
      egress,
      reportPath,
      telemetryPath: opts.telemetry,
      runId: requestId,
      now,
    });

    await egress.emitSummary(report);

    if (result.status === "delivered") return EXIT.DELIVERED;
    stderr.write(`refused by ${result.refusedBy}: ${result.reason}\n`);
    return EXIT.REFUSED;
  } catch (err) {
    if (err instanceof UsageError) {
      stderr.write(err.message + "\n");
      return EXIT.USAGE;
    }
    if (err instanceof ScoutRefusal) {
      stderr.write(err.message + "\n");
      return EXIT.REFUSED;
    }
    stderr.write(`unexpected error: ${err?.message ?? err}\n`);
    return EXIT.DEFECT;
  }
}
