// Lane E — the end-to-end proof, and the reason this repo exists as one system
// rather than five libraries in a trench coat. ONE signed webhook is POSTed over
// a real socket, and it travels every boundary:
//
//   webhook-engine   verifies the HMAC over the raw bytes and enqueues a job
//   the scout        researches in hops and binds each surviving claim to a
//                    citation fetched THIS run (the deterministic citation gate)
//   gtm-architect    is spawned over MCP against the synthetic project and aims
//                    the run (the kernel brief; a refusal would degrade, not fail)
//   gtm-agent-evals  scores the run into telemetry — the streak the autonomy
//                    gate reads
//   redaction-gate   guards the write: a synthetic secret planted in the fetched
//                    content is stripped before the report ever lands on disk
//
// Keyless throughout: recorded provider, synthetic project, synthetic secret.
// If this passes, the dependency list really is the architecture.

delete process.env.ANTHROPIC_API_KEY;

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { signHeader } from "webhook-engine";
import { readEvents } from "gtm-agent-evals/dist/index.js";

import { parseArgs } from "../../src/cli/args.mjs";
import { createScoutServer } from "../../src/cli/serve.mjs";

const E2E_FIXTURE = fileURLToPath(new URL("../../fixtures/e2e-secret/", import.meta.url));
const SYNTH_PROJECT = fileURLToPath(new URL("../../fixtures/gtm-project/", import.meta.url));
const SECRET = "whsec_synthetic_e2e_do_not_use";
// The synthetic secret planted in the fixture's page content. It is NOT a real
// key; it exists only so egress has something it must strip.
const PLANTED_SECRET = "sk-ant-e2eSYNTHETICtoken00000";

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

test("one signed webhook travels every boundary to a redacted, evaluated report", async () => {
  const dir = mkdtempSync(join(tmpdir(), "as-e2e-"));
  const telemetry = join(dir, "telemetry", "events.jsonl");

  const opts = parseArgs([
    "serve",
    "--fixtures", E2E_FIXTURE,
    "--project", SYNTH_PROJECT,
    "--jobs", join(dir, "jobs"),
    "--reports", join(dir, "reports"),
    "--telemetry", telemetry,
  ]);

  const errs = [];
  const scout = createScoutServer(opts, {
    env: { WEBHOOK_SECRET: SECRET },
    stdout: { write: () => {} },
    stderr: { write: (s) => errs.push(s) },
    now: () => "2026-09-07T12:00:09.000Z",
  });

  const port = await listen(scout.server);

  // --- BOUNDARY 1: webhook-engine. Sign the RAW bytes and POST them. ---
  const payload = JSON.stringify({
    requestId: "evt-e2e-001",
    accountName: "Acme Freight",
    domain: "acmefreight.example",
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const res = await fetch(`http://127.0.0.1:${port}/`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-signature": signHeader({ rawBody: payload, secret: SECRET, timestamp }),
    },
    body: payload,
  });
  assert.equal(res.status, 200, "a validly signed delivery is verified and accepted");

  // --- The worker drains the verified job through the rest of the boundaries. ---
  const worked = await scout.tick();
  assert.equal(worked.length, 1, "the verified webhook produced exactly one job");
  const result = worked[0].result;
  assert.equal(result.status, "delivered", "the run cleared evals and egress and delivered");

  // --- BOUNDARY 2: the scout + citation gate. A cited claim, over a real hop. ---
  const reportText = readFileSync(result.reportPath, "utf8");
  assert.match(reportText, /## Claims \(1\)/, "one claim survived the citation gate");
  assert.match(reportText, /less-than-truckload network across the American Midwest/);
  assert.match(reportText, /## Hops \(1\)/, "the claim is backed by a hop actually fetched this run");

  // --- BOUNDARY 5: redaction-gate. The planted secret never reaches disk. ---
  assert.doesNotMatch(reportText, new RegExp(PLANTED_SECRET), "the synthetic secret must not survive egress");
  assert.match(reportText, /\[secret\]/, "the secret was replaced by its redaction placeholder");

  // --- BOUNDARY 4: gtm-agent-evals. The run was scored into the telemetry. ---
  const events = readEvents(telemetry);
  assert.equal(events.length, 1, "exactly one evaluated run recorded");
  assert.ok(["PASS", "BLOCK"].includes(events[0].verdict.status), "the run carries a real verdict");
  assert.equal(events[0].configId, "account-scout-research");

  // --- BOUNDARY 3: gtm-architect. The kernel was consulted, not skipped. A
  // refusal would have degraded to unaimed and logged; delivery with no kernel
  // complaint on stderr is the proof it answered. ---
  assert.equal(
    errs.some((e) => /kernel brief unavailable/.test(e)),
    false,
    "the gtm-architect kernel answered — the run was aimed, not silently unaimed",
  );

  scout.server.close();
});
