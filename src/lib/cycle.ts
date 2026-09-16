import type { Pipeline } from "./pipeline";
import type { Account } from "./types";
import { buildQueue, overdueTotal } from "./data.ts";
import { CAN_SEND_FOR_REAL } from "./outbox.ts";
import { renderLetter } from "./letters.ts";

/**
 * MES's month as something that runs, rather than six snapshots of one moment.
 *
 * Taha opened the 14 September call with the requirement: "it's better if we
 * can run a few simulations instead of attaching with the backend, because we
 * have actual emails. The simulations will work perfectly fine for
 * understanding the flow completely, instead of going into the production
 * environment."
 *
 * "Completely" is the word that matters, and it is what separates this from a
 * report of each day. A report computes every step from the same starting
 * position, so the 21st has no idea the 7th happened and both name the same
 * tenants. A month is not like that: the first reminder goes out, some tenants
 * pay, some promise, a fee is raised on the ones who did neither, and the
 * final notice on the 21st goes to who is left. Each day's outcome is the
 * previous day's state plus what happened in between.
 *
 * So state is carried, one day at a time, and the things that would happen in
 * the world rather than in the software - a payment arriving, somebody
 * promising to pay on the phone - are inputs the person running it supplies.
 * That is the part a static report cannot have and the part that makes the
 * flow legible.
 *
 * The days are MES's, from the Flow tab of Detailed AR report(Final).xlsx:
 *
 *   15th   billing runs, usually for the following month
 *    1st   GIRO deductions. 14 calendar days credit expires
 *    4th   upload, tag the date for aging, show by dorm
 *    7th   first reminder as a bulk email, then calls
 *   15th   30 calendar days credit expires
 *   16th   late payment report, anything over 14 days, to the AR team
 *   21st   final notice, then calls
 *
 * Nothing sends. CAN_SEND_FOR_REAL is a constant rather than a setting, and
 * every step here reports and stops.
 */

export const CYCLE_DAYS = [1, 4, 7, 15, 16, 21] as const;
export type CycleDay = (typeof CYCLE_DAYS)[number];

export interface SimEvent {
  day: CycleDay;
  kind: "sent" | "called" | "charged" | "paid" | "promised" | "note" | "blocked";
  text: string;
  /** Tenants involved, where naming them is useful. */
  accounts?: string[];
  value?: number;
}

export interface SimState {
  /** The last day that has been run. Null before it starts. */
  at: CycleDay | null;
  /** Account ids that have had the 7th's first reminder. */
  firstReminder: string[];
  /** Account ids that have had the 21st's final notice. */
  finalNotice: string[];
  /** Account ids that have been rung, and how many times. */
  calls: Record<string, number>;
  /** Account ids the $100 fee has been raised against. */
  charged: string[];
  /** Account ids the person running this has marked as having paid. */
  paid: string[];
  /** Account ids who promised to pay, with what they said. */
  promised: Record<string, { amount: number; by: string }>;
  log: SimEvent[];
}

export function emptyState(): SimState {
  return {
    at: null,
    firstReminder: [],
    finalNotice: [],
    calls: {},
    charged: [],
    paid: [],
    promised: {},
    log: [],
  };
}

