import type { Account, BucketKey, Invoice, PropertyCode } from "./types";
import { BUCKETS } from "./types.ts";
import { round2 } from "./aging-detail.ts";

/**
 * The six reports MES drew as empty tabs.
 *
 * Their workbook, Detailed AR report(Final).xlsx, ends with six blank tabs:
 * Security Deposit(SD), Parking Fee(PF), 1FM, Late Payment(LP), Stamp
 * Duty(SD) and RM. The blankness is the requirement. Their Flow tab says what
 * to do with them:
 *
 *   "Show by Dorm followed by SD/PF/1FM/LP/SD/RM"
 *   "User can email any of the Reports (SD/PF/1FM/SD/RM) via email drop down"
 *
 * So each report is grouped by dormitory first, and each is independently
 * sendable. Note that MES's shorthand uses SD twice, for Security Deposit and
 * for Stamp Duty. The tab names are what disambiguates them, so the codes
 * here are taken from the tab names rather than from the shorthand.
 */

/* ------------------------------------------------------------------ types */

export interface ReportColumn {
  key: string;
  label: string;
  kind: "text" | "money" | "number" | "date";
  /**
   * Set when a column exists on MES's mock-up but cannot be filled from any
   * file they have sent. The column is still rendered, empty, carrying this
   * sentence, because a silently missing column reads as "no data" whereas an
   * empty one that explains itself is a question somebody can answer.
   */
  unavailable?: string;
}

export interface ReportBlock {
  /** The dormitory, or the manager, this block covers. */
  title: string;
  subtitle?: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  total: number;
}

export interface Report {
  code: string;
  name: string;
  /** MES's own shorthand for it, as written on the Flow tab. */
  shorthand: string;
  asOf: string | null;
  entity: string | null;
  blocks: ReportBlock[];
  lineCount: number;
  total: number;
  /** Anything the reader needs to know before acting on the numbers. */
  notes: string[];
}

const PROPERTY_ORDER: PropertyCode[] = ["JPD1", "JPD2", "BSD", "LEO"];

const norm = (s: unknown) =>
  String(s ?? "").trim().replace(/\s+/g, " ").replace(/\.$/, "").toUpperCase();

/**
 * An invoice line as the reports need it.
 *
 * `id` is optional because a line straight out of the parser has not been
 * given one yet, and none of these reports needs it: they group by customer,
 * dormitory and charge type. Requiring it would mean numbering three thousand
 * rows for no reason other than to satisfy a type.
 */
type Line = Omit<Invoice, "id"> & {
  id?: string;
  property?: PropertyCode;
  customerCode?: string;
  category?: string;
};

/* -------------------------------------------------- who is on GIRO, and how */

/**
 * The tenants paying by GIRO, worked out from the AR report alone.
 *
 * This used to come from the DBS Bulk Collection Report. MES dropped that file
 * in August: "We don't need the bank statement." That looked like it took the
 * GIRO features with it, and it did not, because a failed GIRO deduction
 * raises its own invoice line:
 *
 *   Admin Fee for Rejected Giro - 02-JAN-26      100.00
 *
 * In MES's August export, six tenants carry that fee and six different ones
 * carry "Admin Fee For Late Payment". Not one carries both. That is MES's own
 * rule showing through their data: a tenant on GIRO whose deduction bounced
 * gets the rejected-GIRO fee, and a tenant not on GIRO who simply paid late
 * gets the late payment fee. Same $100, different fee, mutually exclusive.
 *
 * Which is exactly what Jacqueline's email to the AR team asks for by hand:
 *
 *   "Please check if I might have included the giro clients in the listing
 *    and remove accordingly."
 *
 * One limit, and it is worth stating on screen rather than hiding. This finds
 * tenants whose GIRO has *failed*. A tenant whose GIRO succeeds every month
 * raises no fee and is invisible here, which is harmless for this purpose:
 * they are not overdue, so they were never going to appear on a late payment
 * listing anyway. The real gap is timing. If the AR report is pulled before
 * the rejected-GIRO fee has been raised for the current cycle, that tenant
 * looks like an ordinary late payer for one cycle.
 */
