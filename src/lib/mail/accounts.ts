import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reading and writing the connected mailboxes.
 *
 * Kept apart from the OAuth dance and from the transport, so the one thing
 * that touches a stored refresh token is small enough to read in a sitting.
 *
 * Nothing here returns a token to a caller that does not need it. `listFor`
 * is what a screen sees and carries no token at all; `withToken` is what the
 * send path uses and is only ever called on the server.
 *
 * Since 25 October (0028) the mailboxes are one shared list, one row per
 * address, not one per login. One is active and sends every letter; the
 * others are there to switch to.
 */

export type MailProvider = "google" | "microsoft";

export interface MailAccountRow {
  id: string;
  connected_by: string | null;
  provider: MailProvider;
  email: string;
  display_name: string | null;
  refresh_token: string;
  scope: string | null;
  is_default: boolean;
  connected_at: string;
  last_used_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
}

/** What a screen is allowed to know: everything except the credential. */
export interface ConnectedAccount {
  id: string;
  provider: MailProvider;
  email: string;
  displayName: string | null;
  /** The active mailbox: every letter goes out from it. */
  isDefault: boolean;
  connectedAt: string;
  /** Whoever connected it, by name, where that login still exists. */
  connectedBy: string | null;
  lastUsedAt: string | null;
  lastError: string | null;
}

const SAFE = "id,connected_by,provider,email,display_name,is_default,connected_at,last_used_at,last_error";

const missingTable = (message: string) =>
  /does not exist|schema cache/i.test(message)
    ? "The mailbox list is not set up in this database yet (0015 and 0028)."
    : message;

/** Every connected mailbox, the active one first, for the settings screen. */
export async function listFor(
  db: SupabaseClient,
): Promise<{ ok: true; accounts: ConnectedAccount[] } | { ok: false; error: string }> {
  const { data, error } = await db
    .from("mail_accounts")
    .select(SAFE)
    .order("is_default", { ascending: false })
    .order("connected_at", { ascending: true });
  if (error) return { ok: false, error: missingTable(error.message) };

  const rows = (data ?? []) as unknown as Omit<MailAccountRow, "refresh_token" | "scope" | "last_error_at">[];
  const ids = Array.from(new Set(rows.map((r) => r.connected_by).filter((x): x is string => Boolean(x))));
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const p = await db.from("profiles").select("id,full_name").in("id", ids);
    for (const r of (p.data ?? []) as { id: string; full_name: string | null }[]) {
      if (r.full_name) names.set(r.id, r.full_name);
    }
  }

  return {
    ok: true,
    accounts: rows.map((r) => ({
      id: r.id,
      provider: r.provider === "microsoft" ? "microsoft" : "google",
      email: r.email,
      displayName: r.display_name ?? null,
      isDefault: Boolean(r.is_default),
      connectedAt: r.connected_at,
      connectedBy: r.connected_by ? names.get(r.connected_by) ?? null : null,
      lastUsedAt: r.last_used_at ?? null,
      lastError: r.last_error ?? null,
    })),
  };
}

/**
 * Stores a connection. Connecting an address already on the list refreshes
 * that mailbox rather than adding a second row for it.
 *
 * The first mailbox connected becomes the active one, because a system with a
 * mailbox and none active would refuse every letter for a reason nobody would
 * guess. Any other is added to the list, to be made active when wanted.
 */
export async function save(
  db: SupabaseClient,
  userId: string,
  c: {
    email: string;
    displayName: string | null;
    refreshToken: string;
    scope: string | null;
    provider?: MailProvider;
  },
): Promise<{ ok: true; isDefault: boolean } | { ok: false; error: string }> {
  const provider: MailProvider = c.provider ?? "google";
  const existing = await db.from("mail_accounts").select("id,provider,email,is_default");
  if (existing.error) return { ok: false, error: missingTable(existing.error.message) };

  const rows = (existing.data ?? []) as Pick<MailAccountRow, "id" | "provider" | "email" | "is_default">[];
  const same = rows.find((r) => r.provider === provider && r.email.toLowerCase() === c.email.toLowerCase());
  const isDefault = same ? same.is_default : !rows.some((r) => r.is_default);

  const fields = {
    connected_by: userId,
    provider,
    email: c.email,
    display_name: c.displayName,
    refresh_token: c.refreshToken,
    scope: c.scope,
    is_default: isDefault,
    connected_at: new Date().toISOString(),
    // A fresh connection clears whatever went wrong with the old one.
    last_error: null,
    last_error_at: null,
  };
  const { error } = same
    ? await db.from("mail_accounts").update(fields).eq("id", same.id)
    : await db.from("mail_accounts").insert(fields);
  if (error) return { ok: false, error: missingTable(error.message) };

  /* Who can send as MES is worth a line in the log nobody can edit. */
  const me = await db.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  await db.from("audit_log").insert({
    actor: userId,
    actor_name: (me.data?.full_name as string | null) ?? "a signed-in user",
    action: "mail.connect",
    subject: `${c.email} (${provider === "microsoft" ? "Outlook" : "Gmail"})${isDefault ? ", active" : ""}`,
    meta: { provider, refreshed: Boolean(same) },
  });
  return { ok: true, isDefault };
}

