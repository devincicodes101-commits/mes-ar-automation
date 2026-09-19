/**
 * Clients who have been all the way round MES's cycle and still owe.
 *
 * Their workflow runs billing date, fourteen days' credit, first reminder,
 * calls, the $100 fee, final notice. Then their lifecycle note says what
 * happens next, and it is not escalation:
 *
 *   "Still unpaid. Rolls into next month one bucket older, and the cycle
 *    restarts with the September bill."
 *
 * So there is no legal step to build. What MES have instead is a question
 * their own note poses and their screens never answered: "a tenant who pays
 * late every month is a different conversation from one who forgot once."
 * This is the list that tells them apart.
 *
 * ---------------------------------------------------------------------------
 * How a completed cycle is recognised
 *
 * From the $100 fee. MES raise it on the 16th, only against clients who are
 * more than fourteen days late, and only once per cycle. So one fee line is
 * one cycle that ran to the end with the client still owing. Their own
 * wording carries the month with it — "Admin Fee For Late Payment - JAN'26" —
 * and on all twenty-seven fees in their August export the label agrees with
 * the date the fee was raised, so the date is used: it is the same answer and
 * it does not depend on their wording staying constant.
 *
 * Reading it from the fee rather than from our own send history matters,
 * because it works on the very first upload. DORM-117 shows seven completed
 * cycles from January to July in a file we have only just read, without this
 * system having run a single one of them.
 *
 * Where we have also sent the letters ourselves, that is counted separately
 * and shown alongside: one is what MES's own ledger says happened, the other
 * is what this system did.
 */

import type { Account, Invoice } from "./types";
import { overdueTotal, severeTotal } from "./data.ts";

/** A charge line as this module needs it. `id` is not read. */
type Line = Omit<Invoice, "id"> & { id?: string; customerCode?: string };

export interface ChasedRow {
  account: Account;

  /** Completed cycles, one per $100 fee raised against them. */
  cycles: number;
  /** The months those cycles ran, oldest first, as YYYY-MM. */
  months: string[];
  /** The longest unbroken run of them. */
  inARow: number;
  /** The most recent month a cycle completed, or null. */
  lastMonth: string | null;
  /**
   * Whole months between the last completed cycle and the report date.
   *
   * Zero means it happened in the month this report covers, so the cycle they
   * are in now is the one that has just finished. A larger number means they
   * stopped being chased, which is worth seeing: either somebody agreed
   * something off-system, or they fell through.
   */
  monthsSince: number | null;

  /**
   * Of those cycles, how many this system ran itself.
   *
   * Separate from the total because the two are different evidence. A fee in
   * MES's export is a charge their ledger carries; a fee raised here is one
   * this system raised on the 16th and nobody has entered into NetSuite yet.
   * Both mean a cycle ran to the end with the tenant still owing.
   */
  ourCycles: number;

  /** Bounced GIRO deductions, which are a different failure from paying late. */
  giroFails: number;

  outstanding: number;
  /** Of that, the part over ninety days old. */
  severe: number;
}

const MONTH_KEY = /^(\d{4})-(\d{2})/;

/** "2026-03" as a comparable month count, for measuring gaps. */
function monthIndex(month: string): number | null {
  const m = MONTH_KEY.exec(month);
  if (!m) return null;
  return Number(m[1]) * 12 + Number(m[2]);
}

/** The longest run of consecutive months in a sorted, deduplicated list. */
export function longestStreak(months: readonly string[]): number {
  let best = 0;
  let run = 0;
  let previous: number | null = null;
  for (const month of Array.from(new Set(months)).sort()) {
    const index = monthIndex(month);
    if (index === null) continue;
    run = previous !== null && index === previous + 1 ? run + 1 : 1;
    previous = index;
    if (run > best) best = run;
  }
  return best;
}

/** Whole months from one YYYY-MM to another. Null if either cannot be read. */
export function monthsBetween(from: string, to: string): number | null {
  const a = monthIndex(from);
  const b = monthIndex(to);
  if (a === null || b === null) return null;
  return b - a;
}

