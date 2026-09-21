import { NextResponse } from "next/server";

import { identify, mayUpload } from "@/lib/api-auth";
import { serverSupabase } from "@/lib/supabase-server";
import { send } from "@/lib/mail";

/**
 * Sending a report to the people who act on it, with the workbook attached.
 *
 * ---------------------------------------------------------------------------
 * What this replaces
 *
 * simulateReportSend(), which built a covering note, named a file, marked
 * itself "simulated" and stopped. The screen said the report had gone and
 * nothing left the building. That is the fourth time this shape has turned up
 * here — a library that is right, a screen that shows it, and nothing in
 * between — so it is worth naming: a preview and a send have to be different
 * words on the button, and the difference has to be that one of them sends.
 *
 * ---------------------------------------------------------------------------
 * The file comes from the browser
 *
 * The screen has already built the workbook — it is the same bytes the
 * download button hands over — and posts it here rather than the server
 * rebuilding it from the report. Two reasons, and the first is the one that
 * matters: what leaves is then provably what was previewed and downloaded. A
 * second build could differ, and the difference would be invisible until a
 * manager asked why the file in his inbox disagreed with the screen.
 *
 * The second is that the caller could attach anything anyway. Only somebody
 * who may upload may send, which is CSD and the administrators, and every one
 * of them could email a spreadsheet from their own machine without asking.
 * This is not a privilege boundary, so it is not worth a worse guarantee.
 *
 * ---------------------------------------------------------------------------
 * The gate is the gate
 *
 * Goes through send(), so MAIL_MODE and MAIL_ALLOWLIST apply exactly as they
 * do to a tenant letter. A report addressed outside the test list is refused
 * with a reason rather than delivered, and while sending is off nothing goes
 * at all.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* An AR book at MES's size is tens of kilobytes; this is room to spare and a
   refusal rather than a function that dies part way through. */
const BIGGEST = 8 * 1024 * 1024;

interface Body {
  to?: string[];
  subject?: string;
  body?: string;
  filename?: string;
  /** The workbook, base64. Optional: some reports are a covering note only. */
  workbook?: string;
  reportName?: string;
}

export async function POST(request: Request) {
  const who = await identify(request);
  if (!who.ok) {
    return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  }
  if (!mayUpload(who.caller)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          `A ${who.caller.role} may read the reports but not send one. ` +
          "Sending is for the AR team and the administrators.",
      },
      { status: 403 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Unreadable request." }, { status: 400 });
  }

  const to = (body.to ?? []).map((a) => a.trim()).filter((a) => a.length > 0);
  if (to.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Nobody has an email address on this report. Add one in Settings " +
          "and it will go.",
      },
      { status: 400 },
    );
  }
  if (!body.subject?.trim() || !body.body?.trim()) {
    return NextResponse.json(
      { ok: false, error: "A report needs a subject and a covering note." },
      { status: 400 },
    );
  }

  let attachment: { filename: string; content: Buffer } | undefined;
  if (body.workbook) {
    if (body.workbook.length > BIGGEST) {
      return NextResponse.json(
        { ok: false, error: "That workbook is too large to send." },
        { status: 413 },
      );
    }
    if (!body.filename?.trim()) {
      /*
       * Refused rather than named here. A file called "report.xlsx" arriving
       * in a manager's inbox every month is a file he cannot tell apart from
       * last month's, and MES name theirs deliberately.
       */
      return NextResponse.json(
        { ok: false, error: "The attachment has no filename." },
        { status: 400 },
      );
    }
    attachment = {
      filename: body.filename.trim(),
      content: Buffer.from(body.workbook, "base64"),
    };
  }

  let db;
  try {
    db = serverSupabase();
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }

  const outcome = await send(db, who.caller.userId, {
    to,
    subject: body.subject.trim(),
    body: body.body.trim(),
    /*
     * A report is about the whole book rather than one tenant, so there is no
     * tenant id to give. The field exists for the error message and for the
     * record a letter writes; a report writes no such record, because
     * emails_sent is what was said to a tenant and this was not.
     */
    tenantId: "",
    companyName: body.reportName ?? "the report",
    ...(attachment ? { attachment } : {}),
  });

  if (!outcome.sent) {
    return NextResponse.json({
      ok: true,
      sent: false,
      blocked: Boolean(outcome.blocked),
      reason: outcome.reason,
    });
  }

  /*
   * Noted in the audit log rather than in emails_sent. A report going to the
   * AR team or to a manager is a thing somebody did, and worth being able to
   * answer for six weeks later, but it is not a letter to a tenant and putting
   * it among them would make every count of "what we sent this tenant" wrong.
   */
  try {
    await db.from("audit_log").insert({
      actor: who.caller.userId,
      actor_name: who.caller.email ?? "unknown",
      action: "Sent a report",
      subject: body.reportName ?? "report",
      meta: { to, filename: attachment?.filename ?? null },
    });
  } catch {
    /* It went. Failing to note it must not report the send as failed. */
  }

  return NextResponse.json({
    ok: true,
    sent: true,
    from: outcome.from ?? null,
    to,
    filename: attachment?.filename ?? null,
  });
}
