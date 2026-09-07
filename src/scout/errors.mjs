// A refusal is not a crash. The scout fails closed in a way downstream lanes
// can tell apart from a bug: ScoutRefusal means "the run declined to produce a
// report, and here is what was missing", which Lane E maps to an exit code and
// Lane D reports rather than swallows.
//
// A bare Error escaping this package is a defect. A ScoutRefusal is the design.

export class ScoutRefusal extends Error {
  /**
   * @param {string} message What is missing, and where repair would start.
   * @param {{cause?: unknown}} [options] A cause MUST already be scrubbed —
   *   pass `scrubError(err, [secret])`, never the raw error. See below.
   */
  constructor(message, options = {}) {
    super(message, options);
    this.name = "ScoutRefusal";
  }
}

/**
 * Secrets that may be in play anywhere in this process, whether or not the
 * caller knows about them. Used as the default so code that wraps an error it
 * did not create — runScout wrapping a provider someone else wrote — still
 * scrubs, instead of trusting every future provider to be careful.
 */
export function ambientSecrets() {
  return [process.env.ANTHROPIC_API_KEY].filter((s) => typeof s === "string" && s.trim() !== "");
}

/** Replace every secret with a marker. One helper, used everywhere. */
export function scrubText(text, secrets = ambientSecrets()) {
  let out = String(text ?? "");
  for (const secret of secrets) if (secret) out = out.split(secret).join("[redacted]");
  return out;
}

const MAX_CAUSE_DEPTH = 10;

/**
 * A scrubbed CLONE of an error, safe to attach as a `cause`.
 *
 * Scrubbing only the ScoutRefusal's own message is not enough: `{ cause: err }`
 * attaches the original object, and util.inspect / console.error print the
 * whole chain — which is exactly what this package tells Lanes D and E to do
 * with these errors. Three things leak through a raw cause, and all three are
 * handled here:
 *
 *   1. the cause's own message (an upstream 401 body echoing the key back),
 *   2. a NESTED cause further down the chain,
 *   3. the stack, which can carry a key inside a URL — and V8's own
 *      JSON.parse SyntaxError quotes the offending source text, so a key in a
 *      malformed body lands in the message of an error nobody wrote.
 *
 * The stack is dropped rather than scrubbed: its frames point into node
 * internals, so it costs nothing and removes a whole class of leak.
 *
 * @param {unknown} err
 * @param {string[]} secrets
 * @returns {Error} A clone that is safe to print.
 */
export function scrubError(err, secrets = ambientSecrets(), depth = 0, seen = new Set()) {
  const flatten = (error) => {
    error.stack = `${error.name}: ${error.message}`;
    return error;
  };

  if (depth > MAX_CAUSE_DEPTH) return flatten(new Error("[cause chain truncated]"));
  if (!(err instanceof Error)) return flatten(new Error(scrubText(err, secrets)));
  if (seen.has(err)) return flatten(new Error("[cyclic cause omitted]"));
  seen.add(err);

  const clone = new Error(scrubText(err.message, secrets));
  clone.name = err.name;
  flatten(clone);
  if (err.cause !== undefined) clone.cause = scrubError(err.cause, secrets, depth + 1, seen);
  return clone;
}
