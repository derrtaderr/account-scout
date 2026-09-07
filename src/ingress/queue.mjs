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
export const CLAIMS_FILE = "claims.jsonl";
export const POISON_FILE = "poison.jsonl";

/** Attempts before a job is treated as poison. Three is enough for a flaky
 *  dependency to recover and few enough that a crash loop is caught the same day. */
export const DEFAULT_MAX_ATTEMPTS = 3;

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
export function createJobQueue({ dir, now = () => new Date(), maxAttempts = DEFAULT_MAX_ATTEMPTS }) {
  if (typeof dir !== "string" || dir === "")
    throw new TypeError("createJobQueue needs a jobs directory");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1)
    throw new TypeError("createJobQueue maxAttempts must be a whole number of at least 1");

  const pendingPath = join(dir, PENDING_FILE);
  const completedPath = join(dir, COMPLETED_FILE);
  const claimsPath = join(dir, CLAIMS_FILE);
  const poisonPath = join(dir, POISON_FILE);

  function appendLine(path, entry) {
    mkdirSync(dir, { recursive: true });
    appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
  }

  /** Append one validated ResearchRequest as a single JSONL line. */
  async function append(request) {
    const job = {
      requestId: request.requestId,
      enqueuedAt: now().toISOString(),
      request,
    };
    appendLine(pendingPath, job);
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

    const attempts = new Map();
    for (const claim of readLines(claimsPath))
      attempts.set(claim.requestId, (attempts.get(claim.requestId) ?? 0) + 1);

    const alreadyPoisoned = new Set(readLines(poisonPath).map((entry) => entry.requestId));

    for (const job of readLines(pendingPath)) {
      if (done.has(job.requestId)) continue;

      // THE POISON EXIT. Without it, a job that crashes its reader is handed back
      // forever: one bad payload stops the queue permanently and the only symptom is
      // a scout that never makes progress. Reported once to a file a human owns,
      // never silently dropped, and never re-reported on every subsequent read.
      const count = attempts.get(job.requestId) ?? 0;
      if (count >= maxAttempts) {
        if (!alreadyPoisoned.has(job.requestId)) {
          appendLine(poisonPath, {
            requestId: job.requestId,
            attempts: count,
            poisonedAt: now().toISOString(),
          });
          alreadyPoisoned.add(job.requestId);
        }
        continue;
      }

      return job;
    }
    return null;
  }

  /**
   * Record that a reader is about to work this job. The reader calls it BEFORE the
   * work, not after — a claim written afterwards is never written by the crash it
   * exists to count.
   *
   * @returns {Promise<number>} this job's attempt number
   */
  async function claimJob(requestId) {
    appendLine(claimsPath, { requestId, claimedAt: now().toISOString() });
    return readLines(claimsPath).filter((claim) => claim.requestId === requestId).length;
  }

  /**
   * Record a job as finished. Returns false for a requestId that was never
   * enqueued, rather than writing a completion for work that does not exist.
   */
  async function completeJob(requestId) {
    const pending = readLines(pendingPath);
    if (!pending.some((job) => job.requestId === requestId)) return false;
    if (completedIds().has(requestId)) return false;

    appendLine(completedPath, { requestId, completedAt: now().toISOString() });
    return true;
  }

  return {
    append,
    nextJob,
    claimJob,
    completeJob,
    pendingPath,
    completedPath,
    claimsPath,
    poisonPath,
    maxAttempts,
    dir,
  };
}
