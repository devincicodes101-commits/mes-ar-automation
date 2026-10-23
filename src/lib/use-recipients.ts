"use client";

import { useEffect, useState } from "react";

import { authHeader } from "./use-letter-edits.ts";
import { DEFAULT_RECIPIENTS, recipientsWithManagers, type Recipient } from "./dispatch.ts";

/**
 * The report recipients, as everybody sees them.
 *
 * Read from the server once and shared by every screen, like the reminder
 * window. The names come from MES's own roles and the managers in the report;
 * only the addresses are stored.
 */

interface Held {
  emails: Record<string, string>;
  loading: boolean;
  error: string | null;
}

let held: Held = { emails: {}, loading: true, error: null };
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
      const r = await fetch("/api/settings/recipients", { headers: await authHeader() });
      const j = (await r.json()) as { ok?: boolean; emails?: Record<string, string>; error?: string };
      if (!j.ok) set({ loading: false, error: j.error ?? `The server said ${r.status}.` });
      else set({ loading: false, error: null, emails: j.emails ?? {} });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
      inflight = null;
    }
  })();
  return inflight;
}

async function save(emails: Record<string, string>): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const r = await fetch("/api/settings/recipients", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(await authHeader()) },
      body: JSON.stringify({ emails }),
    });
    const j = (await r.json()) as { ok?: boolean; emails?: Record<string, string>; error?: string };
    if (!j.ok) return { ok: false, error: j.error ?? `The server said ${r.status}.` };
    set({ emails: j.emails ?? emails });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** The recipients for the managers named in the report, with their stored addresses. */
export function useRecipients(managerKeys: readonly (string | null | undefined)[]) {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    void load();
    return () => {
      listeners.delete(l);
    };
  }, []);
  const stored: Recipient[] = [
    ...DEFAULT_RECIPIENTS,
    ...Object.keys(held.emails)
      .filter((id) => id.startsWith("rm-"))
      .map((id) => ({ id, name: id.slice(3), kind: "rm" as const, email: null })),
  ].map((r) => ({ ...r, email: held.emails[r.id] ?? null }));
  const recipients = recipientsWithManagers(stored, managerKeys);
  return {
    recipients,
    loading: held.loading,
    error: held.error,
    /** Saves one recipient's address (null clears it), keeping the others. */
    setEmail: async (id: string, email: string | null) => {
      const next = { ...held.emails };
      if (email) next[id] = email;
      else delete next[id];
      return save(next);
    },
  };
}
