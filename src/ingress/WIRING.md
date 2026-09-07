---
name: Lane A ingress wiring
read_by: Lane B (the scout core) before consuming the job queue; Lane E before writing `scout serve`; the orchestrator at merge
---

# Ingress — wiring

The intake built on `webhook-engine`. A delivery that cannot prove itself never
becomes a job, and every refusal names what was wrong.

```
raw bytes + headers
  → webhook-engine verify (HMAC over RAW bytes, replay window)   fail → 401, nothing stored
  → parse                                                        fail → DLQ, reason recorded
  → atomic idempotency reserve on requestId                      dup  → 200 duplicate, handler never runs
  → makeResearchRequest                                          fail → DLQ, reason recorded
  → one appended JSONL line in jobs/pending.jsonl
```

## Exports

### `src/ingress/handler.mjs`

```js
createIngress({ secret, jobsDir = "jobs", queue, ...engineOptions })
  → { handleDelivery, enqueueLocal, engine, queue, store, dlq }
```

`secret` is a string or an array of strings (a rotation). Any remaining option is
passed through to `createEngine`, so `retry`, `toleranceSeconds`, `store` and `dlq`
are all injectable; `parse` and `eventId` have lane defaults (below) and are
overridable. `handler` is not overridable — it is this lane.

```js
handleDelivery(rawBody, headers, deps) → Promise<result>
```

Standalone and pure in the sense that matters: no socket, no server, no ambient
state — everything it touches arrives in `deps` (`{ engine, queue }`). The bound
`ingress.handleDelivery(rawBody, headers)` is the same function with `deps` closed
over. `rawBody` is a string or Buffer of the **exact received bytes**; passing a
reparsed body breaks the signature.

The result is webhook-engine's response object: `{ status, outcome, ... }`.

| status | outcome | meaning |
|---|---|---|
| 200 | `processed` | one job enqueued |
| 200 | `duplicate` | already handled; the handler never ran again |
| 200 | `dead_lettered` | verified but unusable; record in the DLQ, no job |
| 401 | `rejected` | signature or replay window; `reason` says which |
| 409 | `in_flight` | the same requestId is mid-flight |
| 500 | `dead_letter_failed` | the DLQ refused the record, so please redeliver |

```js
enqueueLocal(request) → Promise<job>
```

The CLI path. No socket and no signature — there is no remote sender to
authenticate — but `makeResearchRequest` and the idempotency reservation both still
apply. A refusal **throws** here rather than dead lettering, because the caller is a
person at a terminal who can read the message and fix the input. Idempotent on
`requestId`: a rerun returns the original job rather than enqueuing a second.

### `src/ingress/server.mjs`

```js
createIngressServer(ingress) → node:http Server
```

`node:http`, no framework. Caller owns `.listen()`. POST only (else 405), body read
bounded at 1 MB (else 413). It collects the body as a **Buffer** and hands it over
untouched — the one thing this file can get wrong. Handler exceptions answer a bare
`{ outcome: "ingress_error" }` 500; the detail goes to the operator via
`process.emitWarning`, never to the sender, because an error raised over
attacker-controlled bytes can carry fragments of them and the signature header is
in scope.

### `src/ingress/queue.mjs`

```js
createJobQueue({ dir, now })
  → { append, nextJob, completeJob, pendingPath, completedPath, dir }
```

## The job queue contract (Lane B reads this)

Two append-only JSONL files in `jobs/` (created if missing; gitignored).

`jobs/pending.jsonl` — one job per line:

```json
{"requestId":"evt_northwind_001","enqueuedAt":"2026-09-07T18:22:31.004Z","request":{"accountName":"Northwind Robotics","domain":"northwind.example","questions":["who owns revenue operations?"],"requestId":"evt_northwind_001"}}
```

`request` is exactly the frozen `ResearchRequest` from `src/types.mjs`, already
validated. `job.requestId` always equals `job.request.requestId`.

`jobs/completed.jsonl` — one line per finished job:

```json
{"requestId":"evt_northwind_001","completedAt":"2026-09-07T18:24:02.771Z"}
```

**Reader contract:**

- `await nextJob()` → the oldest job not yet completed, or `null` when drained.
- **It is a peek, not a pop.** Calling it twice returns the same job. Removing the
  job at read time would mean a reader that crashes mid-research has consumed it and
  produced nothing, with no redelivery coming, because the provider already got its
  200. The job stays visible until the reader says the work is finished.
- `await completeJob(requestId)` → `true` when the job existed and was open,
  `false` for an unknown or already-completed id. Completion is a second append, not
  a rewrite of `pending.jsonl`, so every write is one append and the crash window in
  read-mutate-rewrite never opens.
- The files are the state, so a restart is not a reset.

