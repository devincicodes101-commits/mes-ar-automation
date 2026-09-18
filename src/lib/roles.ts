/**
 * How a role is spelled in the app, and how it is spelled in Postgres.
 *
 * Deliberately in a file of its own, with no "use client" and no "server-only"
 * at the top, because both sides need it. That is not tidiness. It is the fix
 * for a fault that made every API route reject every signed-in person.
 *
 * This map used to live in supabase-auth.ts, which begins "use client". When
 * api-auth.ts imported it, Next.js did what that directive asks: it treated
 * the module as a client boundary and handed the server a reference proxy
 * rather than the object. Object.entries() on a proxy produced an empty map,
 * so every role read as one the build did not recognise, and every request
 * came back 403 saying so.
 *
 * Nothing caught it. The types were right, the values were right, the tests
 * that went straight to PostgREST with the service role key never passed
 * through identify() at all. It took signing in over HTTP as a real person to
 * see it, which is what scripts/test-routes.mjs now does.
 *
 * A module that both a server route and a client component import must carry
 * neither directive.
 */

import type { Role } from "./auth.ts";

/** The app's spelling to the database's. */
export const ROLE_TO_DB: Record<Role, string> = {
  "super-admin": "super_admin",
  admin: "admin",
  CSD: "csd",
  RM: "rm",
  Management: "management",
};

/**
 * And back again, derived rather than typed out twice.
 *
 * Built here, in the same module as the map it inverts, so the two cannot
 * drift and so it is never constructed across a client boundary.
 */
export const ROLE_FROM_DB: Record<string, Role> = Object.fromEntries(
  Object.entries(ROLE_TO_DB).map(([app, db]) => [db, app as Role]),
) as Record<string, Role>;
