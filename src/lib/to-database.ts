/**
 * The shape the app holds, turned into the shape the database wants.
 *
 * Kept apart from the route that calls it so it can be tested without a
 * network, and kept apart from the parser so a column renamed in Postgres does
 * not reach back into how a spreadsheet is read.
 *
 * One rule runs through all of it: a row that cannot be mapped honestly is
 * reported, never guessed at. An import that half succeeded and said nothing
 * is the failure this whole phase exists to avoid.
 */

import type { Account, PropertyCode } from "./types";
import type { DetailInvoice } from "./aging-detail";

/** The four MES operate. Anything else is not a dormitory we know about. */
const PROPERTIES: readonly PropertyCode[] = ["JPD1", "JPD2", "BSD", "LEO"];

export interface DbTenant {
  id: string;
  customer_code: string;
  company_name: string;
  property_code: string;
  industry: string | null;
  entity: string | null;
}

export interface DbSnapshot {
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

export interface DbInvoice {
  /*
   * Required, and the reason 0010 exists.
   *
   * import_ar_report finds each line's snapshot by looking one up for this
   * tenant and this report date. A line without it lands with a null
   * snapshot_id, becomes unreachable by every delete in the system, and
   * silently doubles the charge tabs on the next import of the same date.
   */
  tenant_id: string;
  period: string;
  transaction_type: string;
  document_number: string | null;
  linked_contract: string | null;
  issued_on: string | null;
  due_on: string | null;
  age_days: number | null;
  bucket: string | null;
  description: string | null;
  revenue_type: string;
  is_onefm: boolean;
  open_balance: number;
}

export interface ImportPayload {
  p_report_date: string;
  p_period: string;
  p_tenants: DbTenant[];
  p_snapshots: DbSnapshot[];
  p_invoices: DbInvoice[];
  p_ar_filename: string | null;
}

export interface MappingProblem {
  what: string;
  detail: string;
}

export interface Mapped {
  payload: ImportPayload | null;
  problems: MappingProblem[];
}

/** The id the whole system keys on: a company at one dormitory. */
export function tenantId(customerCode: string, property: string): string {
  return `${customerCode}-${property}`.toLowerCase();
}

/** The first of the month the report covers, which is how periods are stored. */
export function periodOf(reportDate: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(reportDate);
  return m ? `${m[1]}-${m[2]}-01` : reportDate;
}

/**
 * Builds everything import_ar_report needs, or explains why it cannot.
 *
 * Returns problems rather than throwing, so a caller can show all of them at
 * once instead of the first. An import is refused outright when there are any:
 * a report that loaded most of its lines would put a wrong balance in front of
 * somebody, and a wrong balance that looks right is worse than an error.
 */
export function toImportPayload(
  accounts: readonly Account[],
  invoices: readonly DetailInvoice[],
  reportDate: string | null,
  fileName: string | null,
): Mapped {
  const problems: MappingProblem[] = [];

  if (!reportDate) {
    problems.push({
      what: "No report date",
      detail:
        "Everything in the database is filed under the date the report was " +
        "run, so a report that cannot be dated cannot be stored. The parser " +
        "reads it from the header, or works it out from the due dates and " +
        "ages on the lines.",
    });
  }

  if (accounts.length === 0) {
    problems.push({
      what: "No tenants",
      detail: "The report was read but produced no accounts.",
    });
  }

  const period = reportDate ? periodOf(reportDate) : "";
  const known = new Set<string>();

  const tenants: DbTenant[] = [];
  const snapshots: DbSnapshot[] = [];

  for (const a of accounts) {
    if (!PROPERTIES.includes(a.property)) {
      problems.push({
        what: `${a.customerCode} is in an unknown dormitory`,
        detail:
          `"${a.property}" is not one of ${PROPERTIES.join(", ")}. The ` +
          "database will refuse it, so the import is stopped here rather " +
          "than part way through.",
      });
      continue;
    }

    const id = tenantId(a.customerCode, a.property);
    if (known.has(id)) {
      problems.push({
        what: `${a.customerCode} appears twice at ${a.property}`,
        detail:
          "A company at a dormitory is one account. Two rows for the same " +
          "pair means the report was read wrongly, and importing would keep " +
          "only one of the two balances.",
      });
      continue;
    }
    known.add(id);

    tenants.push({
      id,
      customer_code: a.customerCode,
      company_name: a.companyName,
      property_code: a.property,
      industry: a.industry ?? null,
      entity: a.entity ?? null,
    });

    snapshots.push({
      tenant_id: id,
      report_date: reportDate ?? "",
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
      legacy_note: a.legacyNote ?? null,
    });
  }

  const lines: DbInvoice[] = [];
  let orphaned = 0;

  for (const i of invoices) {
    const id = tenantId(i.customerCode, i.property);
    if (!known.has(id)) {
      orphaned += 1;
      continue;
    }
    lines.push({
      tenant_id: id,
      period,
      transaction_type: i.transactionType || "Invoice",
      document_number: i.documentNumber || null,
      linked_contract: i.linkedContract ?? null,
      issued_on: i.date ?? null,
      due_on: i.dueDate ?? null,
      age_days: i.age ?? null,
      bucket: i.bucket || null,
      description: i.description ? i.description.slice(0, 400) : null,
      revenue_type: i.revenueType,
      is_onefm: i.isOneFm,
      open_balance: i.openBalance,
    });
  }

  if (orphaned > 0) {
    problems.push({
      what: `${orphaned} charge lines belong to no tenant`,
      detail:
        "Every line is filed under a company at a dormitory. These name a " +
        "pair that is not in the accounts, so importing them would store a " +
        "charge nobody owes.",
    });
  }

  if (problems.length > 0) return { payload: null, problems };

  return {
    payload: {
      p_report_date: reportDate as string,
      p_period: period,
      p_tenants: tenants,
      p_snapshots: snapshots,
      p_invoices: lines,
      p_ar_filename: fileName,
    },
    problems: [],
  };
}
