/**
 * Turning a parsed AR report into database rows.
 *
 * This is where the rule from MES's own flow document is enforced, and it is
 * the rule the whole design turns on:
 *
 *   Balances can always be rebuilt. Delete every one of them, upload the file
 *   again, and the same numbers come back.
 *
 *   Calls, promises, emails and fees cannot be rebuilt by anything. Once gone
 *   they are gone, and no spreadsheet in the world returns them.
 *
 * So an import is allowed to replace the first kind and must never touch the
 * second. MES upload on the 4th, the 7th and the 16th; if an upload could
 * delete a phone call then the officer would be destroying her own work three
 * times a month, silently, with no error, because nothing had gone wrong as
 * far as the software was concerned.
 *
 * The plan is built here as plain data, with no database anywhere near it, so
 * that it can be inspected and tested on its own. Writing it is a separate
 * step: see applyImport.
 */

import type { Account, Invoice } from "./types";

/* --------------------------------------------------------------- the rows */

export interface TenantRow {
  id: string;
  customer_code: string;
  company_name: string;
  property_code: string;
  industry: string | null;
  entity: string | null;
  first_seen: string;
  last_seen: string;
}

export interface SnapshotRow {
  tenant_id: string;
  report_date: string;
  period: string;
  status: "live" | "terminated";
  bucket_current: number;
  bucket_30: number;
  bucket_60: number;
  bucket_90: number;
  bucket_90_plus: number;
  total: number;
  is_onefm: boolean;
  late_fee_count: number;
  legacy_note: string | null;
}

export interface InvoiceRow {
  tenant_id: string;
  period: string;
  transaction_type: string;
  issued_on: string | null;
  due_on: string | null;
  description: string;
  document_number: string;
  linked_contract: string | null;
  age_days: number | null;
  bucket: string;
  open_balance: number;
  revenue_type: string;
  is_onefm: boolean;
}

export interface ImportPlan {
  /** The date printed inside the report. Everything is measured from it. */
  reportDate: string;
  /** The billing month, for grouping only. */
  period: string;
  tenants: TenantRow[];
  snapshots: SnapshotRow[];
  invoices: InvoiceRow[];
  problems: string[];
}

/* ------------------------------------------------------------- the mapping */

/** Normalised for matching only. Never shown, never stored. */
const key = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * The billing month an "as of" date belongs to, as the first of that month.
 *
 * Grouping only. Nothing is aged from this, because MES are explicit that
 * ageing counts from the date on the report rather than the calendar.
 */
export function periodOf(reportDate: string): string {
  return `${reportDate.slice(0, 7)}-01`;
}

/**
 * Builds the rows for one upload.
 *
 * Accounts come from the per-dormitory summary and carry the balances.
 * Invoices come from the detail export and are optional: MES have sent a
 * detail file with every amount blank, and a report with no line detail is
 * still a perfectly good report of what everyone owes.
 */
export function buildImportPlan(
  reportDate: string,
  accounts: Account[],
  invoices: Omit<Invoice, "id">[] = [],
): ImportPlan {
  const period = periodOf(reportDate);
  const problems: string[] = [];

  const tenants: TenantRow[] = accounts.map((a) => ({
    id: a.id,
    customer_code: a.customerCode,
    company_name: a.companyName,
    property_code: a.property,
    industry: a.industry,
    entity: a.entity,
    first_seen: reportDate,
    last_seen: reportDate,
  }));

  const snapshots: SnapshotRow[] = accounts.map((a) => ({
    tenant_id: a.id,
    report_date: reportDate,
    period,
    status: a.status === "Terminated" ? "terminated" : "live",
    bucket_current: a.buckets.current,
    bucket_30: a.buckets.d30,
    bucket_60: a.buckets.d60,
    bucket_90: a.buckets.d90,
    bucket_90_plus: a.buckets.d90plus,
    total: a.total,
    is_onefm: a.isOneFm,
    late_fee_count: a.lateFeeCount,
    legacy_note: a.legacyNote,
  }));

  // Invoices arrive keyed by company name, because the detail export has no
  // customer code on its line rows. A company renting at two dormitories has
  // two tenant records and the name alone cannot say which, so those lines
  // are reported rather than assigned to whichever one happened to be first.
  const byName = new Map<string, TenantRow[]>();
  for (const t of tenants) {
    const k = key(t.company_name);
    byName.set(k, [...(byName.get(k) ?? []), t]);
  }

  const invoiceRows: InvoiceRow[] = [];
  let unmatched = 0;
  const ambiguous = new Set<string>();

  for (const inv of invoices) {
    const found = byName.get(key(inv.companyName)) ?? [];
    if (found.length === 0) {
      unmatched += 1;
      continue;
    }
    if (found.length > 1) {
      ambiguous.add(inv.companyName);
      continue;
    }
    invoiceRows.push({
      tenant_id: found[0].id,
      period,
      transaction_type: inv.transactionType,
      issued_on: inv.date,
      due_on: inv.dueDate,
      description: inv.description,
      document_number: inv.documentNumber,
      linked_contract: inv.linkedContract,
      age_days: inv.age,
      bucket: inv.bucket,
      open_balance: inv.openBalance,
      revenue_type: inv.revenueType,
      is_onefm: inv.isOneFm,
    });
  }

  if (unmatched > 0) {
    problems.push(
      `${unmatched} invoice line${unmatched === 1 ? "" : "s"} belong to a ` +
        `company that is not in the balances file, so they were not imported.`,
    );
  }
  for (const name of Array.from(ambiguous)) {
    problems.push(
      `${name} rents at more than one dormitory, and the invoice detail does ` +
        `not say which. Those lines were left out rather than charged to the ` +
        `wrong one.`,
    );
  }

  return {
    reportDate,
    period,
    tenants,
    snapshots,
    invoices: invoiceRows,
    problems,
  };
}

/* --------------------------------------------------------- what it touches */

/**
 * Tables an import is allowed to write, and the ones it must leave alone.
 *
 * Written out as data rather than left implicit in the SQL, so the rule can
 * be asserted by a test. If someone later adds a delete to applyImport that
 * reaches one of the protected tables, the test fails and says why.
 */
export const IMPORT_REPLACES = [
  "account_snapshots",
  "invoices",
] as const;

export const IMPORT_MUST_NOT_TOUCH = [
  "calls",
  "promises",
  "emails_sent",
  "late_fees",
  "audit_log",
] as const;

/**
 * `tenants` is neither. An import adds tenants it has not seen before and
 * updates the names and dormitory details of ones it has, but never deletes:
 * a tenant who moved out still has calls and fees hanging off them, and
 * removing the row would take those with it.
 */
export const IMPORT_UPSERTS = ["tenants"] as const;
