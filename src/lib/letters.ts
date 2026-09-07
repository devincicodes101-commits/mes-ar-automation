"use client";

/**
 * MES's own reminder letters.
 *
 * These are not our wording. They are transcribed from the two Word documents
 * MES sent in the September folder, JPD1 - First_Reminder - 20260407.docx and
 * J1 - Final Reminder - 20260420.docx, and the text is left exactly as they
 * wrote it, including "Payemnt"-class typos where any exist and the slightly
 * different date formats between the two. Editing MES's debt collection
 * wording is not ours to do: the final notice cites the Employment of Foreign
 * Manpower Regulations and threatens disruption of services, so a paraphrase
 * is a legal change.
 *
 * The documents carry only two mail merge fields:
 *
 *     «Company_Name»      the tenant
 *     «Grand_Total_»      what they owe
 *
 * Everything else that varies is typed prose, and has to be computed:
 *
 *     first reminder, dated 7 April 2026,  asks for payment by 13 April 2026
 *     final notice,   dated 20 April 26,   asks for payment by 27 April 26
 *
 * That is six days on the first and seven on the final, and the two letters
 * format their dates differently. Both are reproduced rather than unified.
 */

export type LetterId = "first-reminder" | "final-notice";

export interface LetterContext {
  companyName: string;
  /** The balance, already rounded. Formatted with thousands separators. */
  grandTotal: number;
  /** The date the letter is being sent, ISO. Normally the AR report date. */
  sentOn: string;
}

export interface RenderedLetter {
  id: LetterId;
  name: string;
  subject: string;
  body: string;
  /** The date the tenant is given, ISO, so the promise tracker can use it. */
  deadline: string;
  /** Fields that were filled, for the audit trail. */
  merged: Record<string, string>;
}

/* ---------------------------------------------------------------- dates */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** A calendar date, parsed without going near a timezone. */
function parts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

