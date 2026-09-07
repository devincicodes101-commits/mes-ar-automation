"use client";

/**
 * Who may sign in, and what each role may do.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 *
 * This is the access model, enforced in the browser. In the prototype that is
 * all there is, and a determined person with developer tools can get past it
 * by editing local storage. That is stated plainly here rather than left for
 * somebody to discover, because a login box that looks real is worse than no
 * login box at all: it invites people to trust it with something.
 *
 * In production the same model is enforced twice more, and those are the ones
 * that matter:
 *
 *   - Supabase row level security, so the database itself refuses to return
 *     rows the signed in user is not entitled to (see
 *     supabase/migrations/0002_security.sql).
 *   - A server session, so the gate cannot be walked around from the client.
 *
 * Everything below is written so that swapping in a real backend touches this
 * module and nothing else: the screens ask `can(user, "send-reminders")` and
 * never test a role name themselves.
 *
 * Passwords are stored as PBKDF2-SHA256 hashes with a per-user salt rather
 * than as text. That does not make the browser gate secure, but it does mean
 * a shared demo machine does not leave readable passwords in local storage.
 */

/* ------------------------------------------------------------------ roles */

export type Role =
  | "super-admin"
  | "admin"
  | "CSD"
  | "RM"
  | "Management";

export const ROLES: Role[] = ["super-admin", "admin", "CSD", "RM", "Management"];

export const ROLE_LABEL: Record<Role, string> = {
  "super-admin": "Super Admin",
  admin: "Admin",
  CSD: "CSD Officer",
  RM: "Relationship Manager",
  Management: "Management",
};

export const ROLE_SUMMARY: Record<Role, string> = {
  "super-admin":
    "Everything, including adding and removing users and changing the fee rules.",
  admin:
    "The full monthly cycle: upload, send, call, raise fees, export. Cannot manage users.",
  CSD: "The daily collections work. Cannot change settings or manage users.",
  RM: "Only the tenants assigned to them, and only to read.",
  Management: "Totals and reports across every property. Read only.",
};

/* ------------------------------------------------------------ permissions */

/**
 * Every distinct thing a person can do. Screens ask for one of these, never
 * for a role, so adding a role is a change in one table rather than a hunt
 * through the components.
 */
export type Capability =
  | "view-all-tenants"
  | "view-own-tenants"
  | "view-tenant-emails"
  | "upload-reports"
  | "send-reminders"
  | "log-calls"
  | "record-promises"
  | "raise-late-fees"
  | "generate-reports"
  | "email-reports"
  | "edit-templates"
  | "edit-settings"
  | "manage-users"
  | "read-audit-log";

export const CAPABILITY_LABEL: Record<Capability, string> = {
  "view-all-tenants": "See every tenant",
  "view-own-tenants": "See only their own tenants",
  "view-tenant-emails": "See tenant email addresses",
  "upload-reports": "Upload the monthly reports",
  "send-reminders": "Send reminder emails",
  "log-calls": "Log a call",
  "record-promises": "Record a promise to pay",
  "raise-late-fees": "Raise late payment fees",
  "generate-reports": "Generate and download reports",
  "email-reports": "Email a report to RM or AR team",
  "edit-templates": "Edit the email wording",
  "edit-settings": "Change fee rules and recipients",
  "manage-users": "Add or remove users",
  "read-audit-log": "Read the activity log",
};

/**
 * The matrix. Read it as: this role may do these things and nothing else.
 *
 * Two deliberate absences, both of which should stay absent:
 *   - Nobody, at any level, may alter the audit log. There is no capability
 *     for it here and no policy for it in the database.
 *   - RM never gets `view-tenant-emails`. Addresses are personal data under
 *     the PDPA and a manager has no reason to hold them.
 */
export const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  "super-admin": [
    "view-all-tenants", "view-tenant-emails", "upload-reports", "send-reminders",
    "log-calls", "record-promises", "raise-late-fees", "generate-reports",
    "email-reports", "edit-templates", "edit-settings", "manage-users",
    "read-audit-log",
  ],
  admin: [
    "view-all-tenants", "view-tenant-emails", "upload-reports", "send-reminders",
    "log-calls", "record-promises", "raise-late-fees", "generate-reports",
    "email-reports", "edit-templates", "edit-settings", "read-audit-log",
  ],
  CSD: [
    "view-all-tenants", "view-tenant-emails", "upload-reports", "send-reminders",
    "log-calls", "record-promises", "raise-late-fees", "generate-reports",
    "email-reports", "read-audit-log",
  ],
  RM: ["view-own-tenants"],
  Management: ["view-all-tenants", "generate-reports", "read-audit-log"],
};

export function can(role: Role | null, capability: Capability): boolean {
  if (!role) return false;
  return ROLE_CAPABILITIES[role].includes(capability);
}

/* ------------------------------------------------------------------ users */

export interface User {
  id: string;
  /** What they type to sign in. Lower cased on both sides. */
  username: string;
  name: string;
  role: Role;
  /** Which manager's book they see, when the role is RM. */
  rmKey?: string;
  salt: string;
  hash: string;
  disabled?: boolean;
}

/**
 * The accounts that exist before anybody configures anything.
 *
 * Hashes are generated by scripts/build-users.mts, never typed by hand. The
 * demo passwords are deliberately obvious and are meant to be replaced before
 * this is put in front of anybody outside the project.
 */
