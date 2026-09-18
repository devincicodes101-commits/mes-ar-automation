import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

import {
  allowlistFromEnv,
  mayLeave,
  modeFromEnv,
  type Letter,
  type MailConnector,
  type SendOutcome,
} from "./connector.ts";
import type { GoogleConfig } from "./google-oauth.ts";

/**
 * Sending as a person who connected their Google account.
 *
 * The same SMTP transport the App Password connector uses, with XOAUTH2 in
 * place of a password. Nodemailer takes the refresh token and gets itself a
 * fresh access token when it needs one, which is the reason for using SMTP
 * here rather than the Gmail REST API: there is no token lifecycle to write.
 *
 * Every refusal still runs. The gate lives in connector.ts and is applied
 * here, at the bottom, so a provider added later cannot forget it by not
 * knowing about it.
 */

export interface Connection {
  email: string;
  displayName: string | null;
  refreshToken: string;
}

export function gmailOAuthConnector(
  google: GoogleConfig,
  connection: Connection,
  fromName?: string,
): MailConnector {
  let transport: Transporter | null = null;

  const open = () => {
    transport ??= nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        type: "OAuth2",
        user: connection.email,
        clientId: google.clientId,
        clientSecret: google.clientSecret,
        refreshToken: connection.refreshToken,
      },
    });
    return transport;
  };

  /*
   * Google's own wording for a revoked or expired grant is "invalid_grant",
   * which tells somebody nothing about what to do. It is worth translating,
   * because the action is specific and nothing else will prompt it: the person
   * has to reconnect, and until they do, the scheduled sends they were
   * nominated for will not go.
   */
  const explain = (message: string): string => {
    if (/invalid_grant|Token has been expired or revoked/i.test(message)) {
      return (
        `Google will no longer send as ${connection.email}. The connection was ` +
        "revoked or has expired. Reconnect the account under Settings."
      );
    }
    if (/invalid_client|unauthorized_client/i.test(message)) {
      return (
        "Google refused the app itself rather than the account. Check " +
        "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET."
      );
    }
    if (/Daily user sending (limit|quota) exceeded|4\.7\.0/i.test(message)) {
      return (
        `${connection.email} has hit Google's daily sending limit. It resets ` +
        "after about 24 hours. Letters already sent went; the rest did not."
      );
    }
    return message;
  };

  return {
    name: `gmail:${connection.email}`,

    async verify() {
      try {
        await open().verify();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: explain((e as Error).message) };
      }
    },

    async send(letter: Letter): Promise<SendOutcome> {
      const allowed = mayLeave(letter, {
        mode: modeFromEnv(),
        allowlist: allowlistFromEnv(),
      });
      if (!allowed.ok) {
        return { sent: false, reason: allowed.reason, blocked: true };
      }

      try {
        const name = fromName?.trim() || connection.displayName || connection.email;
        const info = await open().sendMail({
          from: `"${name}" <${connection.email}>`,
          to: letter.to.join(", "),
          subject: letter.subject,
          text: letter.body,
          /*
           * Replies go back to the person who sent it, which is the point of
           * connecting individual accounts. Stated rather than left implicit,
           * because a tenant replying to a debt letter is the most useful
           * thing that can happen and it must not land nowhere.
           */
          replyTo: connection.email,
        });
        return { sent: true, id: info.messageId, provider: `gmail:${connection.email}` };
      } catch (e) {
        // Not blocked: this was allowed to go and the attempt failed. Blocked
        // means stop and think, failed means it can be tried again.
        return { sent: false, reason: explain((e as Error).message), blocked: false };
      }
    },
  };
}
