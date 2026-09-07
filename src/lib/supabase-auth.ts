"use client";

import { supabase, isSupabaseConfigured } from "./supabase.ts";
import type { Role, Session, User } from "./auth.ts";
import { SEED_USERS, newSession, signIn as localSignIn } from "./auth.ts";

/**
 * Signing in against Supabase, with the local gate as a fallback.
 *
 * Two modes, and the screens cannot tell them apart:
 *
 *   Supabase configured   the database authenticates, the role comes from
 *                         the `profiles` row, and row level security decides
 *                         what any query returns. This is the real one.
 *
 *   not configured        the browser-only gate in auth.ts. Useful for a
 *                         demo on a laptop with no network, and honest about
 *                         being a demonstration rather than security.
 *
 * The fallback exists so the prototype still runs for somebody who clones the
 * repository without credentials. It is not a way to bypass the real one: if
 * the environment names a Supabase project, that project is the only
 * authority, and a failure to reach it is a failed sign in rather than a
 * quiet drop back to the local list.
 */

export const usingSupabase = isSupabaseConfigured;

/** The database enum is snake_case; the application type is not. */
const ROLE_FROM_DB: Record<string, Role> = {
  super_admin: "super-admin",
  admin: "admin",
  csd: "CSD",
  rm: "RM",
  management: "Management",
};

export const ROLE_TO_DB: Record<Role, string> = {
  "super-admin": "super_admin",
  admin: "admin",
  CSD: "csd",
  RM: "rm",
  Management: "management",
};

export interface Profile {
  id: string;
  full_name: string;
  role: Role;
  rm_key: string | null;
}

/**
 * The signed-in person's profile.
 *
 * A user in `auth.users` with no matching `profiles` row can authenticate but
 * has no role, so they are refused rather than defaulted. Defaulting would
 * mean a half-provisioned account silently receiving whatever the default
 * happened to be.
 */
async function loadProfile(userId: string): Promise<Profile | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, rm_key")
    .eq("id", userId)
    .single();

  if (error || !data) return null;
  const role = ROLE_FROM_DB[String(data.role)];
  if (!role) return null;
  return {
    id: data.id as string,
    full_name: (data.full_name as string) ?? "",
    role,
    rm_key: (data.rm_key as string | null) ?? null,
  };
}

function sessionFrom(profile: Profile, email: string, expiresAt: number | null): Session {
  return {
    userId: profile.id,
    username: email,
    name: profile.full_name || email,
    role: profile.role,
    rmKey: profile.rm_key ?? undefined,
    startedAt: new Date().toISOString(),
    // Supabase manages its own token lifetime and refresh. Mirroring its
    // expiry keeps one clock rather than two that can disagree.
    expiresAt: expiresAt
      ? new Date(expiresAt * 1000).toISOString()
      : new Date(Date.now() + 8 * 3600_000).toISOString(),
  };
}

export type Outcome = { ok: true; session: Session } | { ok: false; reason: string };

/** What a failed sign in is safe to say out loud. */
export const CREDENTIALS_REFUSED = "That username and password do not match.";

/**
 * Turns a Supabase error into something worth reading.
 *
 * The ambiguity in `CREDENTIALS_REFUSED` is deliberate and applies to exactly
 * one case: the credentials were wrong. A wrong password and an account that
 * does not exist must be indistinguishable, or the form becomes a way to test
 * which addresses are real.
 *
 * Everything else is a fault in the setup, not a guess by an attacker, and
 * saying so is the difference between fixing it and hunting for a password
 * that was never wrong. This function exists because the first version
 * reported a disabled email provider as a bad password, and cost an hour.
 */
export function explain(
  error: { code?: string; message?: string; status?: number } | null,
): string {
  const code = error?.code ?? "";
  const msg = error?.message ?? "";
  const status = error?.status ?? 0;

  if (code === "email_provider_disabled" || /provider.*disabled|logins are disabled/i.test(msg)) {
    return (
      "Email sign-in is switched off for this project. Turn on " +
      "Authentication → Sign In / Providers → Email in Supabase."
    );
  }
  if (code === "email_not_confirmed") {
    return "That account exists but its email has never been confirmed.";
  }
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit") {
    return "Too many attempts. Wait a minute and try again.";
  }
  if (code === "signup_disabled") {
    return "New accounts are disabled for this project.";
  }
  if (/fetch|network|Failed to fetch/i.test(msg)) {
    return "Could not reach the database. Check the connection and try again.";
  }

  /*
    A server fault is never a wrong password.

    The first version of this returned the credential message for anything it
    did not recognise, on a fail-closed instinct. That instinct is wrong here.
    Failing closed protects a secret; there is no secret in "the server broke",
    and reporting it as a bad password sends somebody to retype a password that
    was always correct. It cost an hour twice: once on a disabled provider, and
    again on seeded rows GoTrue could not read.

    The message still says nothing about whether the account exists, so no
    enumeration is possible. It only says the fault is not yours.
  */
  if (status >= 500 || code === "unexpected_failure") {
    return (
      "The database refused the request, so this is not a password problem. " +
      "Check the Supabase logs — a seeded account with null token columns " +
      "reports exactly this."
    );
  }

  // invalid_credentials, invalid_grant, and anything else at 4xx.
  return CREDENTIALS_REFUSED;
}

export async function signIn(email: string, password: string): Promise<Outcome> {
  if (!supabase) {
    const local = await localSignIn(email, password, SEED_USERS);
    if (!local.ok) return { ok: false, reason: local.reason };
    return { ok: true, session: newSession(local.user) };
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error || !data.user) {
    return { ok: false, reason: explain(error) };
  }

  const profile = await loadProfile(data.user.id);
  if (!profile) {
    await supabase.auth.signOut();
    return {
      ok: false,
      reason:
        "That account has no role assigned yet. Ask a super admin to finish setting it up.",
    };
  }

  return {
    ok: true,
    session: sessionFrom(profile, data.user.email ?? email, data.session?.expires_at ?? null),
  };
}

/** Restores a session on page load, or null if there is not a live one. */
export async function restore(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) return null;
  const profile = await loadProfile(user.id);
  if (!profile) return null;
  return sessionFrom(profile, user.email ?? "", data.session?.expires_at ?? null);
}

export async function signOut(): Promise<void> {
  if (supabase) await supabase.auth.signOut();
}

/**
 * Everyone who can sign in, for the user management screen.
 *
 * Returns an empty list rather than throwing when the caller is not entitled
 * to read it: row level security answers that question, and an empty table is
 * the correct rendering of "you may not see this".
 */
export async function listProfiles(): Promise<Profile[]> {
  if (!supabase) {
    return SEED_USERS.map((u: User) => ({
      id: u.id,
      full_name: u.name,
      role: u.role,
      rm_key: u.rmKey ?? null,
    }));
  }
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, rm_key")
    .order("full_name");
  if (error || !data) return [];
  return data
    .map((d) => ({
      id: d.id as string,
      full_name: (d.full_name as string) ?? "",
      role: ROLE_FROM_DB[String(d.role)],
      rm_key: (d.rm_key as string | null) ?? null,
    }))
    .filter((p): p is Profile => Boolean(p.role));
}