const money = (n: number) =>
  `SGD ${n.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Who is still worth chasing, given everything that has happened so far.
 *
 * A tenant drops out for one of two reasons and they are not the same. Paid
 * means the debt is gone. Promised means they said they would pay and the
 * date has not arrived, so they are held rather than settled: if the date
 * passes without payment they come back, which is what the promise tracker is
 * for. Both are excluded here; only one of them is good news.
 */
export function stillOwing(p: Pipeline, s: SimState): Account[] {
  return buildQueue(p.accounts)
    .filter((q) => overdueTotal(q.account) > 0)
    .filter((q) => !s.paid.includes(q.account.id))
    .filter((q) => !(q.account.id in s.promised))
    .map((q) => q.account);
}

/**
 * The thing a day actually produces, rather than a sentence about it.
 *
 * A line reading "3 tenants get the first reminder" is a claim. The three
 * names, their balances, and the letter one of them would receive is the
 * evidence, and it is what somebody watching a demo needs in order to believe
 * the first line. Every day that does something carries one of these.
 */
export interface DayOutput {
  /** What kind of thing this is, for the heading. */
  label: string;
  /** One row per tenant the day touches. */
  rows: { name: string; detail: string; amount: number | null }[];
  /** Tenants the day deliberately skipped, and why. Never hidden. */
  skipped?: { name: string; detail: string; amount: number | null }[];
  skippedLabel?: string;
  /** A real letter, where the day writes one. */
  letter?: { to: string; subject: string; body: string; deadline: string };
}

export interface DayPlan {
  day: CycleDay;
  title: string;
  /** MES's own wording, where the Flow tab gave one. */
  fromFlowTab: string | null;
  /** What running this day would do, given where the month has got to. */
  willDo: string[];
  /** Things somebody has to know before or instead. */
  blockers: string[];
  affected: number;
  value: number;
}

/** What the next day would do, without doing it. */
export function planFor(p: Pipeline, s: SimState, day: CycleDay): DayPlan {
  const owing = stillOwing(p, s);
  const reachable = owing.filter((a) => a.hasContact);
  const unreachable = owing.filter((a) => !a.hasContact);
  const unreachableValue = unreachable.reduce((t, a) => t + overdueTotal(a), 0);
  const value = (list: Account[]) =>
    list.reduce((t, a) => t + overdueTotal(a), 0);

  const sendNote = (): string[] => {
    const out: string[] = [];
    if (!CAN_SEND_FOR_REAL)
      out.push(
        "Nothing leaves. The letters are written and recorded, and sending " +
          "needs MES's own mailbox, which we do not have.",
      );
    if (unreachable.length > 0)
      out.push(
        `${unreachable.length} tenants have no address, holding ` +
          `${money(unreachableValue)}. They go to Send By Hand instead.`,
      );
    return out;
  };

  switch (day) {
    case 1:
      return {
        day,
        title: "GIRO deductions, and the first deadline passes",
        fromFlowTab: "14 calendar days credit from billing date for payment",
        willDo: [
          `${owing.length} tenants are past 14 days from their billing date and enter the queue.`,
          p.giroCustomers.size > 0
            ? `${p.giroCustomers.size} pay by GIRO. If a deduction bounces it is the bank's failure, so they are held back from the fee on the 16th.`
            : "No GIRO tenants are identifiable in this upload.",
        ],
        blockers: [],
        affected: owing.length,
        value: value(owing),
      };

    case 4:
      return {
        day,
        title: "Upload, and the month is rebuilt",
        fromFlowTab:
          "User Uploads AR Report from NS. Tag DATE for Aging Calculation. " +
          "Show by Dorm followed by SD/PF/1FM/LP/SD/RM",
        willDo: [
          `${p.invoices.length} charge lines read into ${p.accounts.length} accounts.`,
          `Grouped into ${p.byProperty.length} dormitories and ${p.revenueTabs.length} charge tabs.`,
          p.asOf
            ? `Keyed off the report's own date, ${p.asOf}, never today's.`
            : "The report carries no date, so the period comes from the upload screen.",
          "Calls, promises and fees already recorded are never touched by an upload.",
        ],
        blockers: p.problems
          .filter((x) => x.severity === "error")
          .slice(0, 3)
          .map((x) => x.message),
        affected: p.accounts.length,
        value: p.invoices.reduce((t, i) => t + i.openBalance, 0),
      };

    case 7: {
      const fresh = reachable.filter((a) => !s.firstReminder.includes(a.id));
      const again = reachable.length - fresh.length;
      return {
        day,
        title: "First reminder, then the calls",
        fromFlowTab:
          "First Reminder - Bulk Email (Email List by Client Name & email " +
          "addresses captured in the system). Call Customer. Repeated calls allowed",
        willDo: [
          `${fresh.length} tenants get MES's first reminder, across ${fresh.reduce((t, a) => t + a.emails.length, 0)} addresses.`,
          "A tenant with several addresses gets it at all of them, not the first.",
          again > 0
            ? `${again} already had it this cycle and are not sent it twice.`
            : "None of them has had it yet this cycle.",
          `${owing.length} go on the call list, worst first. Nobody drops off after one call.`,
        ],
        blockers: sendNote(),
        affected: fresh.length,
        value: value(fresh),
      };
    }

    case 15:
      return {
        day,
        title: "The second deadline passes",
        fromFlowTab: "30 calendar days credit from billing date for payment",
        willDo: [
          "Anything billed 30 days ago and still unpaid is the debt the final notice cites.",
          `${owing.length} tenants are still owing at this point.`,
        ],
        blockers: [],
        affected: owing.length,
        value: value(owing),
      };

    case 16: {
      const due = owing.filter(
        (a) => !s.charged.includes(a.id) && !p.giroCustomers.has(a.customerCode),
      );
      return {
        day,
        title: "Late payment fees, and the report to the AR team",
        fromFlowTab:
          "Late Payment Report - >14 calendar days credit. Send report to AR " +
          "team (provide User the option to select one or more RMs from drop down)",
        willDo: [
          `${due.length} tenants are charged the $${p.lateFees.fee} fee, before GST.`,
          p.giroCustomers.size > 0
            ? `${p.giroCustomers.size} are held back: they are on GIRO and a bounced deduction is not their failure.`
            : "No tenant is held back for GIRO in this upload.",
          p.managerReports.length > 0
            ? `${p.managerReports.length} manager reports go out, one each, in Ray's layout.`
            : "No manager reports: this export carries no Primary Sales Rep column.",
        ],
        blockers: [
          ...(CAN_SEND_FOR_REAL ? [] : ["Nothing leaves. The reports are built and not sent."]),
          ...(p.managerReports.length === 0
            ? ["Without the sales rep column the managers cannot be told apart."]
            : []),
        ],
        affected: due.length,
        value: due.length * p.lateFees.fee,
      };
    }

    case 21: {
      const fresh = reachable.filter((a) => !s.finalNotice.includes(a.id));
      const hadFirst = fresh.filter((a) => s.firstReminder.includes(a.id)).length;
      return {
        day,
        title: "Final notice, then the calls again",
        fromFlowTab:
          "Final Reminder - Bulk Email. Call Customer. Calling E-Form Update. " +
          "Repeated calls allowed. Call status count",
        willDo: [
          `${fresh.length} tenants get the final notice.`,
          hadFirst > 0
            ? `${hadFirst} of them had the first reminder on the 7th and have not paid since.`
            : "None of them was reminded on the 7th, which is worth checking.",
          "It cites the Employment of Foreign Manpower Regulations, so a tenant who has moved out must not receive it.",
          `${p.defaulters.length} have failed more than once and are flagged as repeat defaulters.`,
        ],
        blockers: [
          ...sendNote(),
          "No file MES have sent says who has moved out, so every tenant is treated as still renting.",
        ],
        affected: fresh.length,
        value: value(fresh),
      };
    }
  }
}