Known bound, stated rather than discovered: `nextJob` reads both files per call, so
this is correct and cheap for the queue depths this artifact runs at and would want
an index before it ran at scale. Single reader assumed — there is no cross-process
lock between `nextJob` and `completeJob`.

## webhook-engine APIs consumed

| API | Used for |
|---|---|
| `createEngine({ secret, handler, parse, eventId, ... })` | the whole pipeline; `receive()` is the intake |
| `engine.receive({ rawBody, headers })` | verify → parse → reserve → handler → DLQ |
| `engine.store` (`MemoryIdempotencyStore`, the default) | `reserve`/`complete`/`release` on the local path |
| `engine.dlq` (`MemoryDeadLetterQueue`, the default) | dead letter records; `list()` in tests |
| `DEFAULT_ID_HEADER` | the `webhook-id` fallback in the id resolver |
| `signHeader` | **tests only**, to produce valid input from a synthetic secret |

Nothing about HMAC, the replay window, the atomic reservation, the retry classifier
or the DLQ record shape is reimplemented here. `verifySignature`, `retry`,
`buildDeadLetterRecord` and the stores are all reached through `createEngine`.

Both stores are in-memory, which is the library's default and is correct for one
process. Two processes, or a restart, and idempotency resets — `createIngress`
passes `store` and `dlq` straight through, so a durable backend is a constructor
argument whenever this stops being a single local process.

## Two decisions worth challenging at review

**1. The idempotency key comes from the SIGNED body first, header only as fallback.**

`resolveRequestId` reads `body.requestId ?? body.id ?? body.event_id ?? body.eventId`,
then falls back to the `webhook-id` header. The HMAC covers the timestamp and the
body, not `webhook-id`, so an id taken from that header is editable in flight by
anything that can rewrite headers. Preferring the header would let one signed
delivery be re-presented under a fresh id and enqueued a second time — defeating the
replay refusal without ever touching the signature. This follows webhook-engine's
own default ordering and the reasoning in its `engine.js`.

Consequence: a delivery whose body carries no id **and** no `webhook-id` header is
refused 400 `no_event_id`. A record with no id cannot be replayed, so there is
nothing honest to put in the DLQ.

**2. A forged delivery does NOT produce a DLQ record. This deviates from the lane brief.**

The brief said every failure — bad signature included — goes to the dead letter
path. webhook-engine deliberately does not do that: it verifies **before** it parses
or stores, so a rejected sender fills neither the idempotency store nor the DLQ.
That is a security property, not an omission. Routing unauthenticated deliveries
into durable storage hands any anonymous caller a way to fill the queue that holds
the events which already failed everywhere else, and `MemoryDeadLetterQueue` throws
rather than evicting when full — so the forged traffic would take the endpoint down
with it.

Implementing the brief literally would have meant bypassing `createEngine` or
wrapping it to catch the 401, in a repo whose entire thesis is these primitives
doing their real job. So the library's behavior stands, and the invariant that
actually carries the lane holds in every failure case: **no job is enqueued, and the
refusal names what was wrong.**

The one place the brief did change the code is the parse hook. A body that failed
`JSON.parse` came from a sender that PASSED verification, so it is evidence worth
keeping; `reportingParse` returns the failure instead of throwing, which moves it
into the handler and therefore into the DLQ. Verification still runs first — this
changes where a parse failure lands, never whether an unauthenticated caller reaches
the parser.

Flagged to the orchestrator as a cross-lane decision rather than settled here.

## Fail-closed cases proven (test/ingress/)

| Case | Test |
|---|---|
| wrong signature → refused, no job, nothing durable | `a delivery signed with the wrong secret is refused and enqueues nothing` |
| the refusal is decided by the signature, not something incidental | `the same bytes that were refused are accepted by the intake holding the matching secret` |
| replayed delivery → refused, exactly one job ever | `a replayed delivery is refused as a duplicate and enqueues exactly one job` |
| stale delivery outside the replay window → refused, no job | `a delivery replayed outside the timestamp window is refused and enqueues nothing` |
| unparsable body → DLQ with the reason, one attempt, no job | `a verified delivery whose body is not JSON is dead lettered with the reason` |
| body that fails `makeResearchRequest` → DLQ with the reason, no job | `a verified delivery that fails makeResearchRequest is dead lettered with the reason` |
| malformed local request → refused identically, no job | `a malformed local request is refused exactly as a malformed delivery is` |
| valid delivery → exactly one JSONL job matching the request | `a verified delivery becomes exactly one JSONL job carrying the request` |
| raw bytes survive the socket | `the listener preserves the exact bytes the signature covers` |

Every secret in the tests is synthetic and invented there. No test prints a secret
or a raw signature.
