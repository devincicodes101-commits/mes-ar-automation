"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_RECIPIENTS, type Recipient } from "./dispatch.ts";
import { LETTER_BODIES } from "./letters.ts";

/**
 * Prototype store.
 *
 * Everything the officer does (logs a call, records a promise, sends a
 * reminder) is kept here and mirrored into the activity log, so the walkthrough
 * shows one action flowing across several screens.
 *
 * It persists to localStorage so a demo survives a refresh. In production this
 * is Supabase, with row level security deciding which rows each role can read.
 */

export interface CallLog {
  id: string;
  accountId: string;
  companyName: string;
  at: string;
  reached: string;
  outcome: CallOutcome;
  promisedAmount: number | null;
  promisedDate: string | null;
  nextActionDate: string | null;
  notes: string;
  /** Pre-filled context captured with the call, per proposal section 5.1. */
  agingBucket: string;
  deductionFailDate: string | null;
}

export type CallOutcome =
  | "promised-to-pay"
  | "disputes-amount"
  | "no-answer"
  | "wrong-number"
  | "will-call-back";

export const CALL_OUTCOMES: { value: CallOutcome; label: string }[] = [
  { value: "promised-to-pay", label: "Agreed to pay" },
  { value: "will-call-back", label: "Said they would call back" },
  { value: "disputes-amount", label: "Disagrees with the amount" },
  { value: "no-answer", label: "Nobody answered" },
  { value: "wrong-number", label: "Wrong number" },
];

export interface PromiseRecord {
  id: string;
  accountId: string;
  companyName: string;
  amount: number;
  promisedFor: string;
  createdAt: string;
  source: "call" | "email";
  /** Section 3: a short confirmation is sent once a promise is recorded. */
  confirmationSentAt: string | null;
}

export interface SentEmail {
  id: string;
  accountId: string;
  companyName: string;
  templateId: string;
  templateName: string;
  subject: string;
  /**
   * The rendered letter, exactly as it went out.
   *
   * Kept because a subject line and a recipient tell you a send happened, not
   * whether it was right. Every merge field, date and amount is decided at
   * send time, so the body is the only place a template fault is visible, and
   * by the time anyone notices, the inputs that produced it have moved on.
   *
   * Optional, and the two falsy cases mean different things:
   *
   *   undefined  the send predates this field. Nothing was captured, and
   *              nothing is wrong.
   *   ""         a letter really did go out with no text in it. That is a
   *              fault worth shouting about.
   *
   * Collapsing them to one empty string, which is what this did first, made
   * every old record accuse the system of sending blank letters.
   */
  body?: string;
  to: string[];
  at: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  subject: string;
}

export interface Template {
  id: string;
  name: string;
  trigger: string;
  /**
   * Day of the month this wording goes out on, where MES's cycle has one.
   * The first reminder is the 7th and the final notice the 21st. Templates
   * sent in response to something, like the promise confirmation, have no
   * day and are never sent automatically.
   */
  triggerDay?: number;
  subject: string;
  body: string;
}

/**
 * Email addresses typed in by the officer for tenants the AR export does not
 * carry one for. Keyed by account id. These sit alongside the imported list
 * rather than replacing it, so a later upload cannot silently wipe them.
 */
export type ManualEmails = Record<string, string[]>;

export interface Settings {
  /**
   * Whether reminders go out without an officer approving each one.
   *
   * On by default, at MES's request. It overrides proposal 4.5, which asks
   * for "a review step before anything goes out", so the screen says which
   * mode it is in rather than leaving it to be discovered.
   *
   * Turning it off returns to the originally agreed process. Both modes are
   * supported and neither is a workaround.
   */
  autoSendReminders: boolean;
  /**
   * Who inside MES a report can be emailed to.
   *
   * MES's Flow tab asks for the late payment report to go to "one or more RMs
   * from drop down", and for any of the six reports to be emailable on
   * demand. Neither is possible without an address, and MES have never sent
   * one for anybody internal: their own screenshots show "To: Ray, Cc: Jamie"
   * with Outlook resolving the rest. So the list is maintained here instead of
   * imported, and starts with the names their documents use and no addresses.
   */
  recipients: Recipient[];
}

