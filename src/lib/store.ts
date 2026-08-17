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

export interface StoreState {
  calls: CallLog[];
  promises: PromiseRecord[];
  emails: SentEmail[];
  audit: AuditEntry[];
  templates: Template[];
}

const KEY = "mes-ar-prototype-v1";

export const DEFAULT_TEMPLATES: Template[] = [
  {
    id: "reminder-7th",
    name: "First reminder",
    trigger: "7th of the month",
    subject: "Outstanding balance for {{company}}",
    body: `Dear {{company}},

Our records show an outstanding balance of SGD {{amount}} on your account {{code}} at {{property}}.

Of this, SGD {{overdue}} is now more than 30 days past due.

We would be grateful if you could arrange payment, or reply to this email if any part of the balance is in question.

Kind regards,
Customer Services Department
MES Group`,
  },
  {
    id: "final-21st",
    name: "Final notice",
    trigger: "21st of the month",
    subject: "Final notice, account {{code}}",
    body: `Dear {{company}},

Despite our earlier reminder, an amount of SGD {{amount}} remains outstanding on account {{code}} at {{property}}.

This is a final notice before a late payment administration fee is applied and the account is placed on credit hold.

Please arrange payment, or contact us today to discuss.

Kind regards,
Customer Services Department
MES Group`,
  },
  {
    id: "giro-setup",
    name: "GIRO setup request",
    trigger: "When no mandate exists",
    subject: "Setting up GIRO for {{company}}",
    body: `Dear {{company}},

We were unable to collect this month's charges because there is no GIRO arrangement in place for account {{code}}.

Setting up GIRO means future charges are collected automatically and avoids late payment fees. The form is attached.

Kind regards,
Customer Services Department
MES Group`,
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
  commit({ ...EMPTY, templates: DEFAULT_TEMPLATES });
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
