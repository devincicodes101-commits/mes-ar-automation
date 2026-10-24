/**
 * The Microsoft side of "Connect Outlook", as plain functions.
 *
 * Split from microsoft-oauth.ts, which is server-only because it talks to
 * Microsoft with a secret. Everything here is string handling with no business
 * being unreachable from a test.
 *
 * ---------------------------------------------------------------------------
 * How this is meant to be run
 *
 * DeVinci registers ONE app with Microsoft and keeps its id and secret in the
 * environment. A client then presses Connect, signs in with their own mailbox
 * and approves. They never see or need an id or a secret, and DeVinci never
 * sees their password. It is the same arrangement as any "Sign in with
 * Microsoft" button on any website.
 *
 * Letters are sent with Microsoft Graph rather than SMTP. SMTP sign in has to
 * be switched on for each mailbox by an administrator, and Microsoft is turning
 * it off by default for existing organisations from the end of December 2026.
 * Graph does not depend on that setting.
 */

/*
 * Delegated permissions: send as the person who signed in, and nothing else.
 * offline_access is what produces a refresh token, without which the 9am run
 * could not send with nobody signed in.
 */
export const MICROSOFT_SCOPES = [
  "offline_access",
  "openid",
  "profile",
  "email",
  "User.Read",
  "Mail.Send",
].join(" ");

export interface MicrosoftConfig {
  clientId: string;
  clientSecret: string;
  /** "common" lets work, school and personal accounts sign in. */
  tenant: string;
  /** Must match a redirect URI on the app registration exactly. */
  redirectUri: string;
}

