/**
 * The access model.
 *
 *   npm run test:auth
 *
 * Checks the two things that matter: a wrong password never signs anybody in,
 * and no role can reach a screen it is not entitled to.
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Role,
  type Session,
  CAPABILITY_LABEL,
  ROLES,
  ROLE_CAPABILITIES,
  ROUTE_CAPABILITY,
  SEED_USERS,
  can,
  canOpen,
  hashPassword,
  isExpired,
  isPublicRoute,
  newSession,
  readSession,
  safeEqual,
  signIn,
} from "../src/lib/auth.ts";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${name.slice(0, 64).padEnd(64)} ` +
      (ok ? "" : `got ${String(actual)}, expected ${String(expected)}`),
  );
}
const section = (t: string) => console.log(`\n${t}\n`);

/* ================================================================ signing in */

section("Signing in");

const good = await signIn("csd@mesgroup.com", "csd@2026", SEED_USERS);
check("the right password signs you in", good.ok, true);
check("and gives the role from the account, not from a choice",
  good.ok ? good.user.role : null, "CSD");

const bad = await signIn("csd@mesgroup.com", "wrong-password", SEED_USERS);
check("a wrong password does not", bad.ok, false);

const nobody = await signIn("nobody", "anything", SEED_USERS);
check("nor does a username that does not exist", nobody.ok, false);
check("and the two failures read identically, so absence is not detectable",
  (bad.ok ? "" : bad.reason) === (nobody.ok ? "" : nobody.reason), true);

const cased = await signIn("CSD@MESGROUP.COM", "csd@2026", SEED_USERS);
check("the username is not case sensitive", cased.ok, true);
const spaced = await signIn("  superadmin@mesgroup.com  ", "superadmin@2026", SEED_USERS);
check("and is trimmed", spaced.ok, true);

check("an empty password never matches", (await signIn("superadmin@mesgroup.com", "", SEED_USERS)).ok, false);

const disabled = SEED_USERS.map((u) =>
  u.username === "rm@mesgroup.com" ? { ...u, disabled: true } : u,
);
check("a disabled account is refused even with the right password",
  (await signIn("rm@mesgroup.com", "rm@2026", disabled)).ok, false);

/* ---------------------------------------------------------------- hashing */

section("Passwords");

check("no seed user stores a readable password",
  SEED_USERS.every((u) => !/@/.test(u.hash)), true);
check("every hash is 64 hex characters",
  SEED_USERS.every((u) => /^[0-9a-f]{64}$/.test(u.hash)), true);
check("every user has their own salt",
  new Set(SEED_USERS.map((u) => u.salt)).size, SEED_USERS.length);

const h1 = await hashPassword("same-password", "salt-one");
const h2 = await hashPassword("same-password", "salt-two");
check("the same password under two salts gives two hashes", h1 === h2, false);
check("and the same salt is reproducible",
  (await hashPassword("same-password", "salt-one")) === h1, true);

check("compare rejects different lengths", safeEqual("abc", "abcd"), false);
check("compare rejects different content", safeEqual("abc", "abd"), false);
check("compare accepts a match", safeEqual("abc", "abc"), true);

/* =============================================================== the session */

section("Sessions");

const user = SEED_USERS.find((u) => u.username === "rm@mesgroup.com")!;
const at = new Date("2026-09-04T09:00:00Z");
const s = newSession(user, at);

check("a session carries the role", s.role, "RM");
check("and the manager's own book", s.rmKey, "2611 Ray Ang");
check("it expires eight hours out",
  Date.parse(s.expiresAt) - Date.parse(s.startedAt), 8 * 3600_000);
check("it is live an hour in", isExpired(s, new Date("2026-09-04T10:00:00Z")), false);
check("and expired nine hours in", isExpired(s, new Date("2026-09-04T18:00:00Z")), true);

const raw = JSON.stringify(s);
check("a stored session restores", readSession(raw, at)?.role, "RM");
check("an expired one does not",
  readSession(raw, new Date("2026-09-05T09:00:00Z")), null);
check("nothing stored means nobody is signed in", readSession(null), null);
check("malformed JSON is treated as no session", readSession("{not json", at), null);
check("a session with no role is refused",
  readSession(JSON.stringify({ userId: "x", expiresAt: s.expiresAt }), at), null);
check("and so is one carrying a role that does not exist",
  readSession(JSON.stringify({ ...s, role: "root" }), at), null);

/* ============================================================ what each may do */

section("What each role may do");

check("only the super admin manages users",
  ROLES.filter((r) => can(r, "manage-users")).join(","), "super-admin");
