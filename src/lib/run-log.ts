import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A line-by-line record of what a scheduled run did.
 *
 * ---------------------------------------------------------------------------
 * Why cron_runs was not enough
 *
 * That table holds one row per day with a summary: how many letters, how many
 * fees, which tenants were held back. It answers "what happened" and not
 * "why", and those are asked at different times. The summary is read the
 * morning after. This is read six weeks later, when somebody asks why a
 * particular tenant got a particular letter and the summary has stopped being
 * enough to say.
 *
 * ---------------------------------------------------------------------------
 * It must never be the reason a letter did not go
 *
 * Two rules follow from that, and both are worth stating because the obvious
 * implementation breaks them.
 *
 * Lines are held in memory and written once at the end. A hundred inserts one
 * at a time, inside a serverless function with a sixty second budget, is a
 * real risk of the run timing out half way through sending — and the thing
 * that would fail is the letters, not the log.
 *
 * And a failed write is swallowed. If the log cannot be stored the run has
 * still happened, and reporting the day as failed because its diary could not
 * be written would be the tail wagging the dog. It is said in the run's notes
 * instead, so the gap is visible without being fatal.
 */

export type Step = "start" | "report" | "memory" | "plan" | "fee" | "letter" | "finish";
export type Level = "info" | "warn" | "error";

interface Line {
  seq: number;
  step: Step;
  level: Level;
  message: string;
  detail: Record<string, unknown>;
  tenant_id: string | null;
}

export interface RunLog {
  /** Add a line. Cheap: nothing leaves the process until flush(). */
  say(
    step: Step,
    message: string,
    detail?: Record<string, unknown>,
    opts?: { level?: Level; tenant?: string | null },
  ): void;
  /** Write them all. Returns a note where it could not, never throws. */
  flush(): Promise<string | null>;
  /** How many lines are waiting, for the run's own summary. */
  size(): number;
}

export function runLog(db: SupabaseClient, ranFor: string): RunLog {
  const lines: Line[] = [];

  return {
    say(step, message, detail = {}, opts = {}) {
      lines.push({
        seq: lines.length + 1,
        step,
        level: opts.level ?? "info",
        message,
        detail,
        tenant_id: opts.tenant ?? null,
      });
    },

    size: () => lines.length,

    async flush() {
      if (lines.length === 0) return null;
      try {
        /*
         * Chunked, because a day that writes to every tenant can produce
         * several hundred lines and PostgREST has a request size to respect.
         * Five hundred is comfortably inside it and keeps the round trips in
         * single figures.
         */
        const CHUNK = 500;
        for (let i = 0; i < lines.length; i += CHUNK) {
          const batch = lines.slice(i, i + CHUNK).map((l) => ({ ...l, ran_for: ranFor }));
          const { error } = await db.from("run_log").insert(batch);
          if (error) {
            const missing = /relation .*run_log.* does not exist|schema cache/i.test(error.message);
            return missing
              ? "The run was not logged in detail: this database does not have 0020_run_log.sql applied yet."
              : `The run was not logged in detail: ${error.message}`;
          }
        }
        return null;
      } catch (e) {
        return `The run was not logged in detail: ${(e as Error).message}`;
      }
    },
  };
}
