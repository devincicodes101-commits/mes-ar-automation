import { NextResponse } from "next/server";

import { identify } from "@/lib/api-auth";
import { can, type Role } from "@/lib/auth";
import { ROLE_FROM_DB, ROLE_TO_DB } from "@/lib/roles";
import { serverSupabase } from "@/lib/supabase-server";

/**
 * Who can sign in, and as what.
 *
 * The Users screen listed a made-up team kept in the code, and its add,
 * remove and role controls changed nothing outside the browser. This reads
 * and changes the real logins.
 *
 * Three rules, checked here rather than trusted to the screen:
 *   - only a super admin creates, changes or switches off a super admin;
 *   - nobody changes their own role or switches themselves off, so the last
 *     person able to manage logins cannot lock everyone out;
 *   - a login is switched off, never deleted, because calls, letters and fees
 *     carry who did them and that record must stay readable.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const ROLES: Role[] = ["super-admin", "admin", "CSD", "RM", "Management"];
/* About a hundred years: Supabase's way of saying "switched off". */
const OFF = "876000h";

async function gate(request: Request) {
  const who = await identify(request);
  if (!who.ok) {
    return { error: NextResponse.json({ ok: false, error: who.error }, { status: who.status }) } as const;
  }
  if (!can(who.caller.role, "manage-users")) {
    return {
      error: NextResponse.json(
        { ok: false, error: "Only an admin or super admin can manage logins." },
        { status: 403 },
      ),
    } as const;
  }
  let db;
  try {
    db = serverSupabase();
  } catch (e) {
    return { error: NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 }) } as const;
  }
  return { who: who.caller, db } as const;
}

const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function GET(request: Request) {
  const g = await gate(request);
  if ("error" in g) return g.error;
  const { db, who } = g;

  const profiles = await db.from("profiles").select("id,full_name,role,rm_key,created_at");
  if (profiles.error) {
    return NextResponse.json(
      { ok: false, error: "Could not read the logins.", detail: profiles.error.message },
      { status: 502 },
    );
  }

  /* Addresses, sign-ins and whether the login is on live on the auth record. */
  const accounts = new Map<string, { email: string | null; lastSignIn: string | null; off: boolean }>();
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) break;
    for (const u of data.users) {
      const banned = (u as { banned_until?: string | null }).banned_until;
      accounts.set(u.id, {
        email: u.email ?? null,
        lastSignIn: u.last_sign_in_at ?? null,
        off: Boolean(banned && new Date(banned).getTime() > Date.now()),
      });
    }
    if (data.users.length < 200) break;
  }

  const users = (profiles.data ?? [])
    .map((p) => ({
      id: p.id as string,
      name: (p.full_name as string | null) ?? "",
      role: ROLE_FROM_DB[p.role as string] ?? null,
      manager: (p.rm_key as string | null) ?? null,
      email: accounts.get(p.id as string)?.email ?? null,
      lastSignIn: accounts.get(p.id as string)?.lastSignIn ?? null,
      off: accounts.get(p.id as string)?.off ?? false,
      you: p.id === who.userId,
    }))
    .sort((a, b) => Number(a.off) - Number(b.off) || a.name.localeCompare(b.name));

  return NextResponse.json({ ok: true, users, mayGrantSuperAdmin: who.role === "super-admin" });
}

