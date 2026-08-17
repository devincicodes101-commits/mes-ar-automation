import raw from "./mock/arData.json";
import {
  Account,
  ArData,
  BucketKey,
  Invoice,
  QueueItem,
  QueueReason,
} from "./types";

/**
 * Prototype data layer.
 *
 * Every value here is parsed from the two workbooks MES supplied, so the
 * screens show their real tenants and real balances. When the FastAPI backend
 * lands, only this module changes: the components read from these functions,
 * never from the JSON directly.
 */
export const data = raw as unknown as ArData;

export const AS_OF = data.asOfSummary;

export function allAccounts(): Account[] {
  return data.accounts;
}

export function accountById(id: string): Account | undefined {
  return data.accounts.find((a) => a.id === id);
}

const norm = (s: string) => s.trim().replace(/\.$/, "").toUpperCase();

export function invoicesForAccount(account: Account): Invoice[] {
  const key = norm(account.companyName);
  return data.invoices.filter((i) => norm(i.companyName) === key);
}

/** Balance sitting at 30 days or worse. This is what MES actually chases. */
export function overdueTotal(a: Account): number {
  return a.buckets.d30 + a.buckets.d60 + a.buckets.d90 + a.buckets.d90plus;
}

export function severeTotal(a: Account): number {
  return a.buckets.d90 + a.buckets.d90plus;
}

export function isInCredit(a: Account): boolean {
  return a.total < 0;
}

export interface Kpis {
  outstanding: number;
  overdue: number;
  severe: number;
  actionable: number;
  inCredit: number;
  accounts: number;
}

export function kpis(accounts: Account[]): Kpis {
  return accounts.reduce<Kpis>(
    (acc, a) => {
      acc.accounts += 1;
      acc.outstanding += a.total;
      acc.overdue += overdueTotal(a);
      acc.severe += severeTotal(a);
      if (isInCredit(a)) acc.inCredit += 1;
      // An account in credit is never chased, whatever its aging columns say.
      if (!isInCredit(a) && overdueTotal(a) > 0) acc.actionable += 1;
      return acc;
    },
    {
      outstanding: 0,
      overdue: 0,
      severe: 0,
      actionable: 0,
      inCredit: 0,
      accounts: 0,
    },
  );
}

export function bucketTotals(accounts: Account[]): Record<BucketKey, number> {
  return accounts.reduce(
    (acc, a) => {
      acc.current += a.buckets.current;
      acc.d30 += a.buckets.d30;
      acc.d60 += a.buckets.d60;
      acc.d90 += a.buckets.d90;
      acc.d90plus += a.buckets.d90plus;
      return acc;
    },
    { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 } as Record<
      BucketKey,
      number
    >,
  );
}

/**
 * Deterministic queue ranking. No AI anywhere near this: MES asked for
 * predictable behaviour on anything involving money.
 */
export function buildQueue(accounts: Account[]): QueueItem[] {
  const items: QueueItem[] = [];

  for (const account of accounts) {
    // Never chase a tenant who is in credit.
    if (isInCredit(account)) continue;

    const overdue = overdueTotal(account);
    const reasons: QueueReason[] = [];

    if (overdue > 0) reasons.push("aging-30");
    if (severeTotal(account) > 0) reasons.push("aging-90");
    if (account.lateFeeCount >= 3) reasons.push("giro-refer-paying-party");
    if (!account.hasContact && overdue > 0) reasons.push("no-contact");
    if (account.legacyNote) reasons.push("promise-broken");

    if (reasons.length === 0) continue;

    let priority = 0;
    priority += severeTotal(account) * 3;
    priority += account.buckets.d60 * 2;
    priority += account.buckets.d30;
    priority += account.lateFeeCount * 500;
    if (account.status === "Terminated") priority *= 0.6;

    items.push({ account, reasons, priority, overdue });
  }

  return items.sort((a, b) => b.priority - a.priority);
}

