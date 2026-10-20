import type { ParseResult } from "./parser.ts";

/**
 * Which billing month a report is for, read from the report itself.
 *
 * The upload screen used to open on a fixed sample month and ask the officer
 * to pick, which is how a September file gets filed under August. The month is
 * in the file: every charge carries the date it was billed.
 *
 * The month most tenants were last billed in is the cycle the report belongs
 * to. Not the "As of" date and not the day it is uploaded: MES export on or
 * after the 15th and may load it weeks later, and the October report can
 * arrive in November, so neither date names the cycle. A handful of tenants
 * billed ad hoc, or long ago and never since, do not move it, because it is
 * the majority that decides.
 *
 * It is a suggestion. The screen fills it in and says how it was read, and the
 * officer can change it. Where the file has no bill dates the report's own
 * date is the fallback, and the screen says that is what it used.
 */
export interface PeriodGuess {
  /** YYYY-MM, as the month picker holds it. */
  period: string;
  basis: "bills" | "report-date";
  /** How many tenants' newest bill falls in that month, and out of how many. */
  tenants: number;
  of: number;
  /** The most common billing date inside that month, ISO, to show as the example. */
  example: string | null;
}

export function suggestPeriod(results: readonly ParseResult[]): PeriodGuess | null {
  for (const r of results) {
    if (r.kind !== "ar-aging-detail") continue;

    /* Each tenant's newest bill date. */
    const newest = new Map<string, string>();
    for (const inv of r.invoices) {
      if (!inv.date) continue;
      const seen = newest.get(inv.customerCode);
      if (!seen || inv.date > seen) newest.set(inv.customerCode, inv.date);
    }

    if (newest.size > 0) {
      const months = new Map<string, number>();
      const days = new Map<string, number>();
      for (const d of Array.from(newest.values())) {
        const m = d.slice(0, 7);
        months.set(m, (months.get(m) ?? 0) + 1);
        days.set(d, (days.get(d) ?? 0) + 1);
      }
      /* Most tenants wins; a tie goes to the later month, the fresher cycle. */
      const best = Array.from(months.entries()).sort(
        (a, b) => b[1] - a[1] || b[0].localeCompare(a[0]),
      )[0]!;
      const example =
        Array.from(days.entries())
          .filter(([d]) => d.startsWith(best[0]))
          .sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0] ?? null;
      return { period: best[0], basis: "bills", tenants: best[1], of: newest.size, example };
    }

    if (r.asOf && /^\d{4}-\d{2}/.test(r.asOf)) {
      return { period: r.asOf.slice(0, 7), basis: "report-date", tenants: 0, of: 0, example: r.asOf };
    }
  }
  return null;
}