check("admin can run the whole cycle but not manage users",
  can("admin", "send-reminders") && !can("admin", "manage-users"), true);
check("CSD can send but cannot change settings",
  can("CSD", "send-reminders") && !can("CSD", "edit-settings"), true);
/*
 * A manager records what came of their own calls, and does nothing else.
 *
 * They were read-only, which meant the person who made the call was never the
 * person who wrote it down. A promise taken on the 12th that reaches the
 * system after the 16th does not stop the $100, so the tenant is charged for
 * being late after they had already arranged to pay.
 *
 * The exact list is asserted rather than the two new entries, because the
 * risk here is a capability arriving quietly: this is the role held by people
 * outside the finance team.
 */
check("a manager may record calls and promises",
  ROLE_CAPABILITIES.RM.join(","), "view-own-tenants,log-calls,record-promises");
check("an RM cannot send a reminder", can("RM", "send-reminders"), false);
check("nor upload a report", can("RM", "upload-reports"), false);
check("nor raise a fee", can("RM", "raise-late-fees"), false);
check("nor read the audit log", can("RM", "read-audit-log"), false);
check("nor see a tenant's email address",
  can("RM", "view-tenant-emails"), false);
check("management can read but not act",
  can("Management", "generate-reports") && !can("Management", "send-reminders"), true);
check("nobody sees tenant emails without the capability",
  can("RM", "view-tenant-emails") || can("Management", "view-tenant-emails"), false);
check("signed out means no capability at all",
  ROLES.some((r) => can(null, "view-all-tenants")), false);

// The audit log is append only for everyone, including the super admin. There
// is deliberately no capability that would let anyone rewrite it.
check("no role can alter the audit log",
  Object.keys(CAPABILITY_LABEL).some((c) => /edit-audit|delete-audit/.test(c)), false);

/* ====================================================== reaching a screen */

section("Which screens each role can open");

check("the login page is open to everyone", isPublicRoute("/login"), true);
check("the landing page is not", isPublicRoute("/"), false);
check("signed out, the landing page is closed", canOpen(null, "/"), false);
check("signed out, every route is closed",
  ["/", "/upload", "/reports", "/settings", "/users"].some((r) => canOpen(null, r)), false);
check("except the login page", canOpen(null, "/login"), true);

check("super admin can open user management", canOpen("super-admin", "/users"), true);
check("admin cannot", canOpen("admin", "/users"), false);
check("CSD cannot", canOpen("CSD", "/users"), false);
check("CSD can open upload", canOpen("CSD", "/upload"), true);
check("CSD cannot open settings", canOpen("CSD", "/settings"), false);
check("admin can open settings", canOpen("admin", "/settings"), true);
check("an RM cannot open upload", canOpen("RM", "/upload"), false);
check("an RM cannot open reminders", canOpen("RM", "/reminders"), false);
check("an RM can still see the board", canOpen("RM", "/"), true);
check("management cannot raise a fee", canOpen("Management", "/late-fees"), false);

const guarded = Object.keys(ROUTE_CAPABILITY);
check("every guarded route names a real capability",
  guarded.every((r) => ROUTE_CAPABILITY[r] in CAPABILITY_LABEL), true);
check("the acting screens are all guarded",
  ["/upload", "/reminders", "/calls", "/late-fees", "/settings", "/users"]
    .every((r) => r in ROUTE_CAPABILITY), true);

/* the whole matrix, as a table, so a change is visible in the diff */
console.log("\n  route              " + ROLES.map((r) => r.slice(0, 6).padEnd(7)).join(""));
console.log("  " + "-".repeat(19 + ROLES.length * 7));
for (const route of ["/", "/upload", "/reminders", "/calls", "/late-fees", "/reports", "/settings", "/users"]) {
  console.log(
    "  " + route.padEnd(19) +
      ROLES.map((r: Role) => (canOpen(r, route) ? "yes" : "-").padEnd(7)).join(""),
  );
}

/* ===================================== what a failed sign in admits to */

section("A failed sign in says the right amount");

const { CREDENTIALS_REFUSED, explain } = await import("../src/lib/supabase-auth.ts");

// The one case that must stay ambiguous.
check("wrong credentials give nothing away",
  explain({ code: "invalid_credentials" }), CREDENTIALS_REFUSED);
check("an unrecognised error is treated the same way",
  explain({ code: "something_new" }), CREDENTIALS_REFUSED);
check("and so is no error object at all", explain(null), CREDENTIALS_REFUSED);

// Everything else is a fault in the setup, and hiding it wastes an hour.
check("a disabled provider says so",
  explain({ code: "email_provider_disabled" }).includes("switched off"), true);