export function formatSgd(value: number, opts?: { sign?: boolean }): string {
  const abs = Math.abs(value);
  const s = abs.toLocaleString("en-SG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (value < 0) return opts?.sign ? `(${s})` : `-${s}`;
  return s;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-SG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/* --------------------------------------------------------------- GIRO status */

export type GiroStatus = "enrolled" | "no-mandate" | "unknown";

export const GIRO_LABEL: Record<GiroStatus, string> = {
  enrolled: "On GIRO, payment rejected",
  "no-mandate": "No GIRO mandate",
  unknown: "GIRO status not confirmed",
};

/**
 * Proposal 4.4 requires the queue to show GIRO status.
 *
 * The AR report carries no such column, and the bank report that would answer
 * it has the tenant names redacted. What we can prove: if a tenant has been
 * charged the rejected GIRO admin fee, a deduction was attempted against them,
 * so a mandate must exist. Everything else stays honestly unknown rather than
 * being guessed.
 */
export function giroStatus(a: Account): GiroStatus {
  if (a.revenueTypes.includes("Rejected GIRO Fee")) return "enrolled";
  return "unknown";
}

/** The worst bucket an account has money sitting in. Used on the call form. */
export function worstBucket(a: Account): string {
  if (a.buckets.d90plus > 0) return "More than 90 days";
  if (a.buckets.d90 > 0) return "90 days";
  if (a.buckets.d60 > 0) return "60 days";
  if (a.buckets.d30 > 0) return "30 days";
  return "Current";
}

/**
 * The date the bank last attempted collection, from the DBS batch header.
 * Per tenant dates need the unredacted report, so this is the batch level date
 * and the screen labels it as such.
 */
export const LAST_BANK_RUN = "2026-05-04";

/* ------------------------------------------------ revenue type segmentation */

/** The detailed report labels buckets in words. Map them onto our keys. */
const BUCKET_FROM_LABEL: Record<string, BucketKey> = {
  Current: "current",
  "30 days": "d30",
  "60 days": "d60",
  "90 days": "d90",
  "More than 90 days": "d90plus",
};

export interface RevenueRow {
  type: string;
  buckets: Record<BucketKey, number>;
  total: number;
  invoices: number;
  companies: number;
  isOneFm: boolean;
}

/**
 * Splits the outstanding balance by what it is actually for, so the officer can
 * see whether a balance is rent, maintenance raised through 1FM, or a fee.
 * Proposal 4.3.
 *
 * Built from the invoice level report, which in the sample covers fewer
 * tenants than the summary. The screen says so rather than hiding it.
 */
export function revenueBreakdown(accounts: Account[]): RevenueRow[] {
  const names = new Set(accounts.map((a) => norm(a.companyName)));
  const rows = new Map<string, RevenueRow>();

  for (const inv of data.invoices) {
    if (!names.has(norm(inv.companyName))) continue;

    const row =
      rows.get(inv.revenueType) ??
      ({
        type: inv.revenueType,
        buckets: { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 },
        total: 0,
        invoices: 0,
        companies: 0,
        isOneFm: false,
      } as RevenueRow);

    const key = BUCKET_FROM_LABEL[inv.bucket];
    if (key) row.buckets[key] += inv.openBalance;
    row.total += inv.openBalance;
    row.invoices += 1;
    if (inv.isOneFm) row.isOneFm = true;
    rows.set(inv.revenueType, row);
  }

  // Count distinct companies per revenue type.
  const out = Array.from(rows.values());
  for (const row of out) {
    row.companies = new Set(
      data.invoices
        .filter(
          (i) => i.revenueType === row.type && names.has(norm(i.companyName)),
        )
        .map((i) => norm(i.companyName)),
    ).size;
  }

  return out.sort((a, b) => b.total - a.total);
}

/** Every revenue type present in the data, for filter menus. */
export function revenueTypes(): string[] {
  return Array.from(new Set(data.invoices.map((i) => i.revenueType))).sort();
}

/* ------------------------------------------------------- late payment fees */

export type FeeBasis = "flat" | "percent";

export interface FeeRule {
  basis: FeeBasis;
  /** Dollar amount when flat, percentage points when percent. */
  value: number;
  /** Only charge accounts owing at least this much. */
  minimumBalance: number;
  /** Skip accounts that have already moved out. */
  skipTerminated: boolean;
}

/**
 * Default reflects what the sample data actually shows: the same flat charge
 * repeating each month. MES has not confirmed the rule, so it is editable on
 * screen rather than hard coded. Proposal 4.8.
 */
export const DEFAULT_FEE_RULE: FeeRule = {
  basis: "flat",
  value: 20,
  minimumBalance: 0,
  skipTerminated: false,
};

export interface FeeLine {
  account: Account;
  overdue: number;
  fee: number;
  alreadyCharged: number;
}

export function feesDue(accounts: Account[], rule: FeeRule): FeeLine[] {
  return accounts
    .filter((a) => !isInCredit(a))
    .filter((a) => (rule.skipTerminated ? a.status !== "Terminated" : true))
    .map((a) => ({ account: a, overdue: overdueTotal(a) }))
    .filter((r) => r.overdue > rule.minimumBalance)
    .map((r) => ({
      account: r.account,
      overdue: r.overdue,
      fee:
        rule.basis === "flat"
          ? rule.value
          : Math.round(r.overdue * (rule.value / 100) * 100) / 100,
      alreadyCharged: r.account.lateFeeCount,
    }))
    .sort((a, b) => b.overdue - a.overdue);
}

/** Written for the officer reading the screen, not for the spec. */
export const REASON_LABEL: Record<QueueReason, string> = {
  "giro-no-dda": "Never set up GIRO",
  "giro-refer-paying-party": "Payment fails every month",
  "aging-30": "Overdue more than 30 days",
  "aging-90": "Owed for over 90 days",
  "promise-broken": "Promised to pay",
  "no-contact": "No email address",
};