export function giroEnrolled(invoices: readonly Line[]): Set<string> {
  const out = new Set<string>();
  for (const i of invoices) {
    if (i.revenueType !== "Rejected GIRO Fee") continue;
    out.add(keyOf(i));
  }
  return out;
}

/** Accounts and invoices are joined on customer code where there is one. */
function keyOf(i: Line): string {
  return i.customerCode ? i.customerCode.toUpperCase() : norm(i.companyName);
}

function accountKey(a: Account): string {
  return a.customerCode ? a.customerCode.toUpperCase() : norm(a.companyName);
}

/* -------------------------------------------------- the five revenue tabs */

export interface RevenueTabSpec {
  code: string;
  name: string;
  shorthand: string;
  /** The revenue type from revenue-rules.ts that fills this tab. */
  revenueType: string;
  note?: string;
}

/**
 * Five of the six tabs are the same shape: the invoice lines of one charge
 * type, grouped by dormitory. Only RM differs, because it is per manager
 * rather than per charge.
 */
export const REVENUE_TABS: RevenueTabSpec[] = [
  {
    code: "SD-SECURITY",
    name: "Security Deposit (SD)",
    shorthand: "SD",
    revenueType: "Security Deposit",
    note:
      "Deposit lines that are still open in the AR ledger: unpaid deposit " +
      "invoices, and offsets where a deposit has been applied against arrears. " +
      "Raman named these as the source for the Security Deposit column on 14 " +
      "September, so the manager reports total them per tenant. A tenant " +
      "whose lines net to nothing or less has had their deposit spent " +
      "against arrears and is reported as having none held.",
  },
  {
    code: "PF",
    name: "Parking Fee (PF)",
    shorthand: "PF",
    revenueType: "Season Parking",
    note:
      "No parking line appears anywhere in MES's August export, so this tab " +
      "is built from the wording used in their earlier file (\"Quarterly " +
      "Charges for Season Parking of ...\") and has never matched real data. " +
      "The first upload that contains one will confirm it or not.",
  },
  {
    code: "1FM",
    name: "1FM Maintenance",
    shorthand: "1FM",
    revenueType: "1FM Maintenance",
    note:
      "Identified by the document number prefix, per MES's own note on the " +
      "export: 1FM = Prefix \"DORMFM\", example BSDFM/1598. Every line on a " +
      "1FM invoice belongs to it, including its VAT line, which is why the " +
      "count is higher than the number of lines whose text says ONEFM.",
  },
  {
    code: "LP",
    name: "Late Payment (LP)",
    shorthand: "LP",
    revenueType: "Late Payment Fee",
    note:
      "The $100 admin fee already raised, one line per month per tenant. " +
      "This is the history. Who is due to be charged next is the Late " +
      "Payment listing, which is a different report.",
  },
  {
    code: "SD-STAMP",
    name: "Stamp Duty (SD)",
    shorthand: "SD",
    revenueType: "Stamp Duty",
    note:
      "MES categorise these as \"Reimbursement\", so they are found by their " +
      "description rather than by the Categories column.",
  },
];

const LINE_COLUMNS: ReportColumn[] = [
  { key: "customerCode", label: "Customer", kind: "text" },
  { key: "companyName", label: "Company Name", kind: "text" },
  { key: "date", label: "Date", kind: "date" },
  { key: "description", label: "Description", kind: "text" },
  { key: "category", label: "Categories", kind: "text" },
  { key: "documentNumber", label: "Document Number", kind: "text" },
  { key: "dueDate", label: "Due Date", kind: "date" },
  { key: "age", label: "Age", kind: "number" },
  { key: "bucket", label: "Aging", kind: "text" },
  { key: "openBalance", label: "Open Balance", kind: "money" },
];

