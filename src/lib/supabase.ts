import { createClient } from "@supabase/supabase-js";

/**
 * Supabase client.
 *
 * This uses the anon key, which is public by design and shipped to the
 * browser. It is not a secret and does not need hiding: what protects the data
 * is row level security in supabase/migrations/0002_security.sql, which the
 * database enforces on every query regardless of who is asking.
 *
 * The service_role key bypasses all of that and must never be imported here.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase =
  isSupabaseConfigured
    ? createClient(url as string, anonKey as string, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
        },
      })
    : null;

/** Throws a useful message rather than a null dereference somewhere deep. */
export function requireSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local and restart the dev server.",
    );
  }
  return supabase;
}
