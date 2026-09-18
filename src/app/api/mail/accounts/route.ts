import { NextResponse } from "next/server";

import { identify } from "@/lib/api-auth";
import { serverSupabase } from "@/lib/supabase-server";
import { disconnect, listFor, makeDefault } from "@/lib/mail/accounts";
import { revoke } from "@/lib/mail/google-oauth";
import { sendingStatus } from "@/lib/mail";

/**
 * The connected accounts, and what sending will actually do.
 *
 * GET is what the Settings screen reads. It never returns a token: what a
 * screen needs is which mailbox, connected by whom, working or not.
 *
 * DELETE disconnects, and tells Google to forget the grant as well. Removing
 * our row alone would leave the app still listed in the person's Google
 * account, which reads as though it can still send.
 *
 * POST nominates which account the schedule sends from. Only an administrator,
 * because it decides whose name is on every letter the 7th and 21st produce.
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

  const listed = await listFor(db, who.caller.userId);
  const status = await sendingStatus(db, who.caller.userId);

  return NextResponse.json({
    ok: true,
    accounts: listed.ok ? listed.accounts : [],
    accountsProblem: listed.ok ? null : listed.error,
    status,
    role: who.caller.role,
  });
}

export async function DELETE(request: Request) {
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

  /*
   * A person may disconnect their own account. An administrator may disconnect
   * anybody's, because somebody who has left cannot do it themselves and their
   * connection would otherwise keep sending on the 7th.
   */
  const target = new URL(request.url).searchParams.get("user") ?? who.caller.userId;
  const admin = who.caller.role === "admin" || who.caller.role === "super-admin";
  if (target !== who.caller.userId && !admin) {
    return NextResponse.json(
      { ok: false, error: "Only an administrator can disconnect somebody else's mailbox." },
      { status: 403 },
    );
  }

  const gone = await disconnect(db, target);
  if (!gone.ok) return NextResponse.json({ ok: false, error: gone.error }, { status: 502 });
  if (gone.token) await revoke(gone.token);

  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  const who = await identify(request);
  if (!who.ok) {
    return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  }
  if (who.caller.role !== "admin" && who.caller.role !== "super-admin") {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Only an administrator can choose which mailbox the schedule sends " +
          "from. It decides whose name is on every automatic letter.",
      },
      { status: 403 },
    );
  }

  let body: { user?: string };
  try {
    body = (await request.json()) as { user?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Unreadable request." }, { status: 400 });
  }
  if (!body.user) {
    return NextResponse.json({ ok: false, error: "Name an account." }, { status: 400 });
  }

  let db;
  try {
    db = serverSupabase();
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }

  const done = await makeDefault(db, body.user);
  if (!done.ok) return NextResponse.json({ ok: false, error: done.error }, { status: 502 });
  return NextResponse.json({ ok: true });
}
