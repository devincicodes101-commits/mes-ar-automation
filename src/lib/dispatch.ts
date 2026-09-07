"use client";

import type { Report } from "./reports.ts";
import { lateFeeEmail, rmEmail, addDays, type InternalEmail } from "./letters.ts";

/**
 * Sending a report to somebody inside MES.
 *
 * Two lines on MES's Flow tab ask for this, and they are the only two
 * requirements on it that are not about tenants:
 *
 *   16th: "Send report to AR team (provide User the option to select one or
 *          more RMs from drop down to send email)"
 *   Other Notes: "User can email any of the Reports (SD/PF/1FM/SD/RM) via
 *          email drop down selection"
 *
 * So: any of the six reports, to one or more chosen people, on demand as well
 * as on the 16th. The covering note is Jacqueline's own wording, transcribed
 * in letters.ts from the two screenshots MES sent.
 *
 * The recipient list is maintained in the app rather than imported. MES have
 * never sent an address for anybody internal — their screenshots show "To:
 * Ray, Cc: Jamie" with the addresses resolved by Outlook — so importing it is
 * not an option, and waiting for it would block a feature that does not need
 * to be blocked. The officer adds them once and edits them thereafter, the
 * same way they can add a tenant's address the contact list is missing.
 */

export type RecipientKind = "ar-team" | "csd" | "rm" | "management";

export interface Recipient {
  id: string;
  name: string;
  kind: RecipientKind;
  /** Null until somebody fills it in. A recipient with no address blocks. */
  email: string | null;
}

export const RECIPIENT_KIND_LABEL: Record<RecipientKind, string> = {
  "ar-team": "AR team",
  csd: "CSD",
  rm: "Relationship manager",
  management: "Management",
};

/**
 * Who exists before anybody configures anything.
 *
 * Names come from MES's own documents: the AR team and CSD are the To and Cc
 * on Jacqueline's late payment fee email, and Harry Tan and Ray Ang are the
 * two managers whose mock-ups they sent. Addresses are deliberately null,
 * because inventing one would mean a screen that says a report was sent to an
 * address nobody at MES has ever confirmed.
 */
export const DEFAULT_RECIPIENTS: Recipient[] = [
  { id: "ar-team", name: "Accounts Receivable", kind: "ar-team", email: null },
  { id: "csd", name: "CSD", kind: "csd", email: null },
  { id: "management", name: "Management", kind: "management", email: null },
  { id: "rm-harry", name: "Harry Tan", kind: "rm", email: null },
  { id: "rm-ray", name: "Ray Ang", kind: "rm", email: null },
];

/* ------------------------------------------------------------- the send */

export type DispatchState = "simulated" | "blocked";

export interface ReportDispatch {
  id: string;
  reportCode: string;
  reportName: string;
  to: Recipient[];
  subject: string;
  body: string;
  /** The workbook that would be attached, named as MES name theirs. */
  attachment: string;
  rows: number;
  state: DispatchState;
  reason: string | null;
  at: string;
}

/**
 * Which covering note goes with which report.
 *
 * The late payment listing has its own, because Jacqueline's asks the AR team
 * to do something specific with it. Everything else takes the manager note,
 * which is a covering line for an attachment and reads correctly for any of
 * the six.
 */
function coveringNote(
  report: Report,
  recipients: Recipient[],
  sentOn: string,
): InternalEmail {
  if (report.code === "LATE-FEE-LISTING") return lateFeeEmail(sentOn);

  const named = recipients.find((r) => r.kind === "rm") ?? recipients[0];
  const note = rmEmail(named?.name ?? "all", sentOn, addDays(sentOn, 7));
  return {
    ...note,
    subject: `${report.name} as of ${sentOn}`,
    attachment: `${report.name.replace(/[^\w ]+/g, "").trim()} - ${sentOn.replace(/-/g, "")}.xlsx`,
  };
}

let counter = 0;

export function simulateReportSend(
  report: Report,
  recipients: Recipient[],
  sentOn: string,
): ReportDispatch {
  counter += 1;
  const note = coveringNote(report, recipients, sentOn);

  const withoutAddress = recipients.filter((r) => !r.email);
  const noRecipients = recipients.length === 0;

  const reason = noRecipients
    ? "Nobody was selected to send this to."
    : withoutAddress.length > 0
      ? `No email address for ${withoutAddress
          .map((r) => r.name)
          .join(", ")}. Add it in Settings and this will go.`
      : null;

  return {
    id: `rpt-${sentOn}-${report.code}-${String(counter).padStart(3, "0")}`,
    reportCode: report.code,
    reportName: report.name,
    to: recipients,
    subject: note.subject,
    body: note.body,
    attachment: note.attachment,
    rows: report.lineCount,
    state: reason ? "blocked" : "simulated",
    reason,
    at: sentOn,
  };
}

/**
 * The whole list, in the order a dropdown should offer it: the six reports
 * MES drew, then the late payment listing that goes out on the 16th.
 */
export function sendableReports(revenueTabs: Report[], lateFeeListing: Report | null): Report[] {
  return lateFeeListing ? [...revenueTabs, lateFeeListing] : [...revenueTabs];
}
