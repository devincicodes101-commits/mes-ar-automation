/**
 * The access model.
 *
 *   npm run test:auth
 *
 * Checks the two things that matter: a wrong password never signs anybody in,
 * and no role can reach a screen it is not entitled to.
 */
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
check("an RM can only read their own tenants",
  ROLE_CAPABILITIES.RM.join(","), "view-own-tenants");
check("an RM cannot send a reminder", can("RM", "send-reminders"), false);
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

console.log(failures === 0 ? "\nALL CHECKS PASS\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