export function buildRevenueTab(
  spec: RevenueTabSpec,
  invoices: readonly Line[],
  asOf: string | null,
  entity: string | null,
): Report {
  const mine = invoices.filter((i) => i.revenueType === spec.revenueType);
  const blocks: ReportBlock[] = [];

  for (const property of PROPERTY_ORDER) {
    const rows = mine.filter((i) => (i.property ?? "BSD") === property);
    if (rows.length === 0) continue;
    blocks.push({
      title: property,
      columns: LINE_COLUMNS,
      rows: rows.map((i) => ({
        customerCode: i.customerCode ?? "",
        companyName: i.companyName,
        date: i.date,
        description: i.description,
        category: i.category ?? "",
        documentNumber: i.documentNumber,
        dueDate: i.dueDate,
        age: i.age,
        bucket: i.bucket,
        openBalance: round2(i.openBalance),
      })),
      total: round2(rows.reduce((n, i) => n + i.openBalance, 0)),
    });
  }

  return {
    code: spec.code,
    name: spec.name,
    shorthand: spec.shorthand,
    asOf,
    entity,
    blocks,
    lineCount: mine.length,
    total: round2(mine.reduce((n, i) => n + i.openBalance, 0)),
    notes: spec.note ? [spec.note] : [],
  };
}

/* ------------------------------------------------------ the manager report */

/**
 * Ray's mock-up, not Harry's.
 *
 * MES sent two, ten days apart, and they do not agree. Harry's (17 August) is
 * four tabs, one per dormitory, nine columns. Ray's (27 August) is one sheet
 * with the dormitory blocks stacked down it and thirteen columns: it adds
 * Overdue Total, Update, Security Deposit and Risk Exposure. Ray's is newer
 * and its columns are a superset, so it is the one built here. If MES say
 * otherwise, dropping the four extra columns gives Harry's exactly.
 *
 * Two of those thirteen cannot be filled from any file MES has sent, and are
 * rendered as empty columns that say why rather than being left out. See
 * MANAGER_UNAVAILABLE below.
 */
export const MANAGER_COLUMNS: ReportColumn[] = [
  { key: "companyName", label: "Company Name", kind: "text" },
  { key: "status", label: "Status", kind: "text" },
  { key: "current", label: "Current", kind: "money" },
  { key: "d30", label: "30 days", kind: "money" },
  { key: "d60", label: "60 days", kind: "money" },
  { key: "d90", label: "90 days", kind: "money" },
  { key: "d90plus", label: "More than 90 days", kind: "money" },
  { key: "total", label: "Grand Total", kind: "money" },
  { key: "overdue", label: "Overdue Total", kind: "money" },
  { key: "update", label: "Update", kind: "text" },
  {
    key: "securityDeposit",
    label: "Security Deposit",
    kind: "money",
    unavailable:
      "Totalled from the Security Deposit lines in the AR report, which is " +
      "the source Raman named on 14 September. Blank where a tenant has no " +
      "deposit line, or where their deposit has already been offset against " +
      "arrears and so is no longer held.",
  },
  {
    key: "riskExposure",
    label: "Risk Exposure",
    kind: "money",
    // Raman answered the formula after the 14 September call: "It is Grand
    // total minus Security Deposit. So if positive it means AR is more than
    // SD." Checked against the version of his mock-up he updated at the same
    // time and it holds on all nine rows, to the cent: 6,428.16 - 34,000 =
    // -27,572, and 11,216.44 - 11,160 = 56.
    //
    // The copy of that workbook in this repository is the one sent before he
    // added it, and its Risk Exposure column matches nothing. That is why the
    // figures quoted here as not following from the other columns did not:
    // they were the old ones.
    //
    // So this is no longer waiting on a definition. It is waiting on the
    // deposit held, which is the other half of the subtraction and is in no
    // file MES have sent. The moment that arrives this column computes.
    unavailable:
      "Grand Total minus Security Deposit, which MES confirmed on 14 " +
      "September. Shown for every tenant whose AR report carries a deposit " +
      "line, and blank for the rest, because a tenant with no deposit on " +
      "file is a different claim from a tenant who lodged nothing.",
  },
  { key: "rep", label: "Sales Rep", kind: "text" },
];

