import type { Invoice, PropertyCode } from "./types";
import { round2 } from "./aging-detail.ts";

/**
 * What is outstanding, grouped by the billing date it came from.
 *
 * Raman, 14 September: "the starting point is the billing date. Billing date
 * plus seven, plus 14, plus 21. Everything from there. So in one report you
 * may have several billing dates. So under that is what's aging. If you can
 * visually show it in a way that's quite intuitive, that'd be great."
 *
 * The aging itself was already measured per line: every invoice keeps its own
 * billing date, due date and age, and its bucket comes from that age rather
 * than from one date for the whole file. What did not exist was any way to
 * see it. MES's August export carries 28 distinct billing dates and every
 * screen added them together, so "this month's rent" and "a bill from March
 * nobody has paid" were one number.
 *
 * Their calendar, from the Flow tab of Detailed AR report(Final):
 *
 *   15th   billing runs, usually for the following month
 *   1st    14 calendar days credit from the billing date expires
 *   7th    first reminder
 *   15th   30 calendar days credit expires
 *   16th   late payment report, anything past 14 days
 *   21st   final notice
 *
 * Adhoc billing happens on other dates too, which is exactly why this cannot
 * assume one cycle a month.
 */

/** MES give 14 calendar days from the billing date before payment is late. */
export const CREDIT_DAYS = 14;

/** And a second deadline at 30 days, which is what the final notice cites. */
export const FINAL_CREDIT_DAYS = 30;

export interface BillingCycle {
  /** The billing date every line in this group shares. */
  billedOn: string;
  /**
   * When payment falls due: the date the file states, or the billing date
   * plus the 14 day credit period where it states none.
   */
  dueBy: string;
  /** Billing date plus 30 days, the second deadline. */
  finalBy: string;
  lines: number;
  tenants: number;
  total: number;
  /** Of that total, the part already past its 14 day credit period. */
  overdue: number;
  /** Days between the billing date and the report date. Negative is future. */
  ageDays: number | null;

  /*
   * Who the run covers, most owed first.
   *
   * A row saying "2 tenants, 7,400" cannot be checked against anything. The
   * names can: somebody can open the spreadsheet, filter on that billing date,
   * and see the same companies. Most runs are one company anyway, and MES's
   * August export has 190 of its 315 runs that way.
   */
  who: { name: string; customerCode: string | null; property: PropertyCode | null; owed: number }[];

  /** The dormitories this run touches, in the order they were met. */
  properties: PropertyCode[];
}

function addDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  // Local noon, so a daylight saving shift on the reader's machine cannot
  // round the result onto the neighbouring day. Same reason as excelDate.
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  d.setDate(d.getDate() + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function daysBetween(from: string, to: string): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to);
  if (!a || !b) return null;
  const x = new Date(Number(a[1]), Number(a[2]) - 1, Number(a[3]), 12);
  const y = new Date(Number(b[1]), Number(b[2]) - 1, Number(b[3]), 12);
  return Math.round((y.getTime() - x.getTime()) / 86_400_000);
}

/**
 * One row per billing date, newest first.
 *
 * Lines with no billing date are left out rather than lumped into a bucket
 * they do not belong to: `undated` says how many, so the caller can say so
 * instead of quietly under-reporting. MES's own sample has twelve.
 *
 * A line counts as overdue on its own terms, not the group's. The 14 day
 * credit runs from the billing date, so a line billed on the 3rd of August is
 * still inside its credit period while one billed in March is years past it,
 * and both can sit in the same upload.
 */
/**
 * A charge line as this module needs it.
 *
 * `id` is optional because a line straight out of the parser has not been
 * given one, and nothing here reads it: lines are grouped by their billing
 * date and added up. Demanding an id would mean numbering three thousand rows
 * to satisfy a type, or casting at every call site, which is the same thing
 * with the check switched off.
 */
export type BillingLine = Omit<Invoice, "id"> & {
  id?: string;
  /** Which dormitory the line belongs to, where the parser worked one out. */
  property?: PropertyCode;
  customerCode?: string;
};

/** One entry per company in a run, biggest balance first. */
function whoIsIn(lines: readonly BillingLine[]) {
  const by = new Map<string, { name: string; customerCode: string | null; property: PropertyCode | null; owed: number }>();
  for (const l of lines) {
    const key = l.customerCode ?? l.companyName;
    const at = by.get(key) ?? {
      name: l.companyName,
      customerCode: l.customerCode ?? null,
      property: l.property ?? null,
      owed: 0,
    };
    at.owed = round2(at.owed + l.openBalance);
    by.set(key, at);
  }
  return Array.from(by.values()).sort((a, b) => b.owed - a.owed);
}

