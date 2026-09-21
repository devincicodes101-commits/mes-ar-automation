import type { CallLog, PromiseRecord } from "./store.ts";

/**
 * The Update column in a manager's workbook, written from what was logged.
 *
 * ---------------------------------------------------------------------------
 * The column MES leave blank on purpose
 *
 * Jacqueline emails each relationship manager their own clients and asks them
 * to "revert on the payment updates by 2pm on 13 August". Every Update cell in
 * her mock-up is empty: it is the box the manager types into before replying.
 *
 * buildManagerReports has always read this column from a notes map, and the
 * Reports screen has always handed it `new Map()`. So the plumbing was there,
 * nothing fed it, and the column came out blank every time — which looked
 * exactly like MES's blank template and was therefore never questioned.
 *
 * ---------------------------------------------------------------------------
 * Why the system should write it rather than the manager
 *
 * Because the manager is going to make the call either way, and the note has
 * to reach two places that must not disagree.
 *
 * If Ray rings Orchard on the 12th and they promise to pay by the 20th, that
 * matters twice over. It belongs in the workbook Jacqueline reads, and it
 * belongs in the system, because a recorded promise stops the 21st's final
 * notice going to somebody who has already made an arrangement. Typing it into
 * a spreadsheet only does the first. Typing it into both is the same fact kept
 * in two places, which is the same fact drifting apart.
 *
 * So a call logged once fills this column, and the round trip stops being a
 * thing anybody waits on: the file is already answered when it is generated.
 *
 * ---------------------------------------------------------------------------
 * What it says, and what it will not say
 *
 * Short, because this is a spreadsheet cell somebody scans a column of, and
 * factual, because it is repeating what an officer recorded rather than
 * summarising it. It never says a tenant has paid. Payment is known from the
 * next AR export — a tenant who has paid is absent from it — and a note
 * claiming otherwise would be one person's recollection of a phone call
 * overriding the ledger.
 */

const money = (n: number) =>
  `$${n.toLocaleString("en-SG", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

/** 2026-08-20 -> 20 Aug. The year is dropped: the column is read in context. */
function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${Number(m[3])} ${months[Number(m[2]) - 1] ?? m[2]}`;
}

const OUTCOME: Record<string, string> = {
  "promised-to-pay": "Agreed to pay",
  "will-call-back": "Said they would call back",
  "disputes-amount": "Disagrees with the amount",
  "no-answer": "No answer",
  "wrong-number": "Wrong number",
};

export interface UpdateNote {
  /** What the cell says. Empty where nothing has been logged. */
  text: string;
  /** Whether a promise is outstanding, which is why the wording leads on it. */
  hasPromise: boolean;
  calls: number;
}

/**
 * One line per tenant, keyed the way buildManagerReports looks them up.
 *
 * A promise leads, whenever there is one, because it is the only thing in here
 * that changes what happens next: it holds the tenant off the chase until the
 * date passes. Everything else is context.
 *
 * Attempts are counted rather than listed. "No answer" against a tenant rung
 * once and a tenant rung five times are different situations and the number is
 * the whole of the difference.
 */
export function updateNotes(
  calls: readonly CallLog[],
  promises: readonly PromiseRecord[],
): Map<string, UpdateNote> {
  const byTenant = new Map<string, { calls: CallLog[]; promises: PromiseRecord[] }>();

  const slot = (id: string) => {
    const found = byTenant.get(id) ?? { calls: [], promises: [] };
    byTenant.set(id, found);
    return found;
  };

  for (const c of calls) slot(c.accountId).calls.push(c);
  for (const p of promises) slot(p.accountId).promises.push(p);

  const out = new Map<string, UpdateNote>();

  /* Array.from rather than iterating the Map directly: this project's
     TypeScript target predates it without downlevelIteration, the same reason
     read-report.ts deduplicates by hand. */
  for (const [id, both] of Array.from(byTenant)) {
    const mine = both.calls;
    const theirs = both.promises;
    mine.sort((a, b) => b.at.localeCompare(a.at));
    theirs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const latest = mine[0];
    const promise = theirs[0];
    const parts: string[] = [];

    if (promise) {
      parts.push(`Promised ${money(promise.amount)} by ${shortDate(promise.promisedFor)}`);
      /* Where the promise came out of a call, the call is the promise and
         repeating "Agreed to pay" under it says nothing. Where it came from a
         reply, saying so is the difference between a conversation and an
         email somebody may not have read. */
      if (promise.source === "email") parts.push("from a reply");
    } else if (latest) {
      parts.push(OUTCOME[latest.outcome] ?? latest.outcome);
    }

    if (latest) {
      /* The count matters more than the dates. Five unanswered calls is a
         different tenant from one, and MES's own flow asks for a running
         "call status count" on the 21st. */
      if (mine.length > 1) parts.push(`${mine.length} calls`);
      parts.push(shortDate(latest.at));

      /* The officer's own words last, and only theirs. Anything this column
         says above is derived and can be regenerated; this cannot, so it is
         never dropped to make room. */
      const said = (latest.notes ?? "").trim().replace(/\s+/g, " ");
      if (said) parts.push(said);
    }

    const text = parts.join(". ");
    if (text) out.set(id, { text, hasPromise: Boolean(promise), calls: mine.length });
  }

  return out;
}

/** Just the text, which is what buildManagerReports takes. */
export function updateColumn(
  calls: readonly CallLog[],
  promises: readonly PromiseRecord[],
): Map<string, string> {
  const notes = updateNotes(calls, promises);
  const out = new Map<string, string>();
  for (const [id, n] of Array.from(notes)) out.set(id, n.text);
  return out;
}