export const MANAGER_UNAVAILABLE = MANAGER_COLUMNS.filter((c) => c.unavailable);

/**
 * The security deposit per tenant, read from the AR report itself.
 *
 * Raman told us where to get this on the 14 September call, and I had it
 * recorded as unanswered. His words, on the master AR report: "go to and
 * filter the yellow column F, the security deposit is there ... depending
 * whether you are using this as a source data to come out that table or
 * you're using JPD one, I would, if I were you, I would use this source
 * data."
 *
 * So: filter the deposit lines out of the Finance AR Download and total them
 * per tenant. Where there is nothing to total, there is no figure, which he
 * also covered: "if there's no data there, then you can't display ... you
 * just can put some kind of note that this data not available."
 *
 * Two things about the result are worth knowing before anybody quotes it.
 *
 * Only a handful of tenants carry a deposit line at all. In MES's August
 * export it is ten out of a hundred and ninety, so this fills the column for
 * ten and leaves the rest saying why they are empty.
 *
 * And a tenant whose deposit has been spent shows a negative, because the
 * offset is booked as a credit: "BEING SECURITY DEPOSIT OF RSP ENGINEERING
 * P/L HAS BEEN OFFSET AGAINST A/R OUTSTANDING". A negative is not a deposit
 * being held, and subtracting one would push Risk Exposure *up*, making a
 * tenant whose deposit is already gone look better covered than one who never
 * lodged a deposit at all. So a total that is not positive is reported as no
 * figure rather than as a figure, and the report says which tenants those are.
 */
export function depositsFromLedger(
  invoices: readonly Line[],
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const i of invoices) {
    if (i.revenueType !== "Security Deposit") continue;
    const key = i.customerCode ? i.customerCode.toUpperCase() : norm(i.companyName);
    totals.set(key, round2((totals.get(key) ?? 0) + i.openBalance));
  }

  const held = new Map<string, number>();
  for (const [key, total] of Array.from(totals)) {
    if (total > 0) held.set(key, total);
  }
  return held;
}

/** Tenants whose deposit lines net to nothing or less: spent, not held. */
export function depositsOffset(invoices: readonly Line[]): string[] {
  const totals = new Map<string, number>();
  for (const i of invoices) {
    if (i.revenueType !== "Security Deposit") continue;
    const key = i.customerCode ? i.customerCode.toUpperCase() : norm(i.companyName);
    totals.set(key, round2((totals.get(key) ?? 0) + i.openBalance));
  }
  return Array.from(totals).filter(([, t]) => t <= 0).map(([k]) => k).sort();
}

/**
 * Risk Exposure, as MES define it.
 *
 * Raman, after the 14 September call: "It is Grand total minus Security
 * Deposit. So if positive it means AR is more than SD." Checked against the
 * version of his mock-up he updated at the same time and it holds on all nine
 * rows to the cent: 6,428.16 - 34,000 = -27,572, and 11,216.44 - 11,160 = 56.
 *
 * Returns null rather than the grand total when no deposit is known, because
 * those are different claims. "We are exposed for the whole balance" is a
 * statement about a tenant who has lodged nothing; "we do not know what they
 * have lodged" is a statement about our data. The second is true today for
 * every tenant, and printing the first would be a figure somebody could act
 * on.
 */
export function riskExposure(
  grandTotal: number,
  securityDeposit: number | null,
): number | null {
  if (securityDeposit === null) return null;
  return round2(grandTotal - securityDeposit);
}

export interface ManagerReport extends Report {
  managerName: string;
}

