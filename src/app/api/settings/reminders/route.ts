import { NextResponse } from "next/server";

import { identify } from "@/lib/api-auth";
import { can } from "@/lib/auth";
import { serverSupabase } from "@/lib/supabase-server";
import { readReminderWindow, writeReminderWindow } from "@/lib/reminder-window";

/**
 * When reminders go out, counted from each tenant's billing date.
 *
 * GET for anyone signed in, because the Schedule screen shows every tenant's
 * reminder dates and those are worked out from this. PUT only for whoever may
 * edit settings, the same people who may change the wording of the letters:
 * moving the date every tenant is chased on is the same weight of decision.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const stored = await readReminderWindow(db);
  return NextResponse.json({ ok: true, ...stored });
}

export async function PUT(request: Request) {
  const who = await identify(request);
  if (!who.ok) {
    return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  }
  if (!can(who.caller.role, "edit-settings")) {
    return NextResponse.json(
      { ok: false, error: "Only an admin can change when reminders go out." },
      { status: 403 },
    );
  }

  let body: { first?: unknown; final?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "The request was not JSON." }, { status: 400 });
  }

  const first = Number(body.first);
  const final = Number(body.final);
  if (!Number.isFinite(first) || !Number.isFinite(final) || first < 0 || final < 0) {
    return NextResponse.json(
      { ok: false, error: "Both numbers must be whole days, zero or more." },
      { status: 400 },
    );
  }
  /*
   * Refused rather than quietly corrected. sane() would hold the final at the
   * first, which keeps the run safe, but somebody who typed it the wrong way
   * round should be told rather than left to find the dates do not move.
   */
  if (final < first) {
    return NextResponse.json(
      {
        ok: false,
        error: "The final notice cannot come before the first reminder.",
      },
      { status: 400 },
    );
  }

  let db;
  try {
    db = serverSupabase();
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }

  const wrote = await writeReminderWindow(
    db,
    { first, final },
    { userId: who.caller.userId, name: who.caller.email ?? who.caller.role },
  );
  if (!wrote.ok) {
    return NextResponse.json({ ok: false, error: wrote.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true, window: wrote.window });
}
