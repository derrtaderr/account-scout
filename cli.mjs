#!/usr/bin/env node
// account-scout — the bin. Everything it does lives in src/cli/main.mjs, which
// is tested; this file only supplies the real streams and env and turns the
// returned code into the process exit code. Kept to three lines of logic on
// purpose: a bin is the one file no test drives directly, so it must contain
// nothing a test could have caught.

import { main } from "./src/cli/main.mjs";

main(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
})
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`account-scout: fatal — ${err?.stack ?? err}\n`);
    process.exit(1);
  });
