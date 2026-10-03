"use client";

import { useCallback, useEffect, useState } from "react";

import { DEFAULT_REMINDER_DAYS, type ReminderWindow } from "./reminder-timing.ts";

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
  window: ReminderWindow;
  /** "default" means the database holds no setting yet; see reminder-window.ts. */
  source: "database" | "default" | "loading";
  updatedAt: string | null;
  error: string | null;
  save: (next: ReminderWindow) => Promise<{ ok: true } | { ok: false; error: string }>;
}

export function useReminderWindow(): ReminderWindowState {
  const [window, setWindow] = useState<ReminderWindow>(DEFAULT_REMINDER_DAYS);
  const [source, setSource] = useState<ReminderWindowState["source"]>("loading");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const r = await fetch("/api/settings/reminders", { headers: await authHeader() });
        const j = await r.json();
        if (!live) return;
        if (!j.ok) {
          setError(j.error ?? `The server said ${r.status}.`);
          setSource("default");
          return;
        }
        setWindow(j.window);
        setSource(j.source);
        setUpdatedAt(j.updatedAt ?? null);
        setError(j.problem ?? null);
      } catch (e) {
        if (!live) return;
        setError((e as Error).message);
        setSource("default");
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const save = useCallback(async (next: ReminderWindow) => {
    try {
      const r = await fetch("/api/settings/reminders", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify(next),
      });
      const j = await r.json();
      if (!j.ok) return { ok: false as const, error: j.error ?? `The server said ${r.status}.` };
      setWindow(j.window);
      setSource("database");
      setUpdatedAt(new Date().toISOString());
      setError(null);
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }, []);

  return { window, source, updatedAt, error, save };
}
