// An MCP client for gtm-architect's `gtm-mcp` server, hand-rolled the way the
// server was.
//
// MCP over stdio is JSON-RPC 2.0, one message per line. That is the whole
// transport, so this file speaks it directly and adds no dependency to do it —
// the server across the pipe made the same choice, and a reader can see every
// byte that crosses the boundary from either side.
//
// The child is started with an ARGUMENT VECTOR, never a shell string, so there
// is no injection surface even though a project directory reaches it. Every
// failure mode is loud: a server that dies before replying, a line that is not
// JSON, and a JSON-RPC error are three different refusals, and none of them is
// allowed to look like an empty answer.

import { spawn as nodeSpawn } from "node:child_process";
import { createRequire } from "node:module";

/** A kernel read that could not be completed. Distinct from a kernel REFUSAL,
 *  which is a successful read whose envelope says no — see readEnvelope. */
export class KernelRefusal extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "KernelRefusal";
  }
}

/** Per-call ceiling. The server shells out to the real CLI, which sets its own
 *  30s cap, so this is the client refusing to wait forever on a server that
 *  stopped answering rather than a guess at how slow the kernel is. */
export const DEFAULT_TIMEOUT_MS = 10_000;

export const PROTOCOL_VERSION = "2024-11-05";
export const CLIENT_NAME = "account-scout-kernel";

/** Where the installed server lives. Resolved through Node's own resolver so a
 *  hoisted or deduped node_modules layout cannot leave a hardcoded path stale. */
export function defaultServerPath() {
  try {
    return createRequire(import.meta.url).resolve("gtm-architect/bin/gtm-mcp.mjs");
  } catch (err) {
    throw new KernelRefusal(
      "the gtm-architect MCP server could not be resolved — the package is a dependency of this " +
        "repo, so this usually means `npm install` has not run",
      { cause: err },
    );
  }
}

/**
 * Start a session against one project directory and complete the MCP handshake.
 * Resolves to a session; throws KernelRefusal if the handshake does not land.
 */
export async function openKernel({
  projectDir,
  serverPath,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  spawnImpl = nodeSpawn,
} = {}) {
  if (typeof projectDir !== "string" || projectDir.trim() === "")
    throw new KernelRefusal(
      "openKernel needs a projectDir — the server reads the project chosen by the caller, and a " +
        "client that omitted it would silently read whatever directory this process happens to be in",
    );

  const bin = serverPath ?? defaultServerPath();

  let child;
  try {
    // Argument vector, never a shell string. `projectDir` crosses this boundary
    // and there is no shell on the other side of it to interpret anything.
    child = spawnImpl(process.execPath, [bin, "--project", projectDir], {
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    throw new KernelRefusal(`the kernel server could not be started (${bin})`, { cause: err });
  }

  const pending = new Map();
  let nextId = 1;
  let dead = null; // the refusal every later call gets once the child is gone
  let stderr = "";

  const failAll = (refusal) => {
    dead ??= refusal;
    for (const [, waiter] of pending) waiter.reject(refusal);
    pending.clear();
  };

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    // Bounded: a chatty or hostile server must not grow this without limit.
    stderr = (stderr + chunk).slice(-4096);
  });

  child.on("error", (err) =>
    failAll(new KernelRefusal(`the kernel server failed to run (${bin})`, { cause: err })),
  );

  child.on("exit", (code, signal) =>
    failAll(
      new KernelRefusal(
        `the kernel server exited before it answered (code ${code}, signal ${signal ?? "none"})` +
          (stderr.trim() ? `. it said: ${stderr.trim()}` : ". it said nothing on stderr"),
      ),
    ),
  );

  // Newline-delimited JSON. A line that is not JSON is a refusal, not a skip:
  // silently dropping it would leave the caller waiting on an id that is never
  // coming back, which is indistinguishable from a hung server.
  let buf = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch (err) {
        failAll(
          new KernelRefusal(
            `the kernel server sent a line that is not JSON, so the transport cannot be trusted ` +
              `for anything that follows. the line was: ${truncate(line)}`,
            { cause: err },
          ),
        );
        try {
          child.kill();
        } catch {}
        return;
      }
      const waiter = msg && pending.get(msg.id);
      if (!waiter) continue; // a reply to nothing we asked; not ours to act on
      pending.delete(msg.id);
      waiter.resolve(msg);
    }
  });

  const request = (method, params) =>
    new Promise((resolve, reject) => {
      if (dead) return reject(dead);
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        try {
          child.kill();
        } catch {}
        reject(
          new KernelRefusal(
            `the kernel server did not answer "${method}" within ${timeoutMs}ms and was killed`,
          ),
        );
      }, timeoutMs);
      timer.unref?.();

      pending.set(id, {
        resolve: (msg) => {
          clearTimeout(timer);
          // A JSON-RPC error is the server's own words. It is surfaced, never
          // swallowed and never flattened into an empty result.
          if (msg.error)
            return reject(
              new KernelRefusal(
                `the kernel refused "${method}" (JSON-RPC ${msg.error.code}): ${msg.error.message}`,
              ),
            );
          resolve(msg.result);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      try {
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      } catch (err) {
        clearTimeout(timer);
        pending.delete(id);
        reject(new KernelRefusal(`the kernel server's input stream is closed`, { cause: err }));
      }
    });

  const notify = (method, params) => {
    // No id, so the protocol forbids a reply and there is nothing to await.
    try {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    } catch {
      /* a dead stdin surfaces on the next request, which does report it */
    }
  };

  const close = async () => {
    dead ??= new KernelRefusal("this kernel session is closed");
    try {
      child.stdin.end();
    } catch {}
    try {
      child.kill();
    } catch {}
  };

  let serverInfo;
  try {
    const result = await request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: CLIENT_NAME, version: "0.1.0" },
    });
    serverInfo = result?.serverInfo;
    notify("notifications/initialized", {});
  } catch (err) {
    await close();
    throw err;
  }

  return {
    serverInfo,
    projectDir,
    async listTools() {
      const result = await request("tools/list", {});
      return result?.tools ?? [];
    },
    close,
  };
}

const truncate = (s, n = 200) => (s.length > n ? `${s.slice(0, n)}…` : s);
