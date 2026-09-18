import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  accountsFromRows,
  countLines,
  invoicesFromRows,
  managersFromRows,
  type ContactRow,
  type InvoiceRow,
  type SnapshotRow,
} from "./from-database.ts";
import type { Account } from "./types.ts";
import type { DetailInvoice } from "./aging-detail.ts";
import type { Manager } from "./dataset.ts";

/**
 * Reading the stored report, in one place.
 *
 * Two callers need it and they must not each have their own copy. /api/dataset
 * serves it to the screens, and the cron reads it to decide what today's step
 * does. If those drifted, the month would run against figures nobody could see
 * on screen, and the disagreement would show up as a letter quoting a balance
 * the tenant's own account page does not.
 *
 * Which report is "most recent" is the report date, not when somebody uploaded
 * it. MES are explicit that a report loaded late still ages as at its own
 * date, so re-uploading August in September must not make August the current
 * picture.
 */

/**
 * Every row, not the first thousand.
 *
 * PostgREST caps a response at max-rows, which is 1,000 on Supabase, and it
 * does it silently: the request succeeds and the array is simply short. Their
 * August report has 3,117 charge lines, so the aging board was summing under a
 * third of them and showing the result as the total.
 *
 * Nothing about that looks wrong on screen. The figures are plausible, no
 * error is raised, and the only way to notice is to know what the total should
 * have been. So the range is walked explicitly, and a page shorter than the
 * step means the end.
 */
const PAGE = 1000;

interface Pageable {
  range: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>;
}

async function everything<T>(build: () => Pageable): Promise<{ rows: T[]; error: unknown }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) return { rows, error };
    /*
     * Cast here rather than in the signature. A select that embeds a related
     * table, as the snapshots one does, defeats supabase-js's row inference
     * and it falls back to a type that matches nothing. The shapes are
     * asserted against the real database by test:routes instead, which is the
     * only place the column names can actually be checked.
     */
    const got = (data ?? []) as T[];
    rows.push(...got);
    if (got.length < PAGE) return { rows, error: null };
  }
}

export interface StoredReport {
  source: "uploaded";
  label: string;
  asOf: string;
  period: string;
  accounts: Account[];
  invoices: (DetailInvoice & { id: string })[];
  managers: Manager[];
}

export type ReadResult =
  | { ok: true; report: StoredReport }
  | { ok: true; report: null; reason: string; checked?: EmptyCheck }
  | { ok: false; error: string; detail: string | null };

/**
 * What "nothing stored" actually meant.
 *
 * "No reports stored" is not a finding on its own. It is the same sentence
 * whether the database is genuinely empty, whether the rows are there and the
 * query could not see them, and whether this copy of the app is pointed at a
 * different project altogether. Those need completely different things done
 * about them, and telling them apart cost an afternoon of reading code that
 * turned out to be correct.
 *
 * So the emptiness is checked rather than assumed, and the counts are reported
 * alongside it. The host is included because a deployment reading the wrong
 * project is the one cause that looks identical from every angle: right code,
 * right key, no error, no rows.
 */
export interface EmptyCheck {
  /** The Supabase project this read went to. Host only: no key, ever. */
  host: string;
  uploads: number | null;
  snapshots: number | null;
  problem: string | null;
}

async function countOf(db: SupabaseClient, table: string): Promise<number | null> {
  const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
  return error ? null : (count ?? 0);
}

/**
 * Runs only when a read came back empty, so the cost lands on the rare path
 * rather than on every request.
 */
export async function whyEmpty(db: SupabaseClient): Promise<EmptyCheck> {
  let host = "unknown";
  try {
    host = new URL((db as unknown as { supabaseUrl: string }).supabaseUrl).host;
  } catch {
    /* Reading it is a convenience, not a requirement. */
  }

  const [uploads, snapshots] = await Promise.all([
    countOf(db, "uploads"),
    countOf(db, "account_snapshots"),
  ]);

  /*
   * The contradiction worth naming: rows exist and the read found none. That
   * is never a database that is simply empty, so it should not be reported as
   * one.
   */
  const problem =
    (snapshots ?? 0) > 0
      ? `${snapshots} snapshots are stored but the report list came back empty.`
      : null;

  return { host, uploads, snapshots, problem };
}