export function billingCycles(
  invoices: readonly BillingLine[],
  asOf: string | null,
): { cycles: BillingCycle[]; undated: number; undatedTotal: number } {
  const groups = new Map<string, BillingLine[]>();
  let undated = 0;
  let undatedTotal = 0;

  for (const inv of invoices) {
    if (!inv.date) {
      undated += 1;
      undatedTotal += inv.openBalance;
      continue;
    }
    groups.set(inv.date, [...(groups.get(inv.date) ?? []), inv]);
  }

  const cycles: BillingCycle[] = [];
  for (const [billedOn, lines] of Array.from(groups)) {
    /*
     * The due date NetSuite put in the file, where the run agrees on one.
     *
     * This used to be the billing date plus fourteen, always, and it produced
     * a screen that contradicted the file it had just read: MES's export dates
     * a run billed on 15 August as due on the 30th, and the table said the
     * 29th. Their written rule is fourteen calendar days and NetSuite's terms
     * are fifteen, so the two disagree by a day on every line.
     *
     * The file wins for the date shown, because it is the date the tenant was
     * actually given and the one their Age column is measured from. The
     * fourteen day rule still decides whether a run is late, because that is
     * what MES wrote down twice and what their cycle is built on. Where a run
     * carries no due date, or its lines disagree about it, the rule fills in.
     *
     * The gap between the two is the open question for MES: their rule says
     * fourteen days, their system says fifteen, and their own worked example
     * says the first of the following month, which is seventeen.
     */
    const stated = new Set(lines.map((l) => l.dueDate).filter(Boolean));
    const dueBy =
      stated.size === 1 ? (Array.from(stated)[0] as string) : addDays(billedOn, CREDIT_DAYS);
    const ageDays = asOf ? daysBetween(billedOn, asOf) : null;
    /*
     * Overdue on the same terms as every other screen: the line's own age,
     * which is days past its due date and is MES's own Age column.
     *
     * This used to count from the billing date instead, against the 14 day
     * credit rule, and the two disagree because MES's due dates are billing
     * plus fifteen rather than plus fourteen. The result was one screen
     * contradicting itself: the tile at the top said 47,100 needed chasing
     * while the line under this table said 58,100 was past its credit period.
     * A tenant billed on 31 August read as "Current" in their own row and as
     * overdue in their billing run.
     *
     * The file's own age wins because it is the figure that reconciles with
     * MES's spreadsheet, on 173 of 173 lines of their real export. The credit
     * clock is still shown, in the "where it stands" column, because it is
     * their stated rule and it is what the reminders are timed off. It is a
     * fact about the run, not about whether the money is yet chaseable.
     *
     * The gap between the two is the open question for MES, and it is worth
     * repeating here because it is the cause: their rule says fourteen days,
     * their system issues due dates at fifteen, and their worked example
     * implies seventeen.
     */
    const isOverdue = (inv: BillingLine) => {
      /*
       * "Past due" means the line has left the Current bucket, not merely that
       * its due date has passed. MES count up to fifteen days past due as
       * Current, so a line at day fifteen is late in plain English and not yet
       * chaseable by their rules, and the tiles above this table are built
       * from exactly that distinction.
       *
       * Read off the line's own bucket rather than recomputing a threshold,
       * because the bucket is MES's figure and a second copy of the boundary
       * here is a second thing to get wrong.
       */
      if (inv.bucket) return inv.bucket.trim().toLowerCase() !== "current";
      // No bucket on the line, which the parser warns about. Fall back to the
      // age and the same boundary the buckets use.
      return (inv.age ?? 0) > 15;
    };

    cycles.push({
      billedOn,
      dueBy,
      finalBy: addDays(billedOn, FINAL_CREDIT_DAYS),
      lines: lines.length,
      tenants: new Set(lines.map((l) => l.companyName)).size,
      who: whoIsIn(lines),
      properties: Array.from(
        new Set(lines.map((l) => l.property).filter(Boolean) as PropertyCode[]),
      ),
      total: lines.reduce((s, l) => s + l.openBalance, 0),
      overdue: lines.reduce((s, l) => s + (isOverdue(l) ? l.openBalance : 0), 0),
      ageDays,
    });
  }

  cycles.sort((a, b) => b.billedOn.localeCompare(a.billedOn));
  return { cycles, undated, undatedTotal };
}

/** Which of MES's deadlines this billing date has passed, as at the report. */
export function cycleStage(
  c: BillingCycle,
): "not yet due" | "within credit" | "past 14 days" | "past 30 days" {
  if (c.ageDays === null) return "within credit";
  if (c.ageDays < 0) return "not yet due";
  if (c.ageDays <= CREDIT_DAYS) return "within credit";
  if (c.ageDays <= FINAL_CREDIT_DAYS) return "past 14 days";
  return "past 30 days";
}
