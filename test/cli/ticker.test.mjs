// Lane E — the guarded ticker. serve sweeps the queue on an interval, and a
// live research run routinely takes longer than one interval. Without a guard,
// a second tick fires while the first is still running: both peek the same job,
// both claim it (two attempts toward poison for one real job), and both record
// a verdict — TWO telemetry events for one clean run, which inflates the
// autonomy streak and earns unattended mode faster than the gate intends. The
// guard makes a tick a no-op while one is already in flight.

import test from "node:test";
import assert from "node:assert/strict";

import { guardedTicker } from "../../src/cli/serve.mjs";

test("a tick is skipped while a previous one is still in flight", async () => {
  let calls = 0;
  const releases = [];
  const slow = () =>
    new Promise((resolve) => {
      calls += 1;
      releases.push(resolve);
    });

  const tick = guardedTicker(slow);

  const first = tick(); // starts; stays pending
  const second = await tick(); // must be skipped, not a second run

  assert.deepEqual(second, { skipped: true });
  assert.equal(calls, 1, "the overlapping call did not start a second run");

  releases[0]("done");
  assert.deepEqual(await first, { ran: "done" });

  // With the first finished, a later tick runs normally.
  const third = tick();
  assert.equal(calls, 2);
  releases[1]("again");
  assert.deepEqual(await third, { ran: "again" });
});

test("a tick that throws is reported, the guard clears, and the next tick runs", async () => {
  let calls = 0;
  const errs = [];
  const flaky = () => {
    calls += 1;
    if (calls === 1) return Promise.reject(new Error("boom"));
    return Promise.resolve("ok");
  };

  const tick = guardedTicker(flaky, { onError: (e) => errs.push(e.message) });

  const first = await tick();
  assert.ok(first.error, "the throw is captured, not propagated");
  assert.deepEqual(errs, ["boom"]);

  // The guard must have cleared even though the tick threw — otherwise one
  // failed tick would freeze the server's sweep forever.
  const second = await tick();
  assert.deepEqual(second, { ran: "ok" });
});
