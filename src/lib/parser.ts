"use client";

import * as XLSX from "xlsx";
import type { Account, Invoice, PropertyCode } from "./types";
import { bucketLabelForAge } from "./data.ts";
import { emailAddresses, looksLikeUnreadableContact } from "./emails.ts";

// The classification rules live on their own so the build can check them
// against every description MES has ever sent: see scripts/test-revenue.mts.
// Re-exported because parser.ts has always been where callers found it.
import { isOneFm, revenueType } from "./revenue-rules.ts";

export { revenueType };

/**
 * Reads the two workbooks MES exports from NetSuite.
 *
 * The library part of this is trivial. The work is the shape of the files,
 * every quirk of which is handled explicitly below and named in a comment, so
 * that when next month's export differs somebody can see what was assumed.
 *
 * Guiding rule: fail loudly. A row we cannot read becomes a visible problem,
 * never a silent zero. Wrong figures that look fine are worse than an error.
 */

/* ------------------------------------------------------------------ types */

export interface ParseProblem {
  sheet: string;
  row: number | null;
  message: string;
  severity: "error" | "warning";
}

export interface ParsedSummary {
  kind: "ar-summary";
  asOf: string | null;
  accounts: Account[];
  /** Tab names the workbook actually contained, in file order. */
  sheets: string[];
  problems: ParseProblem[];
}

export interface ParsedDetail {
  kind: "ar-detail";
  asOf: string | null;
  /** Tab names the workbook actually contained, in file order. */
  sheets: string[];
  invoices: Omit<Invoice, "id">[];
  contacts: { companyName: string; emails: string[] }[];
  industries: { companyName: string; industry: string; entity: string; property: string }[];
  rmAssignments: { companyName: string; rm: string }[];
  managers: { key: string; name: string }[];
  problems: ParseProblem[];
}

/**
 * MES's client contact list. A separate workbook from either AR report, with
 * one tab per dormitory listing who rents there and a combined tab carrying
 * the email addresses.
 */
export interface ParsedContacts {
  kind: "contact-list";
  asOf: string | null;
  sheets: string[];
  contacts: { customerCode: string; companyName: string; emails: string[] }[];
  /** On a dormitory tab but absent from the combined list, so uncontactable. */
  missing: { customerCode: string; companyName: string; property: string }[];
  problems: ParseProblem[];
}

export type ParseResult =
  | ParsedSummary
  | ParsedDetail
  | ParsedContacts
  | { kind: "unreadable"; problems: ParseProblem[] };

/* -------------------------------------------------------------- utilities */

const PROPERTY_NAMES: Record<string, string> = {
  JPD1: "Jurong Penjuru Dormitory 1",
  JPD2: "Jurong Penjuru Dormitory 2",
  BSD: "Blue Stars Dormitory",
  LEO: "The Leo",
};

/** Tab names in the sample carry stray trailing spaces, eg "Industry ". */
const clean = (s: unknown) => String(s ?? "").trim();

const norm = (s: unknown) =>
  clean(s).replace(/\s+/g, " ").replace(/\.$/, "").toUpperCase();

/**
 * Excel numbers arrive as numbers, but blank cells, dashes and stray text all
 * turn up too. Anything unreadable returns null so the caller can raise a
 * problem instead of silently treating it as zero.
 */