export function microsoftConfig(
  env: NodeJS.ProcessEnv = process.env,
): MicrosoftConfig | { error: string } {
  const base = (env.APP_URL ?? env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
  const clientId = (env.MICROSOFT_CLIENT_ID ?? "").trim();
  const clientSecret = (env.MICROSOFT_CLIENT_SECRET ?? "").trim();

  if (!clientId || !clientSecret) {
    return {
      error:
        "Microsoft sign in has not been set up for this system yet. The app has " +
        "to be registered with Microsoft once, and its id and secret put in the " +
        "environment as MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET. The " +
        `redirect address to register is ${base || "<the site address>"}/api/mail/microsoft/callback.`,
    };
  }
  if (!base) {
    return {
      error:
        "APP_URL is not set, so there is no address for Microsoft to send people " +
        "back to. It must match the redirect URI on the app registration exactly.",
    };
  }

  return {
    clientId,
    clientSecret,
    tenant: (env.MICROSOFT_TENANT ?? "").trim() || "common",
    redirectUri: `${base}/api/mail/microsoft/callback`,
  };
}

export const authorizeUrl = (tenant: string) =>
  `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`;
export const tokenUrl = (tenant: string) =>
  `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;

/**
 * Where to send somebody to approve the connection.
 *
 * prompt=select_account so somebody with several Microsoft accounts signed in
 * is asked which one, rather than the system quietly taking the first and
 * sending letters as the wrong mailbox.
 */
export function consentUrl(config: MicrosoftConfig, state: string): string {
  const q = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    response_mode: "query",
    scope: MICROSOFT_SCOPES,
    prompt: "select_account",
    state,
  });
  return `${authorizeUrl(config.tenant)}?${q.toString()}`;
}

/**
 * What Microsoft sends back when the person (or their IT) says no, put into
 * words that say what to do. Microsoft's own are codes like AADSTS65001.
 */
export function plainMicrosoftDenial(error: string, description: string | null): string {
  const text = `${error} ${description ?? ""}`;
  if (/AADSTS65001|AADSTS90094|AADSTS650056|admin.*(consent|approval)|need admin/i.test(text)) {
    return (
      "Your organisation needs an administrator to approve this app once before " +
      "anyone can connect. Ask your IT team to approve it, then connect again."
    );
  }
  if (/access_denied/i.test(error)) return "The connection was not approved.";
  return description ? description.split(/\r?\n/)[0] : error;
}

/** Microsoft's token errors, said plainly. */
export function plainMicrosoftError(code: string | undefined, description: string | undefined): string {
  const text = `${code ?? ""} ${description ?? ""}`;
  if (/AADSTS50011|redirect.*(uri|url).*(match|not)/i.test(text)) {
    return (
      "Microsoft refused because the redirect address does not match the one " +
      "registered on the app. Add exactly the address this system uses."
    );
  }
  if (/AADSTS7000215|invalid_client|AADSTS7000222/i.test(text)) {
    return (
      "Microsoft refused the app itself: the client secret is wrong or has " +
      "expired. Create a new secret on the app registration and update " +
      "MICROSOFT_CLIENT_SECRET."
    );
  }
  /* A personal Outlook account that sent a run of automated mail can be
     locked by Microsoft as suspected spam (seen 25 October). Only its owner
     can unlock it, by signing in and verifying; reconnecting alone will not. */
  if (/AADSTS70000|service abuse|abuse mode/i.test(text)) {
    return (
      "Microsoft has locked this account as suspected spam. Its owner must sign in at " +
      "outlook.com and verify the account to unlock it, then reconnect it here. A Microsoft 365 " +
      "work mailbox is far less likely to be locked than a personal one."
    );
  }
  if (/invalid_grant|AADSTS70008|AADSTS700082|AADSTS50173|AADSTS50076/i.test(text)) {
    return "Microsoft will no longer send as this account. Reconnect it under Settings.";
  }
  if (/AADSTS65001|AADSTS90094/i.test(text)) {
    return "An administrator in the organisation has to approve this app once before it can send.";
  }
  return description?.split(/\r?\n/)[0] ?? code ?? "Microsoft refused the request.";
}

/**
 * The same, for what Graph says when a send is refused.
 *
 * `status` is the HTTP status and `code` Graph's own error code.
 */
export function plainGraphError(status: number, code: string | undefined, message: string | undefined): string {
  if (status === 401) {
    return "Microsoft will no longer send as this account. Reconnect it under Settings.";
  }
  if (status === 429 || /throttl|ApplicationThrottled|MailboxConcurrency/i.test(code ?? "")) {
    return "Microsoft is limiting how fast this mailbox can send (30 a minute). It will go on the next run.";
  }
  if (/MailboxNotEnabledForRESTAPI|MailboxNotSupportedForRESTAPI|ResourceNotFound/i.test(code ?? "")) {
    return "This mailbox cannot send through Microsoft Graph. It may be a mailbox that is not hosted in Microsoft 365.";
  }
  if (status === 403 || /ErrorAccessDenied|Authorization_RequestDenied/i.test(code ?? "")) {
    return (
      "Microsoft refused to send from this account. A personal Outlook account can be blocked for " +
      "suspected spam (sign in at outlook.com to check), and a work account can be blocked by its " +
      "administrator."
    );
  }
  if (/ErrorQuotaExceeded|ErrorSendQuotaExceeded|SendAsDenied|MessageSubmissionBlocked/i.test(code ?? "")) {
    return "This mailbox has hit Microsoft's sending limit or been blocked from sending. " + (message ?? "");
  }
  return `${message ?? "Microsoft refused the message."}${code ? ` (${code})` : ""}`;
}

/** Graph's simple JSON send takes a request of about 4 MB; leave headroom. */
export const MAX_ATTACHMENT_BYTES = 2_500_000;

export interface GraphLetter {
  to: string[];
  subject: string;
  body: string;
  attachment?: { filename: string; content: Buffer };
}

/** The body of POST /me/sendMail. Plain text, saved to the mailbox's Sent Items. */
export function graphMessage(letter: GraphLetter) {
  return {
    message: {
      subject: letter.subject,
      body: { contentType: "Text", content: letter.body },
      toRecipients: letter.to.map((address) => ({ emailAddress: { address } })),
      ...(letter.attachment
        ? {
            attachments: [
              {
                "@odata.type": "#microsoft.graph.fileAttachment",
                name: letter.attachment.filename,
                contentBytes: letter.attachment.content.toString("base64"),
              },
            ],
          }
        : {}),
    },
    saveToSentItems: true,
  };
}
