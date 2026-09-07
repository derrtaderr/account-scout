# account-scout

A GTM account-research agent whose claims must survive. Give it an account, it
researches the open web in multiple hops and returns a report where **every claim
is bound to a citation that was actually fetched in that run**. A claim that
cannot carry its evidence is not quietly dropped — it is refused, listed, and
kept in the report as a first-class result.

It is also **the system above the primitives**. Five public boundary repos run
inside it, each doing its real job. The dependency list is the architecture:

```
signed webhook ──▶ webhook-engine ──▶ the scout ──▶ redaction-gate ──▶ report
                    (ingress)      │  (research +     (egress)
                                   │   citation gate)
                    gtm-architect ◀┤ read via MCP (strategy frame, read-only)
                    gtm-agent-evals┴ scores every run; the streak decides autonomy
```

- `webhook-engine` verifies the HMAC over the raw request bytes and enqueues a job.
- The scout researches in hops and binds each surviving claim to a citation
  **fetched this run** (the deterministic citation gate).
- `gtm-architect` is spawned over MCP against a project's strategy frame and aims
  the run, read-only.
- `gtm-agent-evals` scores every run into JSONL telemetry; a streak of clean runs
  is what earns unattended operation.
- `redaction-gate` guards every write; a secret or a rostered client name is
  stripped before anything lands.

## The load-bearing idea

A `Citation` is **checkable**. Its quote must appear verbatim in content fetched
during the same run, so "cited" is a property the code can decide, not a
formatting convention. Everything the deterministic gate refuses is decidable
from the shapes in `src/types.mjs` alone; judgment — is the source credible, does
the evidence really support the claim — is scored by the evals rubric, never by a
regex wearing a robe.

## Install

```
npm install                # first-party GitHub deps, no third-party runtime dep
npm test                   # 222 tests, node:test, keyless
```

Node 20+ (developed on 25). No API key is needed for the recorded path or the
tests — that is the whole point of the two-mode contract below.

## Two modes, one contract

The same `runScout` function drives both, so a run cannot behave differently in
CI than it does against the real web.

- `--recorded --fixtures DIR` replays a committed fixture store keylessly and
  deterministically. This is what CI and a stranger's first run use.
- `--live` does real web research through the Claude API's server-side web-search
  tool. Reaching the live API is **never the default** — you have to say `--live`,
  so a first command cannot silently spend a key.

## The CLI

Three commands. Exit code is a contract everywhere: `0` delivered, `1` a defect,
`2` a usage error, `3` the system **refused or blocked** (a decision the gate is
supposed to be able to make, not a crash).

### `scout run` — research one account to a guarded report

```
$ account-scout run --account "Northwind Robotics" --domain northwindrobotics.com \
    --fixtures fixtures/northwind-robotics --out report.md
account-scout: Northwind Robotics — 3 claim(s), 4 refusal(s), 3 hop(s) [recorded]
```

The report carries claims, refusals, and the hop trail. Real output — note how a
thin account produces a thin honest report, and how the three refusal *kinds*
each name exactly why the evidence did not hold:

```markdown
## Claims (1)

- [factual/primary] Acme Freight moves palletised freight between regional depots in the American Midwest.
  - https://acmefreight.example/ — "moves palletised freight between regional depots in the American Midwest"

## Refusals (3)

- Acme Freight employs roughly 120 people. — quote does not appear in the fetched content of https://[domain]/acme-freight — quote was: "Employees: approximately 120"
- Acme Freight raised a $12 million Series A in 2025. — citation url was never fetched this run: https://[domain]/acme-freight-series-a — quote was: "Acme Freight raised $12 million"
- Acme Freight prices per pallet-mile. — claim carries no citation — an uncited claim is a refusal, not a claim
```

(The `[domain]` you see is `redaction-gate` at work: an off-account domain in the
report was stripped on the way out.)

### `scout serve` — a signed-webhook endpoint that drains to reports

```
$ WEBHOOK_SECRET=whsec_… account-scout serve --live --project ./my-gtm-project \
    --port 8787 --reports ./reports
account-scout serving on :8787 (live) — POST signed deliveries, reports land in ./reports
```

A validly signed delivery is verified, enqueued, and worked by the same pipeline
`run` uses. The secret is required — an ingress with no secret verifies nothing.
`--unattended` opts into autonomy-gated operation, which only proceeds once the
evals streak has been earned by clean attended runs first.

### `scout report` — the evals dashboard over the scout's own telemetry

```
$ account-scout report --telemetry telemetry/events.jsonl --out dashboard/index.html
dashboard written to dashboard/index.html
```

A self-contained static HTML dashboard, built by `gtm-agent-evals` over the
exact events the autonomy gate reads, with the gate line drawn at the scout's own
N. A missing telemetry file renders an honest empty dashboard, never a crash.

## See it run end to end

```
npm run demo
```

Runs three synthetic accounts through the real bin and builds the dashboard under
`demo/` — `demo/reports/*.md` and `demo/dashboard/index.html`. Every file there is
a real run, never written from memory.

The end-to-end test proves the whole path in one shot: `test/e2e/full-path.test.mjs`
POSTs **one signed webhook over a real socket** and asserts it travels every
boundary — verified by `webhook-engine`, researched and citation-gated by the
scout, aimed by `gtm-architect` over MCP, scored by `gtm-agent-evals` into
telemetry, and stripped of a synthetic planted secret by `redaction-gate` — before
a redacted, evaluated report lands on disk. Keyless throughout.

## Fail closed, everywhere

- A run that fetched nothing **refuses** rather than reporting an empty all-clear.
- Any provider error (search, fetch, extraction) aborts the run closed rather than
  degrading into a partial report indistinguishable from a thorough one.
- A verified job is a peek, not a pop — a worker that dies mid-research has not
  consumed a request no redelivery is coming for.
- Telemetry is a byte exit like any other and is written **post-redaction**.
- Refusals name what is missing and how to repair it.

## Synthetic only

Every account here is invented — Northwind Robotics, Acme Freight, Lumen Freight.
The bundled `gtm-architect` project fixture is a synthetic company. Nothing in
this repo touches a production system, and no fixture carries a real key, secret,
or client name.

MIT.
