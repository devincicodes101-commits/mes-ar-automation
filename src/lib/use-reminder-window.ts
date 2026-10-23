"use client";

import { useEffect, useState } from "react";

import { DEFAULT_REMINDER_DAYS, sane, type FullWindow, type ReminderWindow } from "./reminder-timing.ts";

/**
 * The reminder window as the nine o'clock run will use it.
 *
 * Read from the server, never from the browser. The first version kept these
 * two numbers in localStorage: changing them moved every date on screen, on
 * that one machine, and changed nothing about what was actually sent.
 */

async function authHeader(): Promise<Record<string, string>> {
  try {
    const { supabase } = await import("./supabase.ts");
    const token = (await supabase?.auth.getSession())?.data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

export interface ReminderWindowState {
  window: FullWindow;
  /** "default" means the database holds no setting yet; see reminder-window.ts. */
  source: "database" | "default" | "loading";
  updatedAt: string | null;
  error: string | null;
  save: (next: ReminderWindow) => Promise<{ ok: true } | { ok: false; error: string }>;
}

/*
 * One copy for the whole app, loaded once.
 *
 * Each screen used to fetch this for itself and, until its answer came back,
 * work from the built-in 23 and 27 days. For a moment every screen showed the
 * default's dates and the default's list of who is due - stale figures that
 * then changed under the reader. Now the first screen to ask loads it, every
 * later screen gets it at once, and until it has arrived `source` says
 * "loading" so a screen can show its shape instead of a guess.
 */
type Held = Omit<ReminderWindowState, "save">;

let held: Held = { window: DEFAULT_REMINDER_DAYS, source: "loading", updatedAt: null, error: null };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<Held>) {
  held = { ...held, ...next };
  listeners.forEach((l) => l());
}

function load(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await fetch("/api/settings/reminders", { headers: await authHeader() });
      const j = await r.json();
      if (!j.ok) {
        set({ error: j.error ?? `The server said ${r.status}.`, source: "default" });
        return;
      }
      set({ window: sane(j.window), source: j.source, updatedAt: j.updatedAt ?? null, error: j.problem ?? null });
    } catch (e) {
      set({ error: (e as Error).message, source: "default" });
      /* A failed read may be retried by the next screen that asks. */
      inflight = null;
    }
  })();
  return inflight;
}

async function save(next: ReminderWindow): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const r = await fetch("/api/settings/reminders", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(await authHeader()) },
      body: JSON.stringify(next),
    });
    const j = await r.json();
    if (!j.ok) return { ok: false as const, error: j.error ?? `The server said ${r.status}.` };
    set({ window: sane(j.window), source: "database", updatedAt: new Date().toISOString(), error: null });
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }
}

export function useReminderWindow(): ReminderWindowState {
  const [state, setState] = useState<Held>(held);

  useEffect(() => {
    const l = () => setState(held);
    listeners.add(l);
    l();
    void load();
    return () => {
      listeners.delete(l);
    };
  }, []);

  return { ...state, save };
}
