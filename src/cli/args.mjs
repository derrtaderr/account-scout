// Lane E — the CLI's argument parser. Pure and total: it returns a validated,
// frozen options object or throws a UsageError that names what is wrong and how
// to fix it. It touches no disk, no env, and no network, so the whole surface
// is decidable in a test.
//
// One rule shapes everything: a mode is never guessed. `run` and `serve` default
// to RECORDED, and reaching the live Claude API requires the caller to write
// --live. A stranger's first command therefore cannot silently spend a key it
// never meant to use — the failure that makes "just try it" expensive.

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
    this.usage = true;
  }
}

const COMMANDS = Object.freeze(["run", "serve", "report"]);

/** Pull a `--flag VALUE` pair out of argv (mutating), refusing a missing value. */
function takeValue(argv, flag) {
  const idx = argv.indexOf(flag);
  if (idx === -1) return undefined;
  const v = argv[idx + 1];
  if (v === undefined || v.startsWith("--"))
    throw new UsageError(`${flag} needs a value`);
  argv.splice(idx, 2);
  return v;
}

/** Remove a boolean `--flag` (mutating), reporting whether it was present. */
function takeBool(argv, flag) {
  const idx = argv.indexOf(flag);
  if (idx === -1) return false;
  argv.splice(idx, 1);
  return true;
}

/** Collect every occurrence of a repeatable `--flag VALUE` (mutating). */
function takeAll(argv, flag) {
  const values = [];
  for (;;) {
    const v = takeValue(argv, flag);
    if (v === undefined) break;
    values.push(v);
  }
  return values;
}

function takeInt(argv, flag) {
  const raw = takeValue(argv, flag);
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw))
    throw new UsageError(`${flag} needs a whole number, got "${raw}"`);
  return Number(raw);
}

/** Exactly-one-of the two mode flags; recorded is the default. */
function resolveMode(argv) {
  const recorded = takeBool(argv, "--recorded");
  const live = takeBool(argv, "--live");
  if (recorded && live)
    throw new UsageError("--recorded and --live are mutually exclusive — pick one");
  return live ? "live" : "recorded";
}

export function parseArgs(rawArgv) {
  const argv = [...rawArgv];
  const command = argv.shift();

  if (!command)
    throw new UsageError(`no command — expected one of: ${COMMANDS.join(", ")}`);
  if (!COMMANDS.includes(command))
    throw new UsageError(
      `unknown command "${command}" — expected one of: ${COMMANDS.join(", ")}`,
    );

  if (command === "run") return parseRun(argv);
  if (command === "serve") return parseServe(argv);
  return parseReport(argv);
}

function parseRun(argv) {
  const mode = resolveMode(argv);
  const account = takeValue(argv, "--account");
  const domain = takeValue(argv, "--domain");
  const questions = takeAll(argv, "--question");
  const fixtures = takeValue(argv, "--fixtures");
  const project = takeValue(argv, "--project");
  const out = takeValue(argv, "--out");
  const requestId = takeValue(argv, "--request-id");

  if (!account)
    throw new UsageError("run needs --account NAME — the account to research");
  if (mode === "recorded" && !fixtures)
    throw new UsageError(
      "recorded run needs --fixtures DIR — it replays a specific fixture store " +
        "(account.json, pages.json, transcript.json). Use --live for real web research.",
    );

  return Object.freeze({
    command: "run",
    mode,
    account,
    domain,
    questions: Object.freeze(questions),
    fixtures,
    project,
    out,
    requestId,
  });
}

function parseServe(argv) {
  const mode = resolveMode(argv);
  const fixtures = takeValue(argv, "--fixtures");
  const project = takeValue(argv, "--project");
  const port = takeInt(argv, "--port") ?? 8787;
  const secretEnv = takeValue(argv, "--secret-env") ?? "WEBHOOK_SECRET";
  const jobs = takeValue(argv, "--jobs") ?? "jobs";
  const reports = takeValue(argv, "--reports") ?? "reports";
  const telemetry = takeValue(argv, "--telemetry");
  const unattended = takeBool(argv, "--unattended");
  const gateN = takeInt(argv, "--gate-n");

  if (mode === "recorded" && !fixtures)
    throw new UsageError(
      "recorded serve needs --fixtures DIR — the store every queued job replays. Use --live for real web research.",
    );

  return Object.freeze({
    command: "serve",
    mode,
    fixtures,
    project,
    port,
    secretEnv,
    jobs,
    reports,
    telemetry,
    unattended,
    gateN,
  });
}

function parseReport(argv) {
  // Only the dashboard action exists today; the flag is accepted for symmetry
  // and to leave room, but the default IS the dashboard so `report` alone works.
  takeBool(argv, "--dashboard");
  const telemetry = takeValue(argv, "--telemetry");
  const out = takeValue(argv, "--out") ?? "dashboard/index.html";

  return Object.freeze({
    command: "report",
    dashboard: true,
    telemetry,
    out,
  });
}
