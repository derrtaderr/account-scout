---
name: Lane A ingress wiring
read_by: Lane B (the scout core) before consuming the job queue; Lane E before writing `scout serve`; the orchestrator at merge
---

# Ingress — wiring

The intake built on `webhook-engine`. A delivery that cannot prove itself never
becomes a job, and every refusal names what was wrong.

```
raw bytes + headers
  → webhook-engine verify (HMAC over RAW bytes, replay window)  fail → 401, nothing stored, counter++
  → parse                                                       fail → 400, DLQ record (hash-keyed)
  → job key = requestId from the SIGNED body                    absent → 400, DLQ record (hash-keyed)
  → atomic idempotency reserve on requestId                     dup  → 200 duplicate, handler never runs
  → makeResearchRequest                                         fail → 400, DLQ record
  → one appended JSONL line in jobs/pending.jsonl
```

## THE SENDER CONTRACT

**The signed body MUST carry `requestId`.**

We own both ends of this interface. An id inside the HMAC-covered bytes is
unforgeable; any header is editable by any middlebox on the path. So `requestId`
lives in the body, it is the idempotency key, and it is the `ResearchRequest`'s own
id — one value, signed once, doing all three jobs.

```json
{"requestId":"evt_northwind_001","accountName":"Northwind Robotics","domain":"northwind.example","questions":["who owns revenue operations?"]}
```

A verified body without `requestId` is a contract violation: **400**, no job, and a
dead letter record. `webhook-id` is read for nothing. `id`, `event_id` and `eventId`
are not aliases — they were, and that is what broke (see F1 below).

## Exports

### `src/ingress/handler.mjs`

```js
createIngress({ secret, jobsDir = "jobs", queue, dlq, ...engineOptions })
  → { handleDelivery, enqueueLocal, stats, engine, queue, store, dlq }
```

`secret` is a string or an array of strings (a rotation). Remaining options pass
through to `createEngine`, so `retry`, `toleranceSeconds`, `store` and `onEvent` are
injectable; a caller's `onEvent` is composed with the counter, not replaced.
`parse`, `eventId` and `handler` are this lane's and should not be overridden.

`stats` is `{ rejected }` — see F3.

```js
handleDelivery(rawBody, headers, deps) → Promise<result>
```

No socket, no server, no ambient state; everything arrives in `deps`
(`{ engine, queue }`). `rawBody` is a string or Buffer of the **exact received
bytes** — a reparsed body breaks the signature.

| status | outcome | meaning |
|---|---|---|
| 200 | `processed` | one job enqueued |
| 200 | `duplicate` | already handled; the handler never ran again |
| **400** | `dead_lettered` | **sender-contract violation** — bad JSON, missing `requestId`, or not a valid research request. Record kept, `reason` names it |
| 200 | `dead_lettered` | a non-contract handler failure exhausted its retries; record kept |
| 401 | `rejected` | signature or replay window; `reason` says which. Nothing stored |
| 409 | `in_flight` | the same `requestId` is mid-flight |
| 500 | `dead_letter_failed` | the DLQ refused the record, so please redeliver |

The 400 is this lane's, not the library's. webhook-engine answers 200 for a dead
lettered event so a provider does not redeliver a copy already safely stored — right
for a transient failure. A sender-contract violation is the other case: the bytes are
authentic and permanently wrong, so the **sender** has to change them, and only a 4xx
says that. 4xx is terminal at every provider, so it starts no redelivery storm.

```js
enqueueLocal(request) → Promise<job>
```

The CLI path. No socket and no signature — there is no remote sender to
authenticate — but `makeResearchRequest` and the idempotency reservation both still
apply. A refusal **throws** rather than dead lettering, because the caller is a
person at a terminal who can read the message and fix the input. Idempotent on
`requestId`: a rerun returns the original job.

### `src/ingress/server.mjs`

```js
createIngressServer(ingress) → node:http Server
```