function money(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = clean(v).replace(/[,\s]/g, "");
  if (s === "" || s === "-" || s === "–") return 0;
  // Accounting style negatives: (123.45)
  const paren = /^\((.*)\)$/.exec(s);
  const n = Number(paren ? `-${paren[1]}` : s);
  return Number.isFinite(n) ? n : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A date in a spreadsheet is a calendar date, not an instant in time. Reading
 * it through toISOString() converts local midnight to UTC and, anywhere east
 * of Greenwich, lands on the previous day. Singapore is UTC+8, so "25 May"
 * became "24 May" and every due date shifted with it, which would quietly
 * move invoices between aging buckets.
 *
 * The calendar fields are therefore read directly and never converted.
 */
function excelDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;

  if (v instanceof Date) {
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }

  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${pad(d.m)}-${pad(d.d)}`;
  }

  const parsed = new Date(clean(v));
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}

/**
 * Adds a number of days to a calendar date, staying in calendar terms for the
 * same reason excelDate does. Constructed at local noon so that a daylight
 * saving shift, which Singapore does not observe but a developer's machine
 * might, cannot round the result onto the neighbouring day.
 */
function addDays(iso: string, days: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Splits "DORM-1584 CROISSANT PTE. LTD." into its two halves. */
function splitCustomer(cell: unknown): { code: string; name: string } | null {
  const m = /^(DORM-\d+)\s+(.+)$/i.exec(clean(cell));
  if (!m) return null;
  return { code: m[1].toUpperCase(), name: clean(m[2]).replace(/\.$/, "") };
}

function rowsOf(wb: XLSX.WorkBook, sheetName: string): unknown[][] {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: true,
    blankrows: true,
    defval: null,
  }) as unknown[][];
}

/**
 * Column positions by header name, so a moved or inserted column does not
 * silently shift every field after it.
 *
 * MES's newer export added "End User: Industry Type" at position four and
 * "Primary Sales Rep" at the end. Reading by fixed offset, that pushed every
 * column along by one: the open balance became the aging label and the
 * description became a date. Nothing errored. The rows were simply wrong.
 */
function columnsOf(headerRow: unknown[]): Map<string, number> {
  const m = new Map<string, number>();
  headerRow.forEach((cell, i) => {
    const name = norm(cell);
    if (name !== "" && !m.has(name)) m.set(name, i);
  });
  return m;
}

/**
 * The index of the first header that exists, or a fallback position.
 *
 * The fallback keeps the older export working: it has no "Aging" column and
 * spells some headers differently, and both files have to be readable.
 */
function col(
  cols: Map<string, number>,
  names: string[],
  fallback: number,
): number {
  for (const n of names) {
    const at = cols.get(norm(n));
    if (at !== undefined) return at;
  }
  return fallback;
}

/** Finds the header row rather than assuming it sits at a fixed offset. */
function findHeaderRow(rows: unknown[][], firstHeading: string): number {
  for (let i = 0; i < Math.min(rows.length, 25); i += 1) {
    if (norm(rows[i]?.[0]) === norm(firstHeading)) return i;
  }
  return -1;
}

/* --------------------------------------------------------- classification */

export function detectKind(wb: XLSX.WorkBook): ParseResult["kind"] {
  const names = wb.SheetNames.map((n) => norm(n));
  if (names.some((n) => n.startsWith("DETAILED FULL REPORT"))) return "ar-detail";

  // The contact list is checked before the summary, and has to be. Its tabs
  // are also named JPD1, JPD2 and BSD, so on tab names alone it looks exactly
  // like a balances export and would be parsed as one, producing a list of
  // tenants who all owe nothing. What separates them is an Email Address
  // column, which no balances export carries.
  if (hasEmailColumn(wb)) return "contact-list";

  if (names.some((n) => Object.keys(PROPERTY_NAMES).includes(n)))
    return "ar-summary";

  // "Custom A/R Aging Detail - With Description", the fourth shape MES have
  // sent. One tab, a name we have never seen, and the header on row seven.
  // Nothing in the tab name identifies it, so the header row does: a Customer
  // column with Document Number beside it is invoice detail whatever the tab
  // is called. Checked last so it can never shadow the three known shapes.
  if (hasInvoiceDetail(wb)) return "ar-detail";

  return "unreadable";
}

/**
 * A tab whose header row starts with Customer and carries a document number.
 * Deliberately not tied to a tab name: MES have renamed this export four
 * times and the name has never once been the thing that identified it.
 */
function hasInvoiceDetail(wb: XLSX.WorkBook): boolean {
  return wb.SheetNames.some((sheetName) => {
    const rows = rowsOf(wb, sheetName);
    const at = findHeaderRow(rows, "Customer");
    if (at === -1) return false;
    return (rows[at] ?? []).some((c) => norm(c) === "DOCUMENT NUMBER");
  });
}

function hasEmailColumn(wb: XLSX.WorkBook): boolean {
  for (const sheetName of wb.SheetNames) {
    const rows = rowsOf(wb, sheetName);
    for (let i = 0; i < Math.min(rows.length, 25); i += 1) {
      if ((rows[i] ?? []).some((c) => norm(c) === "EMAIL ADDRESS")) return true;
    }
  }
  return false;
}

/* ------------------------------------------------- the per property summary */

/**
 * AR Report.xlsx. One tab per dormitory. Each tab has title rows, then a
 * header, then Live tenants, then a subtotal, then a second header, then
 * Terminated tenants, then another subtotal.
 */
export function parseSummary(wb: XLSX.WorkBook): ParsedSummary {
  const problems: ParseProblem[] = [];
  const accounts: Account[] = [];
  const seen = new Set<string>();
  let asOf: string | null = null;

  for (const sheetName of wb.SheetNames) {
    const code = norm(sheetName);
    if (!Object.keys(PROPERTY_NAMES).includes(code)) {
      problems.push({
        sheet: sheetName,
        row: null,
        severity: "warning",
        message: `Tab "${sheetName}" is not one of the four dormitories, skipped.`,
      });
      continue;
    }

    const rows = rowsOf(wb, sheetName);

    // "As of 25 May 2026" sits in the first few rows.
    for (let i = 0; i < Math.min(rows.length, 8); i += 1) {
      const m = /^as of\s+(.+)$/i.exec(clean(rows[i]?.[0]));
      if (m && !asOf) asOf = excelDate(m[1]) ?? clean(m[1]);
    }

    const headerAt = findHeaderRow(rows, "Company Name");
    if (headerAt === -1) {
      problems.push({
        sheet: sheetName,
        row: null,
        severity: "error",
        message: `Could not find the "Company Name" header on tab "${sheetName}".`,
      });
      continue;
    }

    // Status is carried on each tenant row in this export. If it is ever
    // dropped we fall back to whichever block we are in.
    let block: "Live" | "Terminated" = "Live";

    for (let i = headerAt + 1; i < rows.length; i += 1) {
      const row = rows[i] ?? [];
      const first = clean(row[0]);

      // The second header row starts the Terminated block.
      if (norm(first) === "COMPANY NAME") {
        block = "Terminated";
        continue;
      }
      if (first === "") continue; // subtotal rows have no company name

      const parts = splitCustomer(first);
      if (!parts) {
        problems.push({
          sheet: sheetName,
          row: i + 1,
          severity: "warning",
          message: `Skipped "${first.slice(0, 40)}": not in the form "DORM-123 COMPANY NAME".`,
        });
        continue;
      }

      const statusCell = norm(row[1]);
      const status: Account["status"] =
        statusCell.startsWith("TERM") || (statusCell === "" && block === "Terminated")
          ? "Terminated"
          : "Live";

      const values = [row[2], row[3], row[4], row[5], row[6], row[7]].map(money);
      const badAt = values.findIndex((v) => v === null);
      if (badAt !== -1) {
        problems.push({
          sheet: sheetName,
          row: i + 1,
          severity: "error",
          message: `${parts.name}: could not read the amount in column ${
            "CDEFGH"[badAt]
          }. Row skipped rather than imported as zero.`,
        });
        continue;
      }

      const [current, d30, d60, d90, d90plus, total] = values as number[];
      const id = `${parts.code}-${code}`.toLowerCase();

      if (seen.has(id)) {
        problems.push({
          sheet: sheetName,
          row: i + 1,
          severity: "warning",
          message: `${parts.name} appears twice for ${code}. Only the first was kept.`,
        });
        continue;
      }
      seen.add(id);

      // A tenant is an account per property, so the same company at two
      // dormitories produces two rows on purpose.
      accounts.push({
        id,
        customerCode: parts.code,
        companyName: parts.name,
        property: code as PropertyCode,
        propertyName: PROPERTY_NAMES[code],
        status,
        buckets: { current, d30, d60, d90, d90plus },
        total,
        legacyNote: clean(row[8]) || null,
        emails: [],
        hasContact: false,
        industry: null,
        entity: null,
        invoiceCount: 0,
        isOneFm: false,
        revenueTypes: [],
        lateFeeCount: 0,
      });

      // The columns should add up to the stated total. If they do not, the
      // export is inconsistent and somebody needs to look at it.
      const sum = current + d30 + d60 + d90 + d90plus;
      if (Math.abs(sum - total) > 0.02) {
        problems.push({
          sheet: sheetName,
          row: i + 1,
          severity: "warning",
          message: `${parts.name}: columns add to ${sum.toFixed(2)} but the total says ${total.toFixed(2)}.`,
        });
      }
    }
  }

  if (accounts.length === 0) {
    problems.push({
      sheet: "-",
      row: null,
      severity: "error",
      message: "No tenant rows were found in this workbook.",
    });
  }

  return {
    kind: "ar-summary",
    asOf,
    accounts,
    sheets: wb.SheetNames.map(clean),
    problems,
  };
}

/* -------------------------------------------------------- the detail report */

/**
 * AR reports-Final.xlsx. The main tab interleaves three kinds of row: a
 * customer heading, that customer's invoices, then a "Total - CUSTOMER" line.
 * Only the middle kind is an invoice.
 */
export function parseDetail(wb: XLSX.WorkBook): ParsedDetail {
  const problems: ParseProblem[] = [];
  const invoices: Omit<Invoice, "id">[] = [];
  const contacts: ParsedDetail["contacts"] = [];
  const industries: ParsedDetail["industries"] = [];
  const rmAssignments: ParsedDetail["rmAssignments"] = [];

  // Manager and trade picked up off the invoice lines of the newer export.
  // Keyed by normalised company name, which is all the detail sheet carries.
  const lineReps = new Map<string, Set<string>>();
  const lineIndustries = new Map<string, string>();
  const managers: ParsedDetail["managers"] = [];
  let asOf: string | null = null;

  const sheet = (want: string) =>
    wb.SheetNames.find((n) => norm(n) === norm(want)) ?? null;

  /* ------------------------------------------------ Detailed Full Report */
  // MES have renamed this tab twice: "Detailed Full Report", then "Sheet1",
  // then "Finance AR Download". The name is not the thing that identifies it,
  // the Customer header row is, so any of them is accepted and an unfamiliar
  // name is tried rather than refused.
  const mainName =
    sheet("Detailed Full Report") ??
    sheet("Finance AR Download") ??
    sheet("Sheet1") ??
    wb.SheetNames.find((n) => findHeaderRow(rowsOf(wb, n), "Customer") !== -1);

  if (!mainName) {
    problems.push({
      sheet: "-",
      row: null,
      severity: "error",
      message:
        "No tab in this workbook has a Customer header row, so there is no " +
        "invoice detail to read.",
    });
  } else {
    const rows = rowsOf(wb, mainName);

    // The date printed in the title, which is a line of text somebody typed.
    // It is not necessarily the date the figures were calculated on: see the
    // reconciliation against the Age column below.
    let titleAsOf: string | null = null;
    for (let i = 0; i < Math.min(rows.length, 8); i += 1) {
      const m = /^as of\s+(.+)$/i.exec(clean(rows[i]?.[0]));
      if (m && !titleAsOf) titleAsOf = excelDate(m[1]) ?? clean(m[1]);
    }
    // Recovered from the data instead: age is days past the due date, so the
    // due date plus the age is the day the export was actually run.
    let dataAsOf: string | null = null;

    const headerAt = findHeaderRow(rows, "Customer");
    if (headerAt === -1) {
      problems.push({
        sheet: mainName,
        row: null,
        severity: "error",
        message: 'Could not find the "Customer" header row.',
      });
    } else {
      // Read by header name, not by position. MES's newer export inserted a
      // column at position four and appended another at the end, which by
      // offset alone turned the open balance into an aging label and the
      // description into a date, with no error anywhere. The fallbacks are the
      // older export's positions, so both files stay readable.
      const cols = columnsOf(rows[headerAt] ?? []);
      const COL = {
        txType: col(cols, ["Transaction Type"], 1),
        company: col(cols, ["Company Name"], 2),
        date: col(cols, ["Date"], 3),
        description: col(cols, ["Description"], 4),
        document: col(cols, ["Document Number"], 5),
        contract: col(cols, ["Linked Contract"], 6),
        dueDate: col(cols, ["Due Date"], 9),
        age: col(cols, ["Age"], 10),
        // No positional fallback. The aging detail export has no bucket column
        // at all, and position 11 is its Age, so a fallback here filed a raw
        // day count as the bucket on every row and disagreed with itself 3,118
        // times. Absent is absent, and the bucket is worked out from the age.
        bucket: col(cols, ["Aging", "Bucket"], -1),
        balance: col(cols, ["Open Balance"], 12),
        rep: col(cols, ["Primary Sales Rep"], -1),
        industry: col(cols, ["End User: Industry Type"], -1),
      };
      const at = (row: unknown[], i: number) => (i < 0 ? "" : row[i]);

      for (let i = headerAt + 1; i < rows.length; i += 1) {
        const row = rows[i] ?? [];
        const customerCell = clean(row[0]);

        // Customer heading, or the "Total - X" line that closes them out.
        if (customerCell !== "") continue;

        const txType = clean(row[COL.txType]);
        const company = clean(row[COL.company]);
        if (txType === "" || company === "") continue;

        // The newer export carries the manager and the trade on every invoice
        // line, which replaces the two RM tabs the older file used. Those tabs
        // held contradictory data anyway: the same customer code appeared
        // against different companies on each one.
        const repCell = clean(at(row, COL.rep));
        if (repCell !== "") {
          const key = norm(company);
          const seen = lineReps.get(key) ?? new Set<string>();
          seen.add(repCell);
          lineReps.set(key, seen);
        }
        const industryCell = clean(at(row, COL.industry));
        if (industryCell !== "") lineIndustries.set(norm(company), industryCell);

        const balance = money(row[COL.balance]);
        if (balance === null) {
          problems.push({
            sheet: mainName,
            row: i + 1,
            severity: "error",
            message: `${company}: could not read the open balance. Row skipped.`,
          });
          continue;
        }

        const description = clean(row[COL.description]);
        const ageRaw = row[COL.age];
        const age =
          typeof ageRaw === "number"
            ? Math.round(ageRaw)
            : Number.isFinite(Number(clean(ageRaw)))
              ? Math.round(Number(clean(ageRaw)))
              : null;

        // MES print an age bucket in the file, and it is a spreadsheet formula
        // rather than something NetSuite exports. A formula can be dragged one
        // row short or left over from last month's layout, so the age is used
        // to work the bucket out here and the two are compared. Theirs is kept
        // either way, because the file is what they will point at, but a
        // disagreement is reported rather than silently inherited.
        const dueIso = excelDate(row[COL.dueDate]);
        if (dataAsOf === null && age !== null && dueIso !== null)
          dataAsOf = addDays(dueIso, age);

        const theirBucket = COL.bucket < 0 ? "" : clean(row[COL.bucket]);
        const ourBucket = age === null ? "" : bucketLabelForAge(age);
        if (age !== null && theirBucket !== "") {
          const ours = ourBucket;
          if (ours !== theirBucket) {
            problems.push({
              sheet: mainName,
              row: i + 1,
              severity: "warning",
              message:
                `${company}: the file says "${theirBucket}" but ${age} days ` +
                `overdue is "${ours}" by MES's own formula. Using the file's ` +
                `value. Worth checking the Aging column in the export.`,
            });
          }
        }

        invoices.push({
          companyName: company.replace(/\.$/, ""),
          transactionType: txType,
          date: excelDate(row[COL.date]),
          dueDate: dueIso,
          description: description.slice(0, 400),
          documentNumber: clean(row[COL.document]),
          linkedContract: clean(row[COL.contract]) || null,
          age,
          bucket: theirBucket !== "" ? theirBucket : ourBucket,
          openBalance: balance,
          revenueType: revenueType(description, clean(row[COL.document])),
          isOneFm: isOneFm(description, clean(row[COL.document])),
        });
      }

      // Which day the report is "as of" decides every age, and the $100 fee
      // turns on a 14 day window, so an error here is not cosmetic. MES's
      // aging detail export carried a title reading 17 August while all 3,117
      // rows were calculated on the 28th, an eleven day gap that moved five
      // companies in and out of the fee. The data wins, because every age in
      // the file is consistent with it and nothing is consistent with the
      // title, but the disagreement is reported rather than absorbed.
      if (dataAsOf !== null && titleAsOf !== null && dataAsOf !== titleAsOf) {
        problems.push({
          sheet: mainName,
          row: null,
          severity: "warning",
          message:
            `This file is titled "as of ${titleAsOf}" but every age in it is ` +
            `calculated as of ${dataAsOf}. Using ${dataAsOf}, because the ` +
            `figures agree with it and the title does not. Worth confirming ` +
            `with MES which date the export was really run on.`,
        });
      }
      asOf = dataAsOf ?? titleAsOf;
    }
  }

  /* --------------------------------------------------- Contact Details */
  const contactName = sheet("Contact Details");
  if (!contactName) {
    problems.push({
      sheet: "-",
      row: null,
      severity: "warning",
      message:
        'No "Contact Details" tab, so no email addresses were loaded. Reminders will be blocked.',
    });
  } else {
    const rows = rowsOf(wb, contactName);
    const headerAt = findHeaderRow(rows, "Company Name");
    for (let i = headerAt + 1; i < rows.length; i += 1) {
      const company = clean(rows[i]?.[0]);
      if (!company) continue;
      // One cell can hold several addresses, wrapped in display names, quotes
      // or angle brackets. See emails.ts: the addresses are found inside the
      // cell rather than the cell being split up.
      const cell = rows[i]?.[2];
      const emails = emailAddresses(cell);
      if (emails.length === 0) {
        problems.push({
          sheet: contactName,
          row: i + 1,
          severity: "warning",
          message: looksLikeUnreadableContact(cell)
            ? `${company}: there is something in the email column but no ` +
              `address we can read in it, so no reminder can be sent. ` +
              `The cell says: ${clean(cell).slice(0, 80)}`
            : `${company} has no email address, so reminders cannot reach ` +
              `them. Phone them instead.`,
        });
        continue;
      }
      contacts.push({ companyName: company.replace(/\.$/, ""), emails });
    }
  }

  /* --------------------------------------------------------- Industry */
  const industryName = sheet("Industry");
  if (industryName) {
    const rows = rowsOf(wb, industryName);
    const headerAt = findHeaderRow(rows, "Customer");
    for (let i = headerAt + 1; i < rows.length; i += 1) {
      const parts = splitCustomer(rows[i]?.[0]);
      if (!parts) continue;
      industries.push({
        companyName: parts.name,
        industry: clean(rows[i]?.[1]),
        entity: clean(rows[i]?.[3]),
        property: clean(rows[i]?.[4]),
      });
    }
  }

  /* ------------------------------------------------ RM assignment tabs */
  for (const name of wb.SheetNames) {
    if (!/^RM\s*-\s*User/i.test(clean(name))) continue;
    const rows = rowsOf(wb, name);
    const managerName = clean(rows[0]?.[0]);
    const key = `rm${managers.length + 1}`;
    if (managerName) {
      managers.push({
        key,
        name: managerName.replace(/\b\w/g, (c) => c.toUpperCase()).toLowerCase()
          .replace(/\b\w/g, (c) => c.toUpperCase()),
      });
    }
    for (const row of rows) {
      const id = clean(row?.[0]);
      let company = clean(row?.[1]);
      if (!id || !company) continue;
      if (norm(company) === "COMPANY NAME") continue;
      // Some cells have the customer code pasted inside the name field.
      company = company.replace(/^DORM-\d+\s+/i, "").replace(/\.$/, "");
      rmAssignments.push({ companyName: company, rm: key });
    }
  }

  /* ------------------------------- managers from the invoice lines instead */
  // The newer export has no RM tabs at all. It carries "Primary Sales Rep" on
  // every line, which is better: it is one source rather than two that
  // disagreed, and it comes from NetSuite rather than being maintained by
  // hand. Used only when the tabs are absent, so the older file is unchanged.
  if (managers.length === 0 && lineReps.size > 0) {
    // Every rep who appears anywhere, so the list is complete even where a
    // company is split between two of them.
    const allReps = new Set<string>();
    for (const set of Array.from(lineReps.values())) {
      for (const r of Array.from(set)) allReps.add(r);
    }

    const keyByName = new Map<string, string>();
    for (const repName of Array.from(allReps).sort()) {
      const key = `rm${keyByName.size + 1}`;
      keyByName.set(repName, key);
      managers.push({ key, name: repName });
    }

    for (const [companyKey, set] of Array.from(lineReps)) {
      const reps = Array.from(set).sort();
      if (reps.length > 1) {
        // Real case in MES's own export: THOMAS EDISON appears as two blocks
        // under two different reps. Taking whichever came last would put the
        // whole balance on one manager's report and leave it off the other's,
        // with nothing to say so. The first is used and the split is named.
        problems.push({
          sheet: mainName ?? "-",
          row: null,
          severity: "warning",
          message:
            `${companyKey} appears under more than one sales rep ` +
            `(${reps.join(", ")}). Assigned to the first. If they really are ` +
            `shared, the manager report will understate one of them.`,
        });
      }
      const key = keyByName.get(reps[0]);
      if (key) rmAssignments.push({ companyName: companyKey, rm: key });
    }
  }

  // Same for the trade, which the older file kept on its own Industry tab.
  if (industries.length === 0 && lineIndustries.size > 0) {
    for (const [companyKey, industry] of Array.from(lineIndustries)) {
      industries.push({
        companyName: companyKey,
        industry,
        entity: "",
        property: "",
      });
    }
  }

  if (invoices.length === 0) {
    problems.push({
      sheet: "-",
      row: null,
      severity: "error",
      message: "No invoice rows were found in this workbook.",
    });
  }

  return {
    kind: "ar-detail",
    asOf,
    sheets: wb.SheetNames.map(clean),
    invoices,
    contacts,
    industries,
    rmAssignments,
    managers,
    problems,
  };
}

/* ------------------------------------------------------------ entry point */

/* ---------------------------------------------------- the contact list */

/**
 * R1.xlsx, MES's client contact list.
 *
 * One tab per dormitory listing who rents there, then a combined tab holding
 * the email addresses. The combined tab is the one that matters; the
 * dormitory tabs are read only to work out who is on none of them, because a
 * tenant with no address cannot be emailed at all and needs to be named
 * rather than quietly skipped.
 *
 * In the file MES sent, 116 companies appear across the three dormitory tabs
 * and 110 on the combined tab. The six in the gap are the ones the reminder
 * screen shows as phone only.
 */
export function parseContacts(wb: XLSX.WorkBook): ParsedContacts {
  const problems: ParseProblem[] = [];
  const contacts: ParsedContacts["contacts"] = [];
  const onDormTab = new Map<string, { companyName: string; property: string }>();
  let asOf: string | null = null;

  for (const sheetName of wb.SheetNames) {
    const rows = rowsOf(wb, sheetName);

    for (let i = 0; i < Math.min(rows.length, 8); i += 1) {
      const m = /^as of\s+(.+)$/i.exec(clean(rows[i]?.[0]));
      if (m && !asOf) asOf = excelDate(m[1]) ?? clean(m[1]);
    }

    const headerAt = findHeaderRow(rows, "Company Name");
    if (headerAt === -1) continue;

    const header = (rows[headerAt] ?? []).map((c) => norm(c));
    const emailAt = header.indexOf("EMAIL ADDRESS");

    for (let i = headerAt + 1; i < rows.length; i += 1) {
      const parts = splitCustomer(rows[i]?.[0]);
      if (!parts) continue;

      if (emailAt === -1) {
        // A dormitory tab: names and Live/Terminated only.
        if (!onDormTab.has(parts.code)) {
          onDormTab.set(parts.code, {
            companyName: parts.name,
            property: clean(sheetName),
          });
        }
        continue;
      }

      const cell = rows[i]?.[emailAt];
      const emails = emailAddresses(cell);
      if (emails.length === 0) {
        problems.push({
          sheet: clean(sheetName),
          row: i + 1,
          severity: "warning",
          message: looksLikeUnreadableContact(cell)
            ? `${parts.name}: there is something in the email column but no ` +
              `address we can read in it. The cell says: ${clean(cell).slice(0, 80)}`
            : `${parts.name} has no email address and cannot be sent a reminder.`,
        });
        continue;
      }
      contacts.push({
        customerCode: parts.code,
        companyName: parts.name,
        emails,
      });
    }
  }

  const withEmail = new Set(contacts.map((c) => c.customerCode));
  const missing = Array.from(onDormTab.entries())
    .filter(([code]) => !withEmail.has(code))
    .map(([code, v]) => ({
      customerCode: code,
      companyName: v.companyName,
      property: v.property,
    }));

  if (contacts.length === 0) {
    problems.push({
      sheet: "-",
      row: null,
      severity: "error",
      message:
        "No email addresses were found. The combined tab should carry an " +
        "Email Address column alongside the company names.",
    });
  }

  for (const m of missing) {
    problems.push({
      sheet: m.property,
      row: null,
      severity: "warning",
      message:
        `${m.customerCode} ${m.companyName} rents at ${m.property} but is not ` +
        "on the list with an address, so no reminder can reach them. They " +
        "stay on the call list.",
    });
  }

  return {
    kind: "contact-list",
    asOf,
    sheets: wb.SheetNames.map(clean),
    contacts,
    missing,
    problems,
  };
}

export async function parseWorkbook(file: File): Promise<ParseResult> {
  const name = file.name.toLowerCase();

  // The bank report arrives as a screenshot in the sample. Reading digits out
  // of an image with OCR would put misread account numbers and amounts into a
  // financial system, so this refuses rather than guessing.
  if (/\.(png|jpe?g|gif|bmp|webp|pdf)$/.test(name)) {
    return {
      kind: "unreadable",
      problems: [
        {
          sheet: "-",
          row: null,
          severity: "error",
          message:
            `"${file.name}" is an image or PDF. Amounts and account numbers ` +
            "cannot be read reliably from a picture, and a misread digit would " +
            "mean chasing the wrong tenant for the wrong sum. Please export " +
            "the report as CSV or Excel instead."
        },
      ],
    };
  }

  let wb: XLSX.WorkBook;
  try {
    const buf = await file.arrayBuffer();
    wb = XLSX.read(buf, { cellDates: true });
  } catch (e) {
    return {
      kind: "unreadable",
      problems: [
        {
          sheet: "-",
          row: null,
          severity: "error",
          message: `Could not open "${file.name}": ${
            e instanceof Error ? e.message : "unknown error"
          }`,
        },
      ],
    };
  }

  const kind = detectKind(wb);
  if (kind === "ar-summary") return parseSummary(wb);
  if (kind === "ar-detail") return parseDetail(wb);
  if (kind === "contact-list") return parseContacts(wb);

  return {
    kind: "unreadable",
    problems: [
      {
        sheet: "-",
        row: null,
        severity: "error",
        message:
          `"${file.name}" was opened but is not a report we recognise. ` +
          `Tabs found: ${wb.SheetNames.join(", ")}. Expected one tab per ` +
          "dormitory (JPD1, JPD2, BSD, LEO), a Detailed Full Report tab, or " +
          "a contact list with an Email Address column.",
      },
    ],
  };
}
