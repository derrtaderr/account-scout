// The file-backed job queue the scout core consumes.
//
// Append-only JSONL. A job is never rewritten in place and never deleted, because
// the crash window in "read, mutate, rewrite the whole file" is exactly the window
// in which a verified request disappears. Completion is recorded by appending to a
// second file, so both writes are single appends.

import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const PENDING_FILE = "pending.jsonl";
export const COMPLETED_FILE = "completed.jsonl";

function readLines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

/**
 * @param {{dir: string, now?: () => Date}} options
 */
export function createJobQueue({ dir, now = () => new Date() }) {
  if (typeof dir !== "string" || dir === "")
    throw new TypeError("createJobQueue needs a jobs directory");

  const pendingPath = join(dir, PENDING_FILE);
  const completedPath = join(dir, COMPLETED_FILE);

  /** Append one validated ResearchRequest as a single JSONL line. */
  async function append(request) {
    mkdirSync(dir, { recursive: true });
    const job = {
      requestId: request.requestId,
      enqueuedAt: now().toISOString(),
      request,
    };
    appendFileSync(pendingPath, `${JSON.stringify(job)}\n`, "utf8");
    return job;
  }

  return { append, pendingPath, completedPath, dir };
}
