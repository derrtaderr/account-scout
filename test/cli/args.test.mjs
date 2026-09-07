// Lane E — CLI argument parsing, pure and total. Every refusal names what is
// missing and how to fix it, and a mode is never guessed: a run that would
// reach the live Claude API must SAY --live, so a stranger's first invocation
// cannot silently spend a key it never meant to use.

import test from "node:test";
import assert from "node:assert/strict";

import { parseArgs, UsageError } from "../../src/cli/args.mjs";

test("no command is a usage error naming the three commands", () => {
  assert.throws(() => parseArgs([]), (err) => {
    assert.ok(err instanceof UsageError);
    assert.match(err.message, /run|serve|report/);
    return true;
  });
});

test("an unknown command is refused, not guessed", () => {
  assert.throws(() => parseArgs(["frobnicate"]), (err) => {
    assert.ok(err instanceof UsageError);
    assert.match(err.message, /frobnicate/);
    return true;
  });
});

test("run needs an account, and says so", () => {
  assert.throws(() => parseArgs(["run"]), (err) => {
    assert.ok(err instanceof UsageError);
    assert.match(err.message, /--account/);
    return true;
  });
});

test("run defaults to recorded mode — live is never the default", () => {
  const parsed = parseArgs(["run", "--account", "Northwind Robotics", "--fixtures", "fixtures/northwind-robotics"]);
  assert.equal(parsed.command, "run");
  assert.equal(parsed.account, "Northwind Robotics");
  assert.equal(parsed.mode, "recorded");
  assert.equal(parsed.fixtures, "fixtures/northwind-robotics");
  assert.deepEqual(parsed.questions, []);
});

test("recorded run requires a fixture store — it replays a specific one", () => {
  assert.throws(() => parseArgs(["run", "--account", "X"]), (err) => {
    assert.ok(err instanceof UsageError);
    assert.match(err.message, /--fixtures/);
    return true;
  });
});

test("--live selects live mode and needs no fixtures", () => {
  const parsed = parseArgs(["run", "--account", "Acme", "--live"]);
  assert.equal(parsed.mode, "live");
  assert.equal(parsed.fixtures, undefined);
});

test("--recorded and --live together is a contradiction, refused", () => {
  assert.throws(
    () => parseArgs(["run", "--account", "X", "--recorded", "--fixtures", "f", "--live"]),
    (err) => {
      assert.ok(err instanceof UsageError);
      assert.match(err.message, /--recorded.*--live|--live.*--recorded/);
      return true;
    },
  );
});

test("--question is repeatable", () => {
  const parsed = parseArgs([
    "run", "--account", "X", "--live",
    "--question", "who are their buyers?",
    "--question", "what do they sell?",
  ]);
  assert.deepEqual(parsed.questions, ["who are their buyers?", "what do they sell?"]);
});

test("run carries domain, project, out and request-id when given", () => {
  const parsed = parseArgs([
    "run", "--account", "X", "--live",
    "--domain", "x.example", "--project", "fixtures/gtm-project",
    "--out", "reports/x.md", "--request-id", "req-cli-1",
  ]);
  assert.equal(parsed.domain, "x.example");
  assert.equal(parsed.project, "fixtures/gtm-project");
  assert.equal(parsed.out, "reports/x.md");
  assert.equal(parsed.requestId, "req-cli-1");
});

test("a flag that needs a value and has none is refused", () => {
  assert.throws(() => parseArgs(["run", "--account"]), (err) => {
    assert.ok(err instanceof UsageError);
    assert.match(err.message, /--account/);
    return true;
  });
});

test("serve defaults are sane and overridable", () => {
  const dflt = parseArgs(["serve", "--fixtures", "fixtures/northwind-robotics"]);
  assert.equal(dflt.command, "serve");
  assert.equal(dflt.mode, "recorded");
  assert.equal(dflt.port, 8787);
  assert.equal(dflt.secretEnv, "WEBHOOK_SECRET");
  assert.equal(dflt.unattended, false);

  const custom = parseArgs([
    "serve", "--live", "--port", "9000",
    "--secret-env", "HMAC_KEY", "--jobs", "/tmp/jobs",
    "--reports", "/tmp/reports", "--unattended", "--gate-n", "3",
  ]);
  assert.equal(custom.port, 9000);
  assert.equal(custom.secretEnv, "HMAC_KEY");
  assert.equal(custom.jobs, "/tmp/jobs");
  assert.equal(custom.reports, "/tmp/reports");
  assert.equal(custom.unattended, true);
  assert.equal(custom.gateN, 3);
});

test("a non-numeric --port is refused, not coerced to NaN", () => {
  assert.throws(
    () => parseArgs(["serve", "--live", "--port", "eighty"]),
    (err) => {
      assert.ok(err instanceof UsageError);
      assert.match(err.message, /--port/);
      return true;
    },
  );
});

test("report defaults to the dashboard action with a default output path", () => {
  const parsed = parseArgs(["report"]);
  assert.equal(parsed.command, "report");
  assert.equal(parsed.dashboard, true);
  assert.ok(parsed.out, "a default output path is chosen");
});

test("report takes an explicit telemetry and out path", () => {
  const parsed = parseArgs(["report", "--telemetry", "t/e.jsonl", "--out", "dash.html"]);
  assert.equal(parsed.telemetry, "t/e.jsonl");
  assert.equal(parsed.out, "dash.html");
});
