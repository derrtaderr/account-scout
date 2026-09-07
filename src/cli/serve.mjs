// Lane E — `scout serve`, the assembled system. This is where every boundary
// meets: webhook-engine verifies and queues, the worker drains, the scout
// researches, the kernel aims, and the gates judge and guard. The builder wires
// them and hands back { server, ingress, tick } so the assembly is testable
// without ever binding a port; the thin serveCommand at the bottom is the only
// part that listens and loops.
//
// Two rules the wiring encodes:
//
//  - THE SECRET IS REQUIRED. An ingress with no secret cannot verify a
//    signature, and a receiver that accepts traffic without one is the exact
//    failure webhook-engine exists to prevent. Missing secret is a usage error,
//    refused before anything starts.
//
//  - EGRESS IS PER JOB. serve researches many accounts; each report must keep
//    its OWN account's domain while redacting everyone else's. One shared egress
//    cannot hold every account's allow-list, so the worker is handed an
//    egressFor(request) that builds the right one per report.

import { join } from "node:path";

import { createIngress } from "../ingress/handler.mjs";
import { createIngressServer } from "../ingress/server.mjs";
import { recordedProvider } from "../scout/provider-recorded.mjs";
import { liveProvider } from "../scout/provider-live.mjs";
import { createEgress } from "../gates/egress.mjs";
import { briefFromKernel } from "../kernel/brief.mjs";
import { processReport, processUnattended } from "../gates/pipeline.mjs";
import { RESEARCH_CONFIG_ID } from "../gates/evals.mjs";
import { drainAll } from "../worker/drain.mjs";
import { slug } from "./commands.mjs";
import { UsageError } from "./args.mjs";

/**
 * Assemble the serve topology without starting it.
 *
 * @param {object} opts a parsed `serve` options object
 * @param {object} deps { env, stdout, stderr, now? }
 * @returns {{server: import('node:http').Server, ingress: object, tick: () => Promise<Array>}}
 * @throws {UsageError} when the webhook secret is not in the environment
 */
export function createScoutServer(opts, deps) {
  const { env, stdout, now = () => new Date().toISOString() } = deps;

  const secret = env[opts.secretEnv];
  if (!secret || secret.trim() === "")
    throw new UsageError(
      `serve needs the webhook secret in env.${opts.secretEnv} — an ingress with no secret ` +
        `cannot verify a signature, and a receiver that accepts unsigned traffic is exactly ` +
        `what this refuses. Set ${opts.secretEnv} and start again.`,
    );

  const ingress = createIngress({ secret, jobsDir: opts.jobs });
  const server = createIngressServer(ingress);

  // Live mode builds ONE provider and reuses it (a shared session). Recorded
  // mode replays the one bundled store for every job — the demo/self-test path.
  const providerFor =
    opts.mode === "live"
      ? (() => {
          const provider = liveProvider(env);
          return async () => provider;
        })()
      : async () => recordedProvider(opts.fixtures);

  // The kernel is spawned at most once and its brief is cached: the strategy
  // frame is stable for the life of the process, and spawning gtm-mcp per job
  // would be pure waste. A kernel refusal caches as "unaimed", surfaced once.
  let briefPromise;
  const briefFor = opts.project
    ? async () => {
        briefPromise ??= briefFromKernel({ projectDir: opts.project }).then((b) => {
          if (b.ok) return b.brief;
          deps.stderr?.write(`kernel brief unavailable, running unaimed: ${b.refusal}\n`);
          return undefined;
        });
        return briefPromise;
      }
    : undefined;

  const egressFor = (request) =>
    createEgress({ allowDomains: request.domain ? [request.domain] : [], out: stdout });

  const process = opts.unattended ? processUnattended : processReport;

  const tick = () =>
    drainAll({
      queue: ingress.queue,
      providerFor,
      egressFor,
      briefFor,
      reportPathFor: (r) => join(opts.reports, `${slug(r.accountName)}-${slug(r.requestId)}.md`),
      telemetryPath: opts.telemetry,
      configId: RESEARCH_CONFIG_ID,
      process,
      gateN: opts.gateN,
      now,
    });

  return { server, ingress, tick };
}

/** How often the worker sweeps the queue when serving, in ms. */
export const DEFAULT_TICK_MS = 1000;

/**
 * `scout serve` — listen for signed deliveries and drain the queue on a cadence.
 * Long-running: the returned promise resolves only when the server closes.
 *
 * @param {object} opts a parsed `serve` options object
 * @param {object} deps { env, stdout, stderr, now?, tickMs? }
 * @returns {Promise<void>}
 */
export function serveCommand(opts, deps) {
  const { stdout, stderr, tickMs = DEFAULT_TICK_MS } = deps;

  let scout;
  try {
    scout = createScoutServer(opts, deps);
  } catch (err) {
    if (err instanceof UsageError) {
      stderr.write(err.message + "\n");
      return Promise.resolve(2);
    }
    throw err;
  }

  return new Promise((resolve) => {
    const timer = setInterval(() => {
      // A tick failure must never take the listener down — log and keep serving.
      scout.tick().catch((err) => stderr.write(`worker tick failed: ${err?.message ?? err}\n`));
    }, tickMs);
    timer.unref?.();

    scout.server.on("close", () => {
      clearInterval(timer);
      resolve(0);
    });

    scout.server.listen(opts.port, () => {
      stdout.write(
        `account-scout serving on :${opts.port} (${opts.mode}${opts.unattended ? ", unattended" : ""}) — ` +
          `POST signed deliveries, reports land in ${opts.reports}\n`,
      );
    });
  });
}
