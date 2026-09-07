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

  /** The requestIds already finished, read from disk so a restart is not a reset. */
  function completedIds() {
    return new Set(readLines(completedPath).map((entry) => entry.requestId));
  }

  /**
   * The oldest job not yet completed, or null.
   *
   * A PEEK, NOT A POP. Removing the job at read time means a reader that crashes
   * mid-research has consumed the job and produced nothing, and the verified
   * request is gone with no redelivery coming — the provider already got its 200.
   * The job stays visible until completeJob says the work is finished.
   */
  async function nextJob() {
    const done = completedIds();
    for (const job of readLines(pendingPath)) {
      if (!done.has(job.requestId)) return job;
    }
    return null;
  }

  /**
   * Record a job as finished. Returns false for a requestId that was never
   * enqueued, rather than writing a completion for work that does not exist.
   */
  async function completeJob(requestId) {
    const pending = readLines(pendingPath);
    if (!pending.some((job) => job.requestId === requestId)) return false;
    if (completedIds().has(requestId)) return false;

    mkdirSync(dir, { recursive: true });
    appendFileSync(
      completedPath,
      `${JSON.stringify({ requestId, completedAt: now().toISOString() })}\n`,
      "utf8",
    );
    return true;
  }

  return { append, nextJob, completeJob, pendingPath, completedPath, dir };
}
