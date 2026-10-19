import "server-only";

import crypto from "node:crypto";

import {
  allowlistFromEnv,
  mayLeave,
  modeFromEnv,
  type Letter,
  type MailConnector,
  type SendOutcome,
} from "./connector.ts";
import {
  graphMessage,
  MAX_ATTACHMENT_BYTES,
  plainGraphError,
  type MicrosoftConfig,
} from "./microsoft-config.ts";
import { refresh } from "./microsoft-oauth.ts";

/**
 * Sending as a person who connected their Outlook / Microsoft 365 account,
 * through Microsoft Graph.
 *
 * Behind the same MailConnector as Gmail, so the cron, the pacing and the
 * safety gate treat it identically. The gate is applied here, at the bottom,
 * as it is there, so a caller added later cannot forget it.
 *
 * The letter is saved to the mailbox's own Sent Items, which is useful in its
 * own right: the client can open Outlook and see exactly what went out.
 *
 * Microsoft 365 refuses more than 30 messages a minute from one mailbox; the
 * pacing in pacing.ts holds a run to 28.
 */

export interface MicrosoftConnection {
  email: string;
  displayName: string | null;
  refreshToken: string;
}

export function outlookGraphConnector(
  config: MicrosoftConfig,
  connection: MicrosoftConnection,
  /** Stores the new refresh token Microsoft hands back, so the chain does not lapse. */
  persist: (refreshToken: string) => Promise<void>,
): MailConnector {
  let access: { token: string; expiresAt: number } | null = null;
  let current = connection.refreshToken;

  const token = async (): Promise<{ ok: true; token: string } | { ok: false; error: string }> => {
    if (access && Date.now() < access.expiresAt) return { ok: true, token: access.token };

    const got = await refresh(config, current);
    if (!got.ok) return { ok: false, error: got.error };

    access = { token: got.accessToken, expiresAt: got.expiresAt };
    if (got.refreshToken !== current) {
      current = got.refreshToken;
      try {
        await persist(current);
      } catch {
        /* The send matters more than the bookkeeping; the old token still works for a while. */
      }
    }
    return { ok: true, token: access.token };
  };

  return {
    name: `outlook:${connection.email}`,

    async verify() {
      const t = await token();
      return t.ok ? { ok: true } : { ok: false, error: t.error };
    },

    async send(letter: Letter): Promise<SendOutcome> {
      const allowed = mayLeave(letter, {
        mode: modeFromEnv(),
        allowlist: allowlistFromEnv(),
      });
      if (!allowed.ok) {
        return { sent: false, reason: allowed.reason, blocked: true };
      }

      if (letter.attachment && letter.attachment.content.length > MAX_ATTACHMENT_BYTES) {
        return {
          sent: false,
          blocked: false,
          reason:
            `The attached workbook is ${(letter.attachment.content.length / 1_000_000).toFixed(1)} MB, ` +
            "which is more than Outlook sending can carry in one go (about 2.5 MB).",
        };
      }

      const t = await token();
      if (!t.ok) return { sent: false, reason: t.error, blocked: false };

      try {
        const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${t.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(graphMessage(letter)),
        });

        // 202 Accepted with no body is success. Graph returns no message id.
        if (res.status === 202) {
          return { sent: true, id: `graph-${crypto.randomUUID()}`, provider: `outlook:${connection.email}` };
        }

        const body = (await res.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string };
        };
        return {
          sent: false,
          blocked: false,
          reason: plainGraphError(res.status, body.error?.code, body.error?.message),
        };
      } catch (e) {
        return { sent: false, blocked: false, reason: `Could not reach Microsoft: ${(e as Error).message}` };
      }
    },
  };
}
