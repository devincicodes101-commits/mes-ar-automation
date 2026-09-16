import type { Invoice } from "./types";

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
  /** Billing date plus the 14 day credit period. */
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
export type BillingLine = Omit<Invoice, "id"> & { id?: string };

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
    const dueBy = addDays(billedOn, CREDIT_DAYS);
    const ageDays = asOf ? daysBetween(billedOn, asOf) : null;
    // Past its own credit period as at the report date. Falls back to the
    // line's own age, which is days past its due date, where the report has
    // no date of its own to measure from.
    const isOverdue = (inv: BillingLine) =>
      ageDays === null ? (inv.age ?? 0) > 0 : ageDays > CREDIT_DAYS;

    cycles.push({
      billedOn,
      dueBy,
      finalBy: addDays(billedOn, FINAL_CREDIT_DAYS),
      lines: lines.length,
      tenants: new Set(lines.map((l) => l.companyName)).size,
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
