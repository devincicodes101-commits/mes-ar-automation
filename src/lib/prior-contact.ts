import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { emptyState, type SimState } from "./cycle.ts";

/**
 * What has already been done to each tenant this month.
 *
 * ---------------------------------------------------------------------------
 * The fault this exists to fix
 *
 * The scheduled run called runDay(pipeline, emptyState(), ...). Every morning
 * it woke with no memory at all: it did not know who had been written to on
 * the 7th, who had been charged on the 16th, or who it had written to itself
 * the last time it ran.
 *
 * Three consequences, and none of them looked like a fault from the outside:
 *
 *   - The 21st sent the final notice to every tenant who owed money and had an
 *     address, whether or not anybody had ever sent them a first reminder. A
 *     tenant appearing in the report for the first time on the 20th would get
 *     a letter citing the Employment of Foreign Manpower Regulations as the
 *     first thing MES had ever sent them. The run said so in its own summary —
 *     "None of them was reminded on the 7th, which is worth checking" — and
 *     sent them anyway.
 *
 *   - A letter an officer sent by hand from the Reminders screen was invisible
 *     to it, because the only duplicate check compared row ids and a hand sent
 *     letter gets a random one. Same tenant, same letter, same month, twice.
 *
 *   - A replayed day resent everything, because the check that was supposed to
 *     stop it ran after the upsert that reset the flag it tested.
 *
 * The memory belongs in the database rather than in a state object carried
 * between runs, because there is nothing to carry it in: each run is a fresh
 * serverless invocation with nothing before it. emails_sent and late_fees are
 * already the record of what happened. This reads them back.
 *
 * ---------------------------------------------------------------------------
 * Really sent, not merely written
 *
 * was_simulated is the test, for the same reason the send loop uses it: a row
 * written and never delivered is exactly what a crash, or a switched off mail
 * gate, leaves behind. That tenant has not been told anything, so the next run
 * should still try. Only a letter that genuinely left counts as contact.
 */

export interface PriorContact {
  /** Tenants who really received the 7th's first reminder this month. */
  reminded: Set<string>;
  /** Tenants who really received the 21st's final notice this month. */
  finalised: Set<string>;
  /** Tenants the $100 has already been raised against this month. */
  charged: Set<string>;
}

export const NOTHING_YET: PriorContact = {
  reminded: new Set(),
  finalised: new Set(),
  charged: new Set(),
};

/* Scoped to one month, so this is a few hundred rows at MES's size. Paged
   anyway: PostgREST stops at a thousand without saying so, and a silent
   truncation here reads as "nobody has been written to", which is the one
   wrong answer that causes a second letter rather than none. */
const PAGE = 1000;

interface Pageable {
  range(from: number, to: number): PromiseLike<{ data: unknown[] | null; error: unknown }>;
}

async function everything<T>(build: () => Pageable): Promise<{ rows: T[]; error: unknown }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) return { rows, error };
    const got = (data ?? []) as T[];
    rows.push(...got);
    if (got.length < PAGE) return { rows, error: null };
  }
}

/**
 * Reads the month back out of the record.
 *
 * Returns an error rather than an empty result when the read fails, because
 * the two must never be confused: an empty result means nothing has been done
 * and the run should act, and a failed read means the run does not know, and
 * acting on that would be the second letter.
 */
export async function priorContact(
  db: SupabaseClient,
  period: string,
): Promise<{ ok: true; prior: PriorContact } | { ok: false; error: string }> {
  const [letters, fees] = await Promise.all([
    everything<{ tenant_id: string; template_id: string | null }>(() =>
      db
        .from("emails_sent")
        .select("tenant_id,template_id")
        .eq("period", period)
        .eq("was_simulated", false) as unknown as Pageable,
    ),
    everything<{ tenant_id: string }>(() =>
      db.from("late_fees").select("tenant_id").eq("period", period) as unknown as Pageable,
    ),
  ]);

  const failed = letters.error ?? fees.error;
  if (failed) {
    return {
      ok: false,
      error: `Could not read what has already been done this month: ${
        (failed as { message?: string }).message ?? String(failed)
      }`,
    };
  }

  const prior: PriorContact = {
    reminded: new Set(),
    finalised: new Set(),
    charged: new Set(),
  };

  for (const r of letters.rows) {
    if (r.template_id === "reminder-7th") prior.reminded.add(r.tenant_id);
    else if (r.template_id === "final-21st") prior.finalised.add(r.tenant_id);
  }
  for (const r of fees.rows) prior.charged.add(r.tenant_id);

  return { ok: true, prior };
}

/**
 * The same facts in the shape the cycle library already speaks.
 *
 * planFor and runDay take a SimState because the simulation screen walks a
 * person through a hypothetical month and the 21st has to know the 7th
 * happened. Out here the same knowledge is real rather than hypothetical, so
 * it is handed over in the same shape instead of the day growing a second way
 * to ask the question.
 *
 * `at` stays null. It means "which day of this walkthrough has been run", and
 * a scheduled run is not walking through anything.
 */
export function stateFrom(prior: PriorContact): SimState {
  return {
    ...emptyState(),
    /* Array.from rather than a spread: this project's TypeScript target
       predates iterating a Set without downlevelIteration, the same reason
       read-report.ts deduplicates by hand. */
    firstReminder: Array.from(prior.reminded),
    finalNotice: Array.from(prior.finalised),
    charged: Array.from(prior.charged),
  };
}
