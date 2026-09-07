---
name: Gates wiring
read_by: Lane E before writing the CLI (scout run|serve|report), the e2e, or the dashboard step; the orchestrator at merge
---

# Lane D wiring — the gates

Every exit guarded, every run scored, autonomy earned. Three modules plus a
composition, all exercised by `test/gates/`. The real libraries do the work:
redaction-gate redacts, scans, and refuses; gtm-agent-evals judges, records,
and counts the streak. This lane maps shapes and wires paths, nothing more.

## Modules and signatures

No barrel module, same as the scout: import the exact path.

### `src/gates/egress.mjs`

```js
scoutRedactionConfig({ roster?, allowDomains?, allow? }) => redaction-gate config
serializeReport(report) => string          // markdown + fenced JSON, ONE document
createEgress({ roster?, allowDomains?, allow?, out? }) => {
  gate,                                    // the bound redaction-gate (createGate)
  writeReport(report, path) => Promise<{path}>,
  emitSummary(report) => Promise<string>,  // one guarded stdout line; returns it as written
  makeReplyWriter(send) => guardedSend,    // send({ body, ...rest }) — body redacted or refused
}
```

- **The roster is the operator's sensitive vocabulary** (client names, people),
  supplied by config. It is NOT the research subject — the account under
  research belongs in its own report; the operator's other clients do not.
  Built-in detectors (secret/email/domain/phone/ipv4/residue/honorific) stay
  on: no `patterns` block is ever passed, so nothing is switched off.
- **`allowDomains` should carry the account's own domain** — a report about
  northwind.example must be allowed to cite northwind.example.
- **One file, one string, one guarded write.** `writeReport` serializes the
  whole report (claims, refusals, hop content, meta) into a single markdown
  document with a fenced ```json block, so there is no second surface a leak
  could ride out on and no partial-write state where one file landed and its
  sibling refused.
- **Redact vs refuse, the library's asymmetry, kept.** A precise-matchable
  identifier (a rostered name on word boundaries, a well-formed key) is
  REDACTED and the write proceeds as a working document carrying typed
  placeholders. A survivor the redactor could not match (a flattened
  `meridian_dynamics`, a whitespace-wrapped key) REFUSES the write: the inner
  writer never runs, nothing lands, and the `RedactionRefusal` carries
  classes and positions, never values. Do not "fix" a refusal by loosening
  the gate; extend the roster or fix the source.
- `out` is injectable (`{ write }`) so tests never print. Lane E: the CLI's
  summary goes through `emitSummary`, not through its own `console.log` of
  report fields — a second unguarded exit is exactly the hole the tool-table
  section of redaction-gate's README warns about. Same for the webhook reply:
  wrap the sender with `makeReplyWriter`, then call only the wrapped one.

### `src/gates/evals.mjs`

```js
RESEARCH_CONFIG_ID   // "account-scout-research" — the streak is counted under this id
TELEMETRY_PATH       // "telemetry/events.jsonl" — the repo convention (gitignored)
reportToAgentRun(report) => AgentRun
evaluateReport(report) => Promise<Verdict>          // rules-only, keyless
recordVerdict({ verdict, runId?, configId?, telemetryPath?, now? }) => Promise<TelemetryEvent>
```

**The AgentRun mapping** (a ResearchReport judged by the research archetype):

| AgentRun field | From the report |
|---|---|
| `archetype` | `"research"` |
| `input` | `Account research: <account>` |
| `steps` | one `{ kind: "tool_result", name: "fetch_page", content: hop.content }` per hop — what `source-step-present` counts and `no-uncited-assertion` grounds against |
| `output` | the serialized claims summary: every claim (`[kind/tier] text (cites: urls)`) AND every refusal — a refusal is first-class output, the judge sees it too |
| `metadata` | account, mode, model (live only), generatedAt, claim/refusal/hop counts |

**Rules-only, exactly the library's own `--rules-only` shape:** config =
research archetype config with `rubric: undefined`, registry =
`{ ...buildRuleRegistry({}), ...allArchetypeRules }`, provider =
`makeFakeProvider({})` as a tripwire — with the rubric stripped, `scoreRun`
never consults it; if a regression reintroduces the rubric it throws and the
gate fails closed to BLOCK. No key is read, ever.

**Telemetry path convention:** one append-only JSONL file at
`telemetry/events.jsonl` (repo-root relative, already gitignored), written
only through the library's `makeJsonlSink`, read only through its
`readEvents`. **Timestamps must carry an explicit timezone** — the default
clock is `new Date().toISOString()` (trailing `Z`). The library's reader
refuses tz-less timestamps rather than interpreting them as machine-local;
that refusal is load-bearing for the streak and there is a test that
exercises it. Do not hand-append lines to this file.

### `src/gates/autonomy.mjs`

```js
DEFAULT_GATE_N   // 3
allowUnattended(configId, { telemetryPath?, gateN? })
  => { allowed: true,  streak, gateN }
   | { allowed: false, streak, gateN, reason }   // "streak N of M — unattended mode refused for ..."
