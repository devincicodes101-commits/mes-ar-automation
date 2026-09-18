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

console.log(failures === 0 ? "\nALL CHECKS PASS\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
