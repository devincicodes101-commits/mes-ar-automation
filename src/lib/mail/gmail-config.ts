/**
 * The Gmail credentials, checked before anything opens a socket.
 *
 * Split out from gmail.ts, which declares itself server-only because it holds
 * the transport. This half is arithmetic on two strings: it has no business
 * being unreachable from a test, and the thing it is guarding against is worth
 * testing, because the failure it prevents is somebody storing their actual
 * Google account password in an environment variable.
 */

export interface GmailConfig {
  user: string;
  appPassword: string;
  /** What a tenant sees in the From line. */
  fromName: string;
}

export function gmailConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GmailConfig | { error: string } {
  const user = (env.GMAIL_USER ?? "").trim();
  const appPassword = (env.GMAIL_APP_PASSWORD ?? "").replace(/\s+/g, "");

  if (!user) return { error: "GMAIL_USER is not set." };
  if (!appPassword) return { error: "GMAIL_APP_PASSWORD is not set." };

  /*
   * An App Password is sixteen characters. Google shows it in four blocks of
   * four and people paste it with the spaces, which is why they are stripped
   * above rather than rejected. A value of any other length is almost always
   * the account password, which would fail at Google with a message that does
   * not say so.
   */
  if (appPassword.length !== 16) {
    return {
      error:
        `GMAIL_APP_PASSWORD is ${appPassword.length} characters. An App Password ` +
        "is 16. This looks like the account password, which will not work and " +
        "should not be stored here.",
    };
  }

  return {
    user,
    appPassword,
    fromName: (env.MAIL_FROM_NAME ?? "MES Group Accounts").trim(),
  };
}
