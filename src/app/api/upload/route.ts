import { NextResponse } from "next/server";

import { identify, mayUpload } from "@/lib/api-auth";
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
 * Who may call it: the roles that may upload through the screens, and nobody
 * else. Checked against the Supabase access token the browser holds, not
 * against the session object in its local storage, which is a claim the caller
 * wrote about themselves.
 */

export const runtime = "nodejs";

interface Body {
  accounts?: Account[];
  invoices?: DetailInvoice[];
  reportDate?: string | null;
  fileName?: string | null;
  /*
   * Absent when only the AR report was uploaded. Absent and empty mean
   * different things: absent leaves the stored contacts alone, and there is no
   * case where an upload should wipe every address MES have.
   */
  contacts?: { customerCode: string; companyName: string; emails: string[] }[] | null;
}

export async function POST(request: Request) {
  /*
   * Before anything is read, let alone stored. This route can replace a whole
   * month for every signed-in person at once, so it establishes who is asking
   * first and refuses early.
   */
  const who = await identify(request);
  if (!who.ok) {
    return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  }
  if (!mayUpload(who.caller)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          `A ${who.caller.role} may read the reports but not replace one. ` +
          "Uploading is for the AR team and the administrators.",
      },
      { status: 403 },
    );
  }

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
    body.contacts ?? null,
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
    /*
     * The one failure worth naming, because its message does not say what to
     * do. PostgREST reports a signature it cannot find as PGRST202, which is
     * what a database that has not had 0011 applied returns for every upload:
     * the function is there, but the seven argument version is not.
     */
    const missingSignature =
      error.code === "PGRST202" || /import_ar_report/.test(error.message);

    return NextResponse.json(
      {
        ok: false,
        error: "The database refused the import, so nothing was stored.",
        detail: error.message,
        hint: missingSignature
          ? "This database may not have 0011_rules_version.sql applied yet. " +
            "Run it in the Supabase SQL editor and upload again."
          : error.hint ?? null,
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
      contacts: payload.p_contacts?.length ?? 0,
    },
  });
}
