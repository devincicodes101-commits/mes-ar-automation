import { NextResponse } from "next/server";

import { serverSupabase } from "@/lib/supabase-server";
import { toImportPayload } from "@/lib/to-database";
import type { Account } from "@/lib/types";
import type { DetailInvoice } from "@/lib/aging-detail";

/**
 * Storing one AR report.
 *
 * The browser has already read the workbook and worked out the accounts, the
 * ages and the buckets, because that is where the parser lives and where its
 * 338 cases run. This route does not re-read the file. It maps what the
 * browser produced onto the database's shape and calls import_ar_report, which
 * does the whole thing in one transaction: replace this report date, leave
 * every other date alone, and touch nothing that records what an officer did.
 *
 * That last guarantee is asserted by npm run test:import:rest rather than
 * assumed. Losing a logged phone call raises no error and would take weeks to
 * notice.
 *
 * ---------------------------------------------------------------------------
 * What this route refuses
 *
 * It holds the service role key, which bypasses every row level security
 * policy in the database. So it is deliberately narrow: it accepts one shape,
 * refuses anything it cannot map completely, and never imports part of a
 * report. A half loaded report puts a wrong balance in front of somebody, and
 * a wrong balance that looks right is worse than an error.
 *
 * Not yet done, and it matters: this does not check who is asking. Sessions
 * are carried into API routes in task 1.7, and until then the route is as open
 * as the app around it. It is listed as a task rather than left implied.
 */

export const runtime = "nodejs";

interface Body {
  accounts?: Account[];
  invoices?: DetailInvoice[];
  reportDate?: string | null;
  fileName?: string | null;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "The request body was not readable JSON." },
      { status: 400 },
    );
  }

  const accounts = body.accounts ?? [];
  const invoices = body.invoices ?? [];

  if (!Array.isArray(accounts) || !Array.isArray(invoices)) {
    return NextResponse.json(
      { ok: false, error: "accounts and invoices must both be arrays." },
      { status: 400 },
    );
  }

  const { payload, problems } = toImportPayload(
    accounts,
    invoices,
    body.reportDate ?? null,
    body.fileName ?? null,
  );

  if (!payload) {
    return NextResponse.json(
      {
        ok: false,
        error: "This report cannot be stored as it stands.",
        problems,
      },
      { status: 422 },
    );
  }

  let db;
  try {
    db = serverSupabase();
  } catch (e) {
    // Configuration, not data. Says so, because the two need different fixes.
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }

  const { data, error } = await db.rpc("import_ar_report", payload);

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "The database refused the import, so nothing was stored.",
        detail: error.message,
        hint: error.hint ?? null,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    stored: data,
    counted: {
      accounts: payload.p_tenants.length,
      lines: payload.p_invoices.length,
    },
  });
}