/**
 * What a day actually produced, named rather than counted.
 *
 * The screen used to say "3 tenants get the first reminder" and stop, which
 * is a claim. This returns the three names, what each of them owes, and the
 * letter one of them would receive, so somebody watching can check it rather
 * than take it on trust.
 *
 * Skipped tenants are returned alongside rather than left out. The 16th holds
 * GIRO tenants back from the fee, and an exclusion nobody can see is
 * indistinguishable from a bug.
 */
export function outputFor(
  p: Pipeline,
  s: SimState,
  day: CycleDay,
  /**
   * Whether the viewer may read tenant email addresses.
   *
   * view-tenant-emails is a capability CSD and above hold and Management does
   * not, and it was declared and never checked anywhere, which is worse than
   * not declaring it: it reads as protection that is not there. Management can
   * open this screen, so this is where it bites. The count still shows,
   * because "3 addresses" is the useful part and the addresses themselves are
   * the tenant's data.
   */
  showAddresses = true,
): DayOutput | null {
  const owing = stillOwing(p, s);
  const reachable = owing.filter((a) => a.hasContact);
  const unreachable = owing.filter((a) => !a.hasContact);
  const sentOn = p.asOf ?? new Date().toISOString().slice(0, 10);

  const row = (a: Account, detail: string) => ({
    name: a.companyName,
    detail,
    amount: overdueTotal(a),
  });

  if (day === 4) {
    return {
      label: "The six tabs MES asked for, built from this file",
      rows: p.revenueTabs.map((t) => ({
        name: t.name,
        detail: `${t.lineCount} line${t.lineCount === 1 ? "" : "s"}`,
        amount: t.total,
      })),
    };
  }

  if (day === 7 || day === 21) {
    const already = day === 7 ? s.firstReminder : s.finalNotice;
    const fresh = reachable.filter((a) => !already.includes(a.id));
    const first = fresh[0];
    const letter = first
      ? renderLetter(day === 7 ? "first-reminder" : "final-notice", {
          companyName: first.companyName,
          grandTotal: first.total,
          sentOn,
        })
      : null;
    return {
      label:
        day === 7
          ? "Who gets the first reminder, and what it says"
          : "Who gets the final notice, and what it says",
      rows: fresh.map((a) =>
        row(
          a,
          showAddresses
            ? `${a.emails.length} address${a.emails.length === 1 ? "" : "es"}: ${a.emails.join(", ")}`
            : `${a.emails.length} address${a.emails.length === 1 ? "" : "es"} on file`,
        ),
      ),
      skippedLabel: "No address, so their letter goes to Send By Hand",
      skipped: unreachable.map((a) => row(a, a.propertyName)),
      letter: letter
        ? {
            to: showAddresses
              ? first!.emails.join(", ")
              : `${first!.emails.length} address${first!.emails.length === 1 ? "" : "es"} on file`,
            subject: letter.subject,
            body: letter.body,
            deadline: letter.deadline,
          }
        : undefined,
    };
  }

  if (day === 16) {
    const due = owing.filter(
      (a) => !s.charged.includes(a.id) && !p.giroCustomers.has(a.customerCode),
    );
    const held = owing.filter((a) => p.giroCustomers.has(a.customerCode));
    return {
      label: `Who is charged the $${p.lateFees.fee} fee`,
      rows: due.map((a) => row(a, `overdue, fee $${p.lateFees.fee}`)),
      skippedLabel:
        "On GIRO, so held back. A bounced deduction is the bank's failure, not theirs",
      skipped: held.map((a) => row(a, a.propertyName)),
    };
  }

  if (day === 1 || day === 15) {
    return {
      label: day === 1 ? "Who is now past 14 days" : "Who is still owing at 30 days",
      rows: owing.map((a) => row(a, a.propertyName)),
    };
  }

  return null;
}

