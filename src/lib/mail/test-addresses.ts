import type { SupabaseClient } from "@supabase/supabase-js";

import { allowlistFromEnv } from "./connector.ts";

/**
 * The test list, kept on Settings, Mailbox (25 October).
 *
 * While MAIL_MODE is "allowed", only these addresses can receive a letter. It
 * was MAIL_ALLOWLIST alone, which only whoever runs the hosting could change,
 * and the status line printed the whole list on every letter screen. Now an
 * administrator keeps it on Settings, each change is in the Activity Log, and
 * it is a second check under the contact list: a real tenant's address that
 * finds its way into the report is held back, not sent.
 *
 * Until somebody saves one, MAIL_ALLOWLIST is the list. Once saved, the saved
 * list is used, even when it is empty, which then holds every letter back.
 */

const KEY = "mail_test_addresses";
const MAX = 100;
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export async function readTestAddresses(
  db: SupabaseClient,
): Promise<{ addresses: string[]; stored: boolean; problem: string | null }> {
  const r = await db.from("app_settings").select("value").eq("key", KEY).maybeSingle();
  if (r.error) return { addresses: allowlistFromEnv(), stored: false, problem: r.error.message };
  if (!r.data) return { addresses: allowlistFromEnv(), stored: false, problem: null };
  const value = (r.data as { value: { addresses?: unknown } }).value;
  const list = Array.isArray(value?.addresses) ? value.addresses.map(String) : [];
  return { addresses: clean(list), stored: true, problem: null };
}

/** Lower case, trimmed, no repeats, in the order given. */
function clean(list: readonly string[]): string[] {
  return Array.from(new Set(list.map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0)));
}

export async function writeTestAddresses(
  db: SupabaseClient,
  list: unknown,
  actor: { userId: string; name: string },
): Promise<{ ok: true; addresses: string[] } | { ok: false; error: string; status: number }> {
  if (!Array.isArray(list)) return { ok: false, error: "Send the addresses as a list.", status: 400 };
  const addresses = clean(list.map(String));
  const wrong = addresses.find((a) => !EMAIL.test(a));
  if (wrong) return { ok: false, error: `${wrong} is not an email address.`, status: 400 };
  if (addresses.length > MAX) return { ok: false, error: `At most ${MAX} test addresses.`, status: 400 };

  const before = await readTestAddresses(db);
  const w = await db
    .from("app_settings")
    .upsert(
      { key: KEY, value: { addresses }, updated_by: actor.userId, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (w.error) return { ok: false, error: w.error.message, status: 502 };

  /* Who may receive a letter while testing: recorded where nobody can edit it. */
  const added = addresses.filter((a) => !before.addresses.includes(a));
  const removed = before.addresses.filter((a) => !addresses.includes(a));
  await db.from("audit_log").insert({
    actor: actor.userId,
    actor_name: actor.name,
    action: "settings.test_addresses",
    subject:
      [added.length ? `added ${added.join(", ")}` : "", removed.length ? `removed ${removed.join(", ")}` : ""]
        .filter(Boolean)
        .join("; ") || `${addresses.length} test addresses`,
    meta: { addresses, added, removed },
  });
  return { ok: true, addresses };
}