export const DEFAULT_SETTINGS: Settings = {
  // MES asked for reminders to go out on their own, confirmed through
  // DeVinci. It overrides the review step in proposal 4.5, so the change is
  // recorded here rather than left as an unexplained default. Anyone turning
  // it off is going back to the originally agreed process, not breaking it.
  autoSendReminders: true,
  recipients: DEFAULT_RECIPIENTS,
};

/**
 * One late fee this system raised.
 *
 * Kept apart from the late fee lines in the uploaded report, which are what
 * MES have billed. A fee lives here from the moment the 16th raises it until
 * somebody at MES enters it into NetSuite, and the two counts must never be
 * added together as though they were the same event.
 */
export interface RaisedFee {
  id: string;
  tenantId: string;
  period: string;
  amount: number;
  raisedAt: string;
}

/**
 * How many fees this system has raised, per tenant.
 *
 * Here rather than in each screen, so the Call List and the collections board
 * cannot arrive at two different counts for the same tenant — which is the
 * shape of disagreement nobody notices until a client asks why one screen
 * calls somebody a repeat defaulter and the other does not.
 */
export function feeCountsByTenant(
  fees: readonly RaisedFee[],
  /**
   * The tenants in the report on screen now.
   *
   * Given, a fee raised against somebody who is no longer in the report is
   * left out: absent from a newer report means they have paid, which is the
   * rule the whole system turns on, and a fee cannot be outstanding against a
   * tenant who owes nothing. Left out, every fee counts, which is the right
   * answer where there is no report to compare against.
   */
  stillOwing?: ReadonlySet<string>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of fees) {
    if (stillOwing && !stillOwing.has(f.tenantId)) continue;
    out.set(f.tenantId, (out.get(f.tenantId) ?? 0) + 1);
  }
  return out;
}

/**
 * Fees raised against tenants who have since gone from the report.
 *
 * MES's rule, from the meeting: a company missing from a later file has paid.
 * The system already applies that everywhere else — a tenant who disappears
 * is settled in full on What Changed, and drops off every screen — but a fee
 * raised before they paid stayed behind, counted, and had nowhere to be seen.
 *
 * Worked out rather than stored, so nothing is deleted. A fee row is the one
 * kind of record here that cannot be rebuilt from any file, and a partial or
 * mistaken export that dropped a tenant would otherwise destroy it for good.
 * If that tenant appears in the next report still owing, the fee is simply
 * counted again.
 */
export function settledFees(
  fees: readonly RaisedFee[],
  stillOwing: ReadonlySet<string>,
): RaisedFee[] {
  return fees.filter((f) => !stillOwing.has(f.tenantId));
}

export interface StoreState {
  calls: CallLog[];
  promises: PromiseRecord[];
  emails: SentEmail[];
  fees: RaisedFee[];
  audit: AuditEntry[];
  templates: Template[];
  manualEmails: ManualEmails;
  settings: Settings;
}

const KEY = "mes-ar-prototype-v1";

/**
 * The wording due to go out today, if any.
 *
 * MES's cycle puts the first reminder on the 7th and the final notice on the
 * 21st. A template with no triggerDay is sent in response to something rather
 * than on a date, so it never fires here.
 */
export function templateDueOn(
  date: Date,
  templates: Template[],
): Template | null {
  const day = date.getDate();
  return templates.find((t) => t.triggerDay === day) ?? null;
}

/**
 * The first two are MES's own letters, transcribed from the Word documents
 * they sent, with their mail merge fields swapped for ours. Wording we had
 * written ourselves stood here until then, which was fine for a demo and not
 * fine for a letter that threatens legal action.
 *
 * Their merge fields were Company_Name and Grand_Total_, which is the whole
 * list: everything else in both letters is fixed text.
 */