`node:http`, no framework. Caller owns `.listen()`. POST only (else 405), body read
bounded at 1 MB (else 413). Collects the body as a **Buffer** and hands it over
untouched — the one thing this file can get wrong. Handler exceptions answer a bare
`{ outcome: "ingress_error" }` 500; detail goes to the operator via
`process.emitWarning`, never to the sender, because an error raised over
attacker-controlled bytes can carry fragments of them.

### `src/ingress/queue.mjs`

```js
createJobQueue({ dir, now, maxAttempts = 3 })
  → { append, nextJob, claimJob, completeJob,
      pendingPath, completedPath, claimsPath, poisonPath, maxAttempts, dir }
```

## The job queue contract (Lane B reads this)

Four append-only JSONL files in `jobs/` (created if missing; gitignored).

`jobs/pending.jsonl` — one job per line:

```json
{"requestId":"evt_northwind_001","enqueuedAt":"2026-09-07T18:22:31.004Z","request":{"accountName":"Northwind Robotics","domain":"northwind.example","questions":["who owns revenue operations?"],"requestId":"evt_northwind_001"}}
```

`request` is exactly the frozen `ResearchRequest` from `src/types.mjs`, already
validated. `job.requestId` always equals `job.request.requestId`.

`jobs/completed.jsonl` — `{"requestId":"…","completedAt":"…"}`
`jobs/claims.jsonl` — `{"requestId":"…","claimedAt":"…"}`
`jobs/poison.jsonl` — `{"requestId":"…","attempts":3,"poisonedAt":"…"}`

### The reader's loop

```js
const job = await queue.nextJob();
if (job) {
  await queue.claimJob(job.requestId);   // BEFORE the work
  await research(job.request);
  await queue.completeJob(job.requestId);
}
```

- `nextJob()` → the oldest job that is neither completed nor poison, or `null`.
- **It is a peek, not a pop.** Calling it twice returns the same job. Removing the
  job at read time would mean a reader that crashes mid-research has consumed it and
  produced nothing, with no redelivery coming, because the provider already got its
  200.
- `claimJob(id)` → the attempt number. Call it **before** the work: a claim written
  afterwards is never written by the crash it exists to count.
- `completeJob(id)` → `true` when the job existed and was open, `false` for an
  unknown or already-completed id.

### Two obligations this puts on Lane B

**1. Delivery is AT-LEAST-ONCE. Lane B must tolerate seeing a job twice.** The peek
plus a crash between `claimJob` and `completeJob` means a redelivery is normal, not
exceptional. Research that is expensive or externally visible should key off
`request.requestId` so a second sighting is recognisable.

**2. `poison.jsonl` is the human's queue.** A job claimed `maxAttempts` times (3)
without completing is skipped so the queue keeps moving, and written once to
`poison.jsonl` with its count. It is reported, never silently dropped, and never
re-reported on later reads. Nothing drains that file automatically — a human owns it.

### Recorded decisions, not oversights

- **Compaction is deferred.** All four files grow without bound, and `nextJob` reads
  them on every call, so a full drain is O(n²) in the number of jobs. That is
  accepted for the depths this artifact runs at (tens to hundreds), and the fix when
  it stops being accepted is a compaction pass that rewrites `pending.jsonl` minus
  completed ids, plus an in-memory index. Recorded here so the bound is a decision
  with a trigger rather than a surprise.
- **Single reader assumed.** There is no cross-process lock between `nextJob`,
  `claimJob` and `completeJob`. Two concurrent readers can take the same job. Fixing
  it means a real lease, which is a durable-store decision, not a file-format one.

## webhook-engine APIs consumed

| API | Used for |
|---|---|
| `createEngine({ secret, handler, parse, eventId, dlq, onEvent })` | the whole pipeline |
| `engine.receive({ rawBody, headers })` | verify → parse → reserve → handler → DLQ |
| `engine.store` (`MemoryIdempotencyStore`, the default) | `reserve`/`complete`/`release` on the local path |
| `MemoryDeadLetterQueue` | the DLQ backend, wrapped for dedup |
| `onEvent` | the `rejected` counter (F3) |
| `signHeader` | **tests only**, to produce valid input from a synthetic secret |