check("and names the setting to change",
  explain({ code: "email_provider_disabled" }).includes("Providers"), true);
check("it is recognised from the message too, not only the code",
  explain({ message: "Email logins are disabled" }).includes("switched off"), true);
check("an unconfirmed account says so",
  explain({ code: "email_not_confirmed" }).includes("never been confirmed"), true);
check("a rate limit says to wait",
  explain({ code: "over_request_rate_limit" }).includes("Wait a minute"), true);
check("a network failure is not blamed on the password",
  explain({ message: "Failed to fetch" }).includes("Could not reach"), true);
// A server fault is never a wrong password. Saying it is sends somebody to
// retype a password that was always correct.
check("a 500 is not reported as a bad password",
  explain({ status: 500 }) === CREDENTIALS_REFUSED, false);
check("unexpected_failure is not either",
  explain({ code: "unexpected_failure" }) === CREDENTIALS_REFUSED, false);
check("and it says the fault is not the password",
  explain({ code: "unexpected_failure" }).includes("not a password problem"), true);
check("a 4xx with no code still fails closed",
  explain({ status: 400 }), CREDENTIALS_REFUSED);
check("the server message still reveals nothing about the account",
  /exists|not found|no such|unknown user/i.test(explain({ status: 500 })), false);

check("none of those leak into the credential message",
  [
    explain({ code: "email_provider_disabled" }),
    explain({ code: "email_not_confirmed" }),
    explain({ message: "Failed to fetch" }),
  ].some((m) => m === CREDENTIALS_REFUSED), false);

/* ------------------------------------------- every route is accounted for ---
 * A route missing from ROUTE_CAPABILITY needs only a session, which is the
 * right default for a read-only screen and the wrong one for anything that
 * writes or that shows every tenant. Send By Hand and the Dry Run were both
 * added after the map was written and both were missed, so an RM could open
 * either and read all 190 tenants with their email addresses.
 *
 * This walks the app folder rather than a list somebody has to remember to
 * update, so the next route added is caught the day it is added.
 */
console.log("\nEvery screen is behind the right permission\n");

const APP = path.join(ROOT, "src", "app");
const routes = readdirSync(APP, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(path.join(APP, d.name, "page.tsx")))
  .map((d) => `/${d.name}`);

// Read-only screens that genuinely need nothing more than being signed in.
//
// /checks is here on purpose. It carries no tenant names, no addresses and no
// amounts: it runs MES's stated requirements as arithmetic and shows what came
// out. Gating it would keep it from whoever is being asked to trust the
// figures, and there is no capability every role holds to gate it with.
//
// /chased is here for the same reason /defaulters is: it names clients and
// their balances, but it scopes with scope(), so a relationship manager sees
// their own book and nobody else's. There is also no capability every role
// holds — an RM has only view-own-tenants — so naming one would shut the
// managers out of a list about their own clients.
//
// /movement is here for the same reason as /chased and /defaulters. It names
// clients and their balances and scopes with scope(), so a relationship
// manager sees their own book. It shows whether a client has an email address
// but never the address itself, so it is no more revealing than the board.
//
// The one case worth naming: a tenant who settled is gone from the current
// report, so there is nothing left saying whose book they were in, and they
// are shown to every manager rather than hidden from the right one. Telling a
// manager somebody paid is the smaller error.
const SESSION_ONLY = new Set([
  "/access", "/collections", "/defaulters", "/login", "/checks", "/chased",
  "/movement",
]);

const unguarded = routes.filter(
  (r) => !(r in ROUTE_CAPABILITY) && !SESSION_ONLY.has(r),
);
check("no screen is left needing only a session by accident",
      unguarded.join(", ") || "none", "none");

check("Send By Hand needs the reminder permission",
      ROUTE_CAPABILITY["/no-email"], "send-reminders");
check("the Dry Run needs the reports permission",
      ROUTE_CAPABILITY["/simulation"], "generate-reports");

// The role with one permission is the one that proves the guard works.
check("an RM cannot open Send By Hand", canOpen("RM", "/no-email"), false);
check("an RM cannot open the Dry Run", canOpen("RM", "/simulation"), false);
check("management cannot open Send By Hand", canOpen("Management", "/no-email"), false);
check("but management can open the Dry Run", canOpen("Management", "/simulation"), true);
check("CSD can open both",
      canOpen("CSD", "/no-email") && canOpen("CSD", "/simulation"), true);
check("and so can an admin",
      canOpen("admin", "/no-email") && canOpen("admin", "/simulation"), true);

console.log(failures === 0 ? "\nALL CHECKS PASS\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