export const DEFAULT_TEMPLATES: Template[] = [
  {
    id: "reminder-7th",
    name: "First reminder",
    trigger: "7th of the month",
    triggerDay: 7,
    subject: "Outstanding rental payment, {{company}}",
    // MES's wording, from letters.ts. Kept in one place because it used to be
    // in two, and the two had drifted: this screen was giving six days to pay
    // on the final notice where MES's own sample gives seven.
    body: LETTER_BODIES["first-reminder"],
  },
  {
    id: "final-21st",
    name: "Final notice",
    trigger: "21st of the month",
    triggerDay: 21,
    subject: "Final reminder, outstanding rental payment for {{company}}",
    body: LETTER_BODIES["final-notice"],
  },
  {
    id: "promise-confirmation",
    name: "Promise confirmation",
    trigger: "Straight after a promise is recorded",
    subject: "Thank you, {{company}}",
    body: `Dear {{company}},

Thank you for speaking with us today.

This is to confirm what we agreed: payment of SGD {{promiseAmount}} on account {{code}} by {{promiseDate}}.

If anything about that is not right, please reply to this email and let us know.

Kind regards,
Customer Services Department
MES Group`,
  },
  {
    id: "onefm",
    name: "1FM maintenance charges",
    trigger: "3rd week of the month",
    subject: "Maintenance charges outstanding, {{company}}",
    body: `Dear {{company}},

The balance below relates to maintenance work raised through 1FM at {{property}}.

Amount outstanding: SGD {{amount}}

Please review and let us know if you need the supporting payment notices.

Kind regards,
Customer Services Department
MES Group`,
  },
];

const EMPTY: StoreState = {
  calls: [],
  promises: [],
  emails: [],
  fees: [],
  audit: [],
  templates: DEFAULT_TEMPLATES,
  manualEmails: {},
  settings: DEFAULT_SETTINGS,
};

let state: StoreState = EMPTY;
let hydrated = false;
const listeners = new Set<() => void>();

function read(): StoreState {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<StoreState>;
    return {
      calls: parsed.calls ?? [],
      promises: parsed.promises ?? [],
      // Left undefined on purpose where it was never captured. See SentEmail.
      emails: parsed.emails ?? [],
      /* Never read from local storage in earlier builds, so it is absent for
         everyone who used one. The server fills it on the next load. */
      fees: parsed.fees ?? [],
      audit: parsed.audit ?? [],
      templates: parsed.templates?.length ? parsed.templates : DEFAULT_TEMPLATES,
      manualEmails: parsed.manualEmails ?? {},
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
    };
  } catch {
    return EMPTY;
  }
}

function commit(next: StoreState) {
  state = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* quota or private mode, the demo still works in memory */
    }
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  if (!hydrated) {
    hydrated = true;
    state = read();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): StoreState {
  if (!hydrated && typeof window !== "undefined") {
    hydrated = true;
    state = read();
  }
  return state;
}

function getServerSnapshot(): StoreState {
  return EMPTY;
}

export function useStore(): StoreState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/* ------------------------------------------------- mirroring to Supabase */

/**
 * The activity log is the one thing here that cannot be rebuilt.
 *
 * A report can be uploaded again and every balance comes back. A phone call at
 * half past four on a Tuesday cannot. Local storage held it until now, which
 * meant one cleared cache lost it and the officer at the next desk could not
 * see it at all.
 *
 * So every record is written locally first and then posted. Locally first
 * because the officer is mid conversation and a screen that waits on a network
 * round trip before showing the call they just logged is a screen they will
 * stop trusting. Posted after because local storage is not where this belongs.
 *
 * What matters is the failure. A post that fails must be visible, because the
 * officer's own screen will show the call either way and they would have no
 * reason to doubt it. `unsaved` counts what is in this browser and nowhere
 * else, and Shell shows it. Silence here would be the worst outcome in the
 * system: a complete looking history missing the calls that mattered enough to
 * be made during an outage.
 */

export interface SyncState {
  /** Records written here that the server has not accepted. */
  unsaved: number;
  /** Why the last one failed, for the person who has to do something about it. */
  lastError: string | null;
  /** True while the first load from the server is in flight. */
  loading: boolean;
}

