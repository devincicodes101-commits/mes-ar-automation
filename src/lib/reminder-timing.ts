import type { Account } from "./types.ts";
import { CREDIT_DAYS, type BillingLine } from "./billing-cycles.ts";

/**
 * When each tenant is due a reminder, counted from their own billing date.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 *
 * Reminders went out on the 7th and the 21st, full stop. Those two numbers
 * were written into the cycle, the simulation, the schedule screen and the
 * cron, and they assumed every tenant was billed on the same day of the month.
 * MES's own August export carries 28 separate billing dates, so for most
 * tenants the 7th meant nothing in particular - it was simply the day the
 * letter happened to go.
 *
 * The rule MES actually work to is a count from the billing date: the first
 * reminder once a bill is 23 days old, the final once it is 37. A tenant
 * billed on the 2nd and a tenant billed on the 28th are then chased the same
 * number of days into their own bill, which is what "dynamic" meant.
 *
 * ---------------------------------------------------------------------------
 * Nothing here is hard-coded
 *
 * The two numbers arrive as an argument. They were dictated as 23 and 27, an
 * earlier note of the same conversation recorded 23 and 37, and 37 was
 * confirmed on 23 October against MES's cycle sheet. That is the sort of
 * disagreement that gets settled after the code is written - so the code does
 * not care. DEFAULT_REMINDER_DAYS is a default, not a rule, and
 * anything calling this may pass its own.
 *
 * ---------------------------------------------------------------------------
 * Which bill starts the clock
 *
 * Every billing date has its own. A tenant's invoices are grouped by the date
 * they were billed on, and each group is chased on its own: the first reminder
 * 23 days after that date, the final notice 37 days after it. The letter asks
 * for that group's total, not the tenant's whole balance, and does not list
 * the invoices: a tenant can have dozens, and the letter is kept short.
 *
 * This used to count from the newest bill only, and a new bill restarted the
 * clock: a tenant owing since August who was billed a small ad hoc charge on
 * 20 October was not chased again until 12 November. Agreed 23 October:
 * group by billing date, quote that date's total without listing the
 * invoices, and several letters a month is acceptable for a tenant billed on
 * several dates.
 *
 * Groups that fall due on the same morning for the same letter go in one
 * email, so a tenant never gets two first reminders on one day.
 */

export interface ReminderWindow {
  /** Days after the billing date that the first reminder falls due. */
  first: number;
  /** And the final notice. Must not be earlier than the first. */
  final: number;
  /*
   * The three choices made on 23 October, kept as settings so MES can change
   * them on the Settings screen. Optional so a stored window from before
   * keeps working; sane() fills in the agreed defaults.
   */
  /** "each": every billing date is chased on its own. "newest": only the
      tenant's newest bill, the way it worked before. */
  countFrom?: "each" | "newest";
  /** Days after its day that a letter missed may still go. 0: its day only. */
  lateDays?: number;
  /** Send the final notice on its day even if this system sent no first. */
  finalWithoutFirst?: boolean;
}

/** A window with every choice filled in, as sane() returns it. */
export type FullWindow = Required<ReminderWindow>;

/* 37 rather than 27: MES's own cycle sheet puts the final notice on the 21st
   for a bill of the 15th of the month before. Confirmed 23 October. */
export const DEFAULT_REMINDER_DAYS: FullWindow = {
  first: 23,
  final: 37,
  countFrom: "each",
  lateDays: 0,
  finalWithoutFirst: true,
};

export type ReminderStage = "first-reminder" | "final-notice";

/** One invoice as a letter lists it. */
export interface BillInvoice {
  documentNumber: string;
  description: string;
  amount: number;
}

/** A tenant's invoices that share one billing date: what one letter is about. */
export interface BillRun {
  billedOn: string;
  /** When that run fell due, for the letter to quote. */
  dueBy: string | null;
  /** What is still owed on these invoices. */
  amount: number;
  invoices: BillInvoice[];
}

/**
 * A tenant's unpaid invoices, grouped by billing date, oldest first.
 *
 * Bills only - lines that add to what is owed. A credit note or a payment has
 * a date too, but it is not a bill anybody is chased for, and counting it
 * would invent a billing date with nothing to ask for.
 */
