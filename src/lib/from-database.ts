/**
 * The shape the database holds, turned back into the shape the app expects.
 *
 * The inverse of to-database.ts, and deliberately its own file so the two can
 * be read against each other. A column that goes out through one and does not
 * come back through the other is a data loss that no screen would report: the
 * figure would simply be zero, and zero is a number somebody acts on.
 *
 * Nothing here recalculates anything. The buckets, the ages and the charge
 * types were worked out when the report was read and stored as they were
 * decided that day. Re-deriving them on the way out would mean a report
 * silently changing its mind months later, the first time a classification
 * rule was fixed.
 */

import type { Account, Invoice, PropertyCode } from "./types";
import type { Manager } from "./dataset";

const PROPERTY_NAMES: Record<string, string> = {
  JPD1: "Jurong Penjuru Dormitory 1",
  JPD2: "Jurong Penjuru Dormitory 2",
  BSD: "Blue Stars Dormitory",
  LEO: "The Leo",
};

/** One row of the snapshot query, with its tenant joined on. */
export interface SnapshotRow {
  tenant_id: string;
  report_date: string;
  period: string;
  status: string;
  bucket_current: number | string;
  bucket_30: number | string;
  bucket_60: number | string;
  bucket_90: number | string;
  bucket_90_plus: number | string;
  total: number | string;
  is_onefm: boolean;
  late_fee_count: number;
  legacy_note: string | null;
  tenants: {
    customer_code: string;
    company_name: string;
    property_code: string;
    industry: string | null;
    entity: string | null;
    rm_key: string | null;
  } | null;
}

export interface InvoiceRow {
  id: string;
  tenant_id: string;
  transaction_type: string | null;
  document_number: string | null;
  linked_contract: string | null;
  issued_on: string | null;
  due_on: string | null;
  age_days: number | null;
  bucket: string | null;
  description: string | null;
  revenue_type: string;
  is_onefm: boolean;
  open_balance: number | string;
}

export interface ContactRow {
  tenant_id: string;
  email: string | null;
}

/* Postgres returns numeric as a string, so that 1234567890123.45 does not
 * quietly lose its last digits on the way through a double. Everything here
 * is under a million dollars, so Number is safe, but it has to be asked for. */
const num = (v: number | string | null | undefined): number =>
  v === null || v === undefined ? 0 : Number(v);

export function accountsFromRows(
  snapshots: readonly SnapshotRow[],
  contacts: readonly ContactRow[] = [],
  invoiceCounts: ReadonlyMap<string, { lines: number; types: Set<string> }> = new Map(),
): Account[] {
  const emails = new Map<string, string[]>();
  for (const c of contacts) {
    if (!c.email) continue;
    emails.set(c.tenant_id, [...(emails.get(c.tenant_id) ?? []), c.email]);
  }

  return snapshots.map((s) => {
    const t = s.tenants;
    const property = (t?.property_code ?? "BSD") as PropertyCode;
    const mine = emails.get(s.tenant_id) ?? [];
    const counted = invoiceCounts.get(s.tenant_id);

    return {
      id: s.tenant_id,
      customerCode: t?.customer_code ?? s.tenant_id,
      companyName: t?.company_name ?? s.tenant_id,
      property,
      propertyName: PROPERTY_NAMES[property] ?? property,
      status: s.status === "terminated" ? "Terminated" : "Live",
      buckets: {
        current: num(s.bucket_current),
        d30: num(s.bucket_30),
        d60: num(s.bucket_60),
        d90: num(s.bucket_90),
        d90plus: num(s.bucket_90_plus),
      },
      total: num(s.total),
      legacyNote: s.legacy_note,
      emails: mine,
      hasContact: mine.length > 0,
      industry: t?.industry ?? null,
      entity: t?.entity ?? null,
      invoiceCount: counted?.lines ?? 0,
      isOneFm: s.is_onefm,
      revenueTypes: counted ? Array.from(counted.types).sort() : [],
      lateFeeCount: s.late_fee_count,
    } satisfies Account;
  });
}

export function invoicesFromRows(rows: readonly InvoiceRow[]): Invoice[] {
  return rows.map((r) => ({
    id: r.id,
    companyName: r.tenant_id,
    transactionType: r.transaction_type ?? "Invoice",
    date: r.issued_on,
    dueDate: r.due_on,
    description: r.description ?? "",
    documentNumber: r.document_number ?? "",
    linkedContract: r.linked_contract,
    age: r.age_days,
    bucket: r.bucket ?? "",
    openBalance: num(r.open_balance),
    revenueType: r.revenue_type,
    isOneFm: r.is_onefm,
  }));
}

/**
 * What each tenant's lines add up to, for the two fields an Account carries
 * about its own invoices. Counted here rather than asked of the database,
 * because the rows are already in hand.
 */
export function countLines(
  rows: readonly InvoiceRow[],
): Map<string, { lines: number; types: Set<string> }> {
  const by = new Map<string, { lines: number; types: Set<string> }>();
  for (const r of rows) {
    const at = by.get(r.tenant_id) ?? { lines: 0, types: new Set<string>() };
    at.lines += 1;
    at.types.add(r.revenue_type);
    by.set(r.tenant_id, at);
  }
  return by;
}

export function managersFromRows(
  rows: readonly { key: string; name: string }[],
): Manager[] {
  return rows.map((m) => ({ key: m.key, name: m.name }) as Manager);
}
