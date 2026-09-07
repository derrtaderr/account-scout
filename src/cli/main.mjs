// Lane E — the dispatch. Parse argv, route to the command, and map a bad
// invocation to exit 2 with its message on stderr. cli.mjs does exactly this
// and then calls process.exit; keeping the logic here means the bin has nothing
// in it a test cannot see.

import { parseArgs, UsageError } from "./args.mjs";
import { runCommand, reportCommand, EXIT } from "./commands.mjs";
import { serveCommand } from "./serve.mjs";

/**
 * @param {string[]} argv process.argv.slice(2)
 * @param {object} deps { stdout, stderr, env, now? }
 * @returns {Promise<number>} the exit code
 */
export async function main(argv, deps) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      deps.stderr.write(err.message + "\n");
      return EXIT.USAGE;
    }
    throw err;
  }

  if (opts.command === "run") return runCommand(opts, deps);
  if (opts.command === "serve") return serveCommand(opts, deps);
  return reportCommand(opts, deps);
}
