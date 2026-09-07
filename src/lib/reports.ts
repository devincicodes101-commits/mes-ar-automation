"use client";

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
      "This is not the deposit held per tenant, which is a balance sheet " +
      "figure and is in no file MES has sent.",
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
      "The deposit held per tenant is a balance sheet figure. The AR report " +
      "carries deposit lines only where they are still open, so this cannot " +
      "be filled until MES name a source for it.",
  },
  {
    key: "riskExposure",
    label: "Risk Exposure",
    kind: "money",
    unavailable:
      "Needs the deposit held, and needs MES to define the calculation. Their " +
      "mock-up has no formula in it and the values do not follow from the " +
      "other columns: one row shows 418.64 overdue against 16,640 of deposit " +
      "and a risk of -3,162.60.",
  },
  { key: "rep", label: "Sales Rep", kind: "text" },
];

export const MANAGER_UNAVAILABLE = MANAGER_COLUMNS.filter((c) => c.unavailable);

export interface ManagerReport extends Report {
  managerName: string;
}

export function buildManagerReports(
  accounts: readonly Account[],
  asOf: string | null,
  entity: string | null,
  notes: Map<string, string> = new Map(),
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
    const blocks: ReportBlock[] = [];
    for (const property of PROPERTY_ORDER) {
      const rows = mine
        .filter((a) => a.property === property)
        .sort((a, b) => b.total - a.total);
      if (rows.length === 0) continue;
      blocks.push({
        title: property,
        subtitle: entity ?? undefined,
        columns: MANAGER_COLUMNS,
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
          securityDeposit: null,
          riskExposure: null,
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
      notes: MANAGER_UNAVAILABLE.map((c) => `${c.label}: ${c.unavailable}`),
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
  months: string[];
  lateFees: number;
  outstanding: number;
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
        outstanding: 0,
      };
      byKey.set(key, row);
    }
    if (isGiro) {
      row.failures += 1;
      if (i.date) row.months.push(i.date.slice(0, 7));
    } else {
      row.lateFees += 1;
    }
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