export const SEED_USERS: User[] = [
  {
    id: "u-super", username: "superadmin@mesgroup.com", name: "Raman Palaniappan",
    role: "super-admin",
    salt: "e3b0c44298fc1c14", hash: "e7a78201bf3eaa7c0f449b9b36f347e90136ad362f93b438c19057f1608f43f3",
  },
  {
    id: "u-admin", username: "admin@mesgroup.com", name: "Darren Phua",
    role: "admin",
    salt: "9f86d081884c7d65", hash: "b8e67589f9f0a97ad682b204bf5b262722af28901dc7d1075398fb04af7426c0",
  },
  {
    id: "u-csd", username: "csd@mesgroup.com", name: "Jacqueline Fong",
    role: "CSD",
    salt: "2c26b46b68ffc68f", hash: "d4e2e2446998866c062afde6dafeaade73cf4d4e99cff0580276b6dc5b7d2633",
  },
  {
    id: "u-rm", username: "rm@mesgroup.com", name: "Ray Ang",
    role: "RM", rmKey: "2611 Ray Ang",
    salt: "fcde2b2edba56bf4", hash: "57630f95a185b7ddc2e9b156202bec40853f65b1768b99e1ad0ed2fc6e2881a9",
  },
  {
    id: "u-mgmt", username: "management@mesgroup.com", name: "Management",
    role: "Management",
    salt: "486ea46224d1bb4f", hash: "1fe820f905b380751e0cf21868e488e695c58b87b595e469ceea7e343626fcb4",
  },
];

/* -------------------------------------------------------------- passwords */

const ITERATIONS = 120_000;

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * PBKDF2-SHA256. Deliberately slow, so a leaked hash is not a leaked password.
 *
 * Available in the browser and in Node 18+, so the same function generates
 * the seed hashes at build time and checks them at sign in. One implementation
 * means the two cannot disagree.
 */
export async function hashPassword(
  password: string,
  salt: string,
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return toHex(bits);
}

/** Constant time compare, so a wrong password cannot be timed character by character. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type SignInResult =
  | { ok: true; user: User }
  | { ok: false; reason: string };

/**
 * Check a username and password against the user list.
 *
 * A wrong username and a wrong password return the same message on purpose:
 * telling somebody which half they got right tells them a username exists.
 */
export async function signIn(
  username: string,
  password: string,
  users: readonly User[],
): Promise<SignInResult> {
  const wanted = username.trim().toLowerCase();
  const user = users.find((u) => u.username.toLowerCase() === wanted);

  // Hash regardless of whether the user exists, so the two paths take the
  // same time and absence cannot be detected by how fast it fails.
  const salt = user?.salt ?? "0000000000000000";
  const attempt = await hashPassword(password, salt);

  if (!user || !safeEqual(attempt, user.hash)) {
    return { ok: false, reason: "That username and password do not match." };
  }
  if (user.disabled) {
    return { ok: false, reason: "That account has been disabled." };
  }
  return { ok: true, user };
}

/* ---------------------------------------------------------------- session */

export interface Session {
  userId: string;
  username: string;
  name: string;
  role: Role;
  rmKey?: string;
  startedAt: string;
  /** ISO. Signing in again extends it; it is not refreshed on activity. */
  expiresAt: string;
}

/** Eight hours: a working day, so nobody is signed out mid-cycle. */
export const SESSION_HOURS = 8;

export const SESSION_KEY = "mes-ar-session-v1";

export function newSession(user: User, now = new Date()): Session {
  const expires = new Date(now.getTime() + SESSION_HOURS * 3600_000);
  return {
    userId: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    rmKey: user.rmKey,
    startedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  };
}

export function isExpired(s: Session, now = new Date()): boolean {
  const t = Date.parse(s.expiresAt);
  return !Number.isFinite(t) || t <= now.getTime();
}

/**
 * Reads a stored session, returning null for anything that is not a live one.
 *
 * Anything malformed is treated as no session rather than repaired. A half
 * understood session is how somebody ends up with a role they were never
 * granted.
 */
export function readSession(raw: string | null, now = new Date()): Session | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<Session>;
    if (
      typeof s.userId !== "string" ||
      typeof s.role !== "string" ||
      !ROLES.includes(s.role as Role) ||
      typeof s.expiresAt !== "string"
    ) {
      return null;
    }
    const session = s as Session;
    return isExpired(session, now) ? null : session;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------- route protection */

/** The only route reachable without a session. */
export const PUBLIC_ROUTES = ["/login"];

export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.includes(pathname);
}

/**
 * Which capability a route needs. A route absent from here needs only a
 * session, which is the default for the read-only screens.
 */
export const ROUTE_CAPABILITY: Record<string, Capability> = {
  "/upload": "upload-reports",
  "/reminders": "send-reminders",
  "/calls": "log-calls",
  "/promises": "record-promises",
  "/late-fees": "raise-late-fees",
  "/outbox": "send-reminders",
  "/reports": "generate-reports",
  "/settings": "edit-settings",
  "/users": "manage-users",
  "/access": "manage-users",
  "/activity": "read-audit-log",
};

export function canOpen(role: Role | null, pathname: string): boolean {
  if (isPublicRoute(pathname)) return true;
  if (!role) return false;
  const needed = ROUTE_CAPABILITY[pathname];
  return needed ? can(role, needed) : true;
}
