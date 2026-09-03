import raw from "./mock/arData.json" with { type: "json" };
import type {
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

/**
 * Invoice lookups take the invoice list explicitly. Screens pass whatever the
 * active dataset holds, so an uploaded file is used rather than the sample.
 * The default keeps older call sites working.
 */
export function invoicesForAccount(
  account: Account,
  invoices: Invoice[] = data.invoices as Invoice[],
): Invoice[] {
  const key = norm(account.companyName);
  return invoices.filter((i) => norm(i.companyName) === key);
}

/** Balance sitting at 30 days or worse. This is what MES actually chases. */
/**
 * What is past the trigger line, meaning everything outside Current.
 *
 * Worth knowing what that is in days. MES count anything up to and including
 * 15 days past due as Current, so this is "more than 15 days overdue", not
 * "more than 30". The proposal and MES both call it the 30-day trigger line
 * because the first bucket past it is labelled "30 days", and that name is
 * kept here so the screens match the language MES use.
 *
 * It is the right measure for deciding who to chase. It is the wrong measure
 * for the late payment fee, which falls due at 14 days and is therefore still
 * inside Current: see feesDue.
 */
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
    if (account.lateFeeCount >= 3) reasons.push("repeat-late-fees");
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

/** The worst bucket an account has money sitting in. Used on the call form. */
export function worstBucket(a: Account): string {
  if (a.buckets.d90plus > 0) return "More than 90 days";
  if (a.buckets.d90 > 0) return "90 days";
  if (a.buckets.d60 > 0) return "60 days";
  if (a.buckets.d30 > 0) return "30 days";
  return "Current";
}

/* ------------------------------------------------ revenue type segmentation */

/** The detailed report labels buckets in words. Map them onto our keys. */
const BUCKET_FROM_LABEL: Record<string, BucketKey> = {
  Current: "current",
  "30 days": "d30",
  "60 days": "d60",
  "90 days": "d90",
  "More than 90 days": "d90plus",
};

/**
 * How overdue a charge is, from MES's own formula. Their Formula tab spells it
 * out, and it agrees with the Aging column on all 173 rows of their export:
 *
 *   IF(Age<=15,"Current", 16..45 "30 days", 46..75 "60 days",
 *      76..105 "90 days", else "More than 90 days")
 *
 * Fifteen days rather than zero because that is the grace period: rent falls
 * due on the 1st and the late fee lands on the 15th.
 *
 * Worth computing rather than copying their label. The label is a formula in
 * their spreadsheet and a formula can be dragged one row short. Calculating it
 * here means a disagreement is visible instead of inherited.
 */
export function bucketForAge(age: number): BucketKey {
  if (age <= 15) return "current";
  if (age <= 45) return "d30";
  if (age <= 75) return "d60";
  if (age <= 105) return "d90";
  return "d90plus";
}

/** The label MES print, for the same age. */
export function bucketLabelForAge(age: number): string {
  return BUCKET_LABEL[bucketForAge(age)];
}

const BUCKET_LABEL: Record<BucketKey, string> = {
  current: "Current",
  d30: "30 days",
  d60: "60 days",
  d90: "90 days",
  d90plus: "More than 90 days",
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
export function revenueBreakdown(
  accounts: Account[],
  invoices: Invoice[] = data.invoices as Invoice[],
): RevenueRow[] {
  const names = new Set(accounts.map((a) => norm(a.companyName)));
  const rows = new Map<string, RevenueRow>();

  for (const inv of invoices) {
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
      invoices
        .filter(
          (i) => i.revenueType === row.type && names.has(norm(i.companyName)),
        )
        .map((i) => norm(i.companyName)),
    ).size;
  }

  return out.sort((a, b) => b.total - a.total);
}

/** Every revenue type present in the data, for filter menus. */
export function revenueTypes(
  invoices: Invoice[] = data.invoices as Invoice[],
): string[] {
  return Array.from(new Set(invoices.map((i) => i.revenueType))).sort();
}

/* ------------------------------------------------------- recurring reports */

/**
 * Proposal 4.7. Three reports go out on a schedule and each one is a
 * different thing. They previously shared a single export, which meant the
 * security deposit report contained no deposits and each manager received
 * every manager's tenants.
 */

export interface DepositRow {
  account: Account;
  deposits: number;
  offsetting: boolean;
  outstanding: number;
}

/**
 * Security deposit reconciliation, to CSD every Monday.
 *
 * Deposits come from invoice lines, and an account is treated as offsetting
 * when the officer has noted it against the balance. In the sample that note
 * reads "Offset SD" in the old spreadsheet's Update column.
 */
export function depositReport(
  accounts: Account[],
  invoices: Invoice[] = data.invoices as Invoice[],
): DepositRow[] {
  return accounts
    .map((a) => {
      const deposits = invoicesForAccount(a, invoices)
        .filter((i) => i.revenueType === "Security Deposit")
        .reduce((s, i) => s + i.openBalance, 0);
      const offsetting = /offset\s*sd/i.test(a.legacyNote ?? "");
      return { account: a, deposits, offsetting, outstanding: overdueTotal(a) };
    })
    .filter((r) => r.deposits > 0 || r.offsetting)
    .sort((x, y) => y.deposits - x.deposits);
}

export interface RmReport {
  key: string;
  name: string;
  accounts: Account[];
  outstanding: number;
  overdue: number;
}

/**
 * Outstanding balance logs, one per relationship manager. A manager receives
 * only their own tenants, which is the same rule the database enforces.
 */
export function rmReports(
  accounts: Account[],
  managers: { key: string; name: string }[] = (
    data as unknown as { managers?: { key: string; name: string }[] }
  ).managers ?? [],
): RmReport[] {

  const rows = managers.map((m) => {
    const mine = accounts.filter(
      (a) => (a as Account & { rm?: string }).rm === m.key,
    );
    return {
      key: m.key,
      name: m.name,
      accounts: mine,
      outstanding: mine.reduce((s, a) => s + a.total, 0),
      overdue: mine.reduce((s, a) => s + overdueTotal(a), 0),
    };
  });

  // Tenants nobody owns are worth surfacing rather than losing.
  const unassigned = accounts.filter(
    (a) => !(a as Account & { rm?: string }).rm,
  );
  if (unassigned.length > 0) {
    rows.push({
      key: "unassigned",
      name: "No manager assigned",
      accounts: unassigned,
      outstanding: unassigned.reduce((s, a) => s + a.total, 0),
      overdue: unassigned.reduce((s, a) => s + overdueTotal(a), 0),
    });
  }
  return rows;
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
  /**
   * How many days past its due date a charge must be before it attracts the
   * fee. Fourteen, from MES's own letter: rent falls due on the 1st and the
   * fee applies if payment has not arrived by the 15th.
   */
  minimumAgeDays: number;
}

/**
 * Default reflects what the sample data actually shows: the same flat charge
 * repeating each month. MES has not confirmed the rule, so it is editable on
 * screen rather than hard coded. Proposal 4.8.
 */
/**
 * MES's own first reminder letter states the rule outright:
 *
 *   "if payment is not received by the 15th day of each calendar month, an
 *    administrative fee for late payment amounting to $100.00 (before
 *    prevailing GST) will be charged."
 *
 * Flat, not a percentage. It was an open item for months and two of our
 * sources disagreed; the letter settles it.
 */
export const DEFAULT_FEE_RULE: FeeRule = {
  basis: "flat",
  value: 100,
  minimumBalance: 0,
  skipTerminated: false,
  minimumAgeDays: 14,
};

/**
 * Charged when a tenant pays by cheque, from 1 August 2022, per the same
 * letter that gives us the $100.
 *
 * Nothing raises it and nothing can. No export MES have sent records how a
 * payment was made, so a cheque is indistinguishable from a transfer, a PayNow
 * or a GIRO deduction. That was equally true before the DBS report was
 * removed, so it is not a gap that more code closes: it needs a payment method
 * from somewhere, which is a scope conversation rather than a change.
 *
 * Shown read-only on the Late Fee screen beside the $100 rather than left as a
 * constant nobody reads. MES's letter names two charges and that screen used
 * to show one, which read as the whole fee picture. Saying plainly that this
 * one is theirs to raise is a better answer than silence.
 *
 * The Cheque Admin Fee classification rule, revenue-rules.ts order 4, already
 * catches the line when MES do raise it and it arrives on a later AR report.
 */
export const CHEQUE_ADMIN_FEE = 50;
export const CHEQUE_ADMIN_FEE_FROM = "1 August 2022";

export interface FeeLine {
  account: Account;
  /** What the fee is being charged on: due at least minimumAgeDays ago. */
  overdue: number;
  fee: number;
  alreadyCharged: number;
  /**
   * True when the figure came from the aging buckets rather than from invoice
   * dates, because the upload carried no line detail. The buckets cannot
   * express "14 days", so the selection is approximate and the screen says so.
   */
  approximate: boolean;
}

/**
 * Who the late payment fee falls on.
 *
 * MES's letter states the rule as a date, not a bucket: the fee applies "if
 * payment is not received by the 15th day of each calendar month". Rent falls
 * due on the 1st, so that is fourteen days past the due date.
 *
 * This used to select on the aging buckets, taking everything outside
 * Current. That looks equivalent and is not. MES count anything up to and
 * including 15 days past due as Current, so on the 16th, when the fee is
 * raised, the month that has just gone unpaid is 15 days old and sits in
 * Current. The rule was therefore charging older debt and never charging the
 * month the letter is actually about, which is precisely backwards.
 *
 * So the invoice dates decide it. Where an upload carries no line detail, and
 * MES have sent one where every amount was blank, the buckets are used as a
 * fallback and the line is marked approximate rather than presented as fact.
 */
export function feesDue(
  accounts: Account[],
  rule: FeeRule,
  invoices: Invoice[] = data.invoices as Invoice[],
): FeeLine[] {
  return accounts
    .filter((a) => !isInCredit(a))
    .filter((a) => (rule.skipTerminated ? a.status !== "Terminated" : true))
    .map((a) => {
      const lines = invoicesForAccount(a, invoices);
      const dated = lines.filter((i) => i.age !== null);
      if (dated.length === 0) {
        return { account: a, overdue: overdueTotal(a), approximate: true };
      }
      const overdue = dated
        .filter((i) => (i.age as number) >= rule.minimumAgeDays)
        .reduce((n, i) => n + i.openBalance, 0);
      return { account: a, overdue, approximate: false };
    })
    .filter((r) => r.overdue > rule.minimumBalance)
    .map((r) => ({
      account: r.account,
      overdue: r.overdue,
      approximate: r.approximate,
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
  "repeat-late-fees": "Charged late fees repeatedly",
  "aging-30": "Overdue more than 30 days",
  "aging-90": "Owed for over 90 days",
  "promise-broken": "Promised to pay",
  "no-contact": "No email address",
};

/**
 * The reason as the officer should read it, given the account it is about.
 *
 * `repeat-late-fees` carries a count because "charged 7 times" and "charged 3
 * times" are different conversations, and a number baked into the string would
 * be wrong the moment the data moves. Everything else is fixed text.
 */
export function reasonLabel(reason: QueueReason, a: Account): string {
  if (reason === "repeat-late-fees") {
    return `Charged late fees ${a.lateFeeCount} times`;
  }
  if (reason === "promise-broken" && a.legacyNote) {
    return `Promise: ${a.legacyNote}`;
  }
  return REASON_LABEL[reason];
}
