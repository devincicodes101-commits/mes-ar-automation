/**
 * Proves the row level security policies actually do what the proposal says.
 *
 *   node scripts/test-rls.mjs
 *
 * Creates three throwaway users, signs in as each, and checks what the
 * database is willing to hand them. Deletes them again at the end.
 *
 * This is the script to run in front of MES. It does not test our screens,
 * it tests PostgreSQL, which is the only layer that matters for this claim.
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

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(url, service, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PW = "Test-" + Math.random().toString(36).slice(2, 10) + "!A9";
const USERS = [
  { email: "rls-csd@example.test", role: "csd", rm: null, label: "CSD Officer" },
  { email: "rls-rm1@example.test", role: "rm", rm: "rm1", label: "RM Voldemort" },
  { email: "rls-rm2@example.test", role: "rm", rm: "rm2", label: "RM Lockhart" },
  { email: "rls-mgmt@example.test", role: "management", rm: null, label: "Management" },
];

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(48)} got ${String(actual).padEnd(6)} expected ${expected}`,
  );
}

console.log("creating test users\n");
const created = [];
for (const u of USERS) {
  const { data, error } = await admin.auth.admin.createUser({
    email: u.email,
    password: PW,
    email_confirm: true,
  });
  if (error) {
    console.error(`could not create ${u.email}: ${error.message}`);
    process.exit(1);
  }
  created.push({ ...u, id: data.user.id });
  // The signup trigger seeds a csd profile; set the real role.
  await admin
    .from("profiles")
    .update({ full_name: u.label, role: u.role, rm_key: u.rm })
    .eq("id", data.user.id);
}

// Ground truth, read with the service key which bypasses every policy.
const { count: totalAccounts } = await admin
  .from("accounts")
  .select("*", { count: "exact" })
  .limit(1);
const { count: rm1Accounts } = await admin
  .from("accounts")
  .select("*", { count: "exact" })
  .eq("rm_key", "rm1")
  .limit(1);
const { count: rm2Accounts } = await admin
  .from("accounts")
  .select("*", { count: "exact" })
  .eq("rm_key", "rm2")
  .limit(1);

console.log(
  `ground truth: ${totalAccounts} accounts, rm1 owns ${rm1Accounts}, rm2 owns ${rm2Accounts}\n`,
);

for (const u of created) {
  const db = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await db.auth.signInWithPassword({
    email: u.email,
    password: PW,
  });
  if (signInError) {
    console.error(`sign in failed for ${u.email}: ${signInError.message}`);
    failures += 1;
    continue;
  }

  console.log(`${u.label}`);

  // How many tenants can they see?
  const { count } = await db.from("accounts").select("*", { count: "exact" }).limit(1);
  const expectedAccounts =
    u.role === "rm" ? (u.rm === "rm1" ? rm1Accounts : rm2Accounts) : totalAccounts;
  check("accounts visible", count ?? 0, expectedAccounts);

  // Can they read tenant email addresses? Personal data, CSD and mgmt only.
  const { count: contacts } = await db
    .from("contacts")
    .select("*", { count: "exact" })
    .limit(1);
  check(
    "tenant email addresses readable",
    (contacts ?? 0) > 0,
    u.role !== "rm",
  );

  // Can they write? Only CSD may.
  const { error: writeErr } = await db
    .from("calls")
    .insert({
      account_id: "dorm-166-jpd2",
      period: "2026-05-01",
      outcome: "no_answer",
      reached: "rls test",
    });
  check("can log a call", writeErr === null, u.role === "csd");

  /*
    Nobody may rewrite history, including CSD.

    Checking for an error here would be wrong. When RLS filters every row
    out of a DELETE, Postgres reports success with zero rows affected, so
    a missing error proves nothing. The only honest test is whether the
    row is still there afterwards, counted with the service key which
    bypasses RLS and therefore sees the truth.
  */
  const marker = `rls-test-${u.role}-${Date.now()}`;
  await admin.from("audit_log").insert({
    actor_name: u.label,
    action: "RLS test",
    subject: marker,
  });

  await db.from("audit_log").delete().eq("subject", marker);
  await db.from("audit_log").update({ action: "tampered" }).eq("subject", marker);

  const { data: after } = await admin
    .from("audit_log")
    .select("action")
    .eq("subject", marker);

  const survived = (after?.length ?? 0) === 1;
  const untouched = after?.[0]?.action === "RLS test";
  check("audit entry survives a delete attempt", survived, true);
  check("audit entry survives an update attempt", untouched, true);

  await db.auth.signOut();
  console.log("");
}

console.log("cleaning up");
await admin.from("calls").delete().eq("reached", "rls test");
await admin.from("audit_log").delete().eq("action", "RLS test");
await admin.from("audit_log").delete().eq("action", "tampered");
for (const u of created) await admin.auth.admin.deleteUser(u.id);

console.log(
  failures === 0
    ? "\nALL CHECKS PASSED. The database enforces the access rules on its own."
    : `\n${failures} CHECK(S) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
