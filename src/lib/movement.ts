import type { Account } from "./types.ts";
import { worstBucket } from "./data.ts";

/**
 * What changed between two reports.
 *
 * Everything else in this system describes one moment. An officer on the 7th
 * sees "81 tenants overdue" and has no way to tell which of them settled on
 * the 4th, which slid a bucket, and which have been sitting in 90+ since June.
 * Today that comparison is somebody putting two spreadsheets side by side.
 *
 * ---------------------------------------------------------------------------
 * The rule this whole file is built around
 *
 * MES were explicit about how to read two exports, and it is not obvious:
 *
 *   absent from the newer report   means paid in full
 *   a smaller balance              means part paid
 *   never do cross-file arithmetic
 *
 * The first is the one that catches people. A tenant who vanishes has not been
 * missed off and is not a parsing fault. They have settled, and chasing them
 * is exactly the mistake this is meant to prevent.
 *
 * The third is subtler and is why nothing here reports an amount paid. A
 * balance that fell by $2,000 does not mean $2,000 arrived: the tenant may
 * have paid $5,000 and been billed $3,000 in the same period. Saying "paid
 * $2,000" would be a number nobody could reconcile against a bank statement,
 * so this says the balance fell by $2,000 and leaves payment to the ledger.
 *
 * ---------------------------------------------------------------------------
 * Terminated tenants
 *
 * Somebody who has moved out still owes what they owe, and MES's final notice
 * cites manpower regulations precisely because that debt survives the tenancy.
 * They are compared like anybody else and never quietly dropped.
 */

/** Worst first, which is the order the buckets escalate in. */
const BUCKET_ORDER = [
  "Current",
  "30 days",
  "60 days",
  "90 days",
  "More than 90 days",
] as const;

const rank = (label: string) => {
  const i = BUCKET_ORDER.indexOf(label as (typeof BUCKET_ORDER)[number]);
  return i === -1 ? 0 : i;
};

export type Direction =
  /** Gone from the newer report, which MES read as paid in full. */
  | "settled"
  /** Owing now, and not in the older report at all. */
  | "new"
  /** Balance fell, but they still owe something. */
  | "down"
  /** Balance rose. */
  | "up"
  /** To the cent, no change. */
  | "same";

export interface Movement {
  id: string;
  customerCode: string;
  companyName: string;
  property: string;
  direction: Direction;
  /** Null when they are new, because there was nothing before. */
  before: number | null;
  /** Null when they have settled, because there is nothing now. */
  after: number | null;
  /**
   * after minus before, and deliberately not called an amount paid. See the
   * note at the top: a balance is not a payment.
   */
  changedBy: number | null;
  bucketBefore: string | null;
  bucketAfter: string | null;
  /** True where the money has aged into an older bucket than it was in. */
  aged: boolean;
  /** True where the worst bucket improved. */
  recovered: boolean;
  /** Whether anybody can be written to about this. */
  hasContact: boolean;
}

/** Rounded the way every other total in the system is, so they can be added. */
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Two reports, tenant by tenant.
 *
 * `before` is the older report and `after` the newer. Passing them the wrong
 * way round would turn every settlement into a new debt, so the caller is
 * expected to order them by report date rather than by upload time: MES
 * re-upload months late and often.
 */
export function compareReports(
  before: readonly Account[],
  after: readonly Account[],
): Movement[] {
  const was = new Map(before.map((a) => [a.id, a]));
  const now = new Map(after.map((a) => [a.id, a]));

  const out: Movement[] = [];

  for (const a of after) {
    const old = was.get(a.id);

    if (!old) {
      out.push({
        id: a.id,
        customerCode: a.customerCode,
        companyName: a.companyName,
        property: a.property,
        direction: "new",
        before: null,
        after: a.total,
        changedBy: null,
        bucketBefore: null,
        bucketAfter: worstBucket(a),
        aged: false,
        recovered: false,
        hasContact: a.hasContact,
      });
      continue;
    }

    const changedBy = round2(a.total - old.total);
    const bucketBefore = worstBucket(old);
    const bucketAfter = worstBucket(a);

    out.push({
      id: a.id,
      customerCode: a.customerCode,
      companyName: a.companyName,
      property: a.property,
      direction: changedBy === 0 ? "same" : changedBy < 0 ? "down" : "up",
      before: old.total,
      after: a.total,
      changedBy,
      bucketBefore,
      bucketAfter,
      aged: rank(bucketAfter) > rank(bucketBefore),
      recovered: rank(bucketAfter) < rank(bucketBefore),
      hasContact: a.hasContact,
    });
  }

  /*
   * Anybody in the older report and not the newer one. This is the case worth
   * getting right: they are settled, not missing, and the whole point of
   * showing them is so nobody rings them.
   */
  for (const old of before) {
    if (now.has(old.id)) continue;
    out.push({
      id: old.id,
      customerCode: old.customerCode,
      companyName: old.companyName,
      property: old.property,
      direction: "settled",
      before: old.total,
      after: null,
      changedBy: null,
      bucketBefore: worstBucket(old),
      bucketAfter: null,
      aged: false,
      recovered: true,
      hasContact: old.hasContact,
    });
  }

  /*
   * Worst news first: who got worse, by how much, then everything else. An
   * officer reads the top of this list and stops, so the top has to be the
   * part that changes what they do today.
   */
  const order: Record<Direction, number> = { up: 0, new: 1, same: 2, down: 3, settled: 4 };
  return out.sort(
    (x, y) =>
      order[x.direction] - order[y.direction] ||
      Math.abs(y.changedBy ?? y.after ?? y.before ?? 0) -
        Math.abs(x.changedBy ?? x.after ?? x.before ?? 0),
  );
}

