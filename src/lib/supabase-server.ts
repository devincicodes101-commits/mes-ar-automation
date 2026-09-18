import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The Supabase client for code that runs on the server.
 *
 * `import "server-only"` at the top is the point of this file. It makes the
 * build fail, rather than the deploy succeed, if anything a browser bundles
 * ever imports it. The key below bypasses every row level security policy in
 * 0002_security.sql: a relationship manager who got hold of it could read all
 * 190 tenants, their balances and their email addresses. It is the one secret
 * in this project that would actually matter.
 *
 * src/lib/supabase.ts is the other half of the pair, and stays as it is: the
 * anon key, shipped to the browser on purpose, with the database deciding what
 * each signed-in person may see.
 *
 * Why the service role rather than the signed-in user's own token, for now:
 * uploading calls import_ar_report, which is `security invoker`, so it runs
 * with the caller's permissions. Until sessions are carried into the API
 * routes — which is task 1.7 — a route acting on the user's behalf has no
 * token to act with. The route therefore checks the caller itself and is the
 * only thing standing between a request and the whole database, which is why
 * it refuses anything it is not certain about.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const isServerSupabaseConfigured = Boolean(url && serviceKey);

let cached: SupabaseClient | null = null;

/**
 * Throws rather than returning null.
 *
 * A route that silently did nothing because the environment was half
 * configured would report success and save no data, which is the worst of both
 * outcomes: nobody would know until somebody looked for a report that was
 * never there.
 */
export function serverSupabase(): SupabaseClient {
  if (cached) return cached;

  if (!url || !serviceKey) {
    const missing = [
      !url && "NEXT_PUBLIC_SUPABASE_URL",
      !serviceKey && "SUPABASE_SERVICE_ROLE_KEY",
    ].filter(Boolean);
    throw new Error(
      `Supabase is not configured on the server: ${missing.join(" and ")} ` +
        "missing. Add them to .env.local for development, and to the Vercel " +
        "project's environment variables for anything deployed.",
    );
  }

  cached = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    /*
     * Never cached, and this is not a tuning choice.
     *
     * Next.js replaces global fetch and, in the App Router, stores GET
     * responses in a data cache that outlives the request and is shared across
     * deployments on Vercel. supabase-js reads through that same fetch, so a
     * plain select becomes a cached document: right once, then frozen.
     *
     * What that looked like was worse than a stale figure. The database was
     * emptied for testing, something read the report list and cached the empty
     * answer, and from then on every upload saved correctly and vanished on
     * the next load, because /api/dataset kept replaying the empty list and
     * the browser believed it. Two months of data were in the tables the whole
     * time.
     *
     * It hid well because a count is a HEAD request and HEAD is not cached, so
     * the rows could be counted and not listed in the same breath. Local
     * development never shows it: the cache is per build and short lived
     * there, so the bug only exists where the data is real.
     *
     * Reads here are of a live ledger that people are changing, and a route
     * that answers from a cache is answering about a month that may no longer
     * exist.
     */
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, cache: "no-store" }),
    },
  });
  return cached;
}