/** Keeps the newest refresh token, where the provider hands back a new one. */
export async function updateRefreshToken(
  db: SupabaseClient,
  accountId: string,
  refreshToken: string,
): Promise<void> {
  await db.from("mail_accounts").update({ refresh_token: refreshToken }).eq("id", accountId);
}

/**
 * Takes a mailbox off the list. Not the active one while there are others:
 * removing it would leave every letter with nothing to send from until
 * somebody noticed, so another is made active first.
 */
export async function disconnect(
  db: SupabaseClient,
  accountId: string,
): Promise<
  | { ok: true; token: string | null; provider: MailProvider; email: string }
  | { ok: false; error: string; status: number }
> {
  const all = await db.from("mail_accounts").select("id,is_default");
  if (all.error) return { ok: false, error: missingTable(all.error.message), status: 502 };
  const rows = (all.data ?? []) as { id: string; is_default: boolean }[];
  const target = rows.find((r) => r.id === accountId);
  if (!target) return { ok: false, error: "That mailbox is not on the list.", status: 404 };
  if (target.is_default && rows.length > 1) {
    return {
      ok: false,
      error: "This is the active mailbox. Make another one active first, then remove this one.",
      status: 409,
    };
  }

  // Read the token first so Google can be told to forget it too.
  const found = await db.from("mail_accounts").select("*").eq("id", accountId).maybeSingle();
  const { error } = await db.from("mail_accounts").delete().eq("id", accountId);
  if (error) return { ok: false, error: error.message, status: 502 };

  return {
    ok: true,
    token: (found.data?.refresh_token as string | null) ?? null,
    provider: found.data?.provider === "microsoft" ? "microsoft" : "google",
    email: (found.data?.email as string) ?? "",
  };
}

/** Makes one mailbox the active one, which every letter then goes out from. */
export async function makeDefault(
  db: SupabaseClient,
  accountId: string,
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const target = await db.from("mail_accounts").select("id,email").eq("id", accountId).maybeSingle();
  if (target.error) return { ok: false, error: target.error.message };
  if (!target.data) return { ok: false, error: "That mailbox is not on the list." };

  /*
   * Cleared first, then set. The unique index allows only one active mailbox,
   * so setting before clearing would collide with the row being replaced.
   */
  const cleared = await db.from("mail_accounts").update({ is_default: false }).eq("is_default", true);
  if (cleared.error) return { ok: false, error: cleared.error.message };

  const { error } = await db.from("mail_accounts").update({ is_default: true }).eq("id", accountId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, email: target.data.email as string };
}

/**
 * The mailbox a send goes out as, token included: always the active one.
 * Letters sent by hand used to go from the sender's own connected mailbox;
 * since 25 October every letter comes from the active mailbox, so replies
 * always reach the same inbox.
 */
export async function withToken(
  db: SupabaseClient,
): Promise<
  | { ok: true; account: MailAccountRow }
  | { ok: false; error: string; noneConnected: boolean }
> {
  const active = await db.from("mail_accounts").select("*").eq("is_default", true).maybeSingle();

  if (active.error) {
    const missing = /does not exist|schema cache/i.test(active.error.message);
    return { ok: false, noneConnected: missing, error: missingTable(active.error.message) };
  }
  if (!active.data) {
    const any = await db.from("mail_accounts").select("id", { count: "exact", head: true });
    return {
      ok: false,
      noneConnected: (any.count ?? 0) === 0,
      error:
        (any.count ?? 0) === 0
          ? "No mailbox is connected, so there is nothing to send from. Connect one under Settings."
          : "No mailbox is active. Make one active under Settings, Mailbox.",
    };
  }
  return { ok: true, account: active.data as MailAccountRow };
}

/** Records that a mailbox worked, or why it did not. */
export async function note(
  db: SupabaseClient,
  accountId: string,
  error: string | null,
): Promise<void> {
  await db
    .from("mail_accounts")
    .update(
      error
        ? { last_error: error, last_error_at: new Date().toISOString() }
        : { last_used_at: new Date().toISOString(), last_error: null, last_error_at: null },
    )
    .eq("id", accountId);
}
