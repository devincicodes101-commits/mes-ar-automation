import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { gmailConfigFromEnv, gmailConnector } from "./gmail.ts";
import { gmailOAuthConnector } from "./gmail-oauth.ts";
import { clientFor } from "./google-oauth.ts";
import { note, withToken } from "./accounts.ts";
import {
  allowlistFromEnv,
  modeFromEnv,
  type Letter,
  type MailConnector,
  type SendOutcome,
} from "./connector.ts";

export type { Letter, MailConnector, SendOutcome } from "./connector.ts";
export { mayLeave, modeFromEnv, allowlistFromEnv } from "./connector.ts";

/**
 * Which mailbox is carrying letters, and on whose behalf.
 *
 * Two ways in, in order of preference:
 *
 *   a connected Google account   the officer signed in with Google and the
 *                                letter goes out as them, with replies coming
 *                                back to them
 *
 *   a shared App Password        one mailbox for everybody, from the
 *                                environment. The fallback, and what MES will
 *                                move to when they nominate an address
 *
 * The cron has nobody signed in, so it sends as whichever connected account
 * was nominated. That is why tokens are stored rather than sessions read: on
 * the 7th at 9am there is no session to read.
 */

export type Chosen =
  | { ok: true; connector: MailConnector; via: "connected" | "shared"; userId: string | null; from: string }
  | { ok: false; error: string };

/**
 * Picks a mailbox.
 *
 * `asUser` is the person doing it, where a person is doing it. Null means the
 * schedule, which takes the nominated account.
 */
export async function connector(
  db: SupabaseClient | null,
  asUser: string | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Chosen> {
  const google = await clientFor(db, env);

  if (db && !("error" in google)) {
    const found = await withToken(db, asUser);
    if (found.ok) {
      return {
        ok: true,
        via: "connected",
        userId: found.account.user_id,
        from: found.account.email,
        connector: gmailOAuthConnector(
          google,
          {
            email: found.account.email,
            displayName: found.account.display_name,
            refreshToken: found.account.refresh_token,
          },
          env.MAIL_FROM_NAME,
        ),
      };
    }
    /*
     * Nobody connected is not an error on its own: the shared mailbox below
     * may still be configured. Anything else is, and is passed through rather
     * than replaced by a vaguer message about the fallback.
     */
    if (!found.noneConnected) return { ok: false, error: found.error };
  }

  const shared = gmailConfigFromEnv(env);
  if ("error" in shared) {
    return {
      ok: false,
      error:
        "error" in google
          ? `No mailbox is available. ${google.error} ${shared.error}`.trim()
          : "No Google account is connected and no shared mailbox is configured. " +
            "Connect an account under Settings.",
    };
  }

  return {
    ok: true,
    via: "shared",
    userId: null,
    from: shared.user,
    connector: gmailConnector(shared),
  };
}

/**
 * What the system will and will not do right now, in words.
 *
 * Read by the settings screen, because a system that silently sends nothing
 * looks exactly like a system that is working, and "why did nobody get the
 * reminder" should be answerable by looking at a screen.
 */
export async function sendingStatus(
  db: SupabaseClient | null,
  asUser: string | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  mode: ReturnType<typeof modeFromEnv>;
  ready: boolean;
  via: "connected" | "shared" | null;
  from: string | null;
  allowlist: string[];
  googleReady: boolean;
  explanation: string;
  problem: string | null;
}> {
  const mode = modeFromEnv(env);
  const allowlist = allowlistFromEnv(env);
  const google = await clientFor(db, env);
  const chosen = await connector(db, asUser, env);

  const problem = chosen.ok ? null : chosen.error;

  const explanation = !chosen.ok
    ? `Nothing can be sent. ${chosen.error}`
    : mode === "off"
      ? "Nothing is sent. Letters are written and recorded, and no mail leaves."
      : mode === "allowed"
        ? allowlist.length === 0
          ? "Sending is limited to a test list and the list is empty, so nothing " +
            "can go out. Set MAIL_ALLOWLIST."
          : `Only these addresses can be written to: ${allowlist.join(", ")}.`
        : "Letters go to real tenants at the addresses on their account.";

  return {
    mode,
    ready: mode !== "off" && chosen.ok,
    via: chosen.ok ? chosen.via : null,
    from: chosen.ok ? chosen.from : null,
    allowlist,
    googleReady: !("error" in google),
    explanation,
    problem,
  };
}

/*
 * An intersection, not an interface extending SendOutcome. SendOutcome is a
 * union discriminated on `sent`, and an interface extending it collapses that,
 * so every caller loses the narrowing that tells sent from blocked.
 */
export type SendResult = SendOutcome & {
  /** The mailbox it actually left from, for the record. */
  from?: string;
};

/**
 * Sends one letter, as the right person, and remembers how it went.
 *
 * The outcome is written back onto the account so a connection that has been
 * revoked says so on screen rather than being discovered as a quiet morning
 * where the 7th sent nothing.
 */
export async function send(
  db: SupabaseClient | null,
  asUser: string | null,
  letter: Letter,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SendResult> {
  const chosen = await connector(db, asUser, env);
  if (!chosen.ok) {
    // Blocked rather than failed: nothing was attempted, and trying again
    // without changing the configuration would do the same thing.
    return { sent: false, reason: chosen.error, blocked: true };
  }

  const outcome = await chosen.connector.send(letter);

  if (db && chosen.userId) {
    // A blocked letter says nothing about the mailbox, so only a real attempt
    // is recorded against it.
    if (outcome.sent) await note(db, chosen.userId, null);
    else if (!outcome.blocked) await note(db, chosen.userId, outcome.reason);
  }

  return { ...outcome, from: chosen.from };
}
