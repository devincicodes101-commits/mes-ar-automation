/**
 * One way to send a letter, whoever ends up carrying it.
 *
 * Taha's design, September 2026: send -> Connector -> Gmail | Outlook. The app
 * calls one function and never names a provider, because MES have not yet
 * committed to one and the system should not have to change when they do.
 *
 * Nothing above this file knows what a mailbox is. Below it there is one small
 * implementation per provider, and swapping providers means swapping that.
 *
 * ---------------------------------------------------------------------------
 * The safety rails, and why they are here rather than in the caller
 *
 * This system's whole job is writing to real companies about money they owe.
 * A mistake here is not a wrong pixel: it is a Singapore business receiving a
 * debt letter that should not have been sent, from an address that is not
 * MES's, about an amount that may be stale.
 *
 * So the refusals live at the bottom, in the one place every send must pass
 * through, rather than in whichever screen or cron job happens to be calling.
 * A new caller added later inherits them without having to remember.
 */

export interface Letter {
  to: string[];
  subject: string;
  body: string;
  /** Which tenant this is about, for the record and for the error message. */
  tenantId: string;
  companyName: string;
  /*
   * Which wording produced it. Optional because the test letter has no
   * template, and recorded because "the first reminder" and "the final notice"
   * are different events to a tenant, and Sent Mail is the only place anybody
   * can check which one they were sent.
   */
  templateId?: string;
  templateName?: string;
  /*
   * A workbook to attach, for the reports that go out with one.
   *
   * MES's manager email is a covering line and a spreadsheet — "please refer
   * to the enclosed" — so a send without the file is not a smaller version of
   * the same thing, it is a letter that refers to nothing. Optional because a
   * tenant reminder has no attachment and never should.
   */
  attachment?: { filename: string; content: Buffer };
  /**
   * The billing month this letter is about, as the first of it.
   *
   * Not the month it is sent. MES upload late — the October report arrives on
   * the 4th of November and its reminder goes out on the 7th — so the two are
   * routinely different and neither can be worked out from the other.
   */
  period?: string;
}

export type SendOutcome =
  | { sent: true; id: string; provider: string }
  | { sent: false; reason: string; blocked: boolean };

export interface MailConnector {
  /** Named in logs and stored against the send, so history says who carried it. */
  readonly name: string;
  /** Checks the connector can work at all, without sending anything. */
  verify(): Promise<{ ok: true } | { ok: false; error: string }>;
  send(letter: Letter): Promise<SendOutcome>;
}

/* ------------------------------------------------------------ the rails -- */

/**
 * Three states, not two.
 *
 * "off"      nothing leaves, which is where this has been all along.
 * "allowed"  only the addresses on the list can be written to. This is what
 *            a real test looks like: a genuine send, through a genuine
 *            mailbox, to somebody who agreed to receive it.
 * "everyone" no restriction. Real tenants. Needs MES's own mailbox and
 *            somebody's explicit decision.
 *
 * Two states would collapse "we are testing" into "we are live", and the step
 * between those is the one worth making somebody take on purpose.
 */
export type SendingMode = "off" | "allowed" | "everyone";

export function modeFromEnv(env: NodeJS.ProcessEnv = process.env): SendingMode {
  const v = (env.MAIL_MODE ?? "").trim().toLowerCase();
  if (v === "everyone") return "everyone";
  if (v === "allowed") return "allowed";
  /*
   * Anything else is off, including a typo. A misspelled mode that failed open
   * would send real letters because somebody wrote "eveyone", so the default
   * is the one that costs nothing to get wrong.
   */
  return "off";
}

/** Addresses a test may write to, from MAIL_ALLOWLIST, comma separated. */
export function allowlistFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.MAIL_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

export interface Gate {
  mode: SendingMode;
  allowlist: string[];
}

/**
 * Whether this letter may leave, and if not, why.
 *
 * Returns the reason rather than a boolean because the reason is what somebody
 * reads at 9am on the 16th when a run says it sent nothing. "Blocked" and
 * "failed" need different responses and must not look alike.
 */
export function mayLeave(letter: Letter, gate: Gate): { ok: true } | { ok: false; reason: string } {
  if (gate.mode === "off") {
    return {
      ok: false,
      reason: "Sending is off. Set MAIL_MODE to allowed or everyone to turn it on.",
    };
  }

  if (letter.to.length === 0) {
    return {
      ok: false,
      reason: `${letter.companyName} has no email address, so there is nobody to write to.`,
    };
  }

  /*
   * An empty letter is a template fault, and it is the one fault that looks
   * like success: the send works, the record says a letter went out, and the
   * tenant received nothing they can act on.
   */
  if (letter.body.trim().length === 0) {
    return {
      ok: false,
      reason: `The letter to ${letter.companyName} came out empty, which is a template fault.`,
    };
  }

  /*
   * An unfilled merge field means a letter that would reach a tenant saying
   * "you owe {{amount}}". Cheap to check and impossible to take back.
   */
  const unfilled = /\{\{\s*\w+\s*\}\}/.exec(letter.subject + letter.body);
  if (unfilled) {
    return {
      ok: false,
      reason:
        `The letter to ${letter.companyName} still has ${unfilled[0]} in it, ` +
        "so something did not merge.",
    };
  }

  if (gate.mode === "allowed") {
    const outside = letter.to.filter((a) => !gate.allowlist.includes(a.trim().toLowerCase()));
    if (outside.length > 0) {
      return {
        ok: false,
        reason:
          `${outside.join(", ")} is not on the test list, so this was not sent. ` +
          "While MAIL_MODE is allowed, only MAIL_ALLOWLIST addresses can be written to.",
      };
    }
  }

  return { ok: true };
}
