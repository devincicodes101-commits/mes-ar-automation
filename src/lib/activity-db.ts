/**
 * What an officer did, mapped between the browser's shape and the database's.
 *
 * The activity log is the one part of this system that cannot be rebuilt. A
 * report can be uploaded again; a phone call at half past four on a Tuesday
 * cannot. So the mapping is kept here, apart from both the store and the
 * route, and covered by its own cases: a field quietly dropped on the way to
 * Postgres would be a conversation lost, and nothing would raise an error.
 *
 * Two shapes differ where the browser and the schema disagree, and both
 * differences are deliberate:
 *
 *   outcomes    the browser spells them with hyphens and the enum with
 *               underscores. Translated in both directions rather than
 *               changing either, because the enum is referenced by policies
 *               and the hyphens are in every local store already saved.
 *
 *   companyName the browser carries it on each record, the database joins it
 *               from tenants. Sent anyway and ignored on the way in, so a
 *               renamed company reads correctly in history instead of
 *               freezing whatever the name was on the day.
 */

import type { CallLog, CallOutcome, PromiseRecord, SentEmail } from "./store";

/* ------------------------------------------------------------- outcomes */

const TO_DB: Record<CallOutcome, string> = {
  "promised-to-pay": "promised_to_pay",
  "will-call-back": "will_call_back",
  "disputes-amount": "disputes_amount",
  "no-answer": "no_answer",
  "wrong-number": "wrong_number",
};

const FROM_DB: Record<string, CallOutcome> = Object.fromEntries(
  Object.entries(TO_DB).map(([app, db]) => [db, app as CallOutcome]),
) as Record<string, CallOutcome>;

export function outcomeToDb(o: CallOutcome): string {
  const v = TO_DB[o];
  if (!v) throw new Error(`Unknown call outcome: ${o}`);
  return v;
}

/**
 * Reads an outcome back, or says it cannot.
 *
 * Returns null rather than guessing at a default. An outcome the build does
 * not recognise means the enum has grown, and showing such a call as "nobody
 * answered" would be inventing the content of a conversation.
 */
export function outcomeFromDb(v: string): CallOutcome | null {
  return FROM_DB[v] ?? null;
}

/* ------------------------------------------------------------ the rows */

export interface CallRow {
  id: string;
  account_id: string;
  period: string;
  called_at: string;
  reached: string | null;
  outcome: string;
  promised_amount: number | string | null;
  promised_date: string | null;
  next_action_date: string | null;
  aging_bucket: string | null;
  deduction_fail_date: string | null;
  notes: string | null;
  tenants?: { company_name: string } | null;
}

export interface PromiseRow {
  id: string;
  account_id: string;
  amount: number | string;
  promised_for: string;
  source: string;
  created_at: string;
  confirmation_sent_at: string | null;
  tenants?: { company_name: string } | null;
}

export interface EmailRow {
  id: string;
  account_id: string;
  template_id: string | null;
  template_name: string;
  subject: string;
  body: string | null;
  recipients: string[];
  sent_at: string;
  was_simulated: boolean;
  tenants?: { company_name: string } | null;
}

/** numeric(14,2) arrives as a string from PostgREST, and 0 is a real amount. */
const money = (v: number | string | null): number =>
  v === null || v === "" ? 0 : Number(v);

/** The first of the month a call belongs to, which is how periods are stored. */
export function periodFor(at: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(at);
  return m ? `${m[1]}-${m[2]}-01` : at.slice(0, 10);
}

/* --------------------------------------------------------- going out */

export function callToRow(c: CallLog) {
  return {
    id: c.id,
    account_id: c.accountId,
    period: periodFor(c.at),
    called_at: c.at,
    reached: c.reached || null,
    outcome: outcomeToDb(c.outcome),
    promised_amount: c.promisedAmount,
    promised_date: c.promisedDate,
    next_action_date: c.nextActionDate,
    aging_bucket: c.agingBucket || null,
    deduction_fail_date: c.deductionFailDate,
    notes: c.notes || null,
  };
}

export function promiseToRow(p: PromiseRecord) {
  return {
    id: p.id,
    account_id: p.accountId,
    amount: p.amount,
    promised_for: p.promisedFor,
    source: p.source,
    created_at: p.createdAt,
    confirmation_sent_at: p.confirmationSentAt,
  };
}

export function emailToRow(e: SentEmail, wasSimulated: boolean) {
  return {
    id: e.id,
    account_id: e.accountId,
    template_id: e.templateId || null,
    template_name: e.templateName,
    subject: e.subject,
    // Undefined means the send predates the field, which is not the same as a
    // letter with no text. Null carries that through; "" stays "".
    body: e.body === undefined ? null : e.body,
    recipients: e.to,
    sent_at: e.at,
    was_simulated: wasSimulated,
  };
}

/* ---------------------------------------------------------- coming back */

/**
 * Calls as the screens read them.
 *
 * A row whose outcome this build cannot read is left out and counted, rather
 * than shown as something it is not. The caller says how many were dropped so
 * the number on screen can be honest about being short.
 */
export function callsFromRows(rows: readonly CallRow[]): {
  calls: CallLog[];
  unreadable: number;
} {
  const calls: CallLog[] = [];
  let unreadable = 0;

  for (const r of rows) {
    const outcome = outcomeFromDb(r.outcome);
    if (!outcome) {
      unreadable += 1;
      continue;
    }
    calls.push({
      id: r.id,
      accountId: r.account_id,
      companyName: r.tenants?.company_name ?? r.account_id,
      at: r.called_at,
      reached: r.reached ?? "",
      outcome,
      promisedAmount: r.promised_amount === null ? null : money(r.promised_amount),
      promisedDate: r.promised_date,
      nextActionDate: r.next_action_date,
      notes: r.notes ?? "",
      agingBucket: r.aging_bucket ?? "",
      deductionFailDate: r.deduction_fail_date,
    });
  }

  return { calls, unreadable };
}

export function promisesFromRows(rows: readonly PromiseRow[]): PromiseRecord[] {
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    companyName: r.tenants?.company_name ?? r.account_id,
    amount: money(r.amount),
    promisedFor: r.promised_for,
    createdAt: r.created_at,
    source: r.source === "email" ? "email" : "call",
    confirmationSentAt: r.confirmation_sent_at,
  }));
}

export function emailsFromRows(rows: readonly EmailRow[]): SentEmail[] {
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    companyName: r.tenants?.company_name ?? r.account_id,
    templateId: r.template_id ?? "",
    templateName: r.template_name,
    subject: r.subject,
    // Null is "not captured", which the type spells undefined. An empty string
    // stays an empty string, because that one is a fault worth seeing.
    body: r.body === null ? undefined : r.body,
    to: r.recipients ?? [],
    at: r.sent_at,
  }));
}
