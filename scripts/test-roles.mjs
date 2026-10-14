/**
 * Every role, against every protected action, over HTTP.
 *
 *   npm run dev                (in another terminal)
 *   APP_URL=http://localhost:3000 node scripts/test-roles.mjs
 *
 * The permission table in src/lib/auth.ts is what the Access Control screen
 * shows and what MES are told. This checks that the running server actually
 * behaves that way for each of the five roles - not the screens, which hide
 * buttons, but the routes behind them, which are what a hidden button can be
 * gone around to reach.
 *
 * Creates one throwaway user per role, fenced behind zz-roles- addresses, and
 * deletes them at the end. Nothing is written: every request a role is allowed
 * to make is sent deliberately incomplete, so an allowed role is told "bad
 * request" (400/422) and a refused one "forbidden" (403). Telling those two
 * apart is the whole test. The two admin-only actions that would do real work
 * if they got past the role check - running a day of the schedule, changing
 * the Google client - are only sent by the roles that must be refused.
 *
 * Added 14 October, when checking the table against the system found that
 * /api/dataset and /api/activity handed every tenant's email address to the
 * relationship manager and Management roles, who the table says may not read
 * them.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const SUPA = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const APP = process.env.APP_URL ?? "http://localhost:3000";
const admin = createClient(SUPA, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let failures = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(62)} got ${String(actual).padEnd(6)} expected ${expected}`);
};

/* A manager who really has tenants, so the RM's narrowing is tested against
   a book that is not empty. */
const { data: owned } = await admin.from("tenants").select("rm_key").not("rm_key", "is", null);
const counts = new Map();
for (const r of owned ?? []) counts.set(r.rm_key, (counts.get(r.rm_key) ?? 0) + 1);
const RM_KEY = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

const PW = "Roles-" + Math.random().toString(36).slice(2, 10) + "!A9";
const ROLES = [
  { db: "super_admin", label: "Super Admin", rm: null },
  { db: "admin", label: "Admin", rm: null },
  { db: "csd", label: "CSD Officer", rm: null },
  { db: "rm", label: "Relationship Manager", rm: RM_KEY },
  { db: "management", label: "Management", rm: null },
];

const created = [];
async function cleanup() {
  for (const u of created) await admin.auth.admin.deleteUser(u.id);
}

async function signIn(email) {
  const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(`sign in as ${email}: ${JSON.stringify(b).slice(0, 160)}`);
  return b.access_token;
}

const call = (path, token, method = "GET", body) =>
  fetch(`${APP}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const HIDDEN = "address hidden";

try {
  for (const r of ROLES) {
    const email = `zz-roles-${r.db}@example.test`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true });
    if (error) throw new Error(`create ${email}: ${error.message}`);
    created.push({ id: data.user.id });
    const { error: pe } = await admin
      .from("profiles")
      .update({ full_name: `Roles test ${r.label}`, role: r.db, rm_key: r.rm })
      .eq("id", data.user.id);
    if (pe) throw new Error(`profile for ${email}: ${pe.message}`);
    r.token = await signIn(email);
  }

  /* What a role that may read everything is handed, to compare against. */
  const full = await (await call("/api/dataset", ROLES[0].token)).json();
  const allAccounts = full.dataset?.accounts ?? [];
  const rmBook = allAccounts.filter((a) => a.rm === RM_KEY).length;
  console.log(`\n${allAccounts.length} accounts in the stored report; manager "${RM_KEY}" owns ${rmBook}\n`);

  for (const r of ROLES) {
    const role = r.db;
    const sends = ["super_admin", "admin", "csd"].includes(role); // send, upload, raise fees, addresses
    const admins = ["super_admin", "admin"].includes(role); // settings, schedule, Google client
    console.log(r.label);

    /* ---------------------------------------------------- reading ----- */
    const ds = await call("/api/dataset", r.token);
    check("reads the report", ds.status, 200);
    const accounts = (await ds.json()).dataset?.accounts ?? [];
    check(
      role === "rm" ? "sees only their own customers" : "sees every customer",
      accounts.length,
      role === "rm" ? rmBook : allAccounts.length,
    );
    const addresses = accounts.flatMap((a) => a.emails ?? []);
    const real = addresses.filter((e) => e !== HIDDEN && e.includes("@")).length;
    check("is handed real email addresses", real > 0, sends && addresses.length > 0);

    const act = await call("/api/activity", r.token);
    check("reads the activity log", act.status, 200);
    const letters = (await act.json()).emails ?? [];
    const realTo = letters.flatMap((l) => l.to ?? []).filter((e) => e !== HIDDEN && e.includes("@")).length;
    check("is handed the recipients of letters sent", realTo > 0, sends && letters.length > 0);

    /* ------------------------------------------- the monthly cycle ----- */
    const deny = (status) => status === 403;
    check("may upload a report", !deny((await call("/api/upload", r.token, "POST", { accounts: [], invoices: [], reportDate: null })).status), sends);
    check("may upload a contact list", !deny((await call("/api/contacts", r.token, "POST", {})).status), sends);
    check("may send reminder emails", !deny((await call("/api/send", r.token, "POST", {})).status), sends);
    check("may email a report", !deny((await call("/api/report", r.token, "POST", {})).status), sends);
    check("may raise a late fee", !deny((await call("/api/activity", r.token, "POST", { kind: "late-fee" })).status), sends);
    check("may record a letter as sent", !deny((await call("/api/activity", r.token, "POST", { kind: "email" })).status), sends);
    check(
      "may log a call",
      !deny((await call("/api/activity", r.token, "POST", { kind: "call" })).status),
      role !== "management",
    );
    check(
      "may record a promise to pay",
      !deny((await call("/api/activity", r.token, "POST", { kind: "promise" })).status),
      role !== "management",
    );
    if (role === "rm") {
      /* Past the role check, the RM is stopped at the tenant: not theirs. */
      const other = allAccounts.find((a) => a.rm !== RM_KEY);
      const st = (await call("/api/activity", r.token, "POST", {
        kind: "call",
        record: { accountId: other?.id ?? "zz-not-theirs" },
      })).status;
      check("may log a call about somebody else's customer", !deny(st), false);
    }

    /* ----------------------------------------------- administration ----- */
    check(
      "may change when reminders go out",
      !deny((await call("/api/settings/reminders", r.token, "PUT", { first: "x", final: "y" })).status),
      admins,
    );
    if (!admins) {
      check("may run a day of the schedule", !deny((await call("/api/schedule", r.token, "POST", {})).status), false);
      check("may change the Google sign-in client", !deny((await call("/api/mail/client", r.token, "POST", {})).status), false);
    }
    console.log("");
  }
} catch (e) {
  failures += 1;
  console.log(`\n  FAIL  ${e.message}`);
}

await cleanup();
console.log(failures === 0 ? "ALL CHECKS PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
