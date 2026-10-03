import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DEFAULT_REMINDER_DAYS, sane, type ReminderWindow } from "./reminder-timing.ts";

/**
 * The two reminder numbers, as the database holds them.
 *
 * One place reads them for both the nine o'clock run and the Settings screen,
 * so the screen can never show one window while the run uses another. That
 * was exactly the state before 0022: the screen read the browser, the run read
 * nothing, and changing the number moved every date on screen and no letter.
 */

const KEY = "reminder_window";

export interface StoredWindow {
  window: ReminderWindow;
  /**
   * Where it came from. "default" is not an error - it is a database that has
   * not had 0022 applied, or a row nobody has written yet - but it is worth
   * saying, because it means the Settings screen cannot change anything yet.
   */
  source: "database" | "default";
  updatedAt: string | null;
  /** Set when the read failed for a reason other than the table being absent. */
  problem: string | null;
}

function fromJson(value: unknown): ReminderWindow | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { first?: unknown; final?: unknown };
  const first = Number(v.first);
  const final = Number(v.final);
  if (!Number.isFinite(first) || !Number.isFinite(final)) return null;
  return sane({ first, final });
}

/**
 * Never throws, and never returns nothing.
 *
 * A failed read falls back to the default rather than stopping the run. A
 * missing setting must not be the reason a tenant is not chased; the run's
 * notes say which window it used, so a fallback is visible rather than silent.
 */
export async function readReminderWindow(db: SupabaseClient): Promise<StoredWindow> {
  const r = await db
    .from("app_settings")
    .select("value, updated_at")
    .eq("key", KEY)
    .maybeSingle();

  if (r.error) {
    const absent = /does not exist|schema cache/i.test(r.error.message);
    return {
      window: DEFAULT_REMINDER_DAYS,
      source: "default",
      updatedAt: null,
      problem: absent ? null : r.error.message,
    };
  }

  const parsed = r.data ? fromJson((r.data as { value: unknown }).value) : null;
  if (!parsed) {
    return { window: DEFAULT_REMINDER_DAYS, source: "default", updatedAt: null, problem: null };
  }

  return {
    window: parsed,
    source: "database",
    updatedAt: (r.data as { updated_at: string | null }).updated_at ?? null,
    problem: null,
  };
}

export async function writeReminderWindow(
  db: SupabaseClient,
  window: ReminderWindow,
  actor: { userId: string; name: string },
): Promise<{ ok: true; window: ReminderWindow } | { ok: false; error: string }> {
  const clean = sane(window);

  const w = await db.from("app_settings").upsert(
    {
      key: KEY,
      value: clean,
      updated_by: actor.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
  if (w.error) {
    return {
      ok: false,
      error: /does not exist|schema cache/i.test(w.error.message)
        ? "This database does not have 0022_reminder_window.sql applied yet, so the setting has nowhere to go."
        : w.error.message,
    };
  }

  /* Said in the one place nobody can edit afterwards: this changes when every
     tenant is written to. */
  await db.from("audit_log").insert({
    actor: actor.userId,
    actor_name: actor.name,
    action: "settings.reminder_window",
    subject: `first ${clean.first} days, final ${clean.final} days after billing`,
    meta: clean,
  });

  return { ok: true, window: clean };
}
