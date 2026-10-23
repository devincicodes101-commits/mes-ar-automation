import { NextResponse } from "next/server";

import { identify } from "@/lib/api-auth";
import { can } from "@/lib/auth";
import { serverSupabase } from "@/lib/supabase-server";

/**
 * The addresses reports are emailed to.
 *
 * They were kept in each browser's own storage, so an address one officer
 * typed in reached nobody else's screen: the AR team's address existed on one
 * laptop. Kept now in app_settings beside the reminder timing, one row,
 * recipient id to address.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY = "report_recipients";
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

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
  const r = await db.from("app_settings").select("value").eq("key", KEY).maybeSingle();
  if (r.error) {
    return NextResponse.json({ ok: false, error: "Could not read the report recipients." }, { status: 502 });
  }
  const value = (r.data?.value ?? {}) as Record<string, unknown>;
  const emails: Record<string, string> = {};
  for (const [id, v] of Object.entries(value)) if (typeof v === "string" && EMAIL.test(v)) emails[id] = v;
  return NextResponse.json({ ok: true, emails });
}

export async function PUT(request: Request) {
  const who = await identify(request);
  if (!who.ok) {
    return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  }
  if (!can(who.caller.role, "edit-settings")) {
    return NextResponse.json(
      { ok: false, error: "Only an admin can change who reports are emailed to." },
      { status: 403 },
    );
  }
  let body: { emails?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "The request was not JSON." }, { status: 400 });
  }
  if (!body.emails || typeof body.emails !== "object") {
    return NextResponse.json({ ok: false, error: "Send the addresses as { emails: { id: address } }." }, { status: 400 });
  }
  const clean: Record<string, string> = {};
  for (const [id, v] of Object.entries(body.emails as Record<string, unknown>)) {
    if (v === null || v === "") continue;
    if (typeof v !== "string" || !EMAIL.test(v.trim())) {
      return NextResponse.json({ ok: false, error: `"${String(v)}" is not an email address.` }, { status: 400 });
    }
    clean[id.slice(0, 120)] = v.trim();
  }
  if (Object.keys(clean).length > 100) {
    return NextResponse.json({ ok: false, error: "Too many recipients." }, { status: 400 });
  }
  let db;
  try {
    db = serverSupabase();
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
  const w = await db
    .from("app_settings")
    .upsert({ key: KEY, value: clean, updated_by: who.caller.userId, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (w.error) {
    return NextResponse.json({ ok: false, error: "Could not save the report recipients." }, { status: 502 });
  }
  await db.from("audit_log").insert({
    actor: who.caller.userId,
    actor_name: who.caller.email ?? who.caller.role,
    action: "settings.report_recipients",
    subject: `${Object.keys(clean).length} with an address`,
    meta: { emails: clean },
  });
  return NextResponse.json({ ok: true, emails: clean });
}
