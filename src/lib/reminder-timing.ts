import type { Account } from "./types.ts";
import { billingForTenant, type BillingLine } from "./billing-cycles.ts";

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
 * reminder once a bill is 23 days old, the final once it is 27. A tenant
 * billed on the 2nd and a tenant billed on the 28th are then chased the same
 * number of days into their own bill, which is what "dynamic" meant.
 *
 * ---------------------------------------------------------------------------
 * Nothing here is hard-coded
 *
 * The two numbers arrive as an argument. They were dictated as 23 and 27 and
 * an earlier note of the same conversation recorded 23 and 37, which is the
 * sort of disagreement that gets settled after the code is written - so the
 * code does not care. DEFAULT_REMINDER_DAYS is a default, not a rule, and
 * anything calling this may pass its own.
 *
 * ---------------------------------------------------------------------------
 * Which bill starts the clock
 *
 * The newest one. Most tenants owe against several runs at once - one in
 * MES's export owes against fifty-six - and the letter quotes the whole
 * balance, so it is a letter about the account rather than about one invoice.
 * Counting from the newest run means a tenant who is billed every month is
 * chased once a month, and the clock restarts when they are billed again.
 *
 * Counting from the oldest would leave anyone long overdue permanently past
 * both thresholds, needing a second rule to stop it firing for ever. Counting
 * every run separately would send a tenant with five unpaid runs up to ten
 * letters. Both were considered and rejected on 3 October.
 */

export interface ReminderWindow {
  /** Days after the billing date that the first reminder falls due. */
  first: number;
  /** And the final notice. Must not be earlier than the first. */
  final: number;
}

export const DEFAULT_REMINDER_DAYS: ReminderWindow = { first: 23, final: 27 };

export type ReminderStage = "first-reminder" | "final-notice";

export interface DueReminder {
  accountId: string;
  companyName: string;
  stage: ReminderStage;
  /** The billing run the clock was counted from. */
  billedOn: string;
  /** When that run fell due, for the letter to quote. */
  dueBy: string | null;
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
export function sane(window: ReminderWindow): ReminderWindow {
  return {
    first: Math.max(0, Math.round(window.first)),
    final: Math.max(Math.max(0, Math.round(window.first)), Math.round(window.final)),
  };
}

/**
 * The reminder each tenant is due as at `today`, or nothing.
 *
 * At most one per tenant: a bill old enough for the final notice is past the
 * first reminder too, and sending both on the same day would be absurd. The
 * caller decides whether it has already been sent - see `key` - because only
 * the caller knows what has gone out.
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

    const billing = billingForTenant(linesFor(a), today);
    if (!billing.billedOn) continue;

    const age = dayDiff(billing.billedOn, today);
    if (age === null || age < w.first) continue;

    due.push({
      accountId: a.id,
      companyName: a.companyName,
      stage: age >= w.final ? "final-notice" : "first-reminder",
      billedOn: billing.billedOn,
      dueBy: billing.dueBy,
      daysSinceBilled: age,
      key: reminderKey(
        a.id,
        billing.billedOn,
        age >= w.final ? "final-notice" : "first-reminder",
      ),
    });
  }

  return due;
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
 * It needs no new column. Every letter already records when it went, and a
 * letter sent on or after the billing date is about that bill or a later one.
 * That also makes it blind to how the letter was sent: one the nine o'clock
 * run wrote and one an officer sent from the Reminders screen count alike.
 */

export interface SentLetter {
  tenantId: string;
  stage: ReminderStage;
  /** When it really left. ISO, date or timestamp. */
  sentAt: string;
}

export interface PlannedLetter {
  accountId: string;
  stage: ReminderStage;
  billedOn: string;
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
 * Two rules beyond the window, both about order:
 *
 *   A final notice never goes to somebody who has not had the first reminder
 *   for this bill. If the first was missed - a report uploaded late, a run
 *   that failed - the first goes now and the final waits, rather than a
 *   tenant's first contact being the letter that cites the regulations.
 *
 *   And the final waits the same gap after the first that the window sets
 *   between them. A first reminder sent late on day 40 is not followed by the
 *   final on day 41.
 */
export function lettersToWrite(
  due: readonly DueReminder[],
  sent: readonly SentLetter[],
  today: string,
  window: ReminderWindow = DEFAULT_REMINDER_DAYS,
): { write: PlannedLetter[]; held: HeldLetter[] } {
  const w = sane(window);
  const gap = w.final - w.first;
  const write: PlannedLetter[] = [];
  const held: HeldLetter[] = [];

  for (const d of due) {
    const since = sent.filter(
      (s) => s.tenantId === d.accountId && dayOf(s.sentAt) >= d.billedOn,
    );
    const firsts = since
      .filter((s) => s.stage === "first-reminder")
      .map((s) => dayOf(s.sentAt))
      .sort();
    const hadFinal = since.some((s) => s.stage === "final-notice");

    if (hadFinal) {
      held.push({
        accountId: d.accountId,
        why: `already had the final notice for the bill of ${d.billedOn}`,
      });
      continue;
    }

    if (d.stage === "first-reminder") {
      if (firsts.length > 0) {
        held.push({
          accountId: d.accountId,
          why: `already had the first reminder for the bill of ${d.billedOn}`,
        });
      } else {
        write.push({ accountId: d.accountId, stage: "first-reminder", billedOn: d.billedOn, dueBy: d.dueBy, note: null });
      }
      continue;
    }

    /* Past the final threshold from here on. */
    if (firsts.length === 0) {
      write.push({
        accountId: d.accountId,
        stage: "first-reminder",
        billedOn: d.billedOn,
        dueBy: d.dueBy,
        note:
          `past the final notice point for the bill of ${d.billedOn} but never ` +
          `sent the first reminder, so the first goes now and the final ` +
          `follows ${gap} days after it`,
      });
      continue;
    }

    const firstOn = firsts[firsts.length - 1];
    const waited = dayDiff(firstOn, today);
    if (waited !== null && waited >= gap) {
      write.push({ accountId: d.accountId, stage: "final-notice", billedOn: d.billedOn, dueBy: d.dueBy, note: null });
    } else {
      held.push({
        accountId: d.accountId,
        why: `final notice waits until ${gap} days after the first reminder of ${firstOn}`,
      });
    }
  }

  return { write, held };
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
