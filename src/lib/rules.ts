/**
 * MES's choices about fees and reports, as settings.
 *
 * Settled with MES one at a time in October, and kept here rather than in the
 * code so they can change them on the Settings screen without a release. The
 * reminder choices live with the reminder timing (reminder-timing.ts); these
 * are the rest. Stored in app_settings as "business_rules", read by the 9am
 * run and the screens alike.
 */

export interface BusinessRules {
  /** A bill is charged the $100 once it is more than this many days past... */
  feeDays: number;
  /** ...its due date (agreed 24 October) or its billing date. */
  feeFrom: "due" | "billing";
  /** The day of the month MES bill on. Any other day is ad hoc. */
  regularBillingDay: number;
  /** Say the report is getting old once it is more than this many days old. */
  warnReportAfter: number;
  /** Stop sending and charging once it is more than this many days old, or
      never (null, agreed 24 October: keeping it current is MES's). */
  stopReportAfter: number | null;
}

export const DEFAULT_RULES: BusinessRules = {
  feeDays: 14,
  feeFrom: "due",
  regularBillingDay: 15,
  warnReportAfter: 16,
  stopReportAfter: null,
};

const whole = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

/** Anything stored or sent, as a complete and sensible set of rules. */
export function saneRules(value: unknown): BusinessRules {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    feeDays: whole(v.feeDays, 0, 365, DEFAULT_RULES.feeDays),
    feeFrom: v.feeFrom === "billing" ? "billing" : "due",
    regularBillingDay: whole(v.regularBillingDay, 1, 31, DEFAULT_RULES.regularBillingDay),
    warnReportAfter: whole(v.warnReportAfter, 0, 365, DEFAULT_RULES.warnReportAfter),
    stopReportAfter:
      v.stopReportAfter === null || v.stopReportAfter === undefined || v.stopReportAfter === ""
        ? null
        : whole(v.stopReportAfter, 1, 365, 25),
  };
}
