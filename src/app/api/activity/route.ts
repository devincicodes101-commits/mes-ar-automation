import { NextResponse } from "next/server";

import { identify } from "@/lib/api-auth";
import { serverSupabase } from "@/lib/supabase-server";
import {
  callToRow,
  promiseToRow,
  emailToRow,
  callsFromRows,
  promisesFromRows,
  emailsFromRows,
  type CallRow,
  type PromiseRow,
  type EmailRow,
} from "@/lib/activity-db";
import { CAN_SEND_FOR_REAL } from "@/lib/outbox";
import type { CallLog, PromiseRecord, SentEmail } from "@/lib/store";

/**
 * The activity log: calls made, promises taken, letters sent.
 *
 * This is the part of the system that cannot be rebuilt. Re-uploading a report
 * restores every balance in it; nothing restores a phone call. Until now it
 * lived in one browser's local storage, which meant it was one cleared cache
 * from gone and invisible to the officer sitting next to them.
 *
 * GET returns the whole log. POST appends one record.
 *
 * Append only, deliberately. There is no PATCH and no DELETE here, matching
 * audit_log in 0002_security.sql: a call logged wrongly is corrected by
 * logging what actually happened next, not by editing the history so that it
 * reads as though the first call never occurred.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WITH_NAME = "tenants(company_name)";

export async function GET(request: Request) {
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

  const [calls, promises, emails] = await Promise.all([
    db
      .from("calls")
      .select(
        "id,tenant_id,period,called_at,reached,outcome,promised_amount," +
          `promised_date,next_action_date,aging_bucket,deduction_fail_date,notes,${WITH_NAME}`,
      )
      .order("called_at", { ascending: false }),
    db
      .from("promises")
      .select(
        `id,tenant_id,amount,promised_for,source,created_at,confirmation_sent_at,${WITH_NAME}`,
      )
      .order("created_at", { ascending: false }),
    db
      .from("emails_sent")
      .select(
        `id,tenant_id,template_id,template_name,subject,body,recipients,sent_at,was_simulated,${WITH_NAME}`,
      )
      .order("sent_at", { ascending: false }),
  ]);

  const failed = [calls, promises, emails].find((r) => r.error);
  if (failed?.error) {
    return NextResponse.json(
      {
        ok: false,
        error: "Could not read the activity log.",
        detail: failed.error.message,
        hint: /column|relation|does not exist/i.test(failed.error.message)
          ? "This database may not have 0012_activity_columns.sql applied yet."
          : null,
      },
      { status: 502 },
    );
  }

  const read = callsFromRows((calls.data ?? []) as unknown as CallRow[]);

  return NextResponse.json({
    ok: true,
    calls: read.calls,
    promises: promisesFromRows((promises.data ?? []) as unknown as PromiseRow[]),
    emails: emailsFromRows((emails.data ?? []) as unknown as EmailRow[]),
    /*
     * Said out loud rather than left as a shorter list. A call whose outcome
     * this build cannot read is a real call, and a screen that silently showed
     * one fewer would be wrong in the direction nobody checks.
     */
    unreadableCalls: read.unreadable,
  });
}

interface Body {
  kind?: "call" | "promise" | "email";
  record?: unknown;
}

export async function POST(request: Request) {
  const who = await identify(request);
  if (!who.ok) {
    return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
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

  if (!body.kind || !body.record) {
    return NextResponse.json(
      { ok: false, error: "Send a kind of call, promise or email, and a record." },
      { status: 400 },
    );
  }

  let db;
  try {
    db = serverSupabase();
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }

  let table: string;
  let row: Record<string, unknown>;

  try {
    if (body.kind === "call") {
      table = "calls";
      row = { ...callToRow(body.record as CallLog), created_by: who.caller.userId };
    } else if (body.kind === "promise") {
      table = "promises";
      row = { ...promiseToRow(body.record as PromiseRecord), created_by: who.caller.userId };
    } else if (body.kind === "email") {
      table = "emails_sent";
      /*
       * Whether this was a real send is decided here, from the build's own
       * flag, and never from what the caller claims. A browser that said a dry
       * run was genuine would make the two indistinguishable afterwards, which
       * is the whole reason the column exists.
       */
      row = {
        ...emailToRow(body.record as SentEmail, !CAN_SEND_FOR_REAL),
        sent_by: who.caller.userId,
      };
    } else {
      return NextResponse.json(
        { ok: false, error: `Unknown kind: ${String(body.kind)}` },
        { status: 400 },
      );
    }
  } catch (e) {
    // A record the mapper refuses, such as an outcome it does not know.
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 422 },
    );
  }

  /*
   * Upsert on the id the browser generated, so a retry after a dropped
   * connection does not log the same call twice. The officer cannot tell
   * whether the first attempt landed, and asking them to check is asking them
   * to do the thing the system is for.
   */
  const { error } = await db.from(table).upsert(row, { onConflict: "id" });

  if (error) {
    const missingTenant = /foreign key|violates/i.test(error.message);
    return NextResponse.json(
      {
        ok: false,
        error: "The database refused this record, so it was not stored.",
        detail: error.message,
        hint: missingTenant
          ? "This tenant is not in the database yet. Upload the AR report " +
            "first, then log the call again."
          : null,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, kind: body.kind });
}