const why = (e: unknown): string | null => (e as { message?: string })?.message ?? null;

/**
 * Every report date that actually has accounts stored against it, newest first.
 *
 * An upload row with nothing under it would otherwise read as a month where
 * everybody paid, which is the same shape as a month that failed to import and
 * means the opposite.
 *
 * Ordered by report date rather than by upload time throughout. MES re-upload
 * months late and often, so "the newest file" and "the newest month" are
 * regularly different things.
 */
export async function reportDates(
  db: SupabaseClient,
): Promise<{ ok: true; dates: string[] } | { ok: false; error: string }> {
  const rows = await everything<{ report_date: string }>(() =>
    db.from("account_snapshots").select("report_date").order("report_date", { ascending: false }),
  );

  if (rows.error) {
    return { ok: false, error: `Could not read the report dates. ${why(rows.error) ?? ""}`.trim() };
  }

  /*
   * One row per snapshot, so hundreds per date. Deduplicated with a plain pass
   * rather than a Set spread, because this file compiles under the project's
   * older target where that needs downlevelIteration. Order is preserved,
   * which is the whole point: the database already sorted them.
   */
  const seen: Record<string, true> = {};
  const dates: string[] = [];
  for (const r of rows.rows) {
    if (seen[r.report_date]) continue;
    seen[r.report_date] = true;
    dates.push(r.report_date);
  }
  return { ok: true, dates };
}

/** The newest stored report, or an explanation. */
export async function newestReport(db: SupabaseClient): Promise<ReadResult> {
  const dates = await reportDates(db);
  if (!dates.ok) return { ok: false, error: dates.error, detail: null };
  if (dates.dates.length === 0) {
    return { ok: true, report: null, reason: "no reports stored", checked: await whyEmpty(db) };
  }
  return reportOn(db, dates.dates[0]!);
}

/** One named report, whichever it is. */
export async function reportOn(
  db: SupabaseClient,
  reportDate: string,
): Promise<ReadResult> {
  /*
   * Scoped by this date's snapshots, which is how invoice lines are filed.
   * Asking by period instead would pull in a re-upload of the same month and
   * show a tenant's charges twice.
   */
  const snapshotIds = await everything<{ id: string }>(() =>
    db.from("account_snapshots").select("id").eq("report_date", reportDate),
  );
  if (snapshotIds.error) {
    return { ok: false, error: "Could not read the report.", detail: why(snapshotIds.error) };
  }
  const ids = snapshotIds.rows.map((r) => r.id);

  const [snapshots, invoices, contacts, managers, upload] = await Promise.all([
    everything<SnapshotRow>(() =>
      db
        .from("account_snapshots")
        .select(
          "tenant_id,report_date,period,status,bucket_current,bucket_30,bucket_60," +
            "bucket_90,bucket_90_plus,total,is_onefm,late_fee_count,legacy_note," +
            "tenants(customer_code,company_name,property_code,industry,entity,rm_key)",
        )
        .eq("report_date", reportDate),
    ),
    everything<InvoiceRow>(() =>
      db
        .from("invoices")
        .select(
          "id,tenant_id,transaction_type,document_number,linked_contract,issued_on," +
            "due_on,age_days,bucket,description,revenue_type,is_onefm,open_balance," +
            "category,tenants(customer_code,company_name,property_code)",
        )
        .in("snapshot_id", ids),
    ),
    everything<ContactRow>(() => db.from("contacts").select("customer_code,email")),
    everything<{ key: string; name: string }>(() => db.from("managers").select("key,name")),
    db
      .from("uploads")
      .select("ar_filename,report_date,period")
      .eq("report_date", reportDate)
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const failed = [snapshots, invoices, contacts, managers].find((r) => r.error);
  if (failed?.error) {
    return { ok: false, error: "Could not read the report.", detail: why(failed.error) };
  }

  const invoiceRows = invoices.rows;

  return {
    ok: true,
    report: {
      source: "uploaded",
      label: (upload.data?.ar_filename as string) ?? `Report of ${reportDate}`,
      asOf: reportDate,
      period: reportDate.slice(0, 7),
      accounts: accountsFromRows(snapshots.rows, contacts.rows, countLines(invoiceRows)),
      invoices: invoicesFromRows(invoiceRows),
      managers: managersFromRows(managers.rows),
    },
  };
}
