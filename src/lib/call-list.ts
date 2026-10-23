import { overdueTotal, severeTotal } from "./data.ts";
import {
  DEFAULT_REMINDER_DAYS,
  letterCovers,
  reminderDatesFor,
  remindersDueOn,
  type DueReminder,
  type ReminderWindow,
  type SentLetter,
} from "./reminder-timing.ts";
import type { BillingLine } from "./billing-cycles.ts";
import type { Account, QueueItem, QueueReason } from "./types.ts";

/**
 * Who to phone today: the call follows the email.
 *
 * MES's process is a letter and then a call - the first reminder, then a
 * call; the final notice, then a call again. The Call List was built from the
 * aging buckets instead, so it asked a different question from the letters:
 * "who has money more than 30 days old" against "who is past their reminder
 * date". On the September file that put 161 on the call list and 255 in the
 * letters, and nobody could say why a tenant who had just been written to was
 * not on the list to ring.
 *
 * Now both ask the same thing, from the same dates: anyone who still owes and
 * whose first reminder date (billing date + 23 days, as set on Settings) has
 * passed is due their first call; past the final notice date (+ 37), their
 * second. No report date and no age groups - those stay for MES's own aging
 * report. Agreed 14 October.
 *
 * One call per tenant, not one per bill. Letters go per billing date, but a
 * call is to a person about everything they owe, so a tenant billed on three
 * dates is on the list once, for their newest bill that has reached its
 * reminder date: the call follows the latest letter.
 *
 * A tenant with a promise to pay that has not yet fallen due is left off, as
 * the letters leave them off.
 *
 * Which call it is follows what was really sent, not only the calendar. On
 * the September file every tenant was past both dates by 14 October and none
 * had been written to, so by the dates alone all 255 were due their second
 * call before their first. The letters refuse that order - the final notice
 * waits for the first reminder - and so do the calls: the second call is for
 * a tenant whose final notice has really gone. A tenant with no address can
 * never be written to, so for them the second call waits for the first call
 * to have been made instead.
 */

/** Which of the two calls this is. The same two rounds as the letters. */
export type CallRound = "first-reminder" | "final-notice";

export interface CallItem extends QueueItem {
  round: CallRound;
  /** The bill the dates were counted from. */
  billedOn: string;
  /** When the first reminder fell due, and the final notice. */
  firstOn: string;
  finalOn: string;
}

export function callListOn(
  accounts: readonly Account[],
  linesFor: (a: Account) => readonly BillingLine[],
  today: string,
  window: ReminderWindow = DEFAULT_REMINDER_DAYS,
  /** Late fees this system has raised, per tenant, for the repeat-fee flag. */
  raisedByUs: ReadonlyMap<string, number> = new Map(),
  /** Tenants holding a promise to pay that has not yet fallen due. */
  promised: ReadonlySet<string> = new Set(),
  /** Letters that really left. Decides the first call from the second. */
  sent: readonly SentLetter[] = [],
  /** Calls logged, with their round. Decides it for a tenant with no address. */
  calls: readonly { accountId: string; at: string; round: CallRound }[] = [],
): CallItem[] {
  const finalSent = (accountId: string, billedOn: string) =>
    sent.some((l) => l.tenantId === accountId && l.stage === "final-notice" && letterCovers(l, billedOn));

  const byId = new Map(accounts.map((a) => [a.id, a]));
  const items: CallItem[] = [];

  /* The newest due bill per tenant. remindersDueOn lists oldest first. */
  const newest = new Map<string, DueReminder>();
  for (const d of remindersDueOn(accounts, linesFor, today, window)) newest.set(d.accountId, d);

  for (const due of Array.from(newest.values())) {
    if (promised.has(due.accountId)) continue;
    const account = byId.get(due.accountId);
    const dates = reminderDatesFor(due.billedOn, window);
    if (!account || !dates) continue;

    const fees = account.lateFeeCount + (raisedByUs.get(account.id) ?? 0);
    const stepBeforeDone = account.hasContact
      ? finalSent(account.id, due.billedOn)
      : calledThisRound({ account, round: "first-reminder", billedOn: due.billedOn }, calls);
    const round: CallRound =
      due.stage === "final-notice" && stepBeforeDone ? "final-notice" : "first-reminder";
    const reasons: QueueReason[] = [
      round === "final-notice" ? "final-notice-passed" : "first-reminder-passed",
    ];
    if (severeTotal(account) > 0) reasons.push("aging-90");
    if (fees >= 3) reasons.push("repeat-late-fees");
    if (!account.hasContact) reasons.push("no-contact");
    if (account.legacyNote) reasons.push("promise-broken");

    /* The same ordering the list has always had: the oldest money, and the
       most late fees, first. Who is on the list changed; who is at the top
       did not. */
    let priority = 0;
    priority += severeTotal(account) * 3;
    priority += account.buckets.d60 * 2;
    priority += account.buckets.d30;
    priority += fees * 500;
    if (account.status === "Terminated") priority *= 0.6;

    items.push({
      account,
      reasons,
      priority,
      overdue: overdueTotal(account),
      round,
      billedOn: due.billedOn,
      firstOn: dates.first,
      finalOn: dates.final,
    });
  }

  return items.sort((a, b) => b.priority - a.priority);
}

/**
 * Whether this round's call has been made: a call logged for the same round,
 * on or after the bill it is about. A call about last month's bill does not
 * count for this one, and a first-round call does not count for the second.
 */
export function calledThisRound(
  item: Pick<CallItem, "account" | "round" | "billedOn">,
  calls: readonly { accountId: string; at: string; round: CallRound }[],
): boolean {
  return calls.some(
    (c) =>
      c.accountId === item.account.id &&
      c.round === item.round &&
      c.at.slice(0, 10) >= item.billedOn,
  );
}
