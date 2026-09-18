import { NextResponse } from "next/server";

import { identify } from "@/lib/api-auth";
import { serverSupabase } from "@/lib/supabase-server";
import { newestReport } from "@/lib/read-report";

/**
 * The most recent report, as the app expects it.
 *
 * The reading itself lives in lib/read-report.ts, because the cron needs the
 * same thing to decide what today's step does. Two copies would mean the month
 * running against figures nobody can see on screen, and the disagreement would
 * surface as a letter quoting a balance the tenant's own page does not show.
 *
 * Returns the whole report in one response rather than paging. Their August
 * export is 190 tenants and 3,117 lines, about a megabyte of JSON: small
 * enough that paging would cost more in complexity than it saves, and every
 * screen wants the whole set anyway because the aging board sums it.
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
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }

  const result = await newestReport(db);

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, detail: result.detail },
      { status: 502 },
    );
  }

  if (!result.report) {
    return NextResponse.json({ ok: true, dataset: null, reason: result.reason });
  }

  return NextResponse.json({ ok: true, dataset: result.report });
}