export function addDays(iso: string, days: number): string {
  const { y, m, d } = parts(iso);
  // Month 0-indexed, and Date handles the roll over into the next month.
  const dt = new Date(y, m - 1, d + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function ordinal(d: number): string {
  if (d % 100 >= 11 && d % 100 <= 13) return `${d}th`;
  return `${d}${["th", "st", "nd", "rd"][d % 10] ?? "th"}`;
}

/** "7th April 2026", the first reminder's own format for today's date. */
export function longOrdinalDate(iso: string): string {
  const { y, m, d } = parts(iso);
  return `${ordinal(d)} ${MONTHS[m - 1]} ${y}`;
}

/** "13 April 2026", the first reminder's format for the deadline. */
export function longDate(iso: string): string {
  const { y, m, d } = parts(iso);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "20 April 26", the final notice's format for both its dates. */
export function shortDate(iso: string): string {
  const { y, m, d } = parts(iso);
  return `${d} ${MONTHS[m - 1]} ${String(y).slice(-2)}`;
}

export function currency(n: number): string {
  return n.toLocaleString("en-SG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/* --------------------------------------------------------------- letters */

/** Days the tenant is given, counted from the date on the letter. */
export const DEADLINE_DAYS: Record<LetterId, number> = {
  "first-reminder": 6,
  "final-notice": 7,
};

/**
 * The payment details block, identical in both letters.
 *
 * These are MES & JPD Housing's. The August export is KT Mesdorm and the
 * other dormitories sit under other entities again, so before a single real
 * letter goes out somebody has to confirm whether each entity banks
 * separately. Asking a tenant to pay the wrong company is worse than not
 * asking at all.
 */
export const PAYMENT_DETAILS = `You can make the payment via bank transfer or PayNow and kindly send a screenshot of the transaction to ar@dormitory.com.sg for confirmation.

Bank Transfer Detail
DBS Account Number: 011-901192-0
MES & JPD HOUSING PTE LTD

PAYNOW Detail
UEN: 200412284W, MES & JPD HOUSING PTE LTD

Please indicate invoice no. in the remarks.`;

export const SIGNATURE = `Jacqueline
Credit Control Officer, Finance Department
DID Tel: 6349 5019
Office No: 6337 2666`;

export interface LetterSpec {
  id: LetterId;
  name: string;
  /** The day of MES's cycle this letter goes out on. */
  triggerDay: number;
  /**
   * Our subject line, not MES's. The Word documents are letters and carry no
   * subject, and MES have not sent an example of the reminder emails
   * themselves, only of the RM and AR team ones. Editable in Settings.
   */
  subject: string;
  render(c: LetterContext): string;
}

/**
 * The letters with their variable parts left as {{placeholders}}.
 *
 * This is the single copy of MES's wording. The Settings screen seeds its
 * editable templates from it and the send path renders from it, so the text an
 * officer previews is the text a simulation shows, by construction rather than
 * by two files happening to agree. They did not agree before this existed: the
 * screen was giving six days to pay on the final notice, where MES's own
 * sample gives seven.
 *
 * Placeholder names match what the reminder screen already substitutes, so a
 * template somebody has edited by hand keeps working.
 */
export const LETTER_BODIES: Record<LetterId, string> = {
  "first-reminder": `Dear {{company}}

We hope this finds you well.

We refer to the above subject and would like to bring your attention to your outstanding dues.

Rental is payable on the 1st working day of each calendar month via Giro.  However, we would like to bring to your attention that we have yet to receive the outstanding rental payment due from you.  As of today, {{today}}, the outstanding amount stands at \${{amount}}, which consists of rental and maintenance charges.

Please take note that if payment is not received by the 15th day of each calendar month, an administrative fee for late payment amounting to $100.00 (before prevailing GST) will be charged.

If you have already processed payment or paid the outstanding rental, kindly ignore this email.

If you have not, kindly assist us with payment as soon as possible.

If you choose to pay by cheque, kindly take note that a cheque admin fee of $50 is chargeable from 1st August 2022.  Please fill in the enclosed Direct Debit Application form and send the original form back to us.

${PAYMENT_DETAILS}

We seek your kind understanding and co-operation to settle your outstanding dues latest by {{dueBy}}.

Should you have any further clarifications, please contact me soonest possible.

Best Regards,

${SIGNATURE}`,

  "final-notice": `Dear {{company}}

We hope this finds you well.

Under the contract we entered, you were to pay rental by the 1st working day of each calendar month via Giro. However, we have yet to receive your outstanding rental payment and maintenance charges of \${{amount}} as of today, {{today}}. Despite our reminders, we have yet to receive payment.

Please take note that if payment is not received by the 15th day of each calendar month, an administrative fee for late payment amounting to $100.00 (before prevailing GST) will be charged.

Do also take note that employers who fail to pay rent for their foreign workers living in dormitories would be in breach of the Employment of Foreign Manpower (Work Passes) Regulations 2012.

If you have already processed payment or paid the outstanding rental, kindly ignore this email.

If you have not, we strongly urge you to make payment urgently.

${PAYMENT_DETAILS}

We seek your kind understanding and co-operation to settle your outstanding dues latest by {{dueBy}}. If you do not make payment within the stipulated time, we shall have no choice but to consider disruption of our services to you and all other available legal options.

Should you have any further clarifications, please contact me soonest possible.

Jacqueline Fong
Credit Control Officer, Finance Department
DID Tel: 6349 5019
Office No: 6337 2666`,
};

/**
 * How each letter writes a date.
 *
 * Three formats across two letters, because the first reminder does not even
 * use one format throughout. From MES's own documents:
 *
 *   first reminder   "As of today, 7th April 2026"   ordinal, full year
 *                    "latest by 13 April 2026"       no ordinal, full year
 *   final notice     "as of today, 20 April 26"      no ordinal, short year
 *                    "latest by 27 April 26"         the same
 *
 * All three are reproduced rather than unified. Rewording a debt collection
 * letter is not ours to do, and this is the kind of detail that reads as
 * sloppy to the tenant receiving it.
 */
export const LETTER_DATE_FORMAT: Record<
  LetterId,
  { today: (iso: string) => string; dueBy: (iso: string) => string }
> = {
  "first-reminder": { today: longOrdinalDate, dueBy: longDate },
  "final-notice": { today: shortDate, dueBy: shortDate },
};

/** The deadline this letter gives, for a letter dated `sentOn`. */
export function deadlineFor(id: LetterId, sentOn: string): string {
  return addDays(sentOn, DEADLINE_DAYS[id]);
}

/**
 * Fills {{placeholders}} in a letter body.
 *
 * Exported because the reminder screen renders templates the officer may have
 * edited, so it cannot go through `render` and needs the same substitution.
 */
export function fillLetter(
  body: string,
  values: {
    company: string;
    amount: number;
    today: string;
    dueBy: string;
    code?: string;
    property?: string;
    overdue?: number;
  },
): string {
  return body
    .replaceAll("{{company}}", values.company)
    .replaceAll("{{code}}", values.code ?? "")
    .replaceAll("{{property}}", values.property ?? "")
    .replaceAll("{{amount}}", currency(values.amount))
    .replaceAll("{{overdue}}", currency(values.overdue ?? values.amount))
    .replaceAll("{{today}}", values.today)
    .replaceAll("{{dueBy}}", values.dueBy);
}

export const LETTERS: LetterSpec[] = [
  {
    id: "first-reminder",
    name: "First Reminder",
    triggerDay: 7,
    subject: "Outstanding rental and maintenance charges",
    render: (c) => renderBody("first-reminder", c),
  },
  {
    id: "final-notice",
    name: "Final Reminder",
    triggerDay: 21,
    subject: "Final reminder — outstanding rental and maintenance charges",
    render: (c) => renderBody("final-notice", c),
  },
];

/** One letter, filled. The wording comes from LETTER_BODIES and nowhere else. */
function renderBody(id: LetterId, c: LetterContext): string {
  const fmt = LETTER_DATE_FORMAT[id];
  return fillLetter(LETTER_BODIES[id], {
    company: c.companyName,
    amount: c.grandTotal,
    today: fmt.today(c.sentOn),
    dueBy: fmt.dueBy(deadlineFor(id, c.sentOn)),
  });
}

export function letterById(id: LetterId): LetterSpec {
  const found = LETTERS.find((l) => l.id === id);
  if (!found) throw new Error(`No letter "${id}"`);
  return found;
}

export function renderLetter(id: LetterId, c: LetterContext): RenderedLetter {
  const spec = letterById(id);
  return {
    id,
    name: spec.name,
    subject: spec.subject,
    body: spec.render(c),
    deadline: addDays(c.sentOn, DEADLINE_DAYS[id]),
    merged: {
      Company_Name: c.companyName,
      Grand_Total_: currency(c.grandTotal),
    },
  };
}

/* ------------------------------------------- the RM and AR team templates */

/**
 * Jacqueline's two internal emails, transcribed from the screenshots in
 * "2. RM_AR_Email Template". Both are short and attachment-driven: the work
 * is the workbook, the mail is a covering note.
 */
export interface InternalEmail {
  subject: string;
  body: string;
  attachment: string;
}

/** To one relationship manager, with their clients by dorm attached. */
export function rmEmail(
  managerName: string,
  asOf: string,
  replyBy: string,
): InternalEmail {
  const shortName = managerName.replace(/^\d+\s+/, "").split(" ")[0];
  return {
    subject: `${shortName}'s Clients as of ${monthYear(asOf)}`,
    attachment: `${shortName}'s Clients by dorm as of ${monthYear(asOf)} - ${compact(asOf)}.xlsx`,
    body: `Dear ${shortName}

Please refer to the enclosed as of ${longDate(asOf)}.

Please revert on the payment updates by 2pm on ${longDate(replyBy)}.

Thank you.

Best Regards,

${SIGNATURE}`,
  };
}

/** To the AR team, asking them to raise the month's late payment fees. */
export function lateFeeEmail(asOf: string): InternalEmail {
  const month = MONTHS[parts(asOf).m - 1];
  return {
    subject: `${month} late payment admin fee`,
    attachment: `${month} late payment fee.xlsx`,
    body: `Dear AR team

Please assist with the issuance of ${month} late payment admin fee.

Please check if I might have included the giro clients in the listing and remove accordingly.

Thank you.

Best Regards,

${SIGNATURE}`,
  };
}

/** "Aug 26", the form MES use in their own subject lines and file names. */
function monthYear(iso: string): string {
  const { y, m } = parts(iso);
  return `${MONTHS[m - 1].slice(0, 3)} ${String(y).slice(-2)}`;
}

/** "20260806", the form MES use at the end of their attachment names. */
function compact(iso: string): string {
  return iso.replace(/-/g, "");
}
