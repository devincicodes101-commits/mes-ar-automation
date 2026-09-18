import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reading and writing the connected Google accounts.
 *
 * Kept apart from the OAuth dance and from the transport, so the one thing
 * that touches a stored refresh token is small enough to read in a sitting.
 *
 * Nothing here returns a token to a caller that does not need it. `listFor`
 * is what a screen sees and carries no token at all; `withToken` is what the
 * send path uses and is only ever called on the server.
 */

export interface MailAccountRow {
  user_id: string;
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
  userId: string;
  email: string;
  displayName: string | null;
  isDefault: boolean;
  connectedAt: string;
  lastUsedAt: string | null;
  lastError: string | null;
  isMine: boolean;
}

const SAFE = "user_id,email,display_name,is_default,connected_at,last_used_at,last_error";

/**
 * Every connected account, for the settings screen.
 *
 * All of them, not only the caller's. Which mailbox MES letters leave from is
 * not private between colleagues: an officer needs to know that the schedule
 * sends as somebody in particular, especially when that person is away and
 * their connection has lapsed.
 */
export async function listFor(
  db: SupabaseClient,
  me: string,
): Promise<{ ok: true; accounts: ConnectedAccount[] } | { ok: false; error: string }> {
  const { data, error } = await db
    .from("mail_accounts")
    .select(SAFE)
    .order("is_default", { ascending: false })
    .order("connected_at", { ascending: true });

  if (error) {
    const missing = /relation .*mail_accounts.* does not exist|schema cache/i.test(error.message);
    return {
      ok: false,
      error: missing
        ? "This database does not have 0015_mail_accounts.sql applied yet."
        : error.message,
    };
  }

  return {
    ok: true,
    accounts: (data ?? []).map((r) => ({
      userId: r.user_id as string,
      email: r.email as string,
      displayName: (r.display_name as string | null) ?? null,
      isDefault: Boolean(r.is_default),
      connectedAt: r.connected_at as string,
      lastUsedAt: (r.last_used_at as string | null) ?? null,
      lastError: (r.last_error as string | null) ?? null,
      isMine: r.user_id === me,
    })),
  };
}

/**
 * Stores a connection, replacing any the same person already had.
 *
 * The first account to connect becomes the one the schedule uses, because a
 * system with a connected mailbox and no nominated sender would refuse the
 * 7th's letters for a reason nobody would guess. It can be changed afterwards.
 */
export async function save(
  db: SupabaseClient,
  userId: string,
  c: { email: string; displayName: string | null; refreshToken: string; scope: string | null },
): Promise<{ ok: true; isDefault: boolean } | { ok: false; error: string }> {
  const existing = await db.from("mail_accounts").select("user_id,is_default");
  if (existing.error) {
    const missing = /does not exist|schema cache/i.test(existing.error.message);
    return {
      ok: false,
      error: missing
        ? "This database does not have 0015_mail_accounts.sql applied yet."
        : existing.error.message,
    };
  }

  const rows = existing.data ?? [];
  const wasDefault = rows.find((r) => r.user_id === userId)?.is_default === true;
  const anyDefault = rows.some((r) => r.is_default);
  const isDefault = wasDefault || !anyDefault;

  const { error } = await db.from("mail_accounts").upsert(
    {
      user_id: userId,
      email: c.email,
      display_name: c.displayName,
      refresh_token: c.refreshToken,
      scope: c.scope,
      is_default: isDefault,
      connected_at: new Date().toISOString(),
      // A fresh connection clears whatever went wrong with the old one.
      last_error: null,
      last_error_at: null,
    },
    { onConflict: "user_id" },
  );

  if (error) return { ok: false, error: error.message };
  return { ok: true, isDefault };
}

export async function disconnect(
  db: SupabaseClient,
  userId: string,
): Promise<{ ok: true; token: string | null } | { ok: false; error: string }> {
  // Read the token first so Google can be told to forget it too. Deleting our
  // row alone would leave the app still listed in their Google account.
  const found = await db
    .from("mail_accounts")
    .select("refresh_token")
    .eq("user_id", userId)
    .maybeSingle();

  const { error } = await db.from("mail_accounts").delete().eq("user_id", userId);
  if (error) return { ok: false, error: error.message };

  return { ok: true, token: (found.data?.refresh_token as string | null) ?? null };
}

/** Nominates which connected account the schedule sends from. */
export async function makeDefault(
  db: SupabaseClient,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  /*
   * Cleared first, then set. The unique index allows only one default, so
   * setting before clearing would collide with the row being replaced.
   */
  const cleared = await db
    .from("mail_accounts")
    .update({ is_default: false })
    .eq("is_default", true);
  if (cleared.error) return { ok: false, error: cleared.error.message };

  const { error } = await db
    .from("mail_accounts")
    .update({ is_default: true })
    .eq("user_id", userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * The account a send should go out as, token included.
 *
 * `preferred` is the person doing it, where a person is doing it. The cron has
 * nobody, so it falls back to whichever account was nominated, which is the
 * whole reason tokens are stored rather than sessions read.
 */
export async function withToken(
  db: SupabaseClient,
  preferred: string | null,
): Promise<
  | { ok: true; account: MailAccountRow }
  | { ok: false; error: string; noneConnected: boolean }
> {
  if (preferred) {
    const mine = await db
      .from("mail_accounts")
      .select("*")
      .eq("user_id", preferred)
      .maybeSingle();
    if (mine.data) return { ok: true, account: mine.data as MailAccountRow };
  }

  const fallback = await db
    .from("mail_accounts")
    .select("*")
    .eq("is_default", true)
    .maybeSingle();

  if (fallback.error) {
    const missing = /does not exist|schema cache/i.test(fallback.error.message);
    return {
      ok: false,
      noneConnected: missing,
      error: missing
        ? "This database does not have 0015_mail_accounts.sql applied yet."
        : fallback.error.message,
    };
  }

  if (!fallback.data) {
    return {
      ok: false,
      noneConnected: true,
      error:
        "No Google account is connected, so there is no mailbox to send from. " +
        "Connect one under Settings.",
    };
  }

  return { ok: true, account: fallback.data as MailAccountRow };
}

/** Records that an account worked, or why it did not. */
export async function note(
  db: SupabaseClient,
  userId: string,
  error: string | null,
): Promise<void> {
  await db
    .from("mail_accounts")
    .update(
      error
        ? { last_error: error, last_error_at: new Date().toISOString() }
        : { last_used_at: new Date().toISOString(), last_error: null, last_error_at: null },
    )
    .eq("user_id", userId);
}