let sync: SyncState = { unsaved: 0, lastError: null, loading: false };
const syncListeners = new Set<() => void>();

/*
 * Which records failed, by id, rather than only how many.
 *
 * The count used to go up and never down. A letter counted as unsaved during
 * an outage stayed counted for the rest of the session even once it had been
 * accepted, so the banner went on saying three records were saved in this
 * browser alone while all three were sitting in the database. A warning that
 * stays on after the thing it warns about has been fixed is one people learn
 * to ignore, which is the one outcome this banner cannot afford.
 *
 * Kept by id so a load from the server can settle it properly: anything the
 * server now has is no longer unsaved, and anything it still does not have
 * genuinely is.
 */
const unsavedIds = new Set<string>();

function noteUnsaved(record: unknown, why: string) {
  const id = (record as { id?: string })?.id;
  if (id) unsavedIds.add(id);
  setSync({ unsaved: unsavedIds.size || sync.unsaved + 1, lastError: why });
}

function setSync(next: Partial<SyncState>) {
  sync = { ...sync, ...next };
  syncListeners.forEach((l) => l());
}

export function useSync(): SyncState {
  return useSyncExternalStore(
    (l) => {
      syncListeners.add(l);
      return () => syncListeners.delete(l);
    },
    () => sync,
    () => ({ unsaved: 0, lastError: null, loading: false }),
  );
}

