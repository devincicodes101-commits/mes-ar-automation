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

  const listed = await listFor(db);
  const status = await sendingStatus(db, who.caller.userId);

  return NextResponse.json({
    ok: true,
    accounts: listed.ok ? listed.accounts : [],
    accountsProblem: listed.ok ? null : listed.error,
    status,
    role: who.caller.role,
  });
}

/** Only an administrator changes the mailbox list: it decides who every letter comes from. */
function isAdmin(role: string) {
  return role === "admin" || role === "super-admin";
}

async function record(
  db: ReturnType<typeof serverSupabase>,
  who: { userId: string; email: string | null; role: string },
  action: string,
  subject: string,
) {
  await db.from("audit_log").insert({
    actor: who.userId,
    actor_name: who.email ?? who.role,
    action,
    subject,
    meta: {},
  });
}

/** Takes a mailbox off the list: ?id=<mailbox>. */
export async function DELETE(request: Request) {
  const who = await identify(request);
  if (!who.ok) {
    return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  }
  if (!isAdmin(who.caller.role)) {
    return NextResponse.json(
      { ok: false, error: "Only an administrator can remove a mailbox." },
      { status: 403 },
    );
  }
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "Name a mailbox." }, { status: 400 });

  let db;
  try {
    db = serverSupabase();
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }

  const gone = await disconnect(db, id);
  if (!gone.ok) return NextResponse.json({ ok: false, error: gone.error }, { status: gone.status });
  // Microsoft has no equivalent call; removing our row is what stops sending.
  if (gone.token && gone.provider === "google") await revoke(gone.token);
  await record(db, who.caller, "mail.remove", gone.email);

  return NextResponse.json({ ok: true });
}

/** Makes a mailbox the active one: { id }. */
export async function POST(request: Request) {
  const who = await identify(request);
  if (!who.ok) {
    return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  }
  if (!isAdmin(who.caller.role)) {
    return NextResponse.json(
      { ok: false, error: "Only an administrator can choose the active mailbox. Every letter comes from it." },
      { status: 403 },
    );
  }

  let body: { id?: string };
  try {
    body = (await request.json()) as { id?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Unreadable request." }, { status: 400 });
  }
  if (!body.id) {
    return NextResponse.json({ ok: false, error: "Name a mailbox." }, { status: 400 });
  }

  let db;
  try {
    db = serverSupabase();
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }

  const done = await makeDefault(db, body.id);
  if (!done.ok) return NextResponse.json({ ok: false, error: done.error }, { status: 502 });
  await record(db, who.caller, "mail.active", done.email);
  return NextResponse.json({ ok: true });
}
