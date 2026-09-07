/**
 * Does the security model actually hold in the database?
 *
 *   npm run verify:db
 *
 * Signs in as each of the five accounts against the live project and checks
 * what the database returns for each. This is the only test in the repository
 * that proves anything about security: every other suite checks what the
 * browser believes, and the browser is not what protects the data.
 *
 * Reads .env.local. Never uses the service_role key, which would bypass the
 * very thing being tested.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const ENV = path.join(ROOT, ".env.local");

if (!existsSync(ENV)) {
  console.error("No .env.local. Add NEXT_PUBLIC_SUPABASE_URL and _ANON_KEY.");
  process.exit(1);
}
const env = Object.fromEntries(
  readFileSync(ENV, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL_ || !ANON) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and _ANON_KEY must both be set.");
  process.exit(1);
}

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${name.slice(0, 66).padEnd(66)} ` +
      (ok ? "" : `got ${String(actual)}, expected ${String(expected)}`),
  );
}
const section = (t: string) => console.log(`\n${t}\n`);

interface Who { email: string; pw: string; role: string; name: string }
const PEOPLE: Who[] = [
  { email: "superadmin@mesgroup.com", pw: "superadmin@2026", role: "super_admin", name: "Raman Palaniappan" },
  { email: "admin@mesgroup.com", pw: "admin@2026", role: "admin", name: "Darren Phua" },
  { email: "csd@mesgroup.com", pw: "csd@2026", role: "csd", name: "Jacqueline Fong" },
  { email: "rm@mesgroup.com", pw: "rm@2026", role: "rm", name: "Ray Ang" },
  { email: "management@mesgroup.com", pw: "management@2026", role: "management", name: "Management" },
];

async function signIn(w: Who) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: w.email, password: w.pw }),
  });
  const d = await r.json();
  return d.access_token
    ? { ok: true as const, token: d.access_token as string, id: d.user?.id as string }
    : { ok: false as const, why: d.error_code ?? d.msg ?? "unknown" };
}

/** A PostgREST call as a signed in person. Returns status and rows. */
async function as(token: string, pathAndQuery: string, init: RequestInit = {}) {
  const r = await fetch(`${URL_}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  let body: unknown = null;
  try { body = await r.json(); } catch { /* 204 has no body */ }
  return { status: r.status, body };
}

/* ============================================================ signing in */

section("Signing in against the live project");

const tokens = new Map<string, string>();
const ids = new Map<string, string>();
for (const w of PEOPLE) {
  const r = await signIn(w);
  check(`${w.email} signs in`, r.ok, true);
  if (r.ok) {
    tokens.set(w.email, r.token);
    ids.set(w.email, r.id);
  } else {
    console.log(`        reason: ${r.why}`);
  }
}
if (tokens.size === 0) {
  console.log("\nNobody could sign in, so nothing below can be checked.\n");
  process.exit(1);
}

const bad = await signIn({ ...PEOPLE[0], pw: "definitely-not-the-password" });
check("a wrong password is refused", bad.ok, false);

/* ============================================================== profiles */

section("Each account carries the role it was seeded with");

for (const w of PEOPLE) {
  const t = tokens.get(w.email);
  if (!t) continue;
  const { body } = await as(t, `profiles?id=eq.${ids.get(w.email)}&select=full_name,role,rm_key`);
  const row = Array.isArray(body) ? body[0] : null;
  check(`${w.email} is ${w.role}`, row?.role, w.role);
  if (w.role === "rm") check("  and carries their own rm_key", row?.rm_key, "2611 Ray Ang");
}

/* ======================================================= reading rows */

section("What each role can read");

async function countOf(token: string, table: string) {
  const r = await fetch(`${URL_}/rest/v1/${table}?select=*`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, Prefer: "count=exact", Range: "0-0" },
  });
  const range = r.headers.get("content-range") ?? "";
  const total = Number(range.split("/")[1]);
  return { status: r.status, total: Number.isFinite(total) ? total : -1 };
}

for (const w of PEOPLE) {
  const t = tokens.get(w.email);
  if (!t) continue;
  const props = await countOf(t, "properties");
  check(`${w.role} can read the reference tables`, props.status < 300, true);
}

const rmTok = tokens.get("rm@mesgroup.com");
const csdTok = tokens.get("csd@mesgroup.com");
if (rmTok && csdTok) {
  const rmProfiles = await as(rmTok, "profiles?select=id");
  const csdProfiles = await as(csdTok, "profiles?select=id");
  const rmRows = Array.isArray(rmProfiles.body) ? rmProfiles.body.length : 0;
  const csdRows = Array.isArray(csdProfiles.body) ? csdProfiles.body.length : 0;
  check("an RM sees only their own profile row", rmRows, 1);
  check("CSD can read every profile", csdRows >= 5, true);
}

/* ======================================================= writing rows */

section("What each role can write");

const mgmtTok = tokens.get("management@mesgroup.com");
const adminTok = tokens.get("admin@mesgroup.com");
const superTok = tokens.get("superadmin@mesgroup.com");

if (mgmtTok) {
  const r = await as(mgmtTok, "properties", {
    method: "POST",
    body: JSON.stringify({ code: "ZZZ", name: "Should never exist" }),
  });
  check("Management cannot insert", r.status >= 400, true);
}
if (rmTok) {
  const r = await as(rmTok, "properties", {
    method: "POST",
    body: JSON.stringify({ code: "YYY", name: "Should never exist" }),
  });
  check("an RM cannot insert", r.status >= 400, true);
}

/* ------------------------------------------ the one that caught a bug */

section("Only Super Admin may touch profiles");

const someoneElse = ids.get("csd@mesgroup.com");
if (csdTok && someoneElse) {
  const r = await as(csdTok, `profiles?id=eq.${ids.get("rm@mesgroup.com")}`, {
    method: "PATCH",
    body: JSON.stringify({ role: "super_admin" }),
  });
  const changed = Array.isArray(r.body) && r.body.length > 0;
  check("CSD cannot promote anyone", changed, false);
}
if (adminTok) {
  const r = await as(adminTok, `profiles?id=eq.${ids.get("rm@mesgroup.com")}`, {
    method: "PATCH",
    body: JSON.stringify({ role: "super_admin" }),
  });
  const changed = Array.isArray(r.body) && r.body.length > 0;
  check("Admin cannot promote anyone either", changed, false);
}
if (superTok) {
  const own = ids.get("superadmin@mesgroup.com");
  const r = await as(superTok, `profiles?id=eq.${own}`, {
    method: "PATCH",
    body: JSON.stringify({ role: "csd" }),
  });
  const changed = Array.isArray(r.body) && r.body.length > 0;
  check("Super Admin cannot demote themselves", changed, false);
}

/* ------------------------------------------------ the audit log is history */

section("Nobody rewrites history");

for (const [label, tok] of [["CSD", csdTok], ["Admin", adminTok], ["Super Admin", superTok]] as const) {
  if (!tok) continue;
  const r = await as(tok, "audit_log?id=not.is.null", { method: "DELETE" });
  const deleted = Array.isArray(r.body) && r.body.length > 0;
  check(`${label} cannot delete the audit log`, deleted, false);
}

console.log(failures === 0 ? "\nALL CHECKS PASS\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
