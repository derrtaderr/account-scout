---
name: Kernel context wiring
read_by: Lane E before wiring the CLI's `--project` flag or writing the README's kernel section, Lane D before reporting a kernel refusal through the gates, and the orchestrator before merging Lane C
---

# Lane C wiring — the kernel context

What Lane C exports, which gtm-architect surfaces it consumes, the shape of the
brief it produces, and every way it refuses. Written so no later lane has to
read the implementation to use it.

Everything here is exercised by tests in `test/kernel/`, and every one of those
tests spawns the **real** `gtm-mcp` server against the bundled fixture.

## What this lane is for

`runScout({ request, provider, maxHops, brief })` takes `brief` as an opaque
string. This lane fills it from a deterministic kernel — gtm-architect, read
over MCP — so hops are aimed by **declared strategy the model cannot negotiate
with** rather than by whatever the extractor felt like emphasising.

The server is read-only by construction, not by convention: it reaches the
kernel through exactly one route, `execFile` of the real `cli.mjs` with
`--json`, and the kernel refuses that flag on every write path. Nothing this
lane does can change a project.

## Modules and signatures

No barrel module, matching Lane B. Import the exact path.

### `src/kernel/client.mjs`

```js
openKernel({ projectDir, serverPath?, timeoutMs?, spawnImpl? }) => Promise<KernelSession>
class KernelRefusal extends Error        // .name === "KernelRefusal"
defaultServerPath() => string
DEFAULT_TIMEOUT_MS      // 10_000
PROTOCOL_VERSION        // "2024-11-05"
CLIENT_NAME             // "account-scout-kernel"
```

```js
KernelSession = {
  serverInfo,                          // { name, version } from initialize
  projectDir,
  listTools() => Promise<Array<{ name, description, inputSchema }>>,
  callTool(name, args = {}) => Promise<Envelope>,   // the gtm-json/1 envelope
  close() => Promise<void>,
}
```

A hand-rolled MCP client, zero new dependencies, matching the server across the
pipe. Newline-delimited JSON-RPC 2.0 over stdio: `initialize` →
`notifications/initialized` → `tools/list` → `tools/call`.

- `projectDir` is **required**. There is no default, because a client that fell
  back to `process.cwd()` would silently read whatever directory it happened to
  start in — the server refuses to let a tool carry a directory for the same
  reason.
- `serverPath` defaults to Node's own resolution of
  `gtm-architect/bin/gtm-mcp.mjs`, so a hoisted or deduped `node_modules` cannot
  leave a hardcoded path stale.
- `spawnImpl` exists so tests can inject a fake **transport**. The server itself
  is never faked; see the testing note at the bottom.
- The child is started with an **argument vector, never a shell string**. The
  project directory crosses this boundary and meets no shell on the other side.
- `timeoutMs` is per call. On expiry the child is killed and the call refuses.
  `close()` kills the child too, so no session leaks a process.

### `src/kernel/brief.mjs`

```js
briefFromKernel({ projectDir, serverPath?, tools?, timeoutMs? }) => Promise<BriefResult>
DEFAULT_TOOLS   // ["gtm_status", "gtm_positioning", "gtm_canvas"]
```

```js
BriefResult =
  | { ok: true,  brief: string, envelopes: Record<toolName, Envelope> }
  | { ok: false, refusal: string }        // note: NO brief key at all
```

Opens a session, confirms the wanted surfaces against the server's **own**
`tools/list` rather than trusting the names, calls each one, and composes the
brief.

## The tool set consumed

Three of the sixteen read surfaces the server exposes. The catalog is checked at
runtime, so a surface that is renamed upstream is named in a refusal rather than
quietly shrinking the brief.

| tool | what the brief takes from it |
|---|---|
| `gtm_status` | product state, the declared mission and its secured window, the picked beachhead and ECP draw date, evidence counts, per-decision gate state, the kernel's own next step |
| `gtm_positioning` | the position statement, the USPs that survive both filters with their benefits, and the table-stakes assets |
| `gtm_canvas` | on this fixture, a refusal — carried into the brief as one |

Observed against the installed server: **`tools/list` returns 16 tools.** The
lane's test asserts the three above are present and does **not** assert 16, so a
seventeenth read surface added upstream is not this lane's regression.

## The brief format

A plain string. No shape is imposed on it by Lane B and none is invented here.

```
<beachhead> <usp asset> <usp asset>          ← line 1, see below

strategy brief — from the gtm-architect kernel, project <name>, read only. …

WHAT THE STRATEGY DECLARES
  product state: mvp
  mission: "…" (secured YYYY-MM-DD to YYYY-MM-DD)
  picked beachhead: "…"
  ECP drawn YYYY-MM-DD
  the kernel's own next step: "…"

WHAT THE POSITIONING CLAIMS
  position: "…"
  USP (survives both filters): "<asset>" — "<benefit>"
  table stakes (valued, not unique): "<asset>" — "<benefit>"

WHAT THE EVIDENCE GATES HOLD OPEN
  N graded observations recorded, M excluded
  decision 01 market: in-progress
  decision 03 product: open — "no evidence"

WHAT THE KERNEL REFUSES (a refusal is recorded state, not a gap to fill in)
  the kernel refuses <tool>: <the kernel's message, whole>
```