export function buildManagerReports(
  accounts: readonly Account[],
  asOf: string | null,
  entity: string | null,
  notes: Map<string, string> = new Map(),
  /**
   * Deposit held per tenant, keyed by customer code.
   *
   * Empty today, and deliberately a parameter rather than something derived
   * here. The AR report carries deposit lines that are still open, which is
   * unpaid deposit invoices and offsets, and that is a different number from
   * the deposit MES are holding. Deriving one from the other would fill the
   * column with a plausible wrong figure.
   *
   * The plumbing is here so that the day MES name a source, both columns fill
   * with no further change.
   */
  depositsHeld: Map<string, number> = new Map(),
): ManagerReport[] {
  const byManager = new Map<string, Account[]>();
  for (const a of accounts) {
    const rep = (a as Account & { rm?: string }).rm;
    if (!rep) continue;
    const list = byManager.get(rep) ?? [];
    list.push(a);
    byManager.set(rep, list);
  }

  const reports: ManagerReport[] = [];
  for (const [rep, mine] of Array.from(byManager).sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    /*
     * Two of these columns carry a sentence explaining why they are empty. If
     * the deposits arrive and the sentence stays, the report contradicts
     * itself: a figure in the cell and, above it, a note saying no figure can
     * be shown. So the explanation is attached per report, not per column, and
     * only while it is true of that report.
     */
    const known = mine.some((a) => depositsHeld.has(a.customerCode));
    const columns = known
      ? MANAGER_COLUMNS.map((c) => {
          const { unavailable, ...rest } = c;
          return unavailable ? rest : c;
        })
      : MANAGER_COLUMNS;

    const blocks: ReportBlock[] = [];
    for (const property of PROPERTY_ORDER) {
      const rows = mine
        .filter((a) => a.property === property)
        .sort((a, b) => b.total - a.total);
      if (rows.length === 0) continue;
      blocks.push({
        title: property,
        subtitle: entity ?? undefined,
        columns,
        rows: rows.map((a) => ({
          companyName: `${a.customerCode} ${a.companyName}`,
          status: a.status,
          current: a.buckets.current,
          d30: a.buckets.d30,
          d60: a.buckets.d60,
          d90: a.buckets.d90,
          d90plus: a.buckets.d90plus,
          total: a.total,
          overdue: round2(
            a.buckets.d30 + a.buckets.d60 + a.buckets.d90 + a.buckets.d90plus,
          ),
          update: notes.get(a.id) ?? a.legacyNote ?? "",
          securityDeposit: depositsHeld.get(a.customerCode) ?? null,
          riskExposure: riskExposure(
            a.total,
            depositsHeld.get(a.customerCode) ?? null,
          ),
          rep,
        })),
        total: round2(rows.reduce((n, a) => n + a.total, 0)),
      });
    }

    reports.push({
      code: `RM-${rep.replace(/\W+/g, "-")}`,
      name: `${rep} — clients by dorm`,
      shorthand: "RM",
      managerName: rep,
      asOf,
      entity,
      blocks,
      lineCount: mine.length,
      total: round2(mine.reduce((n, a) => n + a.total, 0)),
      notes: known
        ? []
        : MANAGER_UNAVAILABLE.map((c) => `${c.label}: ${c.unavailable}`),
    });
  }
  return reports;
}

/* ------------------------------------------- the late payment fee listing */

/**
 * Who should be charged the $100 admin fee this cycle.
 *
 * MES's Flow tab puts this on the 16th: "Late Payment Report - >14 calendar
 * days credit", sent to the AR team so they can raise the invoices. It is a
 * different report from the LP tab above, which is the fees already raised.
 *
 * Tenants on GIRO are excluded, per Jacqueline's standing instruction to the
 * AR team. See giroEnrolled for how they are identified without the bank file.
 */
export interface LateFeeCandidate {
  account: Account;
  overdue: number;
  fee: number;
  alreadyCharged: number;
  approximate: boolean;
}