export function billRuns(lines: readonly BillingLine[]): BillRun[] {
  const by = new Map<string, BillRun>();
  for (const l of lines) {
    if (!l.date || !(l.openBalance > 0)) continue;
    const run = by.get(l.date) ?? { billedOn: l.date, dueBy: l.dueDate ?? null, amount: 0, invoices: [] };
    run.amount = Math.round((run.amount + l.openBalance) * 100) / 100;
    run.invoices.push({ documentNumber: l.documentNumber ?? "", description: l.description ?? "", amount: l.openBalance });
    if (!run.dueBy && l.dueDate) run.dueBy = l.dueDate;
    by.set(l.date, run);
  }
  return Array.from(by.values()).sort((a, b) => a.billedOn.localeCompare(b.billedOn));
}

export interface DueReminder {
  accountId: string;
  companyName: string;
  stage: ReminderStage;
  /** The billing date the clock was counted from. */
  billedOn: string;
  /** When that run fell due, for the letter to quote. */
  dueBy: string | null;
  /** What is owed on this billing date's invoices, and the invoices. */
  amount: number;
  invoices: BillInvoice[];
  daysSinceBilled: number;
  /**
   * Stable per tenant, per billing run, per stage.
   *
   * This is what stops a second send, and it is deliberately not the calendar
   * month. A month was the right key while letters went out on fixed dates;
   * once the clock runs from the billing date, two runs can fall inside one
   * month and a month-shaped key would silently swallow the second.
   */
  key: string;
}

export function reminderKey(
  accountId: string,
  billedOn: string,
  stage: ReminderStage,
): string {
  return `${accountId}|${billedOn}|${stage}`;
}

/** Whole days from one ISO date to another, or null if either is unreadable. */
function dayDiff(from: string, to: string): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to);
  if (!a || !b) return null;
  /* Local noon, so a daylight saving shift cannot round onto the neighbouring
     day. Same reason as billing-cycles. */
  const x = new Date(Number(a[1]), Number(a[2]) - 1, Number(a[3]), 12);
  const y = new Date(Number(b[1]), Number(b[2]) - 1, Number(b[3]), 12);
  return Math.round((y.getTime() - x.getTime()) / 86_400_000);
}

/**
 * A window that cannot fire the final before the first.
 *
 * Both numbers are meant to be editable by whoever runs MES, and a final set
 * below the first would send the closing letter to a tenant who has not had
 * the opening one. Rather than refuse the setting, hold the final at the
 * first: the two letters land together, which is visible and wrong in a way
 * somebody will report, instead of silently out of order.
 */
export function sane(window: ReminderWindow): FullWindow {
  const first = Math.max(0, Math.round(window.first));
  const late = Math.round(Number(window.lateDays ?? DEFAULT_REMINDER_DAYS.lateDays));
  return {
    first,
    final: Math.max(first, Math.round(window.final)),
    countFrom: window.countFrom === "newest" ? "newest" : "each",
    lateDays: Number.isFinite(late) ? Math.min(30, Math.max(0, late)) : 0,
    finalWithoutFirst: window.finalWithoutFirst ?? DEFAULT_REMINDER_DAYS.finalWithoutFirst,
  };
}

/**
 * The reminder each billing date is due as at `today`, oldest bill first.
 *
 * One entry per tenant per billing date that has reached the first reminder:
 * a date old enough for the final notice is past the first too, and is listed
 * once, at the further stage. The caller decides whether it has already been
 * sent - see `key` - because only the caller knows what has gone out.
 *
 * `linesFor` rather than the whole invoice list, so this does not need to know
 * how a tenant is matched to their lines. That join is spelt differently in
 * different places and is not this function's business.
 */