/**
 * Runs one day and returns the state after it.
 *
 * Pure: it takes a state and gives a new one, so stepping backwards is
 * replaying from the start rather than undoing, and the same inputs always
 * produce the same month.
 */
export function runDay(p: Pipeline, s: SimState, day: CycleDay): SimState {
  const plan = planFor(p, s, day);
  const owing = stillOwing(p, s);
  const reachable = owing.filter((a) => a.hasContact);
  const next: SimState = {
    ...s,
    at: day,
    firstReminder: [...s.firstReminder],
    finalNotice: [...s.finalNotice],
    calls: { ...s.calls },
    charged: [...s.charged],
    log: [...s.log],
  };

  const add = (e: Omit<SimEvent, "day">) => next.log.push({ day, ...e });

  if (day === 7) {
    const fresh = reachable.filter((a) => !s.firstReminder.includes(a.id));
    next.firstReminder.push(...fresh.map((a) => a.id));
    for (const a of owing) next.calls[a.id] = (next.calls[a.id] ?? 0) + 1;
    add({
      kind: "sent",
      text: `First reminder written for ${fresh.length} tenants`,
      accounts: fresh.map((a) => a.companyName),
      value: fresh.reduce((t, a) => t + overdueTotal(a), 0),
    });
    add({ kind: "called", text: `${owing.length} tenants added to the call list` });
    for (const b of plan.blockers) add({ kind: "blocked", text: b });
  }

  if (day === 16) {
    const due = owing.filter(
      (a) => !s.charged.includes(a.id) && !p.giroCustomers.has(a.customerCode),
    );
    next.charged.push(...due.map((a) => a.id));
    add({
      kind: "charged",
      text: `$${p.lateFees.fee} fee raised against ${due.length} tenants`,
      accounts: due.map((a) => a.companyName),
      value: due.length * p.lateFees.fee,
    });
    for (const b of plan.blockers) add({ kind: "blocked", text: b });
  }

  if (day === 21) {
    const fresh = reachable.filter((a) => !s.finalNotice.includes(a.id));
    next.finalNotice.push(...fresh.map((a) => a.id));
    for (const a of owing) next.calls[a.id] = (next.calls[a.id] ?? 0) + 1;
    add({
      kind: "sent",
      text: `Final notice written for ${fresh.length} tenants`,
      accounts: fresh.map((a) => a.companyName),
      value: fresh.reduce((t, a) => t + overdueTotal(a), 0),
    });
    add({ kind: "called", text: `${owing.length} tenants rung again` });
    for (const b of plan.blockers) add({ kind: "blocked", text: b });
  }

  if (day === 1 || day === 4 || day === 15) {
    add({ kind: "note", text: plan.title });
  }

  return next;
}

