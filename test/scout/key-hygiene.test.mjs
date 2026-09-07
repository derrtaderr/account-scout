// Every ScoutRefusal MESSAGE was scrubbed, but `{ cause: err }` attached the
// original error object. util.inspect and console.error print the whole cause
// chain — and errors.mjs tells Lanes D and E to report these errors. So the key
// walked straight out through the cause.
//
// These tests assert on util.inspect at depth 10, which is what an operator
// actually sees, rather than on err.message alone.
delete process.env.ANTHROPIC_API_KEY;

import test from "node:test";
import assert from "node:assert/strict";
import util from "node:util";

import { liveProvider } from "../../src/scout/provider-live.mjs";
import { scrubError, ScoutRefusal } from "../../src/scout/errors.mjs";

const KEY = "sk-ant-planted-key-do-not-leak-123456789";
const env = () => ({ ANTHROPIC_API_KEY: KEY });

const countKey = (value) => util.inspect(value, { depth: 10 }).split(KEY).length - 1;

const fakeFetch = (handler) => {
  const impl = async (url, init) => handler(String(url), init);
  return impl;
};

test("path 1: a key planted in a thrown error's message never reaches the inspected refusal", async () => {
  const provider = liveProvider(env(), {
    fetchImpl: fakeFetch(() => {
      throw new Error(`connect ECONNREFUSED using ${KEY}`);
    }),
  });
  const err = await provider.search("q").then(
    () => null,
    (e) => e,
  );
  assert.ok(err instanceof ScoutRefusal);
  assert.equal(countKey(err), 0, "the key must appear zero times in the full inspected chain");
});

test("path 2: a key planted in a NESTED cause never reaches the inspected refusal", async () => {
  const provider = liveProvider(env(), {
    fetchImpl: fakeFetch(() => {
      const root = new Error(`socket closed while authenticating with ${KEY}`);
      const middle = new Error("tls handshake failed", { cause: root });
      throw new Error("request failed", { cause: middle });
    }),
  });
  const err = await provider.search("q").then(
    () => null,
    (e) => e,
  );
  assert.equal(countKey(err), 0);
});

test("path 3a: a JSON SyntaxError quoting a key-bearing snippet does not leak it", async () => {
  const provider = liveProvider(env(), {
    fetchImpl: fakeFetch(() => ({
      ok: true,
      status: 200,
      async json() {
        // What response.json() really throws when the body is not JSON: a
        // SyntaxError whose message quotes the offending source text.
        JSON.parse(`{"authorization": ${KEY}}`);
      },
      async text() {
        return "";
      },
    })),
  });
  const err = await provider.search("q").then(
    () => null,
    (e) => e,
  );
  assert.equal(countKey(err), 0);
});

test("path 3b: the extractor's own JSON.parse failure does not leak a key in the snippet", async () => {
  const provider = liveProvider(env(), {
    fetchImpl: fakeFetch(() => ({
      ok: true,
      status: 200,
      async json() {
        return { content: [{ type: "text", text: `[{"quote": ${KEY}}]` }] };
      },
      async text() {
        return "";
      },
    })),
  });
  const err = await provider
    .proposeClaims({
      account: "Northwind Robotics",
      hops: [{ url: "https://a.example/", title: "A", fetchedAt: "2026-09-07T00:00:00.000Z", content: "some fetched page text" }],
    })
    .then(
      () => null,
      (e) => e,
    );
  assert.ok(err instanceof ScoutRefusal);
  assert.equal(countKey(err), 0);
});

test("an HTTP error body echoing the key back does not leak it", async () => {
  const provider = liveProvider(env(), {
    fetchImpl: fakeFetch(() => ({
      ok: false,
      status: 401,
      async text() {
        return `{"error":{"message":"invalid x-api-key: ${KEY}"}}`;
      },
      async json() {
        return {};
      },
    })),
  });
  const err = await provider.search("q").then(
    () => null,
    (e) => e,
  );
  assert.equal(countKey(err), 0);
});

// ---- the helper itself ----

test("scrubError keeps the chain useful — diagnosis survives, the secret does not", () => {
  const root = new Error(`root cause with ${KEY}`);
  const wrapped = new Error(`outer failure with ${KEY}`, { cause: root });
  const clean = scrubError(wrapped, [KEY]);

  assert.equal(countKey(clean), 0);
  assert.match(clean.message, /outer failure with \[redacted\]/, "the message stays readable");
  assert.match(clean.cause.message, /root cause with \[redacted\]/, "the nested cause is preserved, scrubbed");
});

test("scrubError preserves the original error's name", () => {
  const clean = scrubError(new TypeError("bad type"), [KEY]);
  assert.equal(clean.name, "TypeError");
});

test("scrubError survives a cyclic cause chain instead of hanging", () => {
  const a = new Error("a");
  const b = new Error("b", { cause: a });
  a.cause = b;
  const clean = scrubError(a, [KEY]);
  assert.ok(clean instanceof Error, "a cycle must terminate, not recurse forever");
});

test("scrubError handles a non-Error cause", () => {
  const clean = scrubError(new Error("outer", { cause: `a bare string holding ${KEY}` }), [KEY]);
  assert.equal(countKey(clean), 0);
});

test("scrubError drops the original stack, which can itself carry a key", () => {
  const err = new Error("boom");
  err.stack = `Error: boom\n    at fetch (https://api.example/?key=${KEY}:1:1)`;
  assert.equal(countKey(scrubError(err, [KEY])), 0);
});

// ---- defence in depth: the runner wraps errors from providers it did not write ----

test("a third-party provider's raw secret-bearing error cannot leak through runScout", async () => {
  const { runScout } = await import("../../src/scout/run.mjs");
  const { makeResearchRequest } = await import("../../src/types.mjs");

  process.env.ANTHROPIC_API_KEY = KEY;
  try {
    const rogue = {
      mode: "recorded",
      model: undefined,
      async search() {
        throw new Error(`upstream auth failed with ${KEY}`);
      },
      async fetchPage() {},
      async proposeClaims() {
        return [];
      },
    };
    const err = await runScout({
      request: makeResearchRequest({ accountName: "Stub Co", requestId: "req-rogue" }),
      provider: rogue,
    }).then(
      () => null,
      (e) => e,
    );
    assert.ok(err instanceof ScoutRefusal);
    assert.equal(countKey(err), 0, "runScout must scrub what a provider it did not write hands it");
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});
