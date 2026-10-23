import { NextResponse } from "next/server";

import { identify } from "@/lib/api-auth";
import { can } from "@/lib/auth";
import { serverSupabase } from "@/lib/supabase-server";
import { readRules, writeRules } from "@/lib/rules-server";

/**
 * The fee, ad hoc and report-age rules. Anyone signed in may read them, since
 * the screens show what they decide; only an admin may change them.
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
  return NextResponse.json({ ok: true, ...(await readRules(db)) });
}

export async function PUT(request: Request) {
  const who = await identify(request);
  if (!who.ok) {
    return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  }
  if (!can(who.caller.role, "edit-settings")) {
    return NextResponse.json({ ok: false, error: "Only an admin can change these rules." }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "The request was not JSON." }, { status: 400 });
  }
  let db;
  try {
    db = serverSupabase();
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
  const wrote = await writeRules(db, body, {
    userId: who.caller.userId,
    name: who.caller.email ?? who.caller.role,
  });
  if (!wrote.ok) {
    return NextResponse.json({ ok: false, error: "Could not save the rules." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, rules: wrote.rules });
}
