---
name: Scout core wiring
read_by: Lane C before writing src/kernel/** (the strategy brief), Lane D before wrapping src/gates/** around a report, Lane E before writing the CLI or recording a new fixture
---

# Lane B wiring — the scout core

What Lane B exports, what shape a fixture store has, what a provider must
implement, and where the strategy brief plugs in. Written for the lanes that
come after this one, so none of them has to read the implementation to use it.

Everything here is exercised by tests in `test/scout/` and `test/report/`.

## Modules and signatures

There is deliberately no barrel/index module. Import the exact path — it keeps
the surface honest and makes a stale import fail loudly.

### `src/scout/run.mjs`

```js
runScout({ request, provider, maxHops?, brief?, now? }) => Promise<ResearchReport>
BARREN_HOPS_BEFORE_STOP  // 2
```

The whole motion: plan hops, search, fetch, extract candidates, gate every one,
build the report. Provider-agnostic — recorded and live run the identical code
path, which is what stops CI from proving something the live run does not do.

- `request` — a `ResearchRequest` from `src/types.mjs`.
- `provider` — `recordedProvider(...)` or `liveProvider(...)`, see below.
- `maxHops` — defaults to `DEFAULT_MAX_HOPS` (4).
- `brief` — the optional strategy brief. **This is Lane C's plug.** See below.
- `now` — injectable clock, `() => ISO string`. Tests freeze it; production omits it.

**Throws `ScoutRefusal`** on any provider failure and when the run fetched zero
hops. It never returns a partial report — a partial report is indistinguishable
from a thorough one that found less.

### `src/scout/errors.mjs`

```js
class ScoutRefusal extends Error   // .name === "ScoutRefusal"
```

The refusal/defect boundary. `ScoutRefusal` is the design working; any other
error escaping this package is a bug. **Lane E**: map `ScoutRefusal` to a
distinct non-zero exit code, not to the crash code. **Lane D**: report it,
never swallow it.

### `src/scout/planner.mjs`

```js
planHops({ request, brief?, maxHops? }) => Array<{query, purpose}>
DEFAULT_MAX_HOPS  // 4
```

Deterministic: the same request plans the same queries every time, which is what
lets a fixture store key on the query string. Purposes, in priority order:
`overview`, `primary` (only when a domain is known), `strategy-brief`,
`question` (one per request question), `news`. The brief outranks generic
questions on purpose, so a scarce plan stays aimed by declared strategy.

### `src/scout/gate.mjs`

```js
gateCandidates({ candidates, hops, domain, runAt }) => { claims, refusals }
citationTier(url, domain) => "primary" | "secondary"
```

The deterministic citation gate. See the section below.

### `src/report/build.mjs`

```js
buildResearchReport({ request, hops, claims, refusals, meta, generatedAt? }) => ResearchReport
```

Wraps the frozen `makeResearchReport` and adds the one judgment the contract
cannot express: **zero hops refuses**. `meta.mode` must be honest; `meta.model`
is required in live mode and absent in recorded mode.

### `src/scout/provider-recorded.mjs`

```js
recordedProvider(fixtureDir) => Provider   // mode "recorded", model undefined
```

Keyless and deterministic. Throws `ScoutRefusal` at construction if the store is
missing or malformed.

### `src/scout/provider-live.mjs`

```js
liveProvider(env?, { fetchImpl? }?) => Provider   // mode "live", model set
DEFAULT_MODEL             // "claude-opus-5"
DEFAULT_WEB_SEARCH_TOOL   // "web_search_20250305"
```

`env` defaults to `process.env`; `fetchImpl` defaults to `globalThis.fetch` and
exists so tests inject a fake — **no test in this lane makes a network call.**

Environment:

| Variable | Required | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | — refuses at construction, naming the variable |
| `ANTHROPIC_MODEL` | no | `claude-opus-5` |
| `ANTHROPIC_WEB_SEARCH_TOOL` | no | `web_search_20250305` |

> **Flagged for the orchestrator, not decided here.** `web_search_20250305` is
> the basic web-search variant; `web_search_20260209` (dynamic filtering) is the
> current one for Opus-5-class models. The lane dispatch named `20250305`, so
> that is the pinned default, and the env var switches it with no code change.

## The provider interface

Both providers implement exactly this. A third one (a cache, a different search
backend) only has to satisfy it.

```js
{
  mode: "live" | "recorded",     // lands in report.meta.mode, honestly
  model: string | undefined,     // REQUIRED in live mode, undefined in recorded
  account?: { accountName, domain, questions },  // recorded only, convenience

  // Discovery. Returns [] for an honest miss — never invents a result.
  // Two consecutive empty/duplicate-only searches stop the run.
  search(query, { purpose }) => Promise<Array<{url, title}>>

  // Must return a makeHop(). Refuses rather than returning an empty hop,
  // because a hop with no content lets a citation bind against emptiness.
  fetchPage(url) => Promise<Hop>

  // Candidates BEFORE the gate. Must NOT self-filter — see below.
  proposeClaims({ account, domain, questions, hops, brief })
    => Promise<Array<{text, kind, citations: [{url, quote}]}>>
}
```

**A provider must never filter its own bad candidates.** The fixtures carry
claims that must not survive, and `proposeClaims` hands them through untouched.
If a provider quietly dropped them, the gate could rot without one test going
red. Judging is the gate's job and only the gate's.

## The strategy brief — Lane C's plug

`brief` is an **opaque string**, accepted end to end today and used in two
places:

1. `planHops` lifts its first six terms into a `strategy-brief` hop, ranked
   above generic questions.
2. `runScout` passes it verbatim to `provider.proposeClaims({ brief })`, where
   the live provider puts it in the extraction prompt.

Lane C fills it from gtm-architect's strategy frame. **No shape is required and
none should be invented here** — this lane only needs it to be a string it can
aim with. If Lane C wants structure, that is a types change and therefore an
orchestrator conversation, not a lane decision.

## The deterministic citation gate

Three violations are **decidable**, so three violations refuse:

| Violation | Refusal reason |
|---|---|
| zero citations | `claim carries no citation — an uncited claim is a refusal, not a claim` |
| quote absent from fetched content | `quote does not appear in the fetched content of <url> — quote was: "..."` |
| URL never fetched this run | `citation url was never fetched this run: <url> — quote was: "..."` |

Plus two shape refusals: an unrecognized `kind`, and a citation malformed enough
that the contract will not construct it.

Everything else — is this source credible, does this evidence really support
this claim — is **judgment**, and belongs to the gtm-agent-evals research rubric
(Lane D), not here. A deterministic check only blocks on what it can decide.

Two rules worth knowing before you build on it:

- **One bad citation refuses the whole claim.** A claim carrying a citation that
  does not check out has had its evidence hallucinated or tampered with; keeping
  it alive on its surviving citation would launder the bad half behind the good.
- **Nothing is ever dropped.** `claims.length + refusals.length === candidates.length`,
  always. A refusal is output, not an error path.

**Tiering.** `primary` = the account's own domain or a subdomain of it (`www.`
ignored); `secondary` = everything else, including every case that cannot be
decided (no domain known, unparseable URL). Unknown never flatters the source. A
claim resting on *any* first-party citation is tiered `primary`.

## Fixture store format — for Lane E's recorder

Three files per account, in one directory:

```
fixtures/<slug>/
  account.json      { accountName, domain?, questions?, note? }
  pages.json        [ { url, title, fetchedAt, content } ]
  transcript.json   { recordedWith?, searches: [...], candidates: [...] }
```

`transcript.json`:

```json
{
  "recordedWith": { "mode": "live", "model": "claude-opus-5" },
  "searches": [
    { "query": "<the planner's EXACT query string>",
      "results": [ { "url": "...", "title": "..." } ] }
  ],
  "candidates": [
    { "text": "...", "kind": "numeric|causal|factual",
      "citations": [ { "url": "...", "quote": "..." } ] }
  ]
}
```

Recorder rules, each one load-bearing:

1. **`searches[].query` must be the planner's exact string.** Replay matches
   exactly; an unmatched query returns `[]`, which reads as an honest miss and
   feeds the early stop. Generate them with `planHops` rather than by hand.
2. **`pages[].content` is the text the quotes are checked against**, so record
   the same stripped text the live provider produced — not raw HTML. A quote
   that was verbatim in the live run must stay verbatim in the fixture, or the
   recording is already doctored.
3. **`candidates` are recorded BEFORE the gate, unjudged.** Record what the
   model proposed, including anything wrong. A fixture whose candidates all pass
   cannot catch a broken gate.
4. **Every fixture is synthetic.** Invented companies, invented people,
   `.example` hosts for third parties. This repo goes public.
5. Keys named in `_why` are ignored by the loader and are there to say why a bad
   candidate is in the store on purpose.

Two stores ship today, and they are the two shapes worth testing:

| Fixture | Shape | Hops | Claims | Refusals |
|---|---|---|---|---|
| `northwind-robotics` | rich — all three kinds, both tiers, three planted failures | 4 | 4 | 3 |
| `acme-freight` | sparse — two thin pages, two searches that found nothing | 2 | 1 | 3 |

## Live mode: why search does not supply the content

The server-side web-search tool returns page bodies as `encrypted_content`,
opaque to this process. A citation bound against something we cannot read is not
checkable, which would hollow out the gate entirely.

So **search is discovery only**, and `fetchPage` then retrieves each page with
plain `fetch`. Every quote is checked against bytes this process actually holds,
which is what makes a live citation exactly as checkable as a recorded one.

Consequences to know:

- The Anthropic key goes to `api.anthropic.com` and nowhere else. Third-party
  page fetches carry no Anthropic headers, and there is a test for that.
- Every error this provider raises is scrubbed of the key first, because
  upstream error bodies have been known to echo credentials back.
- Server-tool failures arrive as **HTTP 200** with an error *object* where a
  success carries an *array*. The code branches on that before indexing; anyone
  extending it must keep doing so.
- **Known tradeoff, flagged not decided:** one unreachable page currently fails
  the whole run closed, per the lane dispatch's fail-closed instruction. In live
  use a single dead link will therefore kill a run. If the orchestrator wants
  dead links tolerated instead — collected and surfaced while the run continues —
  that is a deliberate loosening and needs a decision, plus somewhere in the
  frozen report shape to put them.
