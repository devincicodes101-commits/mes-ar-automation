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
import type { GmailConfig } from "./gmail-config.ts";

export { gmailConfigFromEnv, type GmailConfig } from "./gmail-config.ts";

/**
 * Gmail, over SMTP, with an App Password.
 *
 * The simplest thing that genuinely sends. An App Password is a sixteen
 * character credential Google issues for one application once two step
 * verification is on, and it is revocable on its own without touching the
 * account password. It is not the account password, and the account password
 * must never be put here.
 *
 * Why not OAuth: OAuth is the right answer for a mailbox MES own, because a
 * token can be granted by them and withdrawn by them without a shared secret
 * existing at all. It needs a Google Cloud project, a consent screen and a
 * refresh token, which is a day of setup to send the first letter. This gets
 * letters moving now, behind the same interface, so the day MES nominate a
 * mailbox the connector underneath changes and nothing above it does.
 *
 * ---------------------------------------------------------------------------
 * What this cannot do
 *
 * A consumer Gmail account sends about 500 messages a day and Workspace about
 * 2,000. A full run here is roughly 423 letters if every client had an
 * address, so a personal account is inside the limit for one run a day and
 * nothing more. Exceeding it does not bounce politely: Google locks sending
 * for around 24 hours, which on the 21st would mean the final notice going out
 * to some tenants and not others with no way to finish.
 *
 * It also sends as whoever owns the account. A tenant receiving a debt letter
 * from a personal address, rather than from MES, is a reasonable thing for
 * them to ignore or report. That is why the gate in connector.ts defaults to
 * refusing everybody, and why "everyone" should wait for MES's own mailbox.
 */

const HOST = "smtp.gmail.com";
const PORT = 465;

export function gmailConnector(config: GmailConfig): MailConnector {
  let transport: Transporter | null = null;

  const open = () => {
    transport ??= nodemailer.createTransport({
      host: HOST,
      port: PORT,
      secure: true,
      auth: { user: config.user, pass: config.appPassword },
    });
    return transport;
  };

  return {
    name: "gmail",

    async verify() {
      try {
        await open().verify();
        return { ok: true };
      } catch (e) {
        const message = (e as Error).message;
        /*
         * Google's own wording here is "Username and Password not accepted",
         * which sends people to reset the account password. It is almost
         * always the App Password, or two step verification not being on.
         */
        if (/invalid login|username and password not accepted|535/i.test(message)) {
          return {
            ok: false,
            error:
              "Google refused the sign in. Check that two step verification is " +
              "on for this account and that GMAIL_APP_PASSWORD is an App " +
              "Password rather than the account password.",
          };
        }
        return { ok: false, error: message };
      }
    },

    async send(letter: Letter): Promise<SendOutcome> {
      /*
       * Checked here, at the bottom, rather than trusted from the caller. Every
       * send passes through this function, so a caller added later cannot
       * forget the rails by not knowing about them.
       */
      const allowed = mayLeave(letter, {
        mode: modeFromEnv(),
        allowlist: allowlistFromEnv(),
      });

      if (!allowed.ok) {
        return { sent: false, reason: allowed.reason, blocked: true };
      }

      try {
        const info = await open().sendMail({
          from: `"${config.fromName}" <${config.user}>`,
          to: letter.to.join(", "),
          subject: letter.subject,
          text: letter.body,
          /* Only when there is one. nodemailer treats an empty array as no
             attachments, but an undefined filename inside one is an error at
             send time rather than a missing file, so the key is left off. */
          ...(letter.attachment
            ? {
                attachments: [
                  {
                    filename: letter.attachment.filename,
                    content: letter.attachment.content,
                  },
                ],
              }
            : {}),
        });
        return { sent: true, id: info.messageId, provider: "gmail" };
      } catch (e) {
        /*
         * Not blocked: this one was allowed to go and the attempt failed, which
         * is a different thing and wants a different response. Blocked means
         * stop and think; failed means it can be tried again.
         */
        return { sent: false, reason: (e as Error).message, blocked: false };
      }
    },
  };
}
