import type { Account } from "./types.ts";

/**
 * Whether an upload changes anything, compared on substance.
 *
 * The Upload screen used to decide "this is already the file every screen is
 * using" from three facts: the report date, the number of accounts and the
 * number of invoice lines. Anything else could change and the screen would
 * still say "Nothing to apply" and hide its only real button:
 *
 *   - The same AR file uploaded again with a new contact list. The addresses
 *     were never compared, so they were never saved. This happened twice in
 *     testing on 3 October, with no error shown, and looked like a save that
 *     had silently failed.
 *   - A corrected export for the same day. MES fix one amount and export
 *     again; same date, same row counts, different money - "Nothing to apply".
 *
 * Mistakes in the other direction cost nothing: an upload judged "changed"
 * when it is not is simply stored again, and storing the same report date
 * twice replaces that snapshot rather than duplicating it.
 */

interface Comparable {
  asOf: string;
  accounts: readonly Account[];
  invoices: readonly {
    customerCode?: string;
    documentNumber?: string;
    date?: string | null;
    dueDate?: string | null;
    openBalance: number;
  }[];
}

const cents = (n: number) => Math.round(n * 100);

function accountKey(a: Account): string {
  const b = a.buckets;
  return [a.id, cents(a.total), cents(b.current), cents(b.d30), cents(b.d60), cents(b.d90), cents(b.d90plus)].join(":");
}

function lineKey(l: Comparable["invoices"][number]): string {
  return [l.customerCode ?? "", l.documentNumber ?? "", l.date ?? "", l.dueDate ?? "", cents(l.openBalance)].join("|");
}

/** Same report date, same accounts with the same balances, same lines. */
export function sameFigures(a: Comparable, b: Comparable): boolean {
  if (a.asOf !== b.asOf) return false;
  if (a.accounts.length !== b.accounts.length) return false;
  if (a.invoices.length !== b.invoices.length) return false;

  const mine = a.accounts.map(accountKey).sort();
  const theirs = b.accounts.map(accountKey).sort();
  for (let i = 0; i < mine.length; i += 1) if (mine[i] !== theirs[i]) return false;

  const ml = a.invoices.map(lineKey).sort();
  const tl = b.invoices.map(lineKey).sort();
  for (let i = 0; i < ml.length; i += 1) if (ml[i] !== tl[i]) return false;

  return true;
}

/**
 * Addresses in the upload that the active dataset does not already hold.
 *
 * Counted rather than compared for equality, because a contact upload adds
 * addresses and never removes one: a list that only repeats what is stored
 * changes nothing, and a list with one new address changes something.
 */
export function newAddresses(
  upload: readonly Pick<Account, "id" | "emails">[],
  active: readonly Pick<Account, "id" | "emails">[],
): number {
  const held = new Map(active.map((a) => [a.id, new Set(a.emails.map((e) => e.toLowerCase()))]));
  let n = 0;
  for (const a of upload) {
    const have = held.get(a.id);
    for (const e of a.emails) if (!have?.has(e.toLowerCase())) n += 1;
  }
  return n;
}