export interface LateFeeListing {
  asOf: string | null;
  entity: string | null;
  fee: number;
  minimumAgeDays: number;
  rows: LateFeeCandidate[];
  /** Excluded because they are on GIRO, listed so the exclusion is auditable. */
  giroExcluded: { account: Account; overdue: number }[];
  notes: string[];
}

export function buildLateFeeListing(
  accounts: readonly Account[],
  invoices: readonly Line[],
  asOf: string | null,
  entity: string | null,
  opts: { fee?: number; minimumAgeDays?: number } = {},
): LateFeeListing {
  const fee = opts.fee ?? 100;
  const minimumAgeDays = opts.minimumAgeDays ?? 14;
  const onGiro = giroEnrolled(invoices);

  const byKey = new Map<string, Line[]>();
  for (const i of invoices) {
    const k = keyOf(i);
    const list = byKey.get(k) ?? [];
    list.push(i);
    byKey.set(k, list);
  }

  const rows: LateFeeCandidate[] = [];
  const giroExcluded: LateFeeListing["giroExcluded"] = [];

  for (const a of accounts) {
    const key = accountKey(a);
    const mine = (byKey.get(key) ?? []).filter((i) => (i.property ?? "BSD") === a.property);
    const dated = mine.filter((i) => i.age !== null);

    const overdue = round2(
      dated.length > 0
        ? dated
            .filter((i) => (i.age as number) >= minimumAgeDays)
            .reduce((n, i) => n + i.openBalance, 0)
        : a.buckets.d30 + a.buckets.d60 + a.buckets.d90 + a.buckets.d90plus,
    );

    if (overdue <= 0) continue;

    if (onGiro.has(key)) {
      giroExcluded.push({ account: a, overdue });
      continue;
    }

    rows.push({
      account: a,
      overdue,
      fee,
      alreadyCharged: a.lateFeeCount,
      approximate: dated.length === 0,
    });
  }

  rows.sort((x, y) => y.overdue - x.overdue);
  giroExcluded.sort((x, y) => y.overdue - x.overdue);

  const notes = [
    `The fee is $${fee} before GST, charged once per tenant per cycle, on ` +
      `anything more than ${minimumAgeDays} calendar days past its due date. ` +
      "MES's own reminder letter states the rule.",
  ];
  if (giroExcluded.length > 0) {
    notes.push(
      `${giroExcluded.length} tenant${giroExcluded.length === 1 ? " is" : "s are"} ` +
        "on GIRO and excluded, per the standing instruction to the AR team. " +
        "They are listed separately rather than dropped, so the exclusion can " +
        "be checked.",
    );
  }
  return { asOf, entity, fee, minimumAgeDays, rows, giroExcluded, notes };
}

/* ---------------------------------------------------------- the aging board */

export interface AgingByProperty {
  property: PropertyCode;
  accounts: number;
  buckets: Record<BucketKey, number>;
  total: number;
}

/** "Show by Dorm", the first half of MES's standard upload routine. */
export function agingByProperty(accounts: readonly Account[]): AgingByProperty[] {
  const out = new Map<PropertyCode, AgingByProperty>();
  for (const a of accounts) {
    let row = out.get(a.property);
    if (!row) {
      row = {
        property: a.property,
        accounts: 0,
        buckets: { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 },
        total: 0,
      };
      out.set(a.property, row);
    }
    row.accounts += 1;
    row.total = round2(row.total + a.total);
    for (const b of BUCKETS) {
      row.buckets[b.key] = round2(row.buckets[b.key] + a.buckets[b.key]);
    }
  }
  return PROPERTY_ORDER.map((p) => out.get(p)).filter(
    (r): r is AgingByProperty => r !== undefined,
  );
}

/* ------------------------------------------------------ recurring defaulters */

