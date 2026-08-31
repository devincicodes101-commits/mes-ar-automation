"use client";

import { useSyncExternalStore } from "react";

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
   * Off by default, deliberately. Proposal 4.5 requires "a review step before
   * anything goes out", and the requirement deck states it as a highlighted
   * rule: every reminder is drafted, previewed and approved by the CSD officer
   * before anything is sent. Turning this on overrides that, so the screen
   * says so plainly.
   */
  autoSendReminders: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  autoSendReminders: false,
};

export interface StoreState {
  calls: CallLog[];
  promises: PromiseRecord[];
  emails: SentEmail[];
  audit: AuditEntry[];
  templates: Template[];
  manualEmails: ManualEmails;
  settings: Settings;
}

const KEY = "mes-ar-prototype-v1";

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
    subject: "Outstanding rental payment, {{company}}",
    body: `Dear {{company}},

We hope this finds you well.

We refer to the above subject and would like to bring your attention to your outstanding dues.

Rental is payable on the 1st working day of each calendar month via Giro. However, we would like to bring to your attention that we have yet to receive the outstanding rental payment due from you. As of today, {{today}}, the outstanding amount stands at $ {{amount}}, which consists of rental and maintenance charges.

Please take note that if payment is not received by the 15th day of each calendar month, an administrative fee for late payment amounting to $100.00 (before prevailing GST) will be charged.

If you have already processed payment or paid the outstanding rental, kindly ignore this email.

If you have not, kindly assist us with payment as soon as possible.

If you choose to pay by cheque, kindly take note that a cheque admin fee of $50 is chargeable from 1st August 2022. Please fill in the enclosed Direct Debit Application form and send the original form back to us.

You can make the payment via bank transfer or PayNow and kindly send a screenshot of the transaction to ar@dormitory.com.sg for confirmation.

Bank Transfer Detail
DBS Account Number: 011-901192-0
MES & JPD HOUSING PTE LTD

PAYNOW Detail
UEN: 200412284W, MES & JPD HOUSING PTE LTD

Please indicate invoice no. in the remarks.

We seek your kind understanding and co-operation to settle your outstanding dues latest by {{dueBy}}.

Should you have any further clarifications, please contact me soonest possible.

Best Regards,

Jacqueline
Credit Control Officer, Finance Department
DID Tel: 6349 5019
Office No: 6337 2666`,
  },
  {
    id: "final-21st",
    name: "Final notice",
    trigger: "21st of the month",
    subject: "Final reminder, outstanding rental payment for {{company}}",
    body: `Dear {{company}},

We hope this finds you well.

Under the contract we entered, you were to pay rental by the 1st working day of each calendar month via Giro. However, we have yet to receive your outstanding rental payment and maintenance charges of $ {{amount}} as of today, {{today}}. Despite our reminders, we have yet to receive payment.

Please take note that if payment is not received by the 15th day of each calendar month, an administrative fee for late payment amounting to $100.00 (before prevailing GST) will be charged.

Do also take note that employers who fail to pay rent for their foreign workers living in dormitories would be in breach of the Employment of Foreign Manpower (Work Passes) Regulations 2012.

If you have already processed payment or paid the outstanding rental, kindly ignore this email.

If you have not, we strongly urge you to make payment urgently.

You can make the payment via bank transfer or PayNow and kindly send a screenshot of the transaction to ar@dormitory.com.sg for confirmation.

Bank Transfer Detail
DBS Account Number: 011-901192-0
MES & JPD HOUSING PTE LTD

PAYNOW Detail
UEN: 200412284W, MES & JPD HOUSING PTE LTD

Please indicate invoice no. in the remarks.

We seek your kind understanding and co-operation to settle your outstanding dues latest by {{dueBy}}. If you do not make payment within the stipulated time, we shall have no choice but to consider disruption of our services to you and all other available legal options.

Should you have any further clarifications, please contact me soonest possible.

Jacqueline Fong
Credit Control Officer, Finance Department
DID Tel: 6349 5019
Office No: 6337 2666`,
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
      emails: parsed.emails ?? [],
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
  if (call.outcome === "promised-to-pay" && call.promisedDate) {
    promises.unshift({
      id: id(),
      accountId: call.accountId,
      companyName: call.companyName,
      amount: call.promisedAmount ?? 0,
      promisedFor: call.promisedDate,
      createdAt: now(),
      source: "call",
      confirmationSentAt: null,
    });
    entries.push(log("Recorded a promise to pay", call.companyName));
  }

  commit({
    ...state,
    calls: [call, ...state.calls],
    promises,
    audit: [...entries, ...state.audit],
  });
}

export function recordEmail(input: Omit<SentEmail, "id" | "at">): void {
  const email: SentEmail = { ...input, id: id(), at: now() };
  commit({
    ...state,
    emails: [email, ...state.emails],
    audit: [
      log(`Sent the ${email.templateName.toLowerCase()}`, email.companyName),
      ...state.audit,
    ],
  });
}

/** Marks a promise as confirmed to the tenant, per proposal section 3. */
export function markPromiseConfirmed(promiseId: string): void {
  commit({
    ...state,
    promises: state.promises.map((p) =>
      p.id === promiseId ? { ...p, confirmationSentAt: now() } : p,
    ),
  });
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
