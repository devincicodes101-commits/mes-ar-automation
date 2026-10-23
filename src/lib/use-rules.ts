"use client";

import { useEffect, useState } from "react";

import { DEFAULT_RULES, saneRules, type BusinessRules } from "./rules.ts";

/**
 * The fee, ad hoc and report-age rules, as the nine o'clock run uses them.
 * One copy for the whole app, loaded once, like useReminderWindow.
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

interface Held {
  rules: BusinessRules;
  loading: boolean;
  error: string | null;
}

let held: Held = { rules: DEFAULT_RULES, loading: true, error: null };
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
      const r = await fetch("/api/settings/rules", { headers: await authHeader() });
      const j = await r.json();
      if (!j.ok) {
        set({ loading: false, error: j.error ?? `The server said ${r.status}.` });
        return;
      }
      set({ rules: saneRules(j.rules), loading: false, error: j.problem ?? null });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
      inflight = null;
    }
  })();
  return inflight;
}

async function save(next: BusinessRules): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const r = await fetch("/api/settings/rules", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(await authHeader()) },
      body: JSON.stringify(next),
    });
    const j = await r.json();
    if (!j.ok) return { ok: false, error: j.error ?? `The server said ${r.status}.` };
    set({ rules: saneRules(j.rules), error: null });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export function useRules(): Held & { save: typeof save } {
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
