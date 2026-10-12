import type { Account, Buckets } from "./types.ts";

/**
 * Money rounding, in one place.
 *
 * Moved here from aging-detail.ts, which still re-exports round2, so that the
 * screens' adding-up helpers below can use it without an import cycle
 * (aging-detail imports data.ts, and data.ts needs these).
 */

/** Money adds up in binary and drifts. Rounded once, at the boundary. */
export function round2(n: number): number {
  // Half away from zero, which is what money does. Math.round breaks ties
  // towards positive infinity, so it rounded 1.005 up to 1.01 and -1.005 in
  // to -1.00: a half cent treated one way on an invoice and the other on a
  // credit note. This file is full of credit notes, and deposits offset
  // against arrears are all negative.
  // The epsilon is applied as a ratio, not added. 1.005 is held as
  // 1.00499999999999989, so scaling gives 100.49999999999999 and adding an
  // epsilon sized for 1.0 moves nothing at all at that magnitude. Multiplying
  // scales the nudge with the number.
  const cents = Math.round(Math.abs(n) * 100 * (1 + Number.EPSILON));
  return ((n < 0 ? -cents : cents) / 100) || 0;
}

/**
 * An amount as MES exported it, with binary dust removed.
 *
 * MES's exports carry amounts to three and four decimals - 6.752, 15.1926 -
 * and adding them in floating point leaves residue like 0.0000000000009.
 * Six places keeps every real digit and drops the dust, so a customer who has
 * paid in full sums to exactly 0, not to something a test of "> 0" believes.
 */
export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6 || 0;
}

/* --------------------------------------------------- adding up across accounts
 * Totals are made the way MES's own Excel makes them: the exact amounts added
 * up, rounded once, when the figure is shown.
 *
 * Each account carries two sets of figures. `total` and `buckets` are rounded
 * to the cent: they are what a row shows and what every decision reads, so a
 * decision is never made on a fraction of a cent. `exact` is the same figures
 * before rounding, where they are known. Adding up the rounded figures - which
 * is what every total on every screen did - drifted from MES's own totals by a
 * few cents on the September export (2,718,954.93 against their 2,718,955.01),
 * and by different amounts on different screens, because each grouped the
 * rounding differently.
 *
 * An account without `exact` (older formats, or a report stored before 0023)
 * falls back to its rounded figures, which is how every total was made before.
 */
export function exactOf(a: Account): { total: number; buckets: Buckets } {
  return a.exact ?? { total: a.total, buckets: a.buckets };
}

export const exactOverdue = (x: { buckets: Buckets }) =>
  x.buckets.d30 + x.buckets.d60 + x.buckets.d90 + x.buckets.d90plus;

export const exactSevere = (x: { buckets: Buckets }) => x.buckets.d90 + x.buckets.d90plus;

/** A money figure across accounts: exact amounts added, rounded once. */
export function sumExact(
  accounts: readonly Account[],
  pick: (x: { total: number; buckets: Buckets }) => number,
): number {
  return round2(accounts.reduce((n, a) => n + pick(exactOf(a)), 0));
}
