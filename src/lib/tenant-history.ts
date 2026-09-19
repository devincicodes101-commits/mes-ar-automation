/**
 * Everything this system has done to one tenant, in the order it happened.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 *
 * The record was complete and it was scattered. A letter was on Sent Mail, the
 * call that followed it on the Call List, what they promised on Payment
 * Promises, and the $100 on Late Payment Fees — four screens, each sorted by
 * its own thing, none of them answering the question anybody actually asks:
 * what have we done about this company?
 *
 * That question gets asked in two situations and both matter. An officer picks
 * up the phone and needs to know what the tenant has already been told. And a
 * tenant rings up disputing a charge, which is the moment MES need the whole
 * sequence with dates, not four tabs and a good memory.
 *
 * ---------------------------------------------------------------------------
 * One list, not four
 *
 * Merged into a single timeline because the sequence is the point. "Reminder,
 * then a promise, then nothing, then a final notice" is a story. The same four
 * facts sorted separately are not.
 *
 * Newest first, because the useful end of a chase is the recent end.
 */
import type { CallLog, PromiseRecord, RaisedFee, SentEmail } from "./store.ts";

export type HistoryKind = "letter" | "call" | "promise" | "fee";

export interface HistoryEvent {
  id: string;
  kind: HistoryKind;
  /** When it happened, ISO. Everything is sorted on this and nothing else. */
  at: string;
  title: string;
  detail: string;
  /** Money involved, where the event is about an amount. */
  amount: number | null;
  /**
   * True where the event is a thing that left the building — a letter a tenant
   * received, a fee on their account. A note of a phone call is a record of
   * something MES did; a letter is evidence the tenant holds too.
   */
  reachedTheTenant: boolean;
}

const money = (n: number) =>
  `SGD ${n.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const OUTCOME: Record<string, string> = {
  "promised-to-pay": "Promised to pay",
  "will-call-back": "Said they would call back",
  "disputes-amount": "Disputes the amount",
  "no-answer": "No answer",
  "wrong-number": "Wrong number",
};

/**
 * The history for one tenant.
 *
 * Matched on the tenant id throughout. Calls, promises and letters carry it as
 * accountId and fees as tenantId, which is the same value under two names: the
 * browser's records were written before the database had tenants at all, and
 * renaming the field would break every record already in local storage.
 */
export function historyFor(
  tenantId: string,
  source: {
    emails: readonly SentEmail[];
    calls: readonly CallLog[];
    promises: readonly PromiseRecord[];
    fees: readonly RaisedFee[];
  },
): HistoryEvent[] {
  const out: HistoryEvent[] = [];

  for (const e of source.emails) {
    if (e.accountId !== tenantId) continue;
    out.push({
      id: e.id,
      kind: "letter",
      at: e.at,
      title: e.templateName,
      detail: e.subject,
      amount: null,
      reachedTheTenant: true,
    });
  }

  for (const c of source.calls) {
    if (c.accountId !== tenantId) continue;
    const said = OUTCOME[c.outcome] ?? c.outcome;
    out.push({
      id: c.id,
      kind: "call",
      at: c.at,
      title: c.reached === "yes" ? `Spoke to them — ${said}` : `Called — ${said}`,
      detail: c.notes || "No note was left.",
      amount: c.promisedAmount,
      reachedTheTenant: false,
    });
  }

  for (const p of source.promises) {
    if (p.accountId !== tenantId) continue;
    out.push({
      id: p.id,
      kind: "promise",
      at: p.createdAt,
      title: `Promised ${money(p.amount)}`,
      detail: `Due ${p.promisedFor}${p.source === "call" ? ", taken on a call" : ", from a reply"}`,
      amount: p.amount,
      reachedTheTenant: false,
    });
  }

  for (const f of source.fees) {
    if (f.tenantId !== tenantId) continue;
    out.push({
      id: f.id,
      kind: "fee",
      at: f.raisedAt,
      /* The month it is for, not the day it was raised. A fee raised on the
         16th belongs to that month's cycle, and that is how a tenant will
         refer to it. */
      title: `Late payment fee, ${f.period.slice(0, 7)}`,
      detail: `${money(f.amount)} raised under MES's 14-day rule`,
      amount: f.amount,
      reachedTheTenant: true,
    });
  }

  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** A one-line summary of the chase so far, for the top of the page. */
export function summariseHistory(events: readonly HistoryEvent[]): string {
  if (events.length === 0) return "Nothing has been done about this tenant yet.";

  const n = (k: HistoryKind) => events.filter((e) => e.kind === k).length;
  const bits: string[] = [];
  const say = (count: number, one: string, many: string) =>
    count > 0 ? bits.push(`${count} ${count === 1 ? one : many}`) : undefined;

  say(n("letter"), "letter", "letters");
  say(n("call"), "call", "calls");
  say(n("promise"), "promise", "promises");
  say(n("fee"), "late fee", "late fees");

  const last = events[0]!;
  return `${bits.join(" · ")}. Most recently: ${last.title.toLowerCase()}.`;
}