export interface MovementSummary {
  settled: number;
  paidSomething: number;
  worse: number;
  newlyOwing: number;
  unchanged: number;
  /** Money that left the book, as a positive number. */
  balanceDown: number;
  /** Money added to it. */
  balanceUp: number;
  totalBefore: number;
  totalAfter: number;
  /** Tenants whose debt aged into an older bucket, whatever the amount did. */
  aged: number;
}

/**
 * The headline.
 *
 * Counts and totals separately, because they answer different questions and
 * one large tenant can make the totals move while almost nobody paid.
 */
export function summarise(
  movements: readonly Movement[],
  before: readonly Account[],
  after: readonly Account[],
): MovementSummary {
  const sum = (xs: readonly Account[]) => round2(xs.reduce((n, a) => n + a.total, 0));

  let balanceDown = 0;
  let balanceUp = 0;

  for (const m of movements) {
    if (m.direction === "settled") balanceDown += m.before ?? 0;
    else if (m.direction === "new") balanceUp += m.after ?? 0;
    else if (m.changedBy && m.changedBy < 0) balanceDown += -m.changedBy;
    else if (m.changedBy && m.changedBy > 0) balanceUp += m.changedBy;
  }

  return {
    settled: movements.filter((m) => m.direction === "settled").length,
    paidSomething: movements.filter((m) => m.direction === "down").length,
    worse: movements.filter((m) => m.direction === "up").length,
    newlyOwing: movements.filter((m) => m.direction === "new").length,
    unchanged: movements.filter((m) => m.direction === "same").length,
    balanceDown: round2(balanceDown),
    balanceUp: round2(balanceUp),
    totalBefore: sum(before),
    totalAfter: sum(after),
    aged: movements.filter((m) => m.aged).length,
  };
}

/* --------------------------------------------------------- the chronic --- */

export interface Snapshot {
  reportDate: string;
  accounts: readonly Account[];
}

export interface Chronic {
  id: string;
  customerCode: string;
  companyName: string;
  property: string;
  /** How many reports in a row, counting back from the newest. */
  reports: number;
  /** Those report dates, newest first. */
  since: string[];
  bucket: string;
  owed: number;
  hasContact: boolean;
}

/**
 * Tenants who have been stuck in the same place, report after report.
 *
 * This is the question their collections process exists to answer and the one
 * nobody can answer today. A tenant who has been in 90+ since June is a
 * different conversation from one who slipped there last week, and the two are
 * indistinguishable on every screen built so far.
 *
 * Counted backwards from the newest report and stopping at the first break, so
 * "three reports running" means the last three and not three scattered across
 * a year. A tenant who cleared their debt and fell behind again has not been
 * chronically behind, and treating them as though they had would put the wrong
 * name at the top of the list.
 *
 * Reports rather than months, because MES upload three or more times a month
 * and the gap between two reports is not a fixed length. The dates are carried
 * so the screen can say how long it has really been.
 */
export function chronic(
  snapshots: readonly Snapshot[],
  options: { atLeast?: number; from?: string } = {},
): Chronic[] {
  const atLeast = options.atLeast ?? 3;
  const worstFrom = options.from ?? "60 days";
  const floor = rank(worstFrom);

  // Newest first, by report date rather than by the order they arrived.
  const ordered = [...snapshots].sort((a, b) => (a.reportDate < b.reportDate ? 1 : -1));
  if (ordered.length === 0) return [];

  const newest = ordered[0]!;
  const out: Chronic[] = [];

  for (const a of newest.accounts) {
    if (rank(worstBucket(a)) < floor) continue;

    const since: string[] = [];
    for (const snap of ordered) {
      const then = snap.accounts.find((x) => x.id === a.id);
      // The first report they are absent from, or out of that bucket, ends the
      // run. Absent means settled, which is the opposite of chronic.
      if (!then || rank(worstBucket(then)) < floor) break;
      since.push(snap.reportDate);
    }

    if (since.length >= atLeast) {
      out.push({
        id: a.id,
        customerCode: a.customerCode,
        companyName: a.companyName,
        property: a.property,
        reports: since.length,
        since,
        bucket: worstBucket(a),
        owed: a.total,
        hasContact: a.hasContact,
      });
    }
  }

  return out.sort((x, y) => y.reports - x.reports || y.owed - x.owed);
}
