# account-scout — SPEC

A GTM account-research agent whose claims must survive. Give it an account, it
researches the open web in multiple hops and returns a report where **every claim
is bound to a citation that was actually fetched in that run**, and a claim that
cannot carry its evidence is refused, listed, and never silently dropped.

It is also the system above the primitives. Five public boundary repos run inside
it, each doing its real job, which is the point: the dependency list is the
architecture.

```
signed webhook ──▶ webhook-engine ──▶ the scout ──▶ redaction-gate ──▶ report
                    (ingress)      │  (research +     (egress)
                                   │   citation gate)
                    gtm-architect ◀┤ reads via MCP (strategy frame, read-only)
                    gtm-agent-evals┴ scores every run; the streak decides autonomy
                    ship-check governs how this repo itself gets built
```

- **Language:** plain Node.js ESM (.mjs). **Tests:** node:test. **License:** MIT.
- **Dependencies:** exactly four, all first-party, installed from GitHub:
  `redaction-gate`, `webhook-engine`, `gtm-agent-evals`, `gtm-architect`.
  No third-party runtime dependency. The Anthropic API is called with plain
  `fetch`, key from env, never printed, and every provider failure fails closed.
- **Two modes, one contract** (the strategy-benchmark pattern): `--live` does real
  web research through the Claude API's server-side web-search tool; `--recorded`
  replays committed fixtures keylessly, so CI and a stranger's first run need no
  key and reproduce exactly.
- **Magnetiz stays out.** Synthetic accounts only (Northwind Robotics, Acme
  Freight, Lumen Freight). The bundled gtm-architect project fixture is a
  synthetic company. Nothing here touches production Magnetiz systems until the
  artifact is proven and Jason separately decides to deploy it.

## The contract: `src/types.mjs`

Committed with this spec and FROZEN for the lanes. JSDoc-typed factories and
validators rather than TypeScript, per house style. A lane must not change it;
a needed change is a cross-lane event that comes back to the orchestrator.

Core shapes (see the file for the full definitions):

- `ResearchRequest` — accountName, optional domain, optional questions[], requestId.
- `Citation` — url, title, fetchedAt, quote. **The quote must appear verbatim in
  content fetched during this run**, which is what makes a citation checkable
  rather than decorative.
- `Claim` — id, text, kind (numeric | causal | factual), citations[] (≥1), tier
  (primary = the company's own property; secondary = third-party coverage).
- `Refusal` — text, reason. A would-be claim that failed the citation gate. The
  report carries refusals as first-class output.
- `ResearchReport` — account, generatedAt, claims[], refusals[], hops[] (the
  fetched-URL trail), meta (mode, model when live).

## The deterministic citation gate (inside the scout, not bolted on)

The rule learned on strategy-benchmark, applied from day one: **a deterministic
check only blocks on violations it can decide.** Decidable, therefore refused
deterministically: a claim with zero citations; a citation whose quote does not
appear in the fetched content; a citation whose URL was never fetched this run.
Judgment (is the source credible, does the evidence really support the claim) is
scored by the gtm-agent-evals research rubric, not by a regex wearing a robe.

## Lane decomposition — two waves of two, inside cap 2

Cap is 2 and stays 2 (the 9/06 four-at-once was ratified as a one-off, flagged
this time by running waves). Trees are disjoint within each wave.

**Wave 1**
- **Lane A — ingress** (`src/ingress/**`): an intake built ON webhook-engine.
  Raw-byte HMAC verification, replay window, atomic idempotency, DLQ, exactly as
  the library provides them. A verified event becomes a `ResearchRequest` in a
  file-backed job queue (`jobs/` JSONL); a malformed or unverified delivery never
  does. Also a direct CLI enqueue path for local use. Synthetic secrets in tests.
- **Lane B — the scout core** (`src/scout/**`, `src/report/**`): hop planning,
  fetching (live = plain fetch + the Claude web-search tool; recorded = a
  committed fixture store of pages and transcripts), claim extraction, the
  deterministic citation gate above, and the report builder. Fail closed on
  provider errors; a run that fetched nothing refuses rather than reporting an
  empty all-clear.

**Wave 2** (after wave 1 merges)
- **Lane C — the kernel context** (`src/kernel/**`): an MCP client that spawns
  gtm-architect's `gtm-mcp` binary against the bundled SYNTHETIC project fixture
  and reads the strategy frame (status, methods, positioning) into the research
  brief, so hops are aimed by declared strategy rather than vibes. Read-only by
  construction, which the server already enforces.
- **Lane D — the gates** (`src/gates/**`): redaction-gate's `guard()` wrapped
  around every writer that leaves the process (report file, stdout summary,
  webhook reply); gtm-agent-evals' research archetype scoring every run into
  JSONL telemetry; `autonomyStreak` deciding whether unattended mode is allowed,
  refused with the streak named when it is not.

**Wave 3 / session 2**
- **Lane E — CLI, end-to-end, README**: `scout run|serve|report`, exit codes as
  contract, the e2e that pushes one signed webhook through every boundary to a
  redacted evaluated report, README written from live outputs only, and the
  gtm-agent-evals dashboard generated over the scout's own telemetry as a bundled
  artifact.

Known wiring note for Lane D, flagged early: `gtm-agent-evals` has no `prepare`
script, so a git install ships no `dist/`. The fix is one line in that repo
(`"prepare": "tsc"`), is generally correct, and needs Jason's push-yes at ship
time like any public change.

## Discipline (binding, the full house contract)

TDD watch-the-red, commit per cycle. Adversarial senior review per lane, fix
waves, ship-check's gate at merge. Fail closed everywhere; refusals name what is
missing and how to repair it. Synthetic fixtures only. README examples pasted
from real output, never written from memory. The repo is PRIVATE until Jason's
standalone publish-yes.

## Iteration log

- 2026-09-07 — spec locked. Shape, name, and depth confirmed by Jason ("do
  real"). Candidate 45's first instance; queue row 36.
