import { NextResponse } from "next/server";

import { identify, mayUpload } from "@/lib/api-auth";
import { markUsable, recordVerdict } from "@/lib/upload-verdict";
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
  /*
   * Set when the report was read successfully and holds no outstanding
   * charges, which is a month where every tenant has paid. Without it an empty
   * report is refused, and MES's best month becomes their only unstorable one.
   */
  nothingOutstanding?: boolean;
  /*
   * What the upload screen's checks said about this file.
   *
   * Computed in the browser, because that is where the workbook is read and
   * where the subtotals it compares against exist - the server receives
   * accounts and lines, not the sheet. Stored here so the nine o'clock run has
   * something to read: until it was, a file marked "do not use this data" was
   * used the next morning by a job nobody was watching.
   */
  findings?: { severity?: string; title?: string; detail?: string }[] | null;
}

/**
 * Mark the most recent upload usable although its checks failed.
 *
 * A gate with no way through is worse than no gate: the first time MES send a
 * slightly odd but perfectly usable export, collections stop and nobody can
 * start them again. So an officer can look at the figures and say they are
 * right.
 *
 * Recorded against the upload with who and when, and written to the audit log,
 * because this is a person overruling a safety check on money. A later upload
 * starts clean - the decision does not carry forward.
 */
export async function PATCH(request: Request) {
  const who = await identify(request);
  if (!who.ok) {
    return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  }
  if (!mayUpload(who.caller)) {
    return NextResponse.json(
      { ok: false, error: "Your role cannot change an upload." },
      { status: 403 },
    );
  }

  let note = "";
  try {
    const body = (await request.json()) as { note?: string };
    note = String(body?.note ?? "").slice(0, 300);
  } catch {
    note = "";
  }

  let db;
  try {
    db = serverSupabase();
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }

  const done = await markUsable(
    db,
    { userId: who.caller.userId, name: who.caller.email ?? who.caller.role },
    note,
  );
  if (!done.ok) {
    return NextResponse.json({ ok: false, error: done.error }, { status: done.status });
  }

  return NextResponse.json({ ok: true, uploadId: done.uploadId });

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

  /*
   * Only honoured when the report really is empty. The caller says a month had
   * nothing outstanding; it does not get to say that about a report with
   * tenants in it, so the claim is checked against what arrived rather than
   * taken on its own.
   */
  const nothingOutstanding =
    body.nothingOutstanding === true && accounts.length === 0 && invoices.length === 0;

  const { payload, problems } = toImportPayload(
    accounts,
    invoices,
    body.reportDate ?? null,
    body.fileName ?? null,
    body.contacts ?? null,
    nothingOutstanding,
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
     * what a database returns when the code is ahead of its migrations: the
     * function is there, but not with the arguments this build sends.
     *
     * It has happened twice, and both times the upload looked like it worked:
     * the browser had already parsed the file and put the figures on screen,
     * so the only sign was a line saying it had not been saved. The message
     * therefore names the migration rather than describing the problem, so
     * somebody reading it once knows exactly what to run.
     */
    const missingSignature =
      error.code === "PGRST202" || /import_ar_report/.test(error.message);

    return NextResponse.json(
      {
        ok: false,
        error: "The database refused the import, so nothing was stored.",
        detail: error.message,
        hint: missingSignature
          ? "This database is behind the code. Run the migrations that have " +
            "not been applied yet, newest last: 0017_import_contacts.sql, " +
            "0018_email_period.sql, 0019_rm_key.sql. Run them in the " +
            "Supabase SQL editor and upload again."
          : error.hint ?? null,
      },
      { status: 502 },
    );
  }

  /*
   * The verdict, against the upload it belongs to.
   *
   * A separate statement rather than an argument to import_ar_report, so the
   * import function keeps the signature every deployed database already has.
   * A failure here is said out loud and does not fail the upload: the figures
   * are stored and correct either way, and refusing a good import because its
   * verdict could not be filed would be the tail wagging the dog.
   */
  /*
   * The verdict, against the upload it belongs to. recordVerdict does the
   * writing: this route stays thin by design, and everything it stores goes
   * through one atomic import call.
   */
  const uploadId = (data as { upload_id?: string } | null)?.upload_id ?? null;
  const verdictStored = uploadId
    ? await recordVerdict(db, uploadId, Array.isArray(body.findings) ? body.findings : [])
    : null;

  return NextResponse.json({
    ok: true,
    stored: data,
    verdict: verdictStored,
    counted: {
      accounts: payload.p_tenants.length,
      lines: payload.p_invoices.length,
      contacts: payload.p_contacts?.length ?? 0,
      /*
       * Said on every upload, because the whole failure this fixes was silent.
       * A file whose Primary Sales Rep column has gone missing imports
       * perfectly and quietly assigns nobody, and the next sign is a manager
       * opening an empty screen a week later. A zero here is visible at the
       * moment it happens.
       */
      managers: payload.p_managers.length,
      assigned: payload.p_tenants.filter((t) => t.rm_key).length,
    },
  });
}
