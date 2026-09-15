import type { Pipeline } from "./pipeline";
import { buildQueue, overdueTotal } from "./data.ts";
import { CAN_SEND_FOR_REAL } from "./outbox.ts";

/**
 * MES's month, as a thing that can be stepped through rather than waited for.
 *
 * Taha opened the 14 September call with the reason this exists: "it's better
 * if we can run a few simulations instead of attaching with the backend,
 * because we have actual emails. The simulations will work perfectly fine for
 * understanding the flow completely, instead of going into the production
 * environment."
 *
 * The days and what happens on each are MES's, copied from the Flow tab of
 * Detailed AR report(Final).xlsx rather than invented here:
 *
 *   15th   billing runs, usually for the following month
 *    1st   GIRO deductions. 14 calendar days credit expires
 *    4th   upload, tag the date for aging, show by dorm then SD/PF/1FM/LP/SD/RM
 *    7th   upload, first reminder as a bulk email, then calls
 *   15th   30 calendar days credit expires
 *   16th   late payment report, anything over 14 days, to the AR team
 *   21st   final notice as a bulk email, then calls
 *
 * Nothing here sends. It cannot: CAN_SEND_FOR_REAL is a constant, not a
 * setting, and every step reports what would happen and stops. That is the
 * whole point of a sandbox whose recipients are real tenants.
 */

export type CycleAction =
  | "upload"
  | "reminder"
  | "calls"
  | "late-fee"
  | "report"
  | "deadline";

export interface CycleStep {
  day: number;
  title: string;
  /** MES's own wording from the Flow tab, where they gave one. */
  fromFlowTab: string | null;
  actions: CycleAction[];
  /** What the system would do, given the data actually loaded. */
  outcome: string[];
  /** Things that would stop it, or that somebody has to know. */
  blockers: string[];
  /** Tenants this step would touch, where that is a meaningful number. */
  affected: number | null;
  value: number | null;
}