async function authHeader(): Promise<Record<string, string>> {
  try {
    const { supabase } = await import("./supabase.ts");
    const token = (await supabase?.auth.getSession())?.data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

/**
 * Posts one record, and counts it as unsaved if that does not work.
 *
 * Deliberately not awaited by the callers: the officer's next click must not
 * wait on this. The count is the honesty, not the timing.
 */
function mirror(kind: "call" | "promise" | "email", record: unknown): void {
  if (typeof window === "undefined") return;

  void (async () => {
    try {
      const r = await fetch("/api/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ kind, record }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as
          | { error?: string; hint?: string }
          | null;
        noteUnsaved(
          record,
          [body?.error, body?.hint].filter(Boolean).join(" ") ||
            `The server refused it (${r.status}).`,
        );
        return;
      }
      /* Accepted, so this one is no longer in this browser alone. An earlier
         failure still is, and is still counted. */
      const id = (record as { id?: string })?.id;
      if (id) unsavedIds.delete(id);
      setSync({ unsaved: unsavedIds.size, lastError: unsavedIds.size ? sync.lastError : null });
    } catch {
      noteUnsaved(
        record,
        "This record is saved in this browser only. It could not reach the " +
          "server, so nobody else can see it yet.",
      );
    }
  })();
}

let activityLoaded = false;

/**
 * Loads the shared activity log, and keeps what is here if it cannot.
 *
 * The server's copy replaces this browser's, because the server has everyone's
 * calls and this browser has only its own. Anything posted from here has
 * already been accepted or already been counted as unsaved, so nothing is lost
 * by preferring the fuller history.
 *
 * A failure leaves local storage exactly as it was. An officer who cannot
 * reach the server should still see yesterday's calls.
 */
export async function hydrateActivity(force = false): Promise<void> {
  /*
   * Once per load, unless something has just changed the server's copy.
   *
   * The latch is what stops every screen re-fetching the whole log on mount.
   * It also meant that after a send there was no way to pick up the row the
   * server had just written, so the screen went on showing the count it had
   * before: right until the moment it mattered most.
   */
  if (typeof window === "undefined") return;
  if (activityLoaded && !force) return;
  activityLoaded = true;
  setSync({ loading: true });

  try {
    const r = await fetch("/api/activity", { headers: await authHeader() });
    const body = (await r.json()) as {
      ok?: boolean;
      calls?: CallLog[];
      promises?: PromiseRecord[];
      emails?: SentEmail[];
      fees?: RaisedFee[];
      unreadableCalls?: number;
      error?: string;
      hint?: string;
    };

    if (!r.ok || !body.ok) {
      setSync({
        loading: false,
        lastError:
          [body.error, body.hint].filter(Boolean).join(" ") ||
          "The activity log could not be loaded, so this is what is in this browser.",
      });
      return;
    }

    commit({
      ...state,
      calls: body.calls ?? state.calls,
      promises: body.promises ?? state.promises,
      emails: body.emails ?? state.emails,
      fees: body.fees ?? state.fees,
    });

    /*
     * A load from the server settles what is actually unsaved.
     *
     * Anything counted as unsaved that the server turns out to hold was
     * saved after all — a retry landed, or the first attempt did and the
     * reply was lost. Anything the server still does not hold genuinely is
     * missing, and stays counted.
     */
    const onServer = new Set<string>();
    for (const r of [
      ...(body.calls ?? []),
      ...(body.promises ?? []),
      ...(body.emails ?? []),
    ]) {
      const id = (r as { id?: string })?.id;
      if (id) onServer.add(id);
    }
    for (const id of Array.from(unsavedIds)) {
      if (onServer.has(id)) unsavedIds.delete(id);
    }

    setSync({
      loading: false,
      unsaved: unsavedIds.size,
      lastError:
        body.unreadableCalls
          ? `${body.unreadableCalls} calls could not be read by this version ` +
            "and are not shown. They are still in the database."
          : unsavedIds.size
            ? sync.lastError
            : null,
    });
  } catch {
    setSync({
      loading: false,
      lastError:
        "The activity log could not be loaded, so this is what is in this " +
        "browser only.",
    });
  }
}

/* ------------------------------------------------------------------ actions */

const id = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();

function log(action: string, subject: string, actor = "CSD Officer") {
  return { id: id(), at: now(), actor, action, subject };
}

export function recordCall(
  input: Omit<CallLog, "id" | "at">,
): void {
  const call: CallLog = { ...input, id: id(), at: now() };
  const entries: AuditEntry[] = [
    log("Logged a call", call.companyName),
  ];

  const promises = [...state.promises];
  let made: PromiseRecord | null = null;
  if (call.outcome === "promised-to-pay" && call.promisedDate) {
    made = {
      id: id(),
      accountId: call.accountId,
      companyName: call.companyName,
      amount: call.promisedAmount ?? 0,
      promisedFor: call.promisedDate,
      createdAt: now(),
      source: "call",
      confirmationSentAt: null,
    };
    promises.unshift(made);
    entries.push(log("Recorded a promise to pay", call.companyName));
  }

  commit({
    ...state,
    calls: [call, ...state.calls],
    promises,
    audit: [...entries, ...state.audit],
  });

  // After the commit, so the officer sees their call the instant they log it
  // rather than a moment after the network agrees.
  mirror("call", call);
  if (made) mirror("promise", made);
}

export function recordEmail(input: Omit<SentEmail, "id" | "at">): void {
  recordEmails([input]);
}

/**
 * Sends the whole group at once, which is how MES work: their AR Workflow
 * calls the 7th and the 21st a "Bulk Email" and they run it today as a Word
 * mail merge.
 *
 * One commit rather than one per tenant, so forty reminders cannot end up half
 * recorded if something fails midway. Every tenant still gets their own audit
 * entry, because "who was chased and when" has to be answerable per tenant,
 * and a batch line is added on top so the run itself is visible as one act.
 */
export function recordEmails(
  inputs: Omit<SentEmail, "id" | "at">[],
): number {
  if (inputs.length === 0) return 0;

  const stamp = now();
  const emails: SentEmail[] = inputs.map((input) => ({
    ...input,
    id: id(),
    at: stamp,
  }));

  const perTenant = emails.map((e) =>
    log(`Sent the ${e.templateName.toLowerCase()}`, e.companyName),
  );

  const batch =
    emails.length > 1
      ? [
          log(
            `Sent the ${emails[0].templateName.toLowerCase()} to ${emails.length} tenants`,
            "Bulk send",
          ),
        ]
      : [];

  commit({
    ...state,
    emails: [...emails, ...state.emails],
    audit: [...batch, ...perTenant, ...state.audit],
  });

  // One post per letter rather than one per run. A bulk send is forty separate
  // things that happened to forty tenants, and if half fail the other half are
  // still true.
  for (const e of emails) mirror("email", e);

  return emails.length;
}

/**
 * A promise that did not come from a phone call.
 *
 * Until now every promise was a by-product of the call form, so a tenant who
 * replied to a reminder saying "paying on the 29th" could not be recorded at
 * all. MES's own letters invite exactly that: they ask tenants to email
 * payment confirmation to ar@dormitory.com.sg.
 *
 * The officer reads that reply in her mailbox and types it here. The system
 * does not read her mailbox, which is a separate and much larger piece of
 * work, so the source is recorded to make plain where the commitment came
 * from and who heard it.
 */
export function recordPromise(input: {
  accountId: string;
  companyName: string;
  amount: number;
  promisedFor: string;
  source: PromiseRecord["source"];
  note?: string;
}): void {
  const promise: PromiseRecord = {
    id: id(),
    accountId: input.accountId,
    companyName: input.companyName,
    amount: input.amount,
    promisedFor: input.promisedFor,
    createdAt: now(),
    source: input.source,
    confirmationSentAt: null,
  };
  commit({
    ...state,
    promises: [promise, ...state.promises],
    audit: [
      log(
        `Recorded a promise to pay by ${input.promisedFor}` +
          (input.source === "email" ? ", from an email reply" : ""),
        input.companyName,
      ),
      ...state.audit,
    ],
  });

  mirror("promise", promise);
}

/** Marks a promise as confirmed to the tenant, per proposal section 3. */
export function markPromiseConfirmed(promiseId: string): void {
  const promises = state.promises.map((p) =>
    p.id === promiseId ? { ...p, confirmationSentAt: now() } : p,
  );
  commit({ ...state, promises });

  // The same row with the confirmation time filled in. The route upserts on
  // id, so this updates the promise rather than adding a second one.
  const updated = promises.find((p) => p.id === promiseId);
  if (updated) mirror("promise", updated);
}

/** Records an email address the officer typed in for a tenant. */
export function setManualEmails(
  accountId: string,
  companyName: string,
  emails: string[],
): void {
  const next = { ...state.manualEmails };
  if (emails.length === 0) delete next[accountId];
  else next[accountId] = emails;

  commit({
    ...state,
    manualEmails: next,
    audit: [
      log(
        emails.length === 0 ? "Removed an email address" : "Added an email address",
        companyName,
      ),
      ...state.audit,
    ],
  });
}

export function updateSettings(patch: Partial<Settings>): void {
  commit({
    ...state,
    settings: { ...state.settings, ...patch },
    audit: [
      log(
        patch.autoSendReminders === undefined
          ? "Changed a setting"
          : patch.autoSendReminders
            ? "Turned ON automatic reminder sending"
            : "Turned OFF automatic reminder sending",
        "Settings",
      ),
      ...state.audit,
    ],
  });
}

export function saveTemplate(template: Template): void {
  commit({
    ...state,
    templates: state.templates.map((t) =>
      t.id === template.id ? template : t,
    ),
    audit: [log("Edited a template", template.name), ...state.audit],
  });
}

export function recordExport(name: string): void {
  commit({
    ...state,
    audit: [log("Exported a report", name), ...state.audit],
  });
}

export function resetStore(): void {
  commit({
    ...EMPTY,
    templates: DEFAULT_TEMPLATES,
    manualEmails: {},
    settings: DEFAULT_SETTINGS,
  });
}

/* ------------------------------------------------------------- derivations */

export type PromiseState = "upcoming" | "due-today" | "broken";

export function promiseState(p: PromiseRecord, today = new Date()): PromiseState {
  const due = new Date(p.promisedFor);
  const d0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const d1 = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  if (d1.getTime() > d0.getTime()) return "upcoming";
  if (d1.getTime() === d0.getTime()) return "due-today";
  return "broken";
}

export const PROMISE_STATE_LABEL: Record<PromiseState, string> = {
  upcoming: "Coming up",
  "due-today": "Due today",
  broken: "Date passed, still unpaid",
};
