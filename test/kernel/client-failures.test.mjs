// How the client fails.
//
// Every one of these is a case where returning something empty would be worse
// than refusing, because an empty brief and a broken kernel read identically to
// whatever comes next. The first test uses the REAL server, which can be made to
// produce a genuine JSON-RPC error on demand. The rest use a fake transport,
// because a correct server cannot be asked to die mid-handshake or to emit a
// line that is not JSON, and faking the SERVER would defeat this lane's point
// while faking the PIPE does not.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { openKernel, KernelRefusal } from "../../src/kernel/client.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = join(HERE, "..", "..", "fixtures", "gtm-project");

/** A stand-in for one spawned server. `onLine` decides what it does with each
 *  JSON-RPC line the client writes, which is the only lever these tests need. */
function fakeSpawn(onLine) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => {
      child.killed = true;
      return true;
    };
    child.stdin.on("data", (chunk) => {
      for (const line of String(chunk).split("\n").filter((l) => l.trim()))
        onLine({ child, message: JSON.parse(line) });
    });
    return child;
  };
}

test("a write verb is refused in the real server's own words, never swallowed", async () => {
  const kernel = await openKernel({ projectDir: PROJECT_DIR });
  try {
    await assert.rejects(
      () => kernel.callTool("gtm_init"),
      (err) => {
        assert.equal(err.name, "KernelRefusal");
        // The server's own sentence reaches the caller intact.
        assert.match(err.message, /read only/);
        assert.match(err.message, /"init" is a write verb/);
        assert.match(err.message, /nothing was done/);
        return true;
      },
    );
  } finally {
    await kernel.close();
  }
});

test("a server that exits before replying refuses loudly", async () => {
  await assert.rejects(
    () =>
      openKernel({
        projectDir: PROJECT_DIR,
        serverPath: "/nonexistent/never-runs.mjs",
        spawnImpl: fakeSpawn(({ child }) => {
          // Dies on the handshake, answering nothing.
          child.stderr.write("gtm-mcp: could not read the project\n");
          setImmediate(() => child.emit("exit", 1, null));
        }),
      }),
    (err) => {
      assert.ok(err instanceof KernelRefusal);
      assert.match(err.message, /exited before it answered/);
      assert.match(err.message, /code 1/);
      // Whatever the server managed to say is carried, not discarded.
      assert.match(err.message, /could not read the project/);
      return true;
    },
  );
});

test("a reply line that is not JSON refuses loudly and quotes the line", async () => {
  await assert.rejects(
    () =>
      openKernel({
        projectDir: PROJECT_DIR,
        serverPath: "/nonexistent/never-runs.mjs",
        spawnImpl: fakeSpawn(({ child }) => {
          child.stdout.write("this is not JSON at all\n");
        }),
      }),
    (err) => {
      assert.ok(err instanceof KernelRefusal);
      assert.match(err.message, /not JSON/);
      assert.match(err.message, /this is not JSON at all/);
      return true;
    },
  );
});

test("a server that never answers is killed at the timeout, not waited on forever", async () => {
  let spawned;
  await assert.rejects(
    () =>
      openKernel({
        projectDir: PROJECT_DIR,
        serverPath: "/nonexistent/never-runs.mjs",
        timeoutMs: 40,
        spawnImpl: fakeSpawn(({ child }) => {
          spawned = child; // reads the line and answers nothing, ever
        }),
      }),
    (err) => {
      assert.ok(err instanceof KernelRefusal);
      assert.match(err.message, /did not answer "initialize" within 40ms/);
      assert.match(err.message, /killed/);
      return true;
    },
  );
  assert.equal(spawned.killed, true, "the child must not be left running");
});

test("closing a session kills the child", async () => {
  let spawned;
  const kernel = await openKernel({
    projectDir: PROJECT_DIR,
    serverPath: "/nonexistent/never-runs.mjs",
    spawnImpl: fakeSpawn(({ child, message }) => {
      spawned = child;
      if (message.method === "initialize")
        child.stdout.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: { serverInfo: { name: "fake", version: "0" } },
          })}\n`,
        );
    }),
  });
  await kernel.close();
  assert.equal(spawned.killed, true, "close() must not leak the process");
});

test("a projectDir the caller never chose is refused rather than defaulted", async () => {
  await assert.rejects(
    () => openKernel({}),
    (err) => {
      assert.ok(err instanceof KernelRefusal);
      assert.match(err.message, /needs a projectDir/);
      return true;
    },
  );
});
