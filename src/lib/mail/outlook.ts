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
import {
  outlookTransportOptions,
  plainOutlookError,
  type OutlookConfig,
} from "./outlook-config.ts";

export { outlookConfigFromEnv, type OutlookConfig } from "./outlook-config.ts";

/**
 * Outlook / Microsoft 365, over SMTP, with the mailbox's own sign in.
 *
 * The same shape as gmail.ts and behind the same MailConnector, so the cron,
 * the pacing and the safety gate treat it exactly as they treat Gmail. The
 * gate is checked again here at the bottom, as it is there, so a caller added
 * later cannot forget it.
 *
 * Microsoft 365 refuses more than 30 messages a minute from one mailbox. The
 * pacing in pacing.ts holds the run to 28.
 */
export function outlookConnector(config: OutlookConfig): MailConnector {
  let transport: Transporter | null = null;

  const open = () => {
    transport ??= nodemailer.createTransport(outlookTransportOptions(config));
    return transport;
  };

  return {
    name: "outlook",

    async verify() {
      try {
        await open().verify();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: plainOutlookError((e as Error).message) };
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
        const info = await open().sendMail({
          from: `"${config.fromName}" <${config.user}>`,
          to: letter.to.join(", "),
          subject: letter.subject,
          text: letter.body,
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
        return { sent: true, id: info.messageId, provider: "outlook" };
      } catch (e) {
        return { sent: false, reason: plainOutlookError((e as Error).message), blocked: false };
      }
    },
  };
}
