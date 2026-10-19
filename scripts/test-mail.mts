/**
 * What stands between a typo and a Singapore company getting a debt letter.
 *
 *   npm run test:mail
 *
 * Nothing here sends anything or opens a socket. It tests the gate, which is
 * the only code in the system whose failure reaches people outside MES and
 * cannot be taken back.
 *
 * The rule the whole file is checking: every way of getting this wrong should
 * end in nothing being sent. A missing setting, a misspelled setting, an empty
 * list, a letter that did not merge. All of those should refuse, and none of
 * them should quietly let a letter through.
 */
import { allowlistFromEnv, mayLeave, modeFromEnv, type Letter } from "../src/lib/mail/connector.ts";
import { gmailConfigFromEnv } from "../src/lib/mail/gmail-config.ts";
import {
  outlookConfigFromEnv,
  outlookHostFor,
  outlookTransportOptions,
  plainOutlookError,
} from "../src/lib/mail/outlook-config.ts";
import {
  consentUrl as msConsentUrl,
  graphMessage,
  MAX_ATTACHMENT_BYTES,
  microsoftConfig,
  MICROSOFT_SCOPES,
  plainGraphError,
  plainMicrosoftDenial,
  plainMicrosoftError,
} from "../src/lib/mail/microsoft-config.ts";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${name.slice(0, 64).padEnd(64)} ` +
      (ok ? "" : `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`),
  );
}

const letter = (over: Partial<Letter> = {}): Letter => ({
  to: ["someone@example.com"],
  subject: "Outstanding balance, ACME PTE LTD",
  body: "Dear ACME PTE LTD,\n\nOur records show 1,234.00 outstanding.",
  tenantId: "acme-bsd",
  companyName: "ACME PTE LTD",
  ...over,
});

const passes = (l: Letter, mode: string, list: string[]) =>
  mayLeave(l, { mode: mode as never, allowlist: list }).ok;

/* ------------------------------------------------------ the default ----- */

console.log("\nOff is the default, and a typo is off\n");

check("nothing set means off", modeFromEnv({} as NodeJS.ProcessEnv), "off");
check("an empty value is off", modeFromEnv({ MAIL_MODE: "" } as NodeJS.ProcessEnv), "off");

/*
 * The one that matters. A misspelled mode that failed open would send real
 * letters to real companies because somebody typed one character wrong.
 */
check("a misspelling is off, not everyone",
      modeFromEnv({ MAIL_MODE: "eveyone" } as NodeJS.ProcessEnv), "off");
check("and so is something plausible but wrong",
      modeFromEnv({ MAIL_MODE: "true" } as NodeJS.ProcessEnv), "off");
check("and so is on", modeFromEnv({ MAIL_MODE: "on" } as NodeJS.ProcessEnv), "off");

check("allowed is read", modeFromEnv({ MAIL_MODE: "allowed" } as NodeJS.ProcessEnv), "allowed");
check("everyone is read", modeFromEnv({ MAIL_MODE: "everyone" } as NodeJS.ProcessEnv), "everyone");
check("and case does not matter",
      modeFromEnv({ MAIL_MODE: " EVERYONE " } as NodeJS.ProcessEnv), "everyone");

check("nothing off means nothing leaves", passes(letter(), "off", []), false);

/* --------------------------------------------------------- the list ----- */

console.log("\nWhile testing, only the test list can be written to\n");

check("an address on the list goes", passes(letter(), "allowed", ["someone@example.com"]), true);
check("one that is not does not",
      passes(letter({ to: ["tenant@realcompany.com.sg"] }), "allowed", ["someone@example.com"]),
      false);

/*
 * The partial case. A letter to two people where only one is on the list must
 * not go at all: sending to the safe half would still write to the tenant.
 */
check("a letter to one allowed and one not is refused entirely",
      passes(letter({ to: ["someone@example.com", "tenant@realcompany.com.sg"] }),
             "allowed", ["someone@example.com"]),
      false);

check("an empty list means nothing can go", passes(letter(), "allowed", []), false);
check("and the list ignores case and spacing",
      passes(letter({ to: ["  SomeOne@Example.com "] }), "allowed", ["someone@example.com"]),
      true);

check("the list is read from the environment",
      allowlistFromEnv({ MAIL_ALLOWLIST: " a@b.com , C@D.com " } as NodeJS.ProcessEnv),
      ["a@b.com", "c@d.com"]);
check("and an unset list is empty rather than everything",
      allowlistFromEnv({} as NodeJS.ProcessEnv), []);

/* ----------------------------------------------- faults in the letter --- */

console.log("\nA broken letter is not sent, in any mode\n");

for (const mode of ["allowed", "everyone"]) {
  const list = ["someone@example.com"];

  check(`${mode}: a tenant with no address is refused`,
        passes(letter({ to: [] }), mode, list), false);

  /*
   * An empty letter is the fault that looks like success: the send works, the
   * record says a letter went out, and the tenant received nothing.
   */
  check(`${mode}: an empty letter is refused`,
        passes(letter({ body: "   " }), mode, list), false);

  // "you owe {{amount}}" reaching a tenant cannot be taken back.
  check(`${mode}: an unmerged field in the body is refused`,
        passes(letter({ body: "You owe {{amount}} by {{date}}." }), mode, list), false);
  check(`${mode}: and one in the subject is too`,
        passes(letter({ subject: "Balance for {{company}}" }), mode, list), false);
  check(`${mode}: spacing inside the braces does not hide it`,
        passes(letter({ body: "You owe {{ amount }}." }), mode, list), false);
}

// A good letter in everyone mode is the only combination that goes anywhere.
check("a complete letter to a real address goes only in everyone mode",
      passes(letter({ to: ["tenant@realcompany.com.sg"] }), "everyone", []), true);

/*
 * The reason, not just the refusal. Somebody reads this at 9am on the 16th
 * when a run reports it sent nothing, and "blocked" and "failed" need
 * different responses from them.
 */
console.log("\nA refusal says what to do about it\n");

const off = mayLeave(letter(), { mode: "off", allowlist: [] });
check("off explains how to turn it on",
      !off.ok && /MAIL_MODE/.test(off.reason), true);

const outside = mayLeave(letter({ to: ["tenant@realcompany.com.sg"] }),
                         { mode: "allowed", allowlist: ["someone@example.com"] });
check("a blocked address is named", !outside.ok && /realcompany/.test(outside.reason), true);

const unmerged = mayLeave(letter({ body: "You owe {{amount}}." }),
                          { mode: "everyone", allowlist: [] });
check("an unmerged field is quoted back",
      !unmerged.ok && unmerged.reason.includes("{{amount}}"), true);

/* -------------------------------------------------- the credentials ----- */

console.log("\nThe account password is not an App Password\n");

const cfg = (env: Record<string, string>) => {
  const r = gmailConfigFromEnv(env as NodeJS.ProcessEnv);
  return "error" in r ? "refused" : r.user;
};

check("a missing user is refused", cfg({ GMAIL_APP_PASSWORD: "abcd".repeat(4) }), "refused");
check("a missing password is refused", cfg({ GMAIL_USER: "a@b.com" }), "refused");

check("a sixteen character App Password is accepted",
      cfg({ GMAIL_USER: "a@b.com", GMAIL_APP_PASSWORD: "abcd".repeat(4) }), "a@b.com");

// Google displays it in four blocks of four and people paste the spaces.
check("and the spaces Google shows it with are stripped",
      cfg({ GMAIL_USER: "a@b.com", GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop" }), "a@b.com");

/*
 * Anything else is almost always the account password, which fails at Google
 * with a message that sends people to reset the wrong thing.
 */
check("something that is not sixteen characters is refused",
      cfg({ GMAIL_USER: "a@b.com", GMAIL_APP_PASSWORD: "hunter2hunter2" }),
      "refused");

const wrong = gmailConfigFromEnv({
  GMAIL_USER: "a@b.com",
  GMAIL_APP_PASSWORD: "correct horse battery staple",
} as NodeJS.ProcessEnv);
check("and the refusal says it looks like the account password",
      "error" in wrong && /account password/.test(wrong.error), true);

/* -------------------------------------------------------- Outlook ------- */

console.log("\nOutlook sign in\n");

const oc = (env: Record<string, string>) => {
  const r = outlookConfigFromEnv(env as NodeJS.ProcessEnv);
  return "error" in r ? "refused" : r.host;
};
check("a missing mailbox is refused", oc({ OUTLOOK_PASSWORD: "x" }), "refused");
check("a missing password is refused", oc({ OUTLOOK_USER: "a@b.com" }), "refused");
check("something that is not an address is refused", oc({ OUTLOOK_USER: "ar", OUTLOOK_PASSWORD: "x" }), "refused");
check("a company mailbox uses the Microsoft 365 server",
      oc({ OUTLOOK_USER: "ar@mesgroup.com", OUTLOOK_PASSWORD: "x" }), "smtp.office365.com");
check("a personal Outlook address uses the personal server",
      outlookHostFor("me@outlook.com"), "smtp-mail.outlook.com");
check("so does Hotmail", outlookHostFor("me@hotmail.com"), "smtp-mail.outlook.com");
check("the server can be overridden",
      oc({ OUTLOOK_USER: "a@b.com", OUTLOOK_PASSWORD: "x", OUTLOOK_HOST: "smtp.example.com" }), "smtp.example.com");
const opts = outlookTransportOptions({ user: "a@b.com", password: "p", host: "h", fromName: "n" });
check("it signs in on port 587 with STARTTLS required", opts.port === 587 && opts.requireTLS && !opts.secure, true);
check("a switched-off mailbox is explained",
      /Authenticated SMTP/.test(plainOutlookError("550 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled")), true);
check("a wrong password is explained", /address and password/.test(plainOutlookError("535 5.7.3 Authentication unsuccessful")), true);

/* ------------------------------------------- Connect Outlook (Microsoft) -- */

console.log("\nConnect Outlook: sign in with Microsoft\n");

const ENV_OK = { MICROSOFT_CLIENT_ID: "id", MICROSOFT_CLIENT_SECRET: "sec", APP_URL: "https://x.test/" };
const mc = (env: Record<string, string>) => microsoftConfig(env as NodeJS.ProcessEnv);

check("without an id and secret it says what is missing",
      "error" in mc({ APP_URL: "https://x.test" }) &&
        /MICROSOFT_CLIENT_ID/.test((mc({ APP_URL: "https://x.test" }) as { error: string }).error), true);
check("without APP_URL it refuses", "error" in mc({ MICROSOFT_CLIENT_ID: "id", MICROSOFT_CLIENT_SECRET: "s" }), true);
const okc = mc(ENV_OK) as Exclude<ReturnType<typeof microsoftConfig>, { error: string }>;
check("the redirect address is the Microsoft callback, without a double slash",
      okc.redirectUri, "https://x.test/api/mail/microsoft/callback");
check("work, school and personal accounts may sign in by default", okc.tenant, "common");
check("the tenant can be restricted",
      (mc({ ...ENV_OK, MICROSOFT_TENANT: "organizations" }) as { tenant: string }).tenant, "organizations");

const url = new URL(msConsentUrl(okc, "STATE"));
check("the sign in goes to Microsoft", url.hostname, "login.microsoftonline.com");
check("it asks for a lasting token so the 9am run can send",
      url.searchParams.get("scope")?.includes("offline_access"), true);
check("and permission to send mail", url.searchParams.get("scope")?.includes("Mail.Send"), true);
check("and not to read anybody's mail", /Mail\.Read/.test(MICROSOFT_SCOPES), false);
check("the account is chosen, not assumed", url.searchParams.get("prompt"), "select_account");
check("the signed state travels with it", url.searchParams.get("state"), "STATE");

check("an administrator-approval refusal is explained",
      /administrator/.test(plainMicrosoftDenial("access_denied", "AADSTS65001: The user or administrator has not consented")), true);
check("pressing Cancel is just not approved",
      plainMicrosoftDenial("access_denied", null), "The connection was not approved.");
check("a wrong or expired secret is explained", /secret/.test(plainMicrosoftError("invalid_client", "AADSTS7000215: Invalid client secret")), true);
check("a revoked connection says reconnect", /Reconnect/.test(plainMicrosoftError("invalid_grant", "AADSTS70008")), true);
check("a throttled mailbox says it will go on the next run", /next run/.test(plainGraphError(429, "ApplicationThrottled", "")), true);
check("a refused token on send says reconnect", /Reconnect/.test(plainGraphError(401, undefined, "")), true);

const msg = graphMessage({ to: ["a@b.com", "c@d.com"], subject: "S", body: "B" });
check("the message is plain text", msg.message.body.contentType, "Text");
check("every recipient is addressed", msg.message.toRecipients.length, 2);
check("it is kept in the mailbox's Sent Items", msg.saveToSentItems, true);
check("no attachment key when there is none", "attachments" in msg.message, false);
const withFile = graphMessage({ to: ["a@b.com"], subject: "S", body: "B",
  attachment: { filename: "r.xlsx", content: Buffer.from("hello") } }) as
  { message: { attachments: { name: string; contentBytes: string }[] } };
check("an attachment is named and base64 encoded",
      withFile.message.attachments[0].name === "r.xlsx" &&
        withFile.message.attachments[0].contentBytes === Buffer.from("hello").toString("base64"), true);
check("the attachment ceiling leaves room under Graph's request limit", MAX_ATTACHMENT_BYTES < 3_000_000, true);

console.log(failures === 0 ? "\nALL CHECKS PASS\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
