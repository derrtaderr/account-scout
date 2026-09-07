// The MCP client, exercised against the REAL gtm-mcp server.
//
// The whole point of this lane is the real primitive doing its real job, so the
// happy path spawns the actual server binary against the bundled Lumen Freight
// fixture. Nothing about the kernel is mocked here. A fake transport appears
// only where the real server cannot be made to misbehave on demand — a reply
// line that is not JSON, and a server that dies before answering.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { openKernel } from "../../src/kernel/client.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, "..", "..");
export const PROJECT_DIR = join(REPO, "fixtures", "gtm-project");

test("the client lists the read surfaces the real server actually exposes", async () => {
  const kernel = await openKernel({ projectDir: PROJECT_DIR });
  try {
    const tools = await kernel.listTools();
    const names = tools.map((t) => t.name);

    // Not a hardcoded roster. The server derives its catalog from the kernel's
    // own JSON_SURFACES, so this asserts the shape of what came back and the
    // presence of the three the brief consumes — a seventeenth surface added
    // upstream must not fail this lane.
    assert.ok(names.length >= 3, `expected a catalog, got ${names.length} tools`);
    for (const wanted of ["gtm_status", "gtm_positioning", "gtm_canvas"])
      assert.ok(names.includes(wanted), `the catalog is missing ${wanted}: ${names.join(", ")}`);

    for (const t of tools) {
      assert.equal(typeof t.name, "string");
      assert.equal(typeof t.description, "string");
      assert.ok(t.inputSchema, `${t.name} came back with no inputSchema`);
    }
  } finally {
    await kernel.close();
  }
});

test("a read surface comes back as the kernel's own gtm-json/1 envelope", async () => {
  const kernel = await openKernel({ projectDir: PROJECT_DIR });
  try {
    const envelope = await kernel.callTool("gtm_status");

    assert.equal(envelope.schema, "gtm-json/1");
    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, "status");
    // Content from the fixture's own recorded state, not from this client.
    assert.equal(envelope.data.productState, "mvp");
    assert.equal(envelope.data.evidence.total, 5);
    assert.equal(envelope.data.ecp.segment, "regional LTL carriers");
  } finally {
    await kernel.close();
  }
});

test("a refusing surface is a RESULT the caller can read, never a thrown error", async () => {
  const kernel = await openKernel({ projectDir: PROJECT_DIR });
  try {
    // gtm_canvas refuses on this fixture: the worksheet is scaffolded and empty.
    // The kernel exits non-zero saying so, and that refusal is the answer — a
    // client that turned it into an exception would destroy the very words the
    // brief has to carry.
    const envelope = await kernel.callTool("gtm_canvas");

    assert.equal(envelope.ok, false);
    assert.ok(envelope.problems.length > 0, "a refusal must name what is missing");
    assert.match(envelope.problems[0].message, /value-prop\.md/);
  } finally {
    await kernel.close();
  }
});
