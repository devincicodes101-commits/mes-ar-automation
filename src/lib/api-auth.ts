import "server-only";

import { serverSupabase } from "./supabase-server";
import type { Role } from "./auth";
import { ROLE_TO_DB } from "./supabase-auth";

/**
 * Who is asking an API route.
 *
 * The routes hold the service role key, which bypasses every policy in
 * 0002_security.sql. Without this, /api/dataset would hand all 190 tenants,
 * their balances and their addresses to anybody who typed the URL, and
 * /api/upload would let anybody replace a month.
 *
 * The session the browser keeps in local storage is not evidence. It is a
 * JSON object the browser wrote and could rewrite, so a route that trusted it
 * would be trusting the caller's own claim about who they are. What is
 * evidence is the Supabase access token: signed by the project, verifiable
 * here, and impossible to forge without the project's secret.
 *
 * So the browser sends its token and this asks Supabase whose it is, then
 * reads the role out of the profiles table rather than out of anything the
 * caller sent.
 */

/** Maps the database's role values back to the ones the app uses. */
const FROM_DB: Record<string, Role> = Object.fromEntries(
  Object.entries(ROLE_TO_DB).map(([app, db]) => [db, app as Role]),
) as Record<string, Role>;

export interface Caller {
  userId: string;
  email: string | null;
  role: Role;
  /** Which manager's book they see. Null for everyone but an RM. */
  rmKey: string | null;
}

export type CallerResult =
  | { ok: true; caller: Caller }
  | { ok: false; status: 401 | 403; error: string };

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1]! : null;
}

/**
 * Verifies the caller, or explains why not.
 *
 * Returns rather than throws, so a route decides its own status code and the
 * reason reaches the person: "sign in again" and "you are not allowed to do
 * this" need different actions from them, and a single 403 for both would send
 * somebody looking in the wrong place.
 */
export async function identify(request: Request): Promise<CallerResult> {
  const token = bearer(request);
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: "No access token was sent. Sign in and try again.",
    };
  }

  const db = serverSupabase();

  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) {
    return {
      ok: false,
      status: 401,
      error: "That session is not valid any more. Sign in again.",
    };
  }

  const profile = await db
    .from("profiles")
    .select("role, rm_key")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profile.error || !profile.data) {
    return {
      ok: false,
      status: 403,
      error:
        "That account has no role assigned yet, so it cannot read or change " +
        "anything. Ask a super admin to finish setting it up.",
    };
  }

  const role = FROM_DB[profile.data.role as string];
  if (!role) {
    return {
      ok: false,
      status: 403,
      error: `That account holds a role this build does not know: ${profile.data.role}.`,
    };
  }

  return {
    ok: true,
    caller: {
      userId: data.user.id,
      email: data.user.email ?? null,
      role,
      rmKey: (profile.data.rm_key as string | null) ?? null,
    },
  };
}

/**
 * The roles that may replace a month.
 *
 * The same set 0009_admin_roles.sql widened is_csd() to, and deliberately the
 * same list rather than a new one: a person who may upload through the screens
 * may upload through the API, and nobody else may.
 */
export const MAY_UPLOAD: readonly Role[] = ["CSD", "admin", "super-admin"];

export function mayUpload(caller: Caller): boolean {
  return MAY_UPLOAD.includes(caller.role);
}
