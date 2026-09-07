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
