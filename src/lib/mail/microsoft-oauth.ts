import "server-only";

import {
  plainMicrosoftError,
  tokenUrl,
  MICROSOFT_SCOPES,
  type MicrosoftConfig,
} from "./microsoft-config.ts";

export { microsoftConfig, consentUrl } from "./microsoft-config.ts";

/**
 * Connecting a Microsoft account: swapping the code Microsoft hands back for a
 * refresh token, reading which mailbox signed in, and getting a fresh access
 * token each time one is needed.
 *
 * The refresh token is kept, not the session, for the reason the Google side
 * keeps it (see google-oauth.ts): at 9am nobody is signed in.
 */

export interface MicrosoftConnected {
  email: string;
  displayName: string | null;
  refreshToken: string;
  scope: string | null;
}

interface TokenBody {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(
  config: MicrosoftConfig,
  params: Record<string, string>,
): Promise<{ ok: true; body: TokenBody } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(tokenUrl(config.tenant), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        ...params,
      }),
    });
  } catch (e) {
    return { ok: false, error: `Could not reach Microsoft: ${(e as Error).message}` };
  }

  const body = (await res.json().catch(() => ({}))) as TokenBody;
  if (!res.ok) {
    return { ok: false, error: plainMicrosoftError(body.error, body.error_description) };
  }
  return { ok: true, body };
}

/** Swaps the code Microsoft redirected back with for a lasting connection. */
export async function exchange(
  config: MicrosoftConfig,
  code: string,
): Promise<MicrosoftConnected | { error: string }> {
  const got = await tokenRequest(config, {
    grant_type: "authorization_code",
    code,
    scope: MICROSOFT_SCOPES,
  });
  if (!got.ok) return { error: got.error };

  const { access_token, refresh_token, scope } = got.body;
  if (!refresh_token) {
    return {
      error:
        "Microsoft did not return a lasting token, so the 9am run would not be " +
        "able to send. Connect again.",
    };
  }

  const who = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName", {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!who.ok) return { error: "Connected, but Microsoft would not say which account it was." };

  const me = (await who.json()) as { mail?: string | null; userPrincipalName?: string; displayName?: string };
  /*
   * `mail` is the sending address; userPrincipalName is the sign in name and
   * can differ from it. Letters must come from the real address.
   */
  const email = (me.mail || me.userPrincipalName || "").trim();
  if (!email) return { error: "Connected, but the account has no email address on it." };

  return {
    email,
    displayName: me.displayName ?? null,
    refreshToken: refresh_token,
    scope: scope ?? null,
  };
}

/**
 * A fresh access token from the stored refresh token.
 *
 * Microsoft may hand back a NEW refresh token each time and the old one stops
 * being the one to keep, so the new one is returned for the caller to store.
 */
export async function refresh(
  config: MicrosoftConfig,
  refreshToken: string,
): Promise<
  | { ok: true; accessToken: string; expiresAt: number; refreshToken: string }
  | { ok: false; error: string }
> {
  const got = await tokenRequest(config, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: MICROSOFT_SCOPES,
  });
  if (!got.ok) return { ok: false, error: got.error };

  const { access_token, refresh_token, expires_in } = got.body;
  if (!access_token) return { ok: false, error: "Microsoft returned no access token." };

  return {
    ok: true,
    accessToken: access_token,
    // A minute early, so a token is never used in the second it dies.
    expiresAt: Date.now() + Math.max(60, (expires_in ?? 3600) - 60) * 1000,
    refreshToken: refresh_token ?? refreshToken,
  };
}