Three rules hold this honest, and each has a test:

1. **Line one is the aiming line, and it is deliberate.** `planHops` lifts the
   brief's first six word-tokens into a search query. Opening with a header
   would spend all six slots on the word "strategy" and its neighbours, so line
   one carries the picked beachhead and the surviving USPs instead — the most
   searchable terms the kernel holds. `test/kernel/plug.test.mjs` fails if the
   brief ever leads with a label again, and that was verified by reverting it.

2. **Double quotes mean one thing: the kernel said this.** Nothing this module
   authors is ever quoted, so a reader can tell recorded state from labelling by
   looking. A kernel value that *already* contains a double quote is emitted
   **bare** — the longer refusals quote the book they enforce, re-wrapping would
   nest past what a reader or parser can resolve, and escaping would alter the
   kernel's own words.

3. **The brief never writes strategy.** It quotes, labels and arranges. The
   traceability test parses every quoted value back out and requires it verbatim
   in a raw envelope, and requires every reported refusal to match a problem
   message the kernel actually emitted.

## The refusal shapes

Three different things can go wrong and they must never look alike.

| situation | shape | why |
|---|---|---|
| the kernel was read, and a surface refused | `{ ok: true, brief }`, brief carries `the kernel refuses <tool>: …` | **A refusing kernel is the system working.** Open gates and unfilled worksheets are recorded state, and the scout is entitled to know the strategy has not earned a claim yet. |
| the kernel could not be read at all | `{ ok: false, refusal }`, **no `brief` key** | Spawn failed, the handshake did not land, the transport broke, or a wanted surface is missing from the catalog. |
| no brief was requested | caller simply omits `brief` | Distinct from both of the above — which is the whole reason the failed read carries no `brief` key. |

`KernelRefusal` is thrown by `client.mjs` for transport-level failure and is
**caught** by `briefFromKernel`, which converts it to the `ok: false` result.
Callers of `briefFromKernel` never need to catch. Callers of `openKernel` do.

Every message is loud and names what happened:

- server exits before replying — names the exit code and whatever it managed to
  put on stderr
- a reply line that is not JSON — quotes the line, and kills the child, because
  a transport that desynchronized cannot be trusted for what follows
- a JSON-RPC error — surfaced as the kernel's own words, never swallowed. A call
  to a write verb comes back `the kernel refused "tools/call" (JSON-RPC -32601):
  refused: this server is read only and "init" is a write verb …`
- a call that never answers — killed at `timeoutMs`, and said so

**A kernel refusal is not a JSON-RPC error.** A blocked gate or an empty
worksheet comes back as a normal result whose envelope carries `ok: false` and
the problems. `callTool` returns it. Turning that into an exception would
destroy the exact words the brief has to carry.

## For Lane D and Lane E

- **Lane E**: `--project` belongs on the CLI, set by the person wiring it up.
  Pass it to `briefFromKernel`. A `{ ok: false }` result should reach the user as
  its `refusal` string; it is a refusal, not a crash, and deserves the same
  distinct exit code as `ScoutRefusal` rather than the crash code.
- **Lane D**: the brief and the refusal are both plain strings and both may quote
  a synthetic company. Neither carries a credential — this lane is keyless
  throughout and the kernel needs no API key — but they go through `guard()` on
  the way out like everything else.

## The fixture

`fixtures/gtm-project/` is a **synthetic** gtm-architect project: Lumen Freight,
an invented dock-scheduling company. It was built with the kernel's own write
surfaces (`init`, `evidence add`, `pick`, `ecp draw`, `objective set`,
`omtm set`), so every file in it is the shape the instrument actually writes
rather than something hand-forged to please a test.

It carries three cases on purpose:

| surface | state |
|---|---|
| `gtm_status` | rich — 5 graded evidence rows, 2 decisions in progress, a declared objective, a drawn ECP |
| `gtm_positioning` | rich **and** flagged — 2 USPs survive both filters, while the story links no UVP and one claim rests on an asset not in the inventory |
| `gtm_canvas` | **refuses** — `value-prop.md` is scaffolded and deliberately left empty |

The refusing surface is the point of the fixture. Without one, nothing would
prove the brief reports a refusal instead of papering over it.

> **Note for anyone regenerating it.** Six read surfaces — `canvas`,
> `economics`, `wtp`, `positioning`, `funnel`, `loop` — scaffold an empty
> worksheet on first run and then refuse until it is filled. Both scaffolded
> files are **committed**, so the tests neither depend on a write happening nor
> dirty the tree when they run.

## A note on testing

The happy path is not mocked. Every test in `test/kernel/` spawns the real
installed `gtm-mcp` binary against the real fixture, because this lane's whole
claim is that a real primitive is doing its real job.

A fake **transport** appears in `client-failures.test.mjs` for the two cases a
correct server cannot be asked to produce on demand: dying mid-handshake, and
emitting a line that is not JSON. Faking the pipe keeps those cases honest;
faking the server would have defeated the lane.
