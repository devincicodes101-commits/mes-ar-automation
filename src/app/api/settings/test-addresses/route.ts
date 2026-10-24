import { NextResponse } from "next/server";

import { identify } from "@/lib/api-auth";
import { can } from "@/lib/auth";
import { serverSupabase } from "@/lib/supabase-server";
import { modeFromEnv } from "@/lib/mail";
import { readTestAddresses, writeTestAddresses } from "@/lib/mail/test-addresses";

/**
 * The test list on Settings, Mailbox. Read and changed by an administrator
 * only: it decides who can receive mail while testing.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function admin(request: Request) {
  const who = await identify(request);
  if (!who.ok) return { error: NextResponse.json({ ok: false, error: who.error }, { status: who.status }) };
  if (!can(who.caller.role, "edit-settings")) {
    return { error: NextResponse.json({ ok: false, error: "Only an admin can see or change the test list." }, { status: 403 }) };
  }
  try {
    return { who, db: serverSupabase() };
  } catch (e) {
    return { error: NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 }) };
  }
}

export async function GET(request: Request) {
  const g = await admin(request);
  if ("error" in g) return g.error;
  const r = await readTestAddresses(g.db);
  return NextResponse.json({ ok: true, ...r, mode: modeFromEnv() });
}

export async function PUT(request: Request) {
  const g = await admin(request);
  if ("error" in g) return g.error;
  let body: { addresses?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "The request was not JSON." }, { status: 400 });
  }
  const w = await writeTestAddresses(g.db, body.addresses, {
    userId: g.who.caller.userId,
    name: g.who.caller.email ?? g.who.caller.role,
  });
  if (!w.ok) return NextResponse.json({ ok: false, error: w.error }, { status: w.status });
  return NextResponse.json({ ok: true, addresses: w.addresses });
}
