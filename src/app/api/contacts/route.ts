import { NextResponse } from "next/server";

import { identify, mayUpload } from "@/lib/api-auth";
import { serverSupabase } from "@/lib/supabase-server";
import { contactRows } from "@/lib/to-database";

/**
 * Saves a contact list on its own, without an AR report.
 *
 * Addresses used to reach the database only inside import_ar_report, so a
 * contact list uploaded by itself was read, shown, and stored nowhere - and
 * the Send By Hand screen tells officers to do exactly that with the filled-in
 * exception list.
 *
 * Same rules as an address arriving with a report: one row per address,
 * lower-cased, keyed on (customer_code, email). Added, never removed, so a
 * partial list cannot wipe the addresses it leaves out. No upload row is
 * written: an upload is a report, and the newest upload's verdict is what the
 * 9am run reads, so a contact list must not become "the newest upload".
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Incoming = { customerCode?: unknown; companyName?: unknown; emails?: unknown };

export async function POST(request: Request) {
  const who = await identify(request);
  if (!who.ok) {
    return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  }
  if (!mayUpload(who.caller)) {
    return NextResponse.json(
      { ok: false, error: "Your role cannot upload contact lists." },
      { status: 403 },
    );
  }

  let body: { contacts?: unknown; fileName?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "The request was not JSON." }, { status: 400 });
  }
  if (!Array.isArray(body.contacts)) {
    return NextResponse.json({ ok: false, error: "No contact list was sent." }, { status: 400 });
  }

  /* Only well-formed entries; a malformed one is skipped rather than guessed. */
  const contacts = (body.contacts as Incoming[])
    .filter(
      (c) =>
        typeof c?.customerCode === "string" &&
        c.customerCode.trim() !== "" &&
        Array.isArray(c.emails),
    )
    .map((c) => ({
      customerCode: String(c.customerCode).trim(),
      companyName: typeof c.companyName === "string" ? c.companyName : "",
      emails: (c.emails as unknown[]).filter((e): e is string => typeof e === "string"),
    }));

  const rows = contactRows(contacts);
  if (rows.length === 0) {
    return NextResponse.json(
      { ok: false, error: "The contact list has no email addresses in it." },
      { status: 400 },
    );
  }

  let db;
  try {
    db = serverSupabase();
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }

  /* Chunked: a whole contact list is a few hundred rows, and PostgREST has a
     request size to respect. */
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const w = await db
      .from("contacts")
      .upsert(rows.slice(i, i + CHUNK), { onConflict: "customer_code,email" });
    if (w.error) {
      return NextResponse.json(
        {
          ok: false,
          error:
            i === 0
              ? `The addresses were not saved: ${w.error.message}`
              : `Only the first ${i} addresses were saved: ${w.error.message}`,
        },
        { status: 502 },
      );
    }
  }

  const companies = new Set(rows.map((r) => r.customer_code)).size;
  const fileName = typeof body.fileName === "string" ? body.fileName.slice(0, 200) : null;

  /* Said in the one place nobody can edit afterwards: these addresses decide
     who receives letters about money. */
  await db.from("audit_log").insert({
    actor: who.caller.userId,
    actor_name: who.caller.email ?? who.caller.role,
    action: "contacts.upload",
    subject: fileName ?? "contact list",
    meta: { addresses: rows.length, companies },
  });

  return NextResponse.json({ ok: true, addresses: rows.length, companies });
}
