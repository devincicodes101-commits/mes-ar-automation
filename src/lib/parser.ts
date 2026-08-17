"use client";

import * as XLSX from "xlsx";
import { Account, Invoice, PropertyCode } from "./types";

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
  problems: ParseProblem[];
}

export interface ParsedDetail {
  kind: "ar-detail";
  asOf: string | null;
  invoices: Omit<Invoice, "id">[];
  contacts: { companyName: string; emails: string[] }[];
  industries: { companyName: string; industry: string; entity: string; property: string }[];
  rmAssignments: { companyName: string; rm: string }[];
  managers: { key: string; name: string }[];
  problems: ParseProblem[];
}

export type ParseResult =
  | ParsedSummary
  | ParsedDetail
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
  if (names.some((n) => Object.keys(PROPERTY_NAMES).includes(n)))
    return "ar-summary";
  return "unreadable";
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

  return { kind: "ar-summary", asOf, accounts, problems };
}

/* -------------------------------------------------------- the detail report */

/** Works out what a charge is for, from the free text description. */
export function revenueType(description: string): string {
  const d = description.toUpperCase();
  if (d.includes("ONEFM") || d.includes("ONE FM")) return "1FM Maintenance";
  if (d.trim() === "VAT") return "VAT";
  if (d.includes("OCCUPANCY FEE")) return "Occupancy Fee";
  if (d.includes("CREAM SERVICE")) return "CREAM Services";
  if (d.includes("FURNITURE")) return "Furniture & Fittings";
  if (d.includes("SERVICE & CONSERVANCY")) return "Service & Conservancy";
  if (d.includes("LATE PAYMENT")) return "Late Payment Fee";
  if (d.includes("REJECTED GIRO")) return "Rejected GIRO Fee";
  if (d.includes("SEASON PARKING")) return "Season Parking";
  if (d.includes("STAMP DUTY")) return "Stamp Duty";
  if (d.includes("SECURITY DEPOSIT")) return "Security Deposit";
  if (d.includes("ADMIN FEE")) return "Admin Fee";
  return "Other Charges";
}

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
  const managers: ParsedDetail["managers"] = [];
  let asOf: string | null = null;

  const sheet = (want: string) =>
    wb.SheetNames.find((n) => norm(n) === norm(want)) ?? null;

  /* ------------------------------------------------ Detailed Full Report */
  const mainName = sheet("Detailed Full Report");
  if (!mainName) {
    problems.push({
      sheet: "-",
      row: null,
      severity: "error",
      message: 'This workbook has no "Detailed Full Report" tab.',
    });
  } else {
    const rows = rowsOf(wb, mainName);
    for (let i = 0; i < Math.min(rows.length, 8); i += 1) {
      const m = /^as of\s+(.+)$/i.exec(clean(rows[i]?.[0]));
      if (m && !asOf) asOf = excelDate(m[1]) ?? clean(m[1]);
    }

    const headerAt = findHeaderRow(rows, "Customer");
    if (headerAt === -1) {
      problems.push({
        sheet: mainName,
        row: null,
        severity: "error",
        message: 'Could not find the "Customer" header row.',
      });
    } else {
      for (let i = headerAt + 1; i < rows.length; i += 1) {
        const row = rows[i] ?? [];
        const customerCell = clean(row[0]);

        // Customer heading, or the "Total - X" line that closes them out.
        if (customerCell !== "") continue;

        const txType = clean(row[1]);
        const company = clean(row[2]);
        if (txType === "" || company === "") continue;

        const balance = money(row[12]);
        if (balance === null) {
          problems.push({
            sheet: mainName,
            row: i + 1,
            severity: "error",
            message: `${company}: could not read the open balance. Row skipped.`,
          });
          continue;
        }

        const description = clean(row[4]);
        const ageRaw = row[10];
        const age =
          typeof ageRaw === "number"
            ? Math.round(ageRaw)
            : Number.isFinite(Number(clean(ageRaw)))
              ? Math.round(Number(clean(ageRaw)))
              : null;

        invoices.push({
          companyName: company.replace(/\.$/, ""),
          transactionType: txType,
          date: excelDate(row[3]),
          dueDate: excelDate(row[9]),
          description: description.slice(0, 400),
          documentNumber: clean(row[5]),
          linkedContract: clean(row[6]) || null,
          age,
          bucket: clean(row[11]),
          openBalance: balance,
          revenueType: revenueType(description),
          isOneFm: description.toUpperCase().includes("ONEFM"),
        });
      }
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
      // One cell can hold several addresses separated by semicolons.
      const emails = clean(rows[i]?.[2])
        .split(/[;,]/)
        .map((e) => e.trim())
        .filter((e) => e.includes("@"));
      if (emails.length === 0) {
        problems.push({
          sheet: contactName,
          row: i + 1,
          severity: "warning",
          message: `${company} has no usable email address.`,
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
    invoices,
    contacts,
    industries,
    rmAssignments,
    managers,
    problems,
  };
}

/* ------------------------------------------------------------ entry point */

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
            "this report from DBS as CSV or Excel instead.",
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

  return {
    kind: "unreadable",
    problems: [
      {
        sheet: "-",
        row: null,
        severity: "error",
        message:
          `"${file.name}" was opened but does not look like either report. ` +
          `Tabs found: ${wb.SheetNames.join(", ")}. Expected either one tab ` +
          "per dormitory (JPD1, JPD2, BSD, LEO) or a Detailed Full Report tab.",
      },
    ],
  };
}