/**
 * Tenants whose GIRO keeps bouncing.
 *
 * The proposal promised this off the back of the DBS report. It survives
 * without it: each failed deduction leaves a dated "Admin Fee for Rejected
 * Giro - 02-MAR-26" line, so a tenant with three of them across three months
 * has failed three times, and the AR report says so on its own.
 */
export interface RecurringDefaulter {
  customerCode: string;
  companyName: string;
  failures: number;
  /** The months a GIRO deduction bounced, as YYYY-MM. */
  months: string[];
  lateFees: number;
  /**
   * The months the $100 fee was raised, as YYYY-MM.
   *
   * A count on its own does not say what MES need to know. Their own lifecycle
   * note makes the distinction: "a tenant who pays late every month is a
   * different conversation from one who forgot once." Seven months running is
   * an argument for ending a contract; four months scattered across a year is
   * a reminder to call them earlier.
   *
   * Taken from the date the fee was raised rather than parsed out of its
   * wording. MES label each one — "Admin Fee For Late Payment - JAN'26" — and
   * on all 27 in their August export the label and the date agree, so the date
   * is the simpler of two answers that are the same.
   */
  lateFeeMonths: string[];
  /**
   * The longest unbroken run of months carrying the fee.
   *
   * Consecutive is the number worth acting on. DORM-117 in MES's own export
   * has seven in a row from January; DORM-1502 has six across seven months,
   * having paid on time in April. Those are different tenants.
   */
  consecutiveMonths: number;
  outstanding: number;
}

/** The longest run of consecutive YYYY-MM values in a list. */
function longestRun(months: readonly string[]): number {
  const sorted = Array.from(new Set(months)).sort();
  let best = 0;
  let run = 0;
  let previous: number | null = null;
  for (const m of sorted) {
    const parts = /^(\d{4})-(\d{2})$/.exec(m);
    if (!parts) continue;
    const index = Number(parts[1]) * 12 + Number(parts[2]);
    run = previous !== null && index === previous + 1 ? run + 1 : 1;
    previous = index;
    if (run > best) best = run;
  }
  return best;
}

export function recurringDefaulters(
  invoices: readonly Line[],
  accounts: readonly Account[],
  minimumFailures = 2,
): RecurringDefaulter[] {
  const byKey = new Map<string, RecurringDefaulter>();

  for (const i of invoices) {
    const isGiro = i.revenueType === "Rejected GIRO Fee";
    const isLate = i.revenueType === "Late Payment Fee";
    if (!isGiro && !isLate) continue;

    const key = keyOf(i);
    let row = byKey.get(key);
    if (!row) {
      row = {
        customerCode: i.customerCode ?? "",
        companyName: i.companyName,
        failures: 0,
        months: [],
        lateFees: 0,
        lateFeeMonths: [],
        consecutiveMonths: 0,
        outstanding: 0,
      };
      byKey.set(key, row);
    }
    if (isGiro) {
      row.failures += 1;
      if (i.date) row.months.push(i.date.slice(0, 7));
    } else {
      row.lateFees += 1;
      if (i.date) row.lateFeeMonths.push(i.date.slice(0, 7));
    }
  }

  for (const row of Array.from(byKey.values())) {
    row.lateFeeMonths = Array.from(new Set(row.lateFeeMonths)).sort();
    row.months = Array.from(new Set(row.months)).sort();
    row.consecutiveMonths = longestRun(row.lateFeeMonths);
  }

  for (const a of accounts) {
    const row = byKey.get(accountKey(a));
    if (row) row.outstanding = round2(row.outstanding + a.total);
  }

  return Array.from(byKey.values())
    .map((r) => ({ ...r, months: Array.from(new Set(r.months)).sort() }))
    .filter((r) => r.failures + r.lateFees >= minimumFailures)
    .sort(
      (a, b) =>
        b.failures - a.failures ||
        b.lateFees - a.lateFees ||
        b.outstanding - a.outstanding,
    );
}