/** Add a login: name, email, role, a manager's book for an RM, and a first password. */
export async function POST(request: Request) {
  const g = await gate(request);
  if ("error" in g) return g.error;
  const { db, who } = g;

  let body: { name?: unknown; email?: unknown; role?: unknown; manager?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("The request was not JSON.");
  }
  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const role = body.role as Role;
  const manager = String(body.manager ?? "").trim() || null;
  const password = String(body.password ?? "");

  if (!name) return bad("Give the person's name.");
  if (!EMAIL.test(email)) return bad("That is not an email address.");
  if (!ROLES.includes(role)) return bad("Choose a role.");
  if (role === "super-admin" && who.role !== "super-admin") return bad("Only a super admin can create a super admin.", 403);
  if (role === "RM" && !manager) return bad("A relationship manager needs the manager name the report uses.");
  if (password.length < 10) return bad("The first password must be at least 10 characters.");

  const made = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (made.error || !made.data.user) {
    const taken = /already|registered|exists/i.test(made.error?.message ?? "");
    return bad(taken ? "Somebody already has a login with that address." : made.error?.message ?? "Could not create the login.", taken ? 409 : 502);
  }

  /* The sign-up trigger made a CSD profile; this sets what was asked for. */
  const set = await db
    .from("profiles")
    .upsert({ id: made.data.user.id, full_name: name, role: ROLE_TO_DB[role], rm_key: role === "RM" ? manager : null });
  if (set.error) {
    await db.auth.admin.deleteUser(made.data.user.id);
    return bad(`The login was not created: ${set.error.message}`, 502);
  }
  await db.from("audit_log").insert({
    actor: who.userId,
    actor_name: who.email ?? who.role,
    action: "user.create",
    subject: `${name} (${email}) as ${role}${role === "RM" ? ` for ${manager}` : ""}`,
    meta: { id: made.data.user.id, role, manager },
  });
  return NextResponse.json({ ok: true, id: made.data.user.id });
}

/** Change a login's name, role or manager, or switch it off and on. */
export async function PATCH(request: Request) {
  const g = await gate(request);
  if ("error" in g) return g.error;
  const { db, who } = g;

  let body: { id?: unknown; name?: unknown; role?: unknown; manager?: unknown; off?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("The request was not JSON.");
  }
  const id = String(body.id ?? "");
  const current = await db.from("profiles").select("id,full_name,role,rm_key").eq("id", id).maybeSingle();
  if (current.error || !current.data) return bad("There is no such login.", 404);
  const theirRole = ROLE_FROM_DB[current.data.role as string];

  if (theirRole === "super-admin" && who.role !== "super-admin") {
    return bad("Only a super admin can change a super admin.", 403);
  }

  if (typeof body.off === "boolean") {
    if (id === who.userId) return bad("You cannot switch off your own login.", 403);
    const r = await db.auth.admin.updateUserById(id, { ban_duration: body.off ? OFF : "none" });
    if (r.error) return bad(r.error.message, 502);
    await db.from("audit_log").insert({
      actor: who.userId,
      actor_name: who.email ?? who.role,
      action: body.off ? "user.off" : "user.on",
      subject: current.data.full_name as string,
      meta: { id },
    });
    return NextResponse.json({ ok: true });
  }

  const role = (body.role as Role | undefined) ?? theirRole;
  if (!ROLES.includes(role)) return bad("Choose a role.");
  if (id === who.userId && role !== theirRole) return bad("You cannot change your own role.", 403);
  if (role === "super-admin" && who.role !== "super-admin") return bad("Only a super admin can make a super admin.", 403);
  const manager =
    body.manager === undefined ? (current.data.rm_key as string | null) : String(body.manager ?? "").trim() || null;
  if (role === "RM" && !manager) return bad("A relationship manager needs the manager name the report uses.");
  const name = body.name === undefined ? (current.data.full_name as string) : String(body.name).trim();
  if (!name) return bad("Give the person's name.");

  const r = await db
    .from("profiles")
    .update({ full_name: name, role: ROLE_TO_DB[role], rm_key: role === "RM" ? manager : null })
    .eq("id", id);
  if (r.error) return bad(r.error.message, 502);
  await db.from("audit_log").insert({
    actor: who.userId,
    actor_name: who.email ?? who.role,
    action: "user.change",
    subject: `${name} as ${role}${role === "RM" ? ` for ${manager}` : ""}`,
    meta: { id, role, manager },
  });
  return NextResponse.json({ ok: true });
}
