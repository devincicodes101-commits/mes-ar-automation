import { NextResponse } from "next/server";

import { identify } from "@/lib/api-auth";
import { serverSupabase } from "@/lib/supabase-server";
import {
  accountsFromRows,
  countLines,
  invoicesFromRows,
  managersFromRows,
  type ContactRow,
  type InvoiceRow,
  type SnapshotRow,
} from "@/lib/from-database";

/**
 * The most recent report, as the app expects it.
 *
 * Which report is "most recent" is the report date, not when somebody
 * uploaded it. MES are explicit that a report loaded late still ages as at its
 * own date, and somebody re-uploading August in September must not make August
 * the current picture.
 *
 * Returns the whole thing in one response rather than paging. Their August
 * export is 190 tenants and 3,117 lines, which is about a megabyte of JSON:
 * small enough that paging would cost more in complexity than it saves, and
 * every screen wants the whole set anyway because the aging board sums it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  /*
   * Every signed-in role may read the stored report, which is the same rule
   * the screens follow: what a relationship manager is shown is narrowed by
   * scope() rather than by being refused the data. Narrowing it here as well
   * is the right next step and is not done yet, so it is named rather than
   * implied: an RM calling this URL directly receives the whole file.
   */
  const who = await identify(request);
  if (!who.ok) {
    return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  }

  let db;
  try {
    db = serverSupabase();
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }

  // The newest report date that actually has snapshots. An upload row with
  // nothing under it would otherwise read as an empty month.
  const newest = await db
    .from("account_snapshots")
    .select("report_date")
    .order("report_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (newest.error) {
    return NextResponse.json(
      { ok: false, error: "Could not read the report dates.", detail: newest.error.message },
      { status: 502 },
    );
  }
  if (!newest.data) {
    return NextResponse.json({ ok: true, dataset: null, reason: "no reports stored" });
  }

  const reportDate = newest.data.report_date as string;

  const [snapshots, invoices, contacts, managers, upload] = await Promise.all([
    db
      .from("account_snapshots")
      .select(
        "tenant_id,report_date,period,status,bucket_current,bucket_30,bucket_60," +
          "bucket_90,bucket_90_plus,total,is_onefm,late_fee_count,legacy_note," +
          "tenants(customer_code,company_name,property_code,industry,entity,rm_key)",
      )
      .eq("report_date", reportDate),
    db
      .from("invoices")
      .select(
        "id,tenant_id,transaction_type,document_number,linked_contract,issued_on," +
          "due_on,age_days,bucket,description,revenue_type,is_onefm,open_balance",
      )
      .in(
        "snapshot_id",
        // Scoped by the snapshots of this date, which is how invoices are
        // filed. Asking by period would pull in a re-upload of the same month.
        (
          await db
            .from("account_snapshots")
            .select("id")
            .eq("report_date", reportDate)
        ).data?.map((r) => r.id) ?? [],
      ),
    db.from("contacts").select("tenant_id,email"),
    db.from("managers").select("key,name"),
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
    return NextResponse.json(
      { ok: false, error: "Could not read the report.", detail: failed.error.message },
      { status: 502 },
    );
  }

  const invoiceRows = (invoices.data ?? []) as unknown as InvoiceRow[];
  const snapshotRows = (snapshots.data ?? []) as unknown as SnapshotRow[];

  return NextResponse.json({
    ok: true,
    dataset: {
      source: "uploaded" as const,
      label: (upload.data?.ar_filename as string) ?? `Report of ${reportDate}`,
      asOf: reportDate,
      period: reportDate.slice(0, 7),
      accounts: accountsFromRows(
        snapshotRows,
        (contacts.data ?? []) as ContactRow[],
        countLines(invoiceRows),
      ),
      invoices: invoicesFromRows(invoiceRows),
      managers: managersFromRows(
        (managers.data ?? []) as { key: string; name: string }[],
      ),
    },
  });
}
