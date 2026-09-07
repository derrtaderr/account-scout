// The HTTP listener. Thin on purpose: its only real job is to hand the RAW BYTES
// to the handler unmodified, because that is what the signature covers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { signHeader } from "webhook-engine";

import { createIngress } from "../../src/ingress/handler.mjs";
import { createIngressServer } from "../../src/ingress/server.mjs";

/** Synthetic, invented here, never a real key. */
const SECRET = "whsec_synthetic_lane_a_do_not_use";

function freshDir() {
  return mkdtempSync(join(tmpdir(), "account-scout-server-"));
}

function readJobs(dir) {
  const path = join(dir, "pending.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

/** Boot the listener on an ephemeral port and hand back its address. */
async function listening(dir) {
  const ingress = createIngress({ secret: SECRET, jobsDir: dir });
  const server = createIngressServer(ingress);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return { ingress, server, url: `http://127.0.0.1:${port}/webhooks/research` };
}

async function post(url, rawBody, headers) {
  const response = await fetch(url, { method: "POST", body: rawBody, headers });
  return { status: response.status, body: await response.json() };
}

test("a signed delivery over HTTP becomes one job", async (t) => {
  const dir = freshDir();
  const { server, url } = await listening(dir);
  t.after(() => server.close());

  const rawBody = JSON.stringify({ id: "evt_http_001", accountName: "Northwind Robotics" });
  const timestamp = Math.floor(Date.now() / 1000);

  const response = await post(url, rawBody, {
    "content-type": "application/json",
    "webhook-signature": signHeader({ rawBody, secret: SECRET, timestamp }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.outcome, "processed");
  assert.equal(readJobs(dir).length, 1);
  assert.equal(readJobs(dir)[0].request.requestId, "evt_http_001");
});

test("a forged delivery over HTTP is refused with 401 and enqueues nothing", async (t) => {
  const dir = freshDir();
  const { server, url } = await listening(dir);
  t.after(() => server.close());

  const rawBody = JSON.stringify({ id: "evt_http_forged", accountName: "Acme Freight" });
  const timestamp = Math.floor(Date.now() / 1000);

  const response = await post(url, rawBody, {
    "content-type": "application/json",
    "webhook-signature": signHeader({ rawBody, secret: "whsec_synthetic_wrong_key", timestamp }),
  });

  assert.equal(response.status, 401);
  assert.equal(response.body.outcome, "rejected");
  assert.equal(readJobs(dir).length, 0);
});

test("the listener preserves the exact bytes the signature covers", async (t) => {
  const dir = freshDir();
  const { server, url } = await listening(dir);
  t.after(() => server.close());

  // Whitespace, a float that JSON.stringify would renormalise, and a non-ASCII
  // character. A listener that reparsed and reserialised this body would change the
  // digest and refuse a genuine delivery.
  const rawBody = '{  "id": "evt_bytes_001",\n  "accountName": "Lumen Fräight",\n  "score": 1.0 }';
  const timestamp = Math.floor(Date.now() / 1000);

  const response = await post(url, rawBody, {
    "content-type": "application/json",
    "webhook-signature": signHeader({ rawBody, secret: SECRET, timestamp }),
  });

  assert.equal(response.status, 200, "the raw bytes reached the verifier unmodified");
  assert.equal(readJobs(dir)[0].request.accountName, "Lumen Fräight");
});

test("a method other than POST is refused without touching the queue", async (t) => {
  const dir = freshDir();
  const { server, url } = await listening(dir);
  t.after(() => server.close());

  const response = await fetch(url, { method: "GET" });

  assert.equal(response.status, 405);
  assert.equal(readJobs(dir).length, 0);
});