Nothing about HMAC, the replay window, the atomic reservation, the retry classifier
or the DLQ record shape is reimplemented. `verifySignature`, `retry`,
`buildDeadLetterRecord` and the stores are all reached through `createEngine`.
`retryable: false` on permanent errors is the library's own classifier hook, which is
why a validation failure costs one attempt instead of four.

Both stores are in-memory, the library's default, correct for one process. Two
processes, or a restart, and idempotency resets — `store` and `dlq` pass straight
through, so a durable backend is a constructor argument.

## Review decisions

**F1 (blocker, fixed) — there is no header fallback for the job key.** Review
demonstrated that one captured signature over an id-less body, re-presented under
`webhook-id: A`, `B`, `C`, produced **three jobs**. The signature never had to be
broken; any middlebox was an unlimited job generator. `resolveRequestId` now reads
`body.requestId` and nothing else. Proven by
`one signed id-less body replayed under three header ids yields zero jobs`.

**F2 (fixed) — the dead letter path requires nothing unsigned.** A verified delivery
with no usable `requestId` (unparsable body, trailing bytes, missing field) is keyed
by `sha256:` + the hash of the signed bytes: deterministic, replay-stable, and
derived only from what the HMAC covers. Records are deduped on event id, because the
engine deliberately releases the key after dead lettering, so the same garbage
redelivered N times would otherwise push N identical records — and
`MemoryDeadLetterQueue` throws rather than evicting when full, which would hand a
retrying sender a way to take the endpoint down with duplicates of one payload.

**F3 (fixed) — forged attempts are counted.** `ingress.stats.rejected`, incremented
from `onEvent`. A number and nothing else: no bytes, no headers, no signatures, never
logged.

**The verify-before-store deviation STANDS (ratified).** A forged delivery produces
no DLQ record. webhook-engine verifies before it parses or stores, on purpose: an
unauthenticated caller must not be able to fill durable storage — least of all the
queue holding events that already failed everywhere else. F3 supplies the
observability that deviation costs.

## Fail-closed cases proven (test/ingress/)

| Case | Test |
|---|---|
| one signature, three header ids → zero jobs | `one signed id-less body replayed under three header ids yields zero jobs` |
| verified body with no `requestId` → 400 + record naming the contract | `a verified body with no requestId is refused naming the sender contract` |
| wrong signature → refused, no job, nothing durable | `a delivery signed with the wrong secret is refused and enqueues nothing` |
| the refusal is decided by the signature, not something incidental | `the same bytes that were refused are accepted by the intake holding the matching secret` |
| forged attempts visible without storage | `forged deliveries are counted, while storing nothing` |
| replayed delivery → refused, exactly one job ever | `a replayed delivery is refused as a duplicate and enqueues exactly one job` |
| stale delivery outside the replay window → refused, no job | `a delivery replayed outside the timestamp window is refused and enqueues nothing` |
| unparsable body → DLQ with the reason, one attempt, no job | `a verified delivery whose body is not JSON is dead lettered with the reason` |
| header-less garbage → DLQ keyed by content hash | `verified garbage with no webhook-id header is dead lettered, keyed by content hash` |
| replayed garbage → still one record | `the same garbage bytes replayed keep exactly one dead letter record` |
| body that fails `makeResearchRequest` → DLQ with the reason, no job | `a verified delivery that fails makeResearchRequest is dead lettered with the reason` |
| malformed local request → refused identically, no job | `a malformed local request is refused exactly as a malformed delivery is` |
| valid delivery → exactly one JSONL job matching the request | `a verified delivery becomes exactly one JSONL job carrying the request` |
| raw bytes survive the socket | `the listener preserves the exact bytes the signature covers` |
| poison job exits the queue, reported once | `a job claimed to the attempt limit is skipped and poisoned exactly once` |
| a completed job is never poisoned | `a job that completes within the attempt limit is never poisoned` |

Every secret in the tests is synthetic and invented there. No test prints a secret
or a raw signature.