const money = (n: number) =>
  `SGD ${n.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Every step of one cycle, against the data that is actually loaded.
 *
 * This reports rather than decides. It reads the same functions the screens
 * read, so if a screen and this disagree, one of them is wrong and it is worth
 * knowing which. It does not write anything, queue anything or mark anything
 * as sent.
 */
export function cycleSteps(p: Pipeline): CycleStep[] {
  const queue = buildQueue(p.accounts);
  const chase = queue.filter((q) => overdueTotal(q.account) > 0);
  const reachable = chase.filter((q) => q.account.hasContact);
  const unreachable = chase.filter((q) => !q.account.hasContact);
  const unreachableValue = unreachable.reduce(
    (s, q) => s + overdueTotal(q.account),
    0,
  );

  const addresses = reachable.reduce((s, q) => s + q.account.emails.length, 0);
  const fees = p.lateFees;

  // Said on every step that would send, because it is the same reason each
  // time and burying it under one step would make the other look ready.
  const sendBlockers = (n: number): string[] => {
    const out: string[] = [];
    if (!CAN_SEND_FOR_REAL)
      out.push(
        "Nothing leaves. The letters are written and recorded, and sending " +
          "needs MES's own mailbox, which we do not have.",
      );
    if (unreachable.length > 0)
      out.push(
        `${unreachable.length} of the ${n + unreachable.length} tenants have ` +
          `no address, holding ${money(unreachableValue)}. They go to Send By ` +
          "Hand instead.",
      );
    return out;
  };

  return [
    {
      day: 1,
      title: "GIRO deductions, and the first deadline passes",
      fromFlowTab: "14 calendar days credit from billing date for payment",
      actions: ["deadline"],
      outcome: [
        "Anything billed 14 days ago and unpaid is now overdue and enters the queue.",
        p.giroCustomers.size > 0
          ? `${p.giroCustomers.size} tenants pay by GIRO and are held back from the late fee.`
          : "No GIRO tenants are identifiable in this upload.",
      ],
      blockers: [],
      affected: chase.length,
      value: chase.reduce((s, q) => s + overdueTotal(q.account), 0),
    },
    {
      day: 4,
      title: "Upload, and the month is rebuilt",
      fromFlowTab:
        'User Uploads AR Report from NS. Tag DATE for Aging Calculation. ' +
        "Show by Dorm followed by SD/PF/1FM/LP/SD/RM",
      actions: ["upload", "report"],
      outcome: [
        `${p.invoices.length} charge lines read into ${p.accounts.length} accounts.`,
        `Grouped into ${p.byProperty.length} dormitories and ${p.revenueTabs.length} charge tabs.`,
        p.asOf
          ? `Everything is keyed off the report's own date, ${p.asOf}, not today's.`
          : "The report carries no date, so the period comes from the upload screen.",
      ],
      blockers: p.problems
        .filter((x) => x.severity === "error")
        .slice(0, 3)
        .map((x) => x.message),
      affected: p.accounts.length,
      value: p.invoices.reduce((s, i) => s + i.openBalance, 0),
    },
    {
      day: 7,
      title: "First reminder, then the calls",
      fromFlowTab:
        "First Reminder - Bulk Email (Email List by Client Name & email " +
        "addresses captured in the system). Call Customer. Repeated calls allowed",
      actions: ["reminder", "calls"],
      outcome: [
        `${reachable.length} tenants would receive MES's first reminder, across ${addresses} addresses.`,
        "A tenant with several addresses gets it at all of them, not the first.",
        `The call list is the same ${chase.length} tenants, worst first, and nobody drops off after one call.`,
      ],
      blockers: sendBlockers(reachable.length),
      affected: reachable.length,
      value: reachable.reduce((s, q) => s + overdueTotal(q.account), 0),
    },
    {
      day: 15,
      title: "The second deadline passes",
      fromFlowTab: "30 calendar days credit from billing date for payment",
      actions: ["deadline"],
      outcome: [
        "Anything billed 30 days ago and still unpaid is now the debt the final notice cites.",
      ],
      blockers: [],
      affected: null,
      value: null,
    },
    {
      day: 16,
      title: "Late payment fees, and the report to the AR team",
      fromFlowTab:
        "Late Payment Report - >14 calendar days credit. Send report to AR " +
        "team (provide User the option to select one or more RMs from drop down)",
      actions: ["late-fee", "report"],
      outcome: [
        `${fees.rows.length} tenants would be charged the $${fees.fee} fee, before GST.`,
        fees.giroExcluded.length > 0
          ? `${fees.giroExcluded.length} are held back because they pay by GIRO and the bank failed, not them.`
          : "No tenant is held back for GIRO in this upload.",
        p.managerReports.length > 0
          ? `${p.managerReports.length} manager reports would go out, one each.`
          : "No manager reports: this export carries no Primary Sales Rep column.",
      ],
      blockers: [
        ...(CAN_SEND_FOR_REAL ? [] : ["Nothing leaves. The reports are built and not sent."]),
        ...(p.managerReports.length === 0
          ? ["Without the sales rep column the managers cannot be told apart."]
          : []),
      ],
      affected: fees.rows.length,
      value: fees.rows.length * fees.fee,
    },
    {
      day: 21,
      title: "Final notice, then the calls again",
      fromFlowTab:
        "Final Reminder - Bulk Email. Call Customer. Calling E-Form Update. " +
        "Repeated calls allowed. Call status count",
      actions: ["reminder", "calls"],
      outcome: [
        `${reachable.length} tenants would receive the final notice.`,
        "It cites the Employment of Foreign Manpower Regulations, so a tenant who has moved out must not receive it.",
        `${p.defaulters.length} tenants have failed more than once and are flagged as repeat defaulters.`,
      ],
      blockers: [
        ...sendBlockers(reachable.length),
        "No file MES have sent says who has moved out, so every tenant is treated as still renting.",
      ],
      affected: reachable.length,
      value: reachable.reduce((s, q) => s + overdueTotal(q.account), 0),
    },
  ];
}

/** Everything the run would touch, for the summary above the steps. */
export function cycleSummary(p: Pipeline) {
  const queue = buildQueue(p.accounts);
  const chase = queue.filter((q) => overdueTotal(q.account) > 0);
  return {
    tenants: p.accounts.length,
    lines: p.invoices.length,
    chasing: chase.length,
    reachable: chase.filter((q) => q.account.hasContact).length,
    emails: chase
      .filter((q) => q.account.hasContact)
      .reduce((s, q) => s + q.account.emails.length, 0),
    fees: p.lateFees.rows.length,
    feeValue: p.lateFees.rows.length * p.lateFees.fee,
    overdue: chase.reduce((s, q) => s + overdueTotal(q.account), 0),
    errors: p.problems.filter((x) => x.severity === "error").length,
    warnings: p.problems.filter((x) => x.severity === "warning").length,
  };
}
