/**
 * The Outlook credentials, checked before anything opens a socket.
 *
 * Split out from outlook.ts for the same reason gmail-config.ts is: this half
 * is plain string handling with no business being unreachable from a test.
 *
 * Outlook here means SMTP with a mailbox and its password, the way a mail app
 * is set up. It needs no client ID or secret. What it does need is for the
 * mailbox's own admin to have "Authenticated SMTP" switched on, and for the
 * account not to insist on a phone approval at sign in. Microsoft plans to
 * turn it off by default for existing Microsoft 365 organisations from the end
 * of December 2026, which is why this sits behind the same connector interface
 * as everything else: the OAuth version replaces it without anything above
 * noticing.
 */

export interface OutlookConfig {
  user: string;
  password: string;
  host: string;
  /** What a tenant sees in the From line. */
  fromName: string;
}

/** Personal Outlook.com / Hotmail / Live addresses use a different server. */
const PERSONAL = /@(outlook|hotmail|live|msn)\.[a-z.]+$/i;

export function outlookHostFor(user: string): string {
  return PERSONAL.test(user) ? "smtp-mail.outlook.com" : "smtp.office365.com";
}

export function outlookConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): OutlookConfig | { error: string } {
  const user = (env.OUTLOOK_USER ?? "").trim();
  const password = env.OUTLOOK_PASSWORD ?? "";

  if (!user) return { error: "OUTLOOK_USER is not set." };
  if (!password) return { error: "OUTLOOK_PASSWORD is not set." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(user)) {
    return { error: "OUTLOOK_USER must be the full email address of the mailbox." };
  }

  return {
    user,
    password,
    host: (env.OUTLOOK_HOST ?? "").trim() || outlookHostFor(user),
    fromName: (env.MAIL_FROM_NAME ?? "MES Group Accounts").trim(),
  };
}

/** Port 587 with STARTTLS is the one Microsoft supports for SMTP AUTH. */
export function outlookTransportOptions(c: OutlookConfig) {
  return {
    host: c.host,
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: c.user, pass: c.password },
  };
}

/**
 * Microsoft's refusals are terse and the same wording covers several causes,
 * so each is translated into what to check.
 */
export function plainOutlookError(message: string): string {
  if (/5\.7\.139|SmtpClientAuthentication is disabled|basic authentication is disabled/i.test(message)) {
    return (
      "Microsoft says SMTP sign in is switched off for this mailbox. An admin " +
      "has to turn on Authenticated SMTP for it (Microsoft 365 admin centre > " +
      "Users > the mailbox > Mail > Manage email apps)."
    );
  }
  if (/5\.7\.57|5\.7\.30/i.test(message)) {
    return (
      "Microsoft refused to sign in with a password. Authenticated SMTP is " +
      "switched off for this mailbox or organisation."
    );
  }
  if (/535|invalid login|authentication unsuccessful|AUTH/i.test(message)) {
    return (
      "Microsoft refused the sign in. Check the email address and password. If " +
      "the account asks for a phone approval or code when signing in, a plain " +
      "password will not work and an app password is needed."
    );
  }
  return message;
}
