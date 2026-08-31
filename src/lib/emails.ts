/**
 * Pulling email addresses out of MES's contact list.
 *
 * The addresses are typed by hand into a single cell and arrive in at least
 * four shapes, often several in the same cell:
 *
 *   ap@brightsun.com.sg
 *   AKR engg <akrpteltd@gmail.com>
 *   'best.meengineering@gmail.com'
 *   aeoncontractor@gmail.com; Admin Finance <admin@aeoncontractor.com>
 *
 * Splitting on semicolons and keeping anything containing an "@" is not
 * enough: it yields `AKR engg <akrpteltd@gmail.com>` as the address, which
 * bounces. And a bounce is the worst kind of failure here, because the screen
 * still says the reminder was sent.
 *
 * So rather than splitting the cell up, the addresses are found inside it. The
 * surrounding names, quotes and angle brackets are simply not matched.
 */

/**
 * Deliberately not the RFC 5322 grammar, which admits quoted local parts and
 * comments that no one types into a spreadsheet. This matches what MES
 * actually writes, and anything it does not match is reported rather than
 * guessed at.
 */
const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

/**
 * Every address in one cell, in the order written, with duplicates removed.
 *
 * Lower cased. Domains are case insensitive by definition, and while the local
 * part is not, no mail provider MES deals with treats it as significant.
 * Normalising means `Sathiya@brightsun.com.sg` and `sathiya@brightsun.com.sg`
 * are not sent the same reminder twice.
 */
export function emailAddresses(cell: unknown): string[] {
  const text = String(cell ?? "");
  const found = text.match(ADDRESS) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of found) {
    const e = raw.toLowerCase();
    if (seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

/**
 * True when the cell holds text but no address we could recognise.
 *
 * Distinguishes "nobody filled this in", which is a gap for MES to close, from
 * "somebody wrote something we could not read", which is a gap in the rule
 * above. The two need different responses, and lumping them together hides
 * the second one.
 */
export function looksLikeUnreadableContact(cell: unknown): boolean {
  const text = String(cell ?? "").trim();
  return text !== "" && emailAddresses(text).length === 0;
}