/** A tenant pays. Everything after this stops chasing them. */
export function markPaid(s: SimState, a: Account, day: CycleDay): SimState {
  return {
    ...s,
    paid: [...s.paid, a.id],
    log: [
      ...s.log,
      {
        day,
        kind: "paid",
        text: `${a.companyName} paid ${money(overdueTotal(a))}`,
        accounts: [a.companyName],
        value: overdueTotal(a),
      },
    ],
  };
}

/**
 * A tenant promises to pay. Held, not settled.
 *
 * The difference matters on the 21st: a promise keeps the final notice away
 * while the date stands, and the moment it passes unpaid they are back. A
 * system that treated the two the same would stop chasing somebody who only
 * said they would pay.
 */
export function markPromised(
  s: SimState,
  a: Account,
  by: string,
  day: CycleDay,
): SimState {
  const amount = overdueTotal(a);
  return {
    ...s,
    promised: { ...s.promised, [a.id]: { amount, by } },
    log: [
      ...s.log,
      {
        day,
        kind: "promised",
        text: `${a.companyName} promised ${money(amount)} by ${by}`,
        accounts: [a.companyName],
        value: amount,
      },
    ],
  };
}

/** Where the month has got to, for the tiles above the steps. */
export function snapshot(p: Pipeline, s: SimState) {
  const owing = stillOwing(p, s);
  return {
    tenants: p.accounts.length,
    lines: p.invoices.length,
    owing: owing.length,
    owed: owing.reduce((t, a) => t + overdueTotal(a), 0),
    reachable: owing.filter((a) => a.hasContact).length,
    reminded: s.firstReminder.length,
    finalised: s.finalNotice.length,
    charged: s.charged.length,
    feeValue: s.charged.length * p.lateFees.fee,
    paid: s.paid.length,
    promised: Object.keys(s.promised).length,
    errors: p.problems.filter((x) => x.severity === "error").length,
    warnings: p.problems.filter((x) => x.severity === "warning").length,
  };
}