function keyOf(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * The list, worst first.
 *
 * Sorted by the longest unbroken run before the raw count, because that is the
 * distinction MES's own note draws. Seven months in a row is an argument for
 * ending a contract; four spread across a year is a reminder to call sooner.
 *
 * A client who has completed a cycle and since paid does not appear: they are
 * filtered on still owing, so they fall off this list the moment a report
 * shows the money in. Nothing has to be closed by hand.
 */
export function chasedToTheEnd(
  invoices: readonly Line[],
  accounts: readonly Account[],
  asOf: string | null,
  minimumCycles = 1,
  /**
   * Fees this system raised, as {tenantId, period}.
   *
   * Without them this list reads MES's export alone, which is right for a
   * first upload and wrong from the moment the system starts raising fees
   * itself: a tenant chased all the way round — both letters, a call, the
   * $100 — showed nowhere, because the only evidence of the cycle having run
   * was a row nobody here was reading.
   *
   * Optional, so the old answer is still available where there is nothing of
   * our own to add.
   */
  raised: readonly { tenantId: string; period: string }[] = [],
): ChasedRow[] {
  const feeMonths = new Map<string, string[]>();
  const giro = new Map<string, number>();

  for (const line of invoices) {
    const code = line.customerCode ?? line.companyName;
    if (!code) continue;
    const key = keyOf(code);

    if (line.revenueType === "Late Payment Fee" && line.date) {
      feeMonths.set(key, [...(feeMonths.get(key) ?? []), line.date.slice(0, 7)]);
    }
    if (line.revenueType === "Rejected GIRO Fee") {
      giro.set(key, (giro.get(key) ?? 0) + 1);
    }
  }

  /* Ours are keyed on the tenant id, MES's on the customer code, because the
     two arrive from different places. Merged per account below rather than
     forcing one key on both. */
  const ourMonths = new Map<string, string[]>();
  for (const r of raised) {
    ourMonths.set(r.tenantId, [...(ourMonths.get(r.tenantId) ?? []), r.period.slice(0, 7)]);
  }

  const reportMonth = asOf ? asOf.slice(0, 7) : null;
  const rows: ChasedRow[] = [];

  for (const account of accounts) {
    const key = keyOf(account.customerCode || account.companyName);
    const theirs = feeMonths.get(key) ?? [];
    const ours = ourMonths.get(account.id) ?? [];
    /* A month counts once however many places it came from. MES entering our
       fee into NetSuite must not turn one cycle into two. */
    const months = Array.from(new Set([...theirs, ...ours])).sort();
    if (months.length < minimumCycles) continue;

    // Still owing is the whole point. A client who completed the cycle and
    // then paid belongs in the history, not on a list of people to act on.
    const outstanding = overdueTotal(account);
    if (outstanding <= 0) continue;

    const lastMonth = months[months.length - 1] ?? null;
    rows.push({
      account,
      cycles: months.length,
      months,
      inARow: longestStreak(months),
      lastMonth,
      monthsSince:
        lastMonth && reportMonth ? monthsBetween(lastMonth, reportMonth) : null,
      ourCycles: Array.from(new Set(ours)).length,
      giroFails: giro.get(key) ?? 0,
      outstanding,
      severe: severeTotal(account),
    });
  }

  return rows.sort(
    (a, b) =>
      b.inARow - a.inARow ||
      b.cycles - a.cycles ||
      b.outstanding - a.outstanding,
  );
}

/** "2026-01" as "Jan 26", which is how MES write it on the fee itself. */
export function shortMonth(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  const names = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                 "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(m[2])] ?? m[2]} ${m[1]!.slice(2)}`;
}

/**
 * How hard this one is, in a word.
 *
 * Three or more months running is where MES's own example sits: BURNING SUN,
 * charged four times, named in their lifecycle note as the case that is "a
 * different conversation".
 */
export function severity(row: ChasedRow): "chronic" | "repeat" | "once" {
  if (row.inARow >= 3) return "chronic";
  if (row.cycles >= 2) return "repeat";
  return "once";
}
