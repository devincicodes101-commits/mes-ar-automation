import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Caller } from "./api-auth.ts";
import type { Account } from "./types.ts";

/**
 * Narrowing an API response to the book the caller is allowed to see.
 *
 * ---------------------------------------------------------------------------
 * The hole this closes
 *
 * 0002_security.sql puts row level security on all nineteen tables and
 * can_see_account() refuses a relationship manager every row whose rm_key is
 * not theirs. Signed in as Ray, the database hands over three tenants of ten
 * and twenty invoice lines of fifty-nine. That part works, and was verified
 * by signing in as him and asking.
 *
 * The API routes then went round it. They hold the service role key, which
 * bypasses every policy by design — a route has to be able to read a tenant
 * before deciding whether the caller may see it — and none of them narrowed
 * the result afterwards. So /api/dataset sent Ray all ten tenants and the
 * screen hid seven of them with scope(). Hidden in the browser is not the
 * same as not sent: the network tab has the rest.
 *
 * The comment in /api/dataset said as much and left it. This is that comment
 * being made true.
 *
 * ---------------------------------------------------------------------------
 * Only an RM is narrowed
 *
 * The same rule the policies use. CSD, admin, super-admin and management see
 * everything, because their work is the whole book: the aging board sums it,
 * the AR team raise fees across it, and management are sent the industry
 * breakdown. An RM sees their own tenants and nobody else's.
 *
 * A tenant with no manager is seen by no RM. That is 0002's reading of "only
 * their own tenants" and it is the safe one — an unassigned tenant belonging
 * to everybody would mean a manager reading a book they were never given.
 */

export function isNarrowed(caller: Caller): boolean {
  return caller.role === "RM";
}

/** The tenants an RM may see, or null when they may see all of them. */
export async function visibleTenantIds(
  db: SupabaseClient,
  caller: Caller,
): Promise<{ ok: true; ids: Set<string> | null } | { ok: false; error: string }> {
  if (!isNarrowed(caller)) return { ok: true, ids: null };

  /*
   * An RM with no key is not "an RM who sees everything". The check constraint
   * in 0001 forbids the state, and if it ever occurred, the safe reading is
   * that they have been given no book yet.
   */
  if (!caller.rmKey) return { ok: true, ids: new Set() };

  const { data, error } = await db
    .from("tenants")
    .select("id")
    .eq("rm_key", caller.rmKey);

  if (error) {
    return {
      ok: false,
      error: `Could not work out which tenants this manager may see: ${error.message}`,
    };
  }

  return { ok: true, ids: new Set((data ?? []).map((r) => r.id as string)) };
}

/**
 * The same question asked of an already-loaded report.
 *
 * Accounts carry their manager on `rm`, read back from tenants.rm_key, so this
 * needs no second query. Invoices do not carry it, and are matched on the
 * customer code and property that make up an account id instead — the same
 * pairing tenantId() uses when writing them.
 */
export function narrowReport<
  T extends {
    accounts: Account[];
    invoices: { customerCode?: string; property?: string; companyName: string }[];
  },
>(report: T, caller: Caller): T {
  if (!isNarrowed(caller)) return report;

  const key = caller.rmKey;
  const mine = report.accounts.filter(
    (a) => key !== null && (a as Account & { rm?: string }).rm === key,
  );

  /* Matched on both, because a company renting at two dormitories is two
     accounts and may well have two different managers. Matching on the code
     alone would hand one manager the other's lines. */
  const pairs = new Set(mine.map((a) => `${a.customerCode}|${a.property}`));

  return {
    ...report,
    accounts: mine,
    invoices: report.invoices.filter((i) =>
      pairs.has(`${i.customerCode ?? ""}|${i.property ?? ""}`),
    ),
  };
}
