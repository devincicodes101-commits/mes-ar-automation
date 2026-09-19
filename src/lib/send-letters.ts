/**
 * Sending letters from a screen, rather than writing down that they were sent.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists
 *
 * Reminder Emails recorded a send and never contacted a mail server. It called
 * recordEmails(), which writes "Sent the first reminder" into the store, logs
 * it, and counts it under "Sent so far". Every signal on the screen said the
 * letters had gone, and every one of those signals was the browser describing
 * its own behaviour. Nothing reached a tenant, and the Sent folder of the
 * connected mailbox stayed empty, which is the only place the truth showed.
 *
 * The connector itself was finished and tested the whole time. /api/send was
 * reachable from exactly one place, the test button in Settings. The screen
 * that the entire system exists to drive was the one screen not wired to it.
 *
 * So this is the only way a screen may send. It goes to the server, waits for
 * Google to accept each letter, and reports what actually happened. A letter
 * that did not leave is never written down as one that did.
 *
 * ---------------------------------------------------------------------------
 * The server records it, not the browser
 *
 * The route writes to emails_sent itself, because it is the only party that
 * knows whether the letter left. The browser then re-reads the log rather than
 * appending its own copy: two writers would double every row, and the one the
 * browser wrote would be the optimistic one.
 */
import type { SentEmail } from "./store.ts";

export interface Outgoing {
  tenantId: string;
  companyName: string;
  to: string[];
  subject: string;
  body: string;
  templateId?: string;
  templateName?: string;
}

export interface SendReport {
  /** True when the request itself was answered, whatever the letters did. */
  ok: boolean;
  sent: number;
  blocked: number;
  failed: number;
  /** Why nothing went, when nothing went. */
  error: string | null;
  /** One line per letter, for a screen that wants to name the tenant. */
  results: {
    tenantId: string;
    companyName: string;
    sent: boolean;
    blocked?: boolean;
    reason?: string;
  }[];
}

/** The Supabase access token, the same way the other calls get it. */
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
 * Sends, then says what happened.
 *
 * Never throws. A screen that cannot reach the server has to tell somebody
 * that nothing went out, and an exception thrown into a click handler is how
 * that message gets lost.
 */
export async function sendLetters(letters: Outgoing[]): Promise<SendReport> {
  const none: SendReport = { ok: false, sent: 0, blocked: 0, failed: 0, error: null, results: [] };
  if (letters.length === 0) return { ...none, ok: true };

  try {
    const r = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeader()) },
      body: JSON.stringify({ letters }),
    });

    const body = (await r.json().catch(() => null)) as
      | (SendReport & { ok?: boolean; error?: string })
      | null;

    if (!r.ok || !body?.ok) {
      return {
        ...none,
        failed: letters.length,
        error: body?.error ?? `The server answered ${r.status}.`,
      };
    }

    return {
      ok: true,
      sent: body.sent ?? 0,
      blocked: body.blocked ?? 0,
      failed: body.failed ?? 0,
      error: null,
      results: body.results ?? [],
    };
  } catch (e) {
    return { ...none, failed: letters.length, error: (e as Error).message };
  }
}

/**
 * What to put on screen afterwards.
 *
 * Written here rather than in each caller so that the three places that send
 * cannot describe the same outcome three different ways. "Sent 4" and "sent 4,
 * 2 refused" need to be distinguishable at a glance on the morning of the 7th.
 */
export function describe(report: SendReport, what: string): { title: string; detail: string } {
  if (report.error) {
    return {
      title: `Nothing was sent`,
      detail: `${report.error} No letter left, and nothing has been recorded as sent.`,
    };
  }

  const stopped = report.blocked + report.failed;
  if (report.sent === 0) {
    const why = report.results.find((x) => x.reason)?.reason;
    return {
      title: "Nothing was sent",
      detail: why ?? `All ${stopped} were refused before leaving.`,
    };
  }

  if (stopped === 0) {
    return {
      title: `${what} sent to ${report.sent} ${report.sent === 1 ? "tenant" : "tenants"}`,
      detail: "Each one was accepted by the mail server.",
    };
  }

  const first = report.results.find((x) => !x.sent);
  return {
    title: `${report.sent} sent, ${stopped} not`,
    detail: first
      ? `${first.companyName}: ${first.reason ?? "refused"}. The rest are on Sent Mail.`
      : "The ones that did not go are listed on Sent Mail.",
  };
}

/** Which tenants actually received it, for a screen crossing them off. */
export function delivered(report: SendReport): Set<string> {
  const out = new Set<string>();
  for (const r of report.results) if (r.sent) out.add(r.tenantId);
  return out;
}

export type { SentEmail };
