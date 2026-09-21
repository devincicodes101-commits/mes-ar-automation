import { NextResponse } from "next/server";

import { identify } from "@/lib/api-auth";
import { serverSupabase } from "@/lib/supabase-server";
import { newestReport } from "@/lib/read-report";
import { narrowReport } from "@/lib/scope-server";

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
   * Every signed-in role may read the stored report; what comes back is
   * narrowed to the caller's own book below.
   *
   * This used to say that narrowing here "is the right next step and is not
   * done yet", and meanwhile an RM calling this URL received all 190 tenants
   * while their screen showed three. The database had always refused them —
   * can_see_account() is on every table — but this route holds the service
   * role key, which bypasses every policy by design, and never narrowed the
   * result afterwards. Hidden by scope() in the browser is not the same as
   * not sent.
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
    /*
     * The counts go with the answer. An empty screen and a screen whose data
     * the server could not see look the same to the person in front of it, and
     * the difference is the whole of what they need to do next.
     */
    return NextResponse.json({
      ok: true,
      dataset: null,
      reason: result.reason,
      checked: result.checked ?? null,
    });
  }

  return NextResponse.json({
    ok: true,
    dataset: narrowReport(result.report, who.caller),
  });
}