```

The autonomy contract: `readEvents` + `autonomyStreak` (the library's) count
consecutive PASSes back from the most recent run for this `configId`; any
BLOCK resets the count; `streak >= gateN` allows. A refusal NAMES the streak
and the gate in its first clause — `streak 1 of 3 — unattended mode refused` —
then whose streak it is and what repairs it. Empty telemetry refuses at
streak 0 (autonomy is never the default), and another config's streak earns
this config nothing. **Throws** (does not refuse) when the telemetry itself
cannot be read — corrupt line, tz-less timestamp — because a gate must never
decide over evidence it cannot parse.

### `src/gates/pipeline.mjs`

```js
processReport(report, deps) => Promise<ProcessResult>
processUnattended(report, deps) => Promise<ProcessResult & { autonomy }>
// deps: { egress, reportPath, telemetryPath?, configId?, runId?, now?, gateN? }
// ProcessResult: { status: "delivered"|"quarantined"|"refused",
//                  verdict?, event?, reportPath?, refusedBy?, reason? }
```

The composed check, in binding order: **evaluate → telemetry → egress-guarded
write.** The verdict is on the record before any write is attempted, so the
streak sees every run including ones whose reports never landed.

| Outcome | status | refusedBy | On disk | In telemetry |
|---|---|---|---|---|
| PASS, clean | `delivered` | — | `<reportPath>` | PASS event |
| BLOCK verdict | `quarantined` | `evals` | `<reportPath minus .md>.blocked.md` | BLOCK event |
| egress survivor | `refused` | `egress` | nothing | the verdict, already recorded |
| autonomy unearned (unattended only) | `refused` | `autonomy` | nothing | nothing — the run never happened |

Nothing is decided silently: every refusal path returns a structured result
naming what refused and why, in that gate's own words. A BLOCK quarantines
rather than drops — the evidence survives for the human, it just never wears
a delivered report's name. Any error that is not a `RedactionRefusal`
propagates: it is a defect, not a refusal, per the boundary in
`src/scout/errors.mjs`. Lane E's unattended job loop (`scout serve` draining
`jobs/`) calls `processUnattended`; the attended CLI path calls
`processReport`. `runId` should be the job's `requestId` so telemetry joins
back to the queue trail.

## Errors out of this lane

Two refusal types cross this package's boundary, both safe to print:

- `RedactionRefusal` (redaction-gate's) — classes, lines, columns, lengths;
  values withheld by the error type itself, and `test/gates` holds
  `util.inspect(err, { depth: 10 })` to zero occurrences of a caught key.
- `ScoutRefusal` — reported, never swallowed, exactly as `src/scout/errors.mjs`
  instructs. This lane attaches no causes; if you extend it and do, scrub
  them (`scrubError`) first.

## Upstream fix needed in gtm-agent-evals (needs Jason's push-yes)

The git install of `gtm-agent-evals` ships **no `dist/`** (TypeScript source
only, no `prepare` script) and **no `main`/`exports`** in its package.json,
so a root import (`from "gtm-agent-evals"`) fails even after building. This
lane's workaround, acceptable for the lane and recorded here as debt:

1. `dist/` was built in place: `cd node_modules/gtm-agent-evals && npx -y -p typescript@5.6 tsc`
   (a fresh `npm install` erases it; rerun the build).
2. Imports use the deep path `gtm-agent-evals/dist/index.js`.

The real fix is one commit upstream: add `"prepare": "tsc"` (builds on git
install) and `"main": "dist/index.js"` (or an `exports` map) to
gtm-agent-evals' package.json. It is a public repo change, so it ships only
on Jason's explicit push-yes; when it lands, the deep imports here can move
to the package root in one find-and-replace.
