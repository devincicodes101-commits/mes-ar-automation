import "server-only";

/**
 * Connecting a Google account, so letters can be sent as the person who
 * connected it.
 *
 * Three things happen here and nowhere else: building the URL that sends
 * somebody to Google, swapping the code Google hands back for a refresh token,
 * and reading which address actually authorised.
 *
 * ---------------------------------------------------------------------------
 * Why the refresh token is kept rather than the session
 *
 * The obvious design is to send as whoever is signed in. It does not work
 * here, and the reason is the whole point of the schedule: on the 7th at 9am
 * nobody is signed in. A send that depends on a live session cannot happen on
 * a timer, which would leave the two days that send the most letters unable to
 * send any.
 *
 * So the token is stored, exactly one connected account is nominated as the
 * one the schedule uses, and the cron sends as that person whether or not they
 * are at their desk. Everything else about per-user sending still holds: each
 * officer connects their own account, replies come back to them, and revoking
 * is one click in their Google settings.
 *
 * ---------------------------------------------------------------------------
 * Scope
 *
 * https://mail.google.com/ is asked for because SMTP with XOAUTH2 requires it.
 * The narrower gmail.send scope works with the Gmail REST API but not with
 * SMTP, and SMTP is what the existing connector already speaks. Worth knowing
 * when the consent screen asks somebody to approve something broad sounding.
 */

/** SMTP with XOAUTH2 will not accept anything narrower. */
export const SCOPES = [
  "https://mail.google.com/",
  "openid",
  "email",
  "profile",
].join(" ");

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  /** Must match one of the redirect URIs on the Google Cloud credential. */
  redirectUri: string;
}

export function googleConfig(
  env: NodeJS.ProcessEnv = process.env,
): GoogleConfig | { error: string } {
  const clientId = (env.GOOGLE_CLIENT_ID ?? "").trim();
  const clientSecret = (env.GOOGLE_CLIENT_SECRET ?? "").trim();
  const base = (env.APP_URL ?? env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");

  if (!clientId || !clientSecret) {
    return {
      error:
        "Google sign in is not set up. Create an OAuth client in Google Cloud " +
        "and set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    };
  }
  if (!base) {
    return {
      error:
        "APP_URL is not set, so there is no address for Google to send people " +
        "back to. It must match the redirect URI on the Google credential exactly.",
    };
  }

  return { clientId, clientSecret, redirectUri: `${base}/api/mail/callback` };
}

/**
 * Where to send somebody to approve the connection.
 *
 * access_type=offline and prompt=consent together are what produce a refresh
 * token. Without them Google returns only a short lived access token on a
 * second connection, the stored row ends up with nothing durable in it, and
 * the failure appears weeks later as a scheduled send that stopped working.
 */
export function consentUrl(config: GoogleConfig, state: string): string {
  const q = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH}?${q.toString()}`;
}

export interface Connected {
  email: string;
  displayName: string | null;
  refreshToken: string;
  scope: string | null;
}

/** Swaps the code Google redirected back with for a lasting connection. */
export async function exchange(
  config: GoogleConfig,
  code: string,
): Promise<Connected | { error: string }> {
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const body = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!res.ok) {
    /*
     * redirect_uri_mismatch is by far the most common one and its own message
     * does not say what to compare against, so it is answered directly.
     */
    if (body.error === "redirect_uri_mismatch") {
      return {
        error:
          `Google refused because the redirect address does not match. This app ` +
          `sent "${config.redirectUri}". Add exactly that, character for ` +
          "character, to the Authorised redirect URIs on the OAuth client.",
      };
    }
    return { error: body.error_description ?? body.error ?? `Google returned ${res.status}.` };
  }

  if (!body.refresh_token) {
    /*
     * Google issues a refresh token on the first consent and then stops, unless
     * asked again with prompt=consent. If this is ever reached it means an
     * account that was connected before is reconnecting without being asked to
     * approve again, and storing the row without a token would produce a
     * connection that looks fine and cannot send.
     */
    return {
      error:
        "Google did not return a lasting token, which usually means this " +
        "account was connected before. Remove this app at " +
        "myaccount.google.com/permissions and connect again.",
    };
  }

  const who = await fetch(USERINFO, {
    headers: { Authorization: `Bearer ${body.access_token}` },
  });
  if (!who.ok) {
    return { error: "Connected, but Google would not say which account it was." };
  }
  const profile = (await who.json()) as { email?: string; name?: string };
  if (!profile.email) {
    return { error: "Connected, but the account has no email address on it." };
  }

  return {
    email: profile.email,
    displayName: profile.name ?? null,
    refreshToken: body.refresh_token,
    scope: body.scope ?? null,
  };
}

/**
 * Tells Google to forget the connection.
 *
 * Deleting our row alone would leave the app still listed in the person's
 * Google account, which reads as though it can still send. Best effort: a
 * failure here must not stop the row being removed, because the row is the
 * thing this system acts on.
 */
export async function revoke(refreshToken: string): Promise<void> {
  try {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
    });
  } catch {
    /* Revoking is a courtesy to the person; removing our row is the guarantee. */
  }
}
