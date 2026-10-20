import { NextResponse } from "next/server";

import { identify, mayUpload } from "@/lib/api-auth";
import { serverSupabase } from "@/lib/supabase-server";
import { checkEdit, loadLetterEdits } from "@/lib/letter-edits";
import type { LetterId } from "@/lib/letters";

/**
 * Letters edited by hand, which the 9am run then sends as edited.
 *
 * GET   every saved edit. Everybody signed in is told THAT a letter is edited
 *       (so a screen can warn them); only people who may edit also receive the
 *       words.
 * PUT   save an edit for one tenant, one letter, one bill.
 * DELETE put that letter back to MES's standard wording.
 *
 * Saving or removing is the same permission as uploading and sending, and is
 * written to the audit log: it changes what a tenant is told about money.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STAGES: LetterId[] = ["first-reminder", "final-notice"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

interface Target {
  tenantId: string;
  stage: LetterId;
  billedOn: string;
}

function target(src: { tenantId?: unknown; stage?: unknown; billedOn?: unknown }): Target | string {
  const tenantId = typeof src.tenantId === "string" ? src.tenantId.trim() : "";
  const stage = src.stage as LetterId;
  const billedOn = typeof src.billedOn === "string" ? src.billedOn : "";
  if (!tenantId) return "Name the tenant.";
  if (!STAGES.includes(stage)) return "Say which letter: first-reminder or final-notice.";
  if (!ISO.test(billedOn)) return "Say which bill, by its billing date (YYYY-MM-DD).";
  return { tenantId, stage, billedOn };
}

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

  const { edits, problem } = await loadLetterEdits(db);
  const mayRead = mayUpload(who.caller);

  return NextResponse.json({
    ok: true,
    problem,
    edits: Array.from(edits.values()).map((e) => ({
      tenantId: e.tenantId,
      stage: e.stage,
      billedOn: e.billedOn,
      editedAt: e.editedAt,
      ...(mayRead ? { subject: e.subject, body: e.body } : {}),
    })),
  });
}

export async function PUT(request: Request) {
  const who = await identify(request);
  if (!who.ok) {
    return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  }
  if (!mayUpload(who.caller)) {
    return NextResponse.json(
      { ok: false, error: "Your role cannot change what letters say." },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Unreadable request." }, { status: 400 });
  }

  const t = target(body);
  if (typeof t === "string") return NextResponse.json({ ok: false, error: t }, { status: 400 });

  const subject = typeof body.subject === "string" ? body.subject : "";
  const text = typeof body.body === "string" ? body.body : "";
  const refused = checkEdit(subject, text);
  if (refused) return NextResponse.json({ ok: false, error: refused }, { status: 400 });

  let db;
  try {
    db = serverSupabase();
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }

  const { error } = await db.from("letter_edits").upsert(
    {
      tenant_id: t.tenantId,
      stage: t.stage,
      billed_on: t.billedOn,
      subject,
      body: text,
      edited_by: who.caller.userId,
      edited_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,stage,billed_on" },
  );
  if (error) {
    const missing = /does not exist|schema cache/i.test(error.message);
    return NextResponse.json(
      {
        ok: false,
        error: missing
          ? "This database does not have 0026_letter_edits.sql applied yet."
          : error.message,
      },
      { status: missing ? 409 : 502 },
    );
  }

  await db.from("audit_log").insert({
    actor: who.caller.userId,
    actor_name: who.caller.email ?? who.caller.role,
    action: "letter.edit",
    subject: `${t.stage} for ${t.tenantId}`,
    meta: { billedOn: t.billedOn, tenantId: t.tenantId, stage: t.stage },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const who = await identify(request);
  if (!who.ok) {
    return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  }
  if (!mayUpload(who.caller)) {
    return NextResponse.json(
      { ok: false, error: "Your role cannot change what letters say." },
      { status: 403 },
    );
  }

  const q = new URL(request.url).searchParams;
  const t = target({
    tenantId: q.get("tenantId"),
    stage: q.get("stage"),
    billedOn: q.get("billedOn"),
  });
  if (typeof t === "string") return NextResponse.json({ ok: false, error: t }, { status: 400 });

  let db;
  try {
    db = serverSupabase();
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }

  const { error } = await db
    .from("letter_edits")
    .delete()
    .eq("tenant_id", t.tenantId)
    .eq("stage", t.stage)
    .eq("billed_on", t.billedOn);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 502 });

  await db.from("audit_log").insert({
    actor: who.caller.userId,
    actor_name: who.caller.email ?? who.caller.role,
    action: "letter.edit.reset",
    subject: `${t.stage} for ${t.tenantId}`,
    meta: { billedOn: t.billedOn, tenantId: t.tenantId, stage: t.stage },
  });

  return NextResponse.json({ ok: true });
}