export function remindersDueOn(
  accounts: readonly Account[],
  linesFor: (a: Account) => readonly BillingLine[],
  today: string,
  window: ReminderWindow = DEFAULT_REMINDER_DAYS,
): DueReminder[] {
  const w = sane(window);
  const due: DueReminder[] = [];

  for (const a of accounts) {
    /* Nothing owed is nothing to chase, whatever the calendar says. */
    if (a.total <= 0) continue;

    const runs = billRuns(linesFor(a));
    /* "newest": the clock runs from the newest bill only, and its letter is
       about the whole balance, as before 23 October. */
    const newest = w.countFrom === "newest";
    for (const run of newest ? runs.slice(-1) : runs) {
      const age = dayDiff(run.billedOn, today);
      if (age === null || age < w.first) continue;
      const stage: ReminderStage = age >= w.final ? "final-notice" : "first-reminder";

      due.push({
        accountId: a.id,
        companyName: a.companyName,
        stage,
        billedOn: run.billedOn,
        dueBy: run.dueBy ?? addDays(run.billedOn, CREDIT_DAYS),
        amount: newest ? a.total : run.amount,
        invoices: run.invoices,
        daysSinceBilled: age,
        key: reminderKey(a.id, run.billedOn, stage),
      });
    }
  }

  return due;
}

function addDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  d.setDate(d.getDate() + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * The two dates a given billing run will be chased on.
 *
 * For showing a tenant's own schedule rather than deciding a send: "billed on
 * the 15th, first reminder the 7th, final the 11th" is the sentence an officer
 * needs when a tenant asks why they were written to.
 */
export function reminderDatesFor(
  billedOn: string,
  window: ReminderWindow = DEFAULT_REMINDER_DAYS,
): { first: string; final: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(billedOn);
  if (!m) return null;
  const w = sane(window);
  const at = (days: number) => {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
    d.setDate(d.getDate() + days);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  return { first: at(w.first), final: at(w.final) };
}

/* ------------------------------------------------ what has already gone ---
 * Deciding the letters, given what each tenant has really been sent.
 *
 * The question used to be "has this tenant had this letter this calendar
 * month". Once the clock runs from the billing date that is the wrong
 * question: a tenant billed on the 28th reaches day 23 in the next month, and a
 * month-shaped memory would forget a letter sent on the 30th the moment the
 * 1st arrived. So the question is now "has this tenant had this letter since
 * their current bill was raised", which is the same question asked properly.
 *
 * Each letter records the billing dates it was about (emails_sent.billed_on),
 * so a reminder for the bill of the 15th does not count for the bill of the
 * 24th. Letters sent before that column existed were about the tenant's whole
 * balance, so they count for every bill raised on or before the day they
 * went. Either way it is blind to how the letter was sent: one the nine
 * o'clock run wrote and one an officer sent from the Reminders screen count
 * alike.
 */

export interface SentLetter {
  tenantId: string;
  stage: ReminderStage;
  /** When it really left. ISO, date or timestamp. */
  sentAt: string;
  /** The billing dates it was about. Absent for letters sent before they were
      recorded, which were about the whole balance. */
  billedOn?: readonly string[] | null;
}

/** Whether this letter was about the bill of `billedOn`. */
export function letterCovers(s: Pick<SentLetter, "sentAt" | "billedOn">, billedOn: string): boolean {
  if (s.billedOn && s.billedOn.length > 0) return s.billedOn.includes(billedOn);
  return dayOf(s.sentAt) >= billedOn;
}

/**
 * The reminder letters in a list of sent emails, really sent only.
 *
 * Every screen that asks "what has this tenant been sent" builds this list,
 * and they used to build it three slightly different ways. The template ids
 * are named for the 7th and the 21st, which they no longer mean; renaming
 * them would break the link to every letter already on record.
 */
export function sentReminders(
  emails: readonly { accountId: string; templateId: string; at: string; simulated?: boolean; billedOn?: readonly string[] | null }[],
): SentLetter[] {
  return emails
    .filter((e) => !e.simulated && (e.templateId === "reminder-7th" || e.templateId === "final-21st"))
    .map((e) => ({
      tenantId: e.accountId,
      stage: e.templateId === "final-21st" ? ("final-notice" as const) : ("first-reminder" as const),
      sentAt: e.at,
      billedOn: e.billedOn ?? null,
    }));
}

/** One email to one tenant: one letter, one or more billing dates. */
export interface PlannedLetter {
  accountId: string;
  stage: ReminderStage;
  /** The billing dates it covers, oldest first. Usually one. */
  bills: BillRun[];
  /** The newest of those dates: what a saved edit and the letter's id are keyed on. */
  billedOn: string;
  /** The total of the listed invoices, which is the figure the letter asks for. */
  amount: number;
  dueBy: string | null;
  /** Said in the run's diary when the letter is not the obvious one. */
  note: string | null;
}

export interface HeldLetter {
  accountId: string;
  why: string;
}

const dayOf = (iso: string) => iso.slice(0, 10);

/**
 * Which of today's due reminders actually go, and why the rest do not.
 *
 * One day each, and no catching up. Agreed 23 October:
 *
 *   The first reminder goes on the day the bill is 23 days old, and only
 *   then. A bill already past that day when the system first sees it - a
 *   report uploaded late, a bill from before the system - is taken to have
 *   been reminded by MES, and nothing is sent for it.
 *
 *   The final notice goes on the day the bill is 37 days old, whether or not
 *   this system sent that bill's first reminder. A bill first seen on day 30
 *   missed its first reminder here, but MES chased it before the system did,
 *   so the final notice still goes on its day.
 *
 *   A morning that did not run, or failed, does not send its letters on a
 *   later morning. Running that morning again does (see askedFor), and a
 *   retry button for it is to come.
 *
 * Decided for each billing date on its own, then gathered: everything one
 * tenant is due for the same letter today goes in one email.
 *
 * Only bills whose day is today are reported as held. Every other bill is
 * simply not due anything today, and listing them every morning would bury
 * the ones that are.
 */
export function lettersToWrite(
  due: readonly DueReminder[],
  sent: readonly SentLetter[],
  window: ReminderWindow = DEFAULT_REMINDER_DAYS,
): { write: PlannedLetter[]; held: HeldLetter[] } {
  const w = sane(window);
  const each: { d: DueReminder; stage: ReminderStage; note: string | null }[] = [];
  const held: HeldLetter[] = [];

  for (const d of due) {
    const about = sent.filter((s) => s.tenantId === d.accountId && letterCovers(s, d.billedOn));
    const hadFirst = about.some((s) => s.stage === "first-reminder");
    const hadFinal = about.some((s) => s.stage === "final-notice");
    /* Its day, or up to lateDays after it (Settings; 0 since 23 October). A
       first reminder stops being due once the final notice's day arrives. */
    const age = d.daysSinceBilled;
    const firstWindow = age >= w.first && age <= w.first + w.lateDays && age < w.final;
    const finalWindow = age >= w.final && age <= w.final + w.lateDays;

    if (firstWindow) {
      if (hadFirst) {
        held.push({ accountId: d.accountId, why: `already had the first reminder for the bill of ${d.billedOn}` });
      } else {
        each.push({ d, stage: "first-reminder", note: age > w.first ? `${age - w.first} days late` : null });
      }
    } else if (finalWindow) {
      if (hadFinal) {
        held.push({ accountId: d.accountId, why: `already had the final notice for the bill of ${d.billedOn}` });
      } else if (!hadFirst && !w.finalWithoutFirst) {
        held.push({
          accountId: d.accountId,
          why: `no first reminder was sent for the bill of ${d.billedOn}, and Settings say no final notice without one`,
        });
      } else {
        each.push({
          d,
          stage: "final-notice",
          note: hadFirst ? null : `no first reminder was sent from this system for the bill of ${d.billedOn}; the final notice goes on its day regardless`,
        });
      }
    }
  }

  /* Gathered per tenant per letter, in the order the tenants came. */
  const byLetter = new Map<string, PlannedLetter>();
  for (const { d, stage, note } of each) {
    const k = `${d.accountId}|${stage}`;
    const bill: BillRun = { billedOn: d.billedOn, dueBy: d.dueBy, amount: d.amount, invoices: d.invoices };
    const at = byLetter.get(k);
    if (!at) {
      byLetter.set(k, { accountId: d.accountId, stage, bills: [bill], billedOn: d.billedOn, amount: d.amount, dueBy: d.dueBy, note });
      continue;
    }
    at.bills.push(bill);
    at.bills.sort((a, b) => a.billedOn.localeCompare(b.billedOn));
    at.billedOn = at.bills[at.bills.length - 1]!.billedOn;
    at.dueBy = at.bills[at.bills.length - 1]!.dueBy;
    at.amount = Math.round((at.amount + d.amount) * 100) / 100;
    at.note = [at.note, note].filter(Boolean).join("; ") || null;
  }

  return { write: Array.from(byLetter.values()), held };
}

/** Where one tenant stands with their letters for one billing date. */
export type LetterPosition =
  | { kind: "not-yet" }
  | { kind: "first-due" }
  | { kind: "first-sent"; firstSentOn: string; finalDueOn: string }
  /* firstSentOn is null where this system never sent the first reminder. */
  | { kind: "final-due"; firstSentOn: string | null }
  | { kind: "final-sent"; finalSentOn: string }
  /* The first reminder's day went by with no first reminder. finalComing:
     whether the final notice will still go on its own day (Settings). */
  | { kind: "first-missed"; firstOn: string; finalOn: string; finalComing: boolean }
  /* The final notice's day went by without it: no more emails for this bill. */
  | { kind: "final-missed"; firstSentOn: string | null; finalOn: string };

/**
 * Where a bill stands, from its dates and from what has really been sent.
 *
 * The same rules as lettersToWrite, so the card says what the run will do:
 * each letter on its one day, the final on its day whether or not the first
 * went, and a day that has gone by stays gone.
 */
export function letterPosition(
  billedOn: string,
  sent: readonly SentLetter[],
  today: string,
  window: ReminderWindow = DEFAULT_REMINDER_DAYS,
): LetterPosition {
  const w = sane(window);
  const dates = reminderDatesFor(billedOn, w);
  if (!dates) return { kind: "not-yet" };

  const about = sent.filter((s) => letterCovers(s, billedOn));
  const finals = about.filter((s) => s.stage === "final-notice").map((s) => dayOf(s.sentAt)).sort();
  if (finals.length > 0) return { kind: "final-sent", finalSentOn: finals[finals.length - 1]! };

  /* The same windows as lettersToWrite: its day, or up to lateDays after. */
  const age = dayDiff(billedOn, today) ?? 0;
  const inFinal = age >= w.final && age <= w.final + w.lateDays;

  const firsts = about.filter((s) => s.stage === "first-reminder").map((s) => dayOf(s.sentAt)).sort();
  if (firsts.length > 0) {
    const firstSentOn = firsts[firsts.length - 1]!;
    if (age < w.final) return { kind: "first-sent", firstSentOn, finalDueOn: dates.final };
    if (inFinal) return { kind: "final-due", firstSentOn };
    return { kind: "final-missed", firstSentOn, finalOn: dates.final };
  }

  if (age < w.first) return { kind: "not-yet" };
  if (age <= w.first + w.lateDays && age < w.final) return { kind: "first-due" };
  const missed = { kind: "first-missed" as const, firstOn: dates.first, finalOn: dates.final, finalComing: w.finalWithoutFirst };
  if (age < w.final || !w.finalWithoutFirst) return { ...missed, finalComing: w.finalWithoutFirst && age < w.final };
  if (inFinal) return { kind: "final-due", firstSentOn: null };
  return { kind: "final-missed", firstSentOn: null, finalOn: dates.final };
}

/**
 * Each tenant's own lines, for remindersDueOn.
 *
 * Matched on the account id - customer code and dormitory - the same id the
 * parser, the database and pastDueByAccount all give an account. A tenant who
 * rents at two dormitories is two accounts with two billing histories, and
 * matching by company name would hand both the same billing date.
 *
 * Company name is the fallback, for lines the parser could not place in a
 * dormitory. Such a line belongs to every account of that company, which is
 * the least wrong answer available for it.
 */
export function linesByAccount(
  accounts: readonly Pick<Account, "id" | "companyName">[],
  invoices: readonly BillingLine[],
): (a: Pick<Account, "id" | "companyName">) => readonly BillingLine[] {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "").trim();
  const byId = new Map<string, BillingLine[]>();
  const byName = new Map<string, BillingLine[]>();

  for (const line of invoices) {
    if (line.customerCode && line.property) {
      const id = `${line.customerCode}-${line.property}`.toLowerCase();
      byId.set(id, [...(byId.get(id) ?? []), line]);
    } else if (line.companyName) {
      const k = norm(line.companyName);
      byName.set(k, [...(byName.get(k) ?? []), line]);
    }
  }

  return (a) => [...(byId.get(a.id) ?? []), ...(byName.get(norm(a.companyName)) ?? [])];
}
