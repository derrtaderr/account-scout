// Lane E — `scout serve`, the assembled system. The builder wires the HMAC
// ingress, the file-backed queue, and the worker into one thing: a signed
// webhook becomes a verified job, and a tick drains that job through the scout
// and the gates to a guarded report. The secret is required — an ingress with
// no secret cannot verify anything, and a receiver that "works" without one is
// the failure webhook-engine exists to prevent.
//
// The full over-the-wire signed-delivery-through-a-port path is the e2e test;
// here the ingress is exercised directly, which is enough to prove the wiring.

delete process.env.ANTHROPIC_API_KEY;

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { signHeader } from "webhook-engine";

import { parseArgs } from "../../src/cli/args.mjs";
import { createScoutServer } from "../../src/cli/serve.mjs";
import { UsageError } from "../../src/cli/args.mjs";

const NORTHWIND_FIXTURE = fileURLToPath(new URL("../../fixtures/northwind-robotics/", import.meta.url));
const SECRET = "whsec_synthetic_serve_test_do_not_use";
const FROZEN_NOW = () => "2026-09-07T12:00:09.000Z";

function signed(body, secret = SECRET) {
  const rawBody = JSON.stringify(body);
  return {
    rawBody,
    headers: {
      "content-type": "application/json",
      "webhook-signature": signHeader({ rawBody, secret, timestamp: Math.floor(Date.now() / 1000) }),
    },
  };
}

function harness(argv, { env = { WEBHOOK_SECRET: SECRET }, ...over } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "as-serve-"));
  const opts = parseArgs([
    ...argv,
    "--jobs", join(dir, "jobs"),
    "--reports", join(dir, "reports"),
    "--telemetry", join(dir, "telemetry", "events.jsonl"),
  ]);
  const deps = { env, stdout: { write: () => {} }, stderr: { write: () => {} }, now: FROZEN_NOW, ...over };
  return { dir, opts, deps };
}

test("serve refuses to start without the webhook secret", () => {
  const { opts, deps } = harness(["serve", "--fixtures", NORTHWIND_FIXTURE], { env: {} });
  assert.throws(() => createScoutServer(opts, deps), (err) => {
    assert.ok(err instanceof UsageError);
    assert.match(err.message, /WEBHOOK_SECRET|secret/);
    return true;
  });
});

test("a signed webhook becomes a job that a tick drains to a guarded report", async () => {
  const { dir, opts, deps } = harness(["serve", "--fixtures", NORTHWIND_FIXTURE]);
  const scout = createScoutServer(opts, deps);

  const { rawBody, headers } = signed({
    requestId: "evt-serve-1",
    accountName: "Northwind Robotics",
    domain: "northwindrobotics.com",
  });
  const result = await scout.ingress.handleDelivery(rawBody, headers);
  assert.equal(result.status, 200, "a verified delivery is accepted");

  const worked = await scout.tick();

  assert.equal(worked.length, 1);
  assert.equal(worked[0].result.status, "delivered");
  assert.ok(existsSync(worked[0].result.reportPath));
  assert.match(readFileSync(worked[0].result.reportPath, "utf8"), /Northwind Robotics/);

  scout.server.close();
});

test("the report about an account keeps that account's own domain — per-job egress", async () => {
  const { opts, deps } = harness(["serve", "--fixtures", NORTHWIND_FIXTURE]);
  const scout = createScoutServer(opts, deps);

  const { rawBody, headers } = signed({
    requestId: "evt-serve-2",
    accountName: "Northwind Robotics",
    domain: "northwindrobotics.com",
  });
  await scout.ingress.handleDelivery(rawBody, headers);
  const [worked] = await scout.tick();

  // The account's own domain must survive into its own report, not be redacted
  // as if it were some other client's — that is what per-job egress buys.
  const text = readFileSync(worked.result.reportPath, "utf8");
  assert.match(text, /northwindrobotics\.com/);

  scout.server.close();
});
