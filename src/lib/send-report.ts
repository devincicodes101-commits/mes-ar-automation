"use client";

import { supabase } from "./supabase.ts";

/**
 * Sending a report from a screen, and saying plainly what happened.
 *
 * The companion to send-letters.ts, and it exists for the same reason: the
 * screen had a button that called a function whose name began with "simulate",
 * and the toast said the report had been prepared. Nobody reading that would
 * have guessed the file never left.
 *
 * Returns a title and a detail rather than a boolean, because the three
 * outcomes need three different responses from the person: it went, it was
 * refused by the gate and will keep being refused until something is changed,
 * or the attempt itself failed and trying again is reasonable.
 */

export interface ReportToSend {
  to: string[];
  subject: string;
  body: string;
  filename: string;
  workbook: ArrayBuffer;
  reportName: string;
}

export interface ReportSent {
  sent: boolean;
  title: string;
  detail: string;
}

/**
 * base64 without blowing the stack.
 *
 * btoa takes a string, and String.fromCharCode(...bytes) on a workbook of any
 * size is tens of thousands of arguments in one call, which throws. Chunked
 * for that reason and not for speed.
 */
function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  const CHUNK = 0x8000;
  let out = "";
  for (let i = 0; i < view.length; i += CHUNK) {
    out += String.fromCharCode(...Array.from(view.subarray(i, i + CHUNK)));
  }
  return btoa(out);
}

export async function sendReport(report: ReportToSend): Promise<ReportSent> {
  if (report.to.length === 0) {
    return {
      sent: false,
      title: "Nobody to send it to",
      detail:
        "None of the people selected has an email address. Add one in " +
        "Settings and this will go.",
    };
  }

  let headers: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const token = (await supabase?.auth.getSession())?.data.session?.access_token;
    if (token) headers = { ...headers, Authorization: `Bearer ${token}` };
  } catch {
    /* No session is a 401 from the route, which says what to do about it. */
  }

  let response: Response;
  try {
    response = await fetch("/api/report", {
      method: "POST",
      headers,
      body: JSON.stringify({
        to: report.to,
        subject: report.subject,
        body: report.body,
        filename: report.filename,
        workbook: toBase64(report.workbook),
        reportName: report.reportName,
      }),
    });
  } catch (e) {
    return {
      sent: false,
      title: "The report did not go",
      detail: (e as Error).message,
    };
  }

  const result = (await response.json().catch(() => null)) as {
    ok?: boolean;
    sent?: boolean;
    blocked?: boolean;
    reason?: string;
    error?: string;
    from?: string | null;
    filename?: string | null;
  } | null;

  if (!response.ok || !result?.ok) {
    return {
      sent: false,
      title: "The report did not go",
      detail: result?.error ?? `The server answered ${response.status}.`,
    };
  }

  if (!result.sent) {
    return {
      sent: false,
      /* Blocked and failed are different words on purpose. One of them means
         trying again will do exactly the same thing. */
      title: result.blocked ? "Held back, not sent" : "The report did not go",
      detail: result.reason ?? "No reason was given.",
    };
  }

  return {
    sent: true,
    title: `${report.reportName} sent`,
    detail:
      `${report.to.join(", ")} — ${result.filename ?? report.filename} attached` +
      (result.from ? `, from ${result.from}` : ""),
  };
}
