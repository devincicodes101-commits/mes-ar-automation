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

export const REASON_LABEL: Record<QueueReason, string> = {
  "giro-no-dda": "No GIRO mandate",
  "giro-refer-paying-party": "Repeat GIRO failure",
  "aging-30": "Past 30 day trigger",
  "aging-90": "Balance over 90 days",
  "promise-broken": "Open promise to pay",
  "no-contact": "No email on file",
};
