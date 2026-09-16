"use client";

import * as XLSX from "xlsx";
import type { Account } from "./types";
import {
  type ParseProblem,
  type ParsedAgingDetail,
  isAgingDetail,
  parseAgingDetail,
} from "./aging-detail.ts";
import { parseContacts, type ParsedContacts } from "./parser.ts";
import {
  type LateFeeListing,
  type ManagerReport,
  type RecurringDefaulter,
  type Report,
  REVENUE_TABS,
  agingByProperty,
  buildLateFeeListing,
  buildManagerReports,
  depositsFromLedger,
  buildRevenueTab,
  giroEnrolled,
  recurringDefaulters,
  type AgingByProperty,
} from "./reports.ts";

/**
 * One upload, start to finish.
 *
 * MES's Flow tab describes a single routine that runs on every import,
 * whatever day it happens on:
 *
 *   "Anytime an AR Report is imported, do the followings:-
 *      Tag DATE for Aging Calculation
 *      Insert Column F and apply formula to calculate Aging
 *      Show by Dorm followed by SD/PF/1FM/LP/SD/RM"
 *
 * That is what this does, in that order. There is deliberately no branch on
 * "is it the 4th or the 7th": the calendar decides which reminder is offered,
 * never how the figures are worked out. Re-uploading the same file on a
 * different day produces identical numbers, because every one of them is
 * keyed off the report's own date rather than today's.
 */

export interface Pipeline {
  asOf: string | null;
  entity: string | null;
  accounts: Account[];
  invoices: ParsedAgingDetail["invoices"];
  byProperty: AgingByProperty[];
  /** SD, PF, 1FM, LP, Stamp Duty — the five per-charge tabs. */
  revenueTabs: Report[];
  /** One per relationship manager. Empty when the export omits the column. */
  managerReports: ManagerReport[];
  lateFees: LateFeeListing;
  defaulters: RecurringDefaulter[];
  giroCustomers: Set<string>;
  contactCoverage: {
    total: number;
    withEmail: number;
    withoutEmail: number;
    addresses: number;
  };
  problems: ParseProblem[];
}

export function readWorkbook(bytes: ArrayBuffer | Uint8Array): XLSX.WorkBook {
  return XLSX.read(bytes, { cellDates: true });
}

/**
 * Attaches the contact list to the accounts.
 *
 * Joined on customer code, never on company name. MES's two files spell the
 * same company differently often enough that names lose matches, and a lost
 * match here means a tenant silently drops off the reminder run.
 *
 * The contact list is also the only place Live/Terminated appears now, since
 * the September AR export dropped the Status column, so status comes across
 * with the addresses.
 */
export function linkContacts(
  accounts: Account[],
  contacts: ParsedContacts | null,
): Account[] {
  if (!contacts) return accounts;
  const byCode = new Map(
    contacts.contacts.map((c) => [c.customerCode.toUpperCase(), c.emails]),
  );
  for (const a of accounts) {
    const found = byCode.get(a.customerCode.toUpperCase());
    if (!found || found.length === 0) continue;
    a.emails = Array.from(new Set([...a.emails, ...found]));
    a.hasContact = true;
  }
  return accounts;
}

export function runPipeline(
  agingWorkbook: XLSX.WorkBook,
  contactWorkbook: XLSX.WorkBook | null = null,
): Pipeline {
  const parsed = parseAgingDetail(agingWorkbook);
  const contacts = contactWorkbook ? parseContacts(contactWorkbook) : null;

  return buildPipeline(
    linkContacts(parsed.accounts, contacts),
    parsed.invoices,
    parsed.asOf,
    parsed.entity,
    [...parsed.problems, ...(contacts?.problems ?? [])],
  );
}

/**
 * Everything after parsing, from accounts and invoice lines.
 *
 * Split out so the Dry Run can run a month against the file the officer has
 * already uploaded rather than asking for it a second time. Somebody signing
 * in as Management to look at the cycle does not have the spreadsheet, and
 * making them find it was the wrong shape: it is the same data either way.
 */
export function buildPipeline(
  accounts: Account[],
  invoices: ParsedAgingDetail["invoices"],
  asOf: string | null,
  entity: string | null,
  parseProblems: ParseProblem[] = [],
): Pipeline {
  const revenueTabs = REVENUE_TABS.map((spec) =>
    buildRevenueTab(spec, invoices, asOf, entity),
  );

  // The deposit per tenant, out of the AR report's own Security Deposit
  // lines. Raman's instruction on 14 September was to take it from this
  // source rather than from the dormitory tabs, which do not carry it.
  const depositsHeld = depositsFromLedger(invoices);

  const managerReports = buildManagerReports(
    accounts,
    asOf,
    entity,
    new Map(),
    depositsHeld,
  );

  const problems: ParseProblem[] = [...parseProblems];

  // The manager report is one of the six MES asked for and it cannot be
  // built from this export, so the pipeline says so rather than returning an
  // empty list that reads like "no managers this month".
  if (managerReports.length === 0) {
    problems.push({
      sheet: "-",
      row: null,
      severity: "warning",
      message:
        "No manager report: this export has no Primary Sales Rep column, so " +
        "there is nothing to group clients by. It is present on MES's " +
        "Finance AR Download tab but not on the Custom A/R Aging Detail. One " +
        "export carrying both that column and Categories would produce it.",
    });
  }

  const withEmail = accounts.filter((a) => a.emails.length > 0);

  return {
    asOf,
    entity,
    accounts,
    invoices,
    byProperty: agingByProperty(accounts),
    revenueTabs,
    managerReports,
    lateFees: buildLateFeeListing(accounts, invoices, asOf, entity),
    defaulters: recurringDefaulters(invoices, accounts),
    giroCustomers: giroEnrolled(invoices),
    contactCoverage: {
      total: accounts.length,
      withEmail: withEmail.length,
      withoutEmail: accounts.length - withEmail.length,
      addresses: new Set(withEmail.flatMap((a) => a.emails)).size,
    },
    problems,
  };
}

export { isAgingDetail };
