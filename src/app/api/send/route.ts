import { NextResponse } from "next/server";

import { identify, mayUpload } from "@/lib/api-auth";
import { serverSupabase } from "@/lib/supabase-server";
import { connector, send, sendingStatus, type Letter } from "@/lib/mail";

/**
 * Actually putting a letter in somebody's inbox.
 *
 * Everything before this built the letter and stopped. This is the only code
 * in the system whose mistakes reach people outside MES and cannot be taken
 * back, so it is the most cautious thing here by some distance.
 *
 * GET says what would happen without doing anything: which mailbox, which
 * mode, and why nothing is going out if nothing is. A system that silently
 * sends nothing looks exactly like a system that is working, so the answer to
 * "why did nobody get the reminder" is a URL rather than a log file.
 *
 * POST sends. Who may: the same roles that may upload, because writing to a
 * tenant about money is at least as consequential as replacing a month's
 * figures, and a relationship manager who cannot do the second should not be
 * able to do the first.
 *
 * ---------------------------------------------------------------------------
 * Every send is recorded, including the ones that did not happen
 *
 * A blocked letter is a fact about the run, not an absence. If the 21st writes
 * to 40 tenants and 38 are refused because they have no address, that is the
 * single most useful thing anybody could know that morning, and it must not be
 * something you have to go looking for.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const who = await identify(request);
  if (!who.ok) {
    return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  }

  let db = null;
  try {
    db = serverSupabase();
  } catch {
    // Without a database there are no connected accounts, only the shared
    // mailbox. Worth reporting on rather than refusing outright.
  }

  const status = await sendingStatus(db, who.caller.userId);

  /*
   * Only checked when asked, because it opens a connection to Google and this
   * URL is otherwise cheap enough to poll.
   */
  const url = new URL(request.url);
  let mailbox: { ok: boolean; error?: string } | null = null;
  if (url.searchParams.get("verify") === "1") {
    const chosen = await connector(db, who.caller.userId);
    mailbox = chosen.ok ? await chosen.connector.verify() : { ok: false, error: chosen.error };
  }

  return NextResponse.json({ ok: true, ...status, mailbox });
}

interface Body {
  /** A single letter to whoever is testing, to prove the mailbox works. */
  test?: { to: string };
  /** Real letters, already built and merged by the caller. */
  letters?: Letter[];
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
          `A ${who.caller.role} may read the reports but not write to tenants. ` +
          "Sending is for the AR team and the administrators.",
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

  /*
   * The test letter. Deliberately not a real template and deliberately says so
   * in its own text, so that if it ever does reach somebody by mistake it is
   * obviously not a demand for money.
   */
  let db;
  try {
    db = serverSupabase();
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }

  if (body.test?.to) {
    const outcome = await send(db, who.caller.userId, {
      to: [body.test.to],
      subject: "Test message from the MES AR system",
      body:
        "This is a test of the mail connector for the MES AR automation " +
        "system.\n\nIt is not a bill, a reminder, or a request for payment. " +
        "Nothing needs to be done about it.\n\nIf you received this and were " +
        "not expecting it, please let DeVinci Codes know.",
      tenantId: "test",
      companyName: "the test address",
    });

    return NextResponse.json({
      ok: outcome.sent,
      ...outcome,
      status: await sendingStatus(db, who.caller.userId),
    });
  }

  const letters = body.letters ?? [];
  if (!Array.isArray(letters) || letters.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Send a test address, or one or more letters." },
      { status: 400 },
    );
  }

  const results: {
    tenantId: string;
    companyName: string;
    sent: boolean;
    blocked?: boolean;
    reason?: string;
  }[] = [];

  /*
   * One at a time, on purpose.
   *
   * Sending forty in parallel would be faster and would also hit Google's rate
   * limit as one burst, which does not fail politely: it locks sending for
   * about a day. On the 21st that would mean the final notice reaching some
   * tenants and not others, with no way to finish and no record of where it
   * stopped. Slower is the right trade here.
   */
  for (const letter of letters) {
    const outcome = await send(db, who.caller.userId, letter);

    results.push({
      tenantId: letter.tenantId,
      companyName: letter.companyName,
      sent: outcome.sent,
      ...(outcome.sent ? {} : { blocked: outcome.blocked, reason: outcome.reason }),
    });

    /*
     * Recorded whether or not it went. was_simulated is false only for a
     * letter that genuinely left, so the day sending was switched on stays
     * findable forever after by looking at this column rather than at a
     * deployment date somebody has to remember.
     */
    if (outcome.sent) {
      const stored = await db.from("emails_sent").insert({
        tenant_id: letter.tenantId,
        template_id: letter.templateId ?? null,
        template_name: letter.templateName ?? "Sent by the connector",
        period: letter.period ?? null,
        subject: letter.subject,
        body: letter.body,
        recipients: letter.to,
        sent_at: new Date().toISOString(),
        sent_by: who.caller.userId,
        was_simulated: false,
        sent_from: outcome.from ?? null,
      });
      if (stored.error) {
        // The letter is gone and cannot be unsent, so this is said loudly
        // rather than swallowed: the record is now wrong in the direction
        // that matters.
        results[results.length - 1]!.reason =
          `Sent, but not recorded: ${stored.error.message}`;
      }
    }
  }

  const sent = results.filter((r) => r.sent).length;
  const blocked = results.filter((r) => !r.sent && r.blocked).length;

  return NextResponse.json({
    ok: true,
    sent,
    blocked,
    failed: results.length - sent - blocked,
    results,
    status: await sendingStatus(db, who.caller.userId),
  });
}
