"use client";

import * as XLSX from "xlsx";
import type { Account, Invoice, PropertyCode } from "./types";
import { bucketForAge, bucketLabelForAge } from "./data.ts";
import { isOneFm, revenueType } from "./revenue-rules.ts";

/**
 * Custom A/R Aging Detail - With Description.
 *
 * This is the export MES settled on in September, and it replaces the pair of
 * files the app was built against. Three things make it a different shape
 * rather than a new version of the old one:
 *
 *   1. There is no per dormitory summary tab. The old AR Report carried one
 *      tab per dormitory with the five aging buckets already added up. This
 *      file has invoice lines only, so the buckets have to be built here.
 *   2. There is no Status column, so Live/Terminated cannot come from this
 *      file at all. It comes from the contact list, or it is unknown.
 *   3. There is a Categories column. MES tag every line with what it is for,
 *      which until now had to be guessed from the description text.
 *
 * The header sits at row 7 rather than row 1, with the entity, the report
 * title and the as-of date above it, and a note MES typed into G2:I2
 * explaining how to spot a 1FM line. All of that is read rather than skipped.
 */

/* ------------------------------------------------------------------ types */

export interface ParseProblem {
  sheet: string;
  row: number | null;
  message: string;
  severity: "error" | "warning";
}

export interface DetailInvoice extends Omit<Invoice, "id"> {
  /** MES's own Categories value, or "" where the cell was blank. */
  category: string;
  /** Which dormitory the invoice belongs to, from its document number. */
  property: PropertyCode;
  customerCode: string;
}

export interface ParsedAgingDetail {
  kind: "ar-aging-detail";
  /** From "As of 17 August 2026" in column A. The pivot for everything. */
  asOf: string | null;
  /** The last segment of "Consol : ... : KT Mesdorm Pte Ltd". */
  entity: string | null;
  sheets: string[];
  invoices: DetailInvoice[];
  accounts: Account[];
  /** MES's own "Total - DORM-x" lines, kept so ours can be checked against them. */
  subtotals: { customerCode: string; companyName: string; total: number }[];
  problems: ParseProblem[];
}

/* -------------------------------------------------------------- utilities */

const PROPERTY_NAMES: Record<PropertyCode, string> = {
  JPD1: "Jurong Penjuru Dormitory 1",
  JPD2: "Jurong Penjuru Dormitory 2",
  BSD: "Blue Stars Dormitory",
  LEO: "The Leo",
};

const clean = (s: unknown) => String(s ?? "").trim();
const norm = (s: unknown) =>
  clean(s).replace(/\s+/g, " ").replace(/\.$/, "").toUpperCase();

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Calendar dates, never instants. Reading a spreadsheet date through
 * toISOString() shifts it a day west of the date line, and Singapore is
 * UTC+8, so every due date would move and invoices would change bucket.
 */
function excelDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : null;
  }
  const parsed = new Date(clean(v));
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}

function money(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = clean(v).replace(/[,\s]/g, "");
  if (s === "" || s === "-" || s === "–") return 0;
  const paren = /^\((.*)\)$/.exec(s);
  const n = Number(paren ? `-${paren[1]}` : s);
  return Number.isFinite(n) ? n : null;
}

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

function columnsOf(headerRow: unknown[]): Map<string, number> {
  const m = new Map<string, number>();
  headerRow.forEach((cell, i) => {
    const name = norm(cell);
    if (name !== "" && !m.has(name)) m.set(name, i);
  });
  return m;
}

function col(cols: Map<string, number>, names: string[], fallback: number): number {
  for (const n of names) {
    const at = cols.get(norm(n));
    if (at !== undefined) return at;
  }
  return fallback;
}

/* ------------------------------------------------- dormitory from a number */

/**
 * Which dormitory an invoice belongs to.
 *
 * The file has no property column. It does not need one, because MES number
 * every document with the dormitory in front of it. Every shape in the August
 * export:
 *
 *   BSD-786/002070   regular invoice          -> BSD
 *   BSD786/44140     the older numbering      -> BSD
 *   BSDFM/1598       raised through 1FM       -> BSD
 *   BSDCN/017        credit note              -> BSD
 *   REC-BSD367       a receipt                -> BSD
 *   JPD1-786/002429  regular invoice          -> JPD1
 *   JP1FM/2705       1FM, abbreviated         -> JPD1
 *   KTM-1444         entity level journal     -> falls back to the file's entity
 *
 * KTM is KT Mesdorm, the company, not a dormitory: those rows are opening
 * balances, credit memos and write offs raised against the entity rather than
 * against a block. They inherit the property the workbook header names, which
 * is why `fallback` is required rather than optional.
 */
export function propertyFromDocument(
  documentNumber: string,
  fallback: PropertyCode,
): PropertyCode {
  const doc = norm(documentNumber).replace(/^REC-/, "");

  // JP1FM and JP2FM are JPD1 and JPD2 with the D dropped. Checked first
  // because "JP1" would otherwise not match any dormitory code.
  const short = /^JP(\d)(FM|CN)/.exec(doc);
  if (short) {
    const code = `JPD${short[1]}` as PropertyCode;
    if (code in PROPERTY_NAMES) return code;
  }

  for (const code of ["JPD1", "JPD2", "BSD", "LEO"] as PropertyCode[]) {
    if (doc.startsWith(code)) return code;
  }
  return fallback;
}

/**
 * The dormitory a legal entity operates, for the rows numbered by entity.
 *
 * Taken from the headers of MES's own contact list, which names the entity on
 * each dormitory's tab.
 */
export const ENTITY_PROPERTY: { match: RegExp; property: PropertyCode }[] = [
  { match: /KT\s*MESDORM/i, property: "BSD" },
  { match: /KAKI\s*BUKIT/i, property: "LEO" },
  { match: /MES\s*&\s*JPD\s*HOUSING/i, property: "JPD1" },
];

export function propertyForEntity(entity: string | null): PropertyCode | null {
  if (!entity) return null;
  for (const e of ENTITY_PROPERTY) if (e.match.test(entity)) return e.property;
  return null;
}

/* ------------------------------------------------------------- detection */

/** True when this workbook is the Custom A/R Aging Detail export. */
export function isAgingDetail(wb: XLSX.WorkBook): boolean {
  for (const name of wb.SheetNames) {
    const rows = rowsOf(wb, name);
    for (let i = 0; i < Math.min(rows.length, 25); i += 1) {
      if (norm(rows[i]?.[0]) !== "CUSTOMER") continue;
      const cols = columnsOf(rows[i] ?? []);
      // Categories and Open Balance together are unique to this export. The
      // older detail report has Open Balance but no Categories, and the
      // summary export has neither.
      if (cols.has("CATEGORIES") && cols.has("OPEN BALANCE")) return true;
    }
  }
  return false;
}

/* ----------------------------------------------------------------- parse */

export function parseAgingDetail(wb: XLSX.WorkBook): ParsedAgingDetail {
  const problems: ParseProblem[] = [];
  const invoices: DetailInvoice[] = [];
  const subtotals: ParsedAgingDetail["subtotals"] = [];

  let asOf: string | null = null;
  let entity: string | null = null;

  const sheetName =
    wb.SheetNames.find((n) => {
      const rows = rowsOf(wb, n);
      return rows.some((r, i) => i < 25 && norm(r?.[0]) === "CUSTOMER");
    }) ?? wb.SheetNames[0];

  const rows = rowsOf(wb, sheetName);

  /* --------------------------------------------------- the header block */
  let headerAt = -1;
  for (let i = 0; i < Math.min(rows.length, 25); i += 1) {
    const first = clean(rows[i]?.[0]);
    if (norm(first) === "CUSTOMER") {
      headerAt = i;
      break;
    }
    // "Consol : Mini Environment Service Pte Ltd : KT Mesdorm Pte Ltd"
    if (/^consol\s*:/i.test(first) && !entity) {
      const parts = first.split(":").map((s) => s.trim()).filter(Boolean);
      entity = parts[parts.length - 1] ?? null;
    }
    const m = /^as of\s+(.+)$/i.exec(first);
    if (m && !asOf) asOf = excelDate(m[1]) ?? clean(m[1]);
  }

  if (headerAt === -1) {
    return {
      kind: "ar-aging-detail",
      asOf,
      entity,
      sheets: wb.SheetNames.map(clean),
      invoices: [],
      accounts: [],
      subtotals: [],
      problems: [
        {
          sheet: clean(sheetName),
          row: null,
          severity: "error",
          message:
            'No "Customer" header row in the first 25 rows, so this is not ' +
            "the Custom A/R Aging Detail export.",
        },
      ],
    };
  }

  // Which dormitory the rows that carry no dormitory in their number belong
  // to. Unresolvable entities fall back to BSD only after saying so, because
  // silently filing another dormitory's balances under Blue Stars would put
  // them on the wrong officer's screen.
  const entityProperty = propertyForEntity(entity);
  if (!entityProperty && entity) {
    problems.push({
      sheet: clean(sheetName),
      row: null,
      severity: "warning",
      message:
        `"${entity}" is not an entity we know, so invoices numbered without ` +
        "a dormitory in front of them cannot be placed. They are filed under " +
        "BSD. Add the entity to ENTITY_PROPERTY in aging-detail.ts.",
    });
  }
  const fallbackProperty: PropertyCode = entityProperty ?? "BSD";

  if (!asOf) {
    problems.push({
      sheet: clean(sheetName),
      row: null,
      severity: "error",
      message:
        'No "As of ..." row above the header. Every aging figure is keyed ' +
        "off that date, so the report cannot be dated and must not be used.",
    });
  }

  /* -------------------------------------------------------- the columns */
  const cols = columnsOf(rows[headerAt] ?? []);
  const COL = {
    txType: col(cols, ["Transaction Type"], 1),
    company: col(cols, ["Company Name"], 2),
    date: col(cols, ["Date"], 3),
    description: col(cols, ["Description"], 4),
    category: col(cols, ["Categories", "Category"], -1),
    document: col(cols, ["Document Number"], 6),
    contract: col(cols, ["Linked Contract"], 7),
    dueDate: col(cols, ["Due Date"], 10),
    age: col(cols, ["Age"], 11),
    balance: col(cols, ["Open Balance"], 12),
    // Not in the August export. Read anyway, so that the day MES add them the
    // manager and industry reports start working with no code change.
    rep: col(cols, ["Primary Sales Rep"], -1),
    industry: col(cols, ["End User: Industry Type"], -1),
    status: col(cols, ["Status"], -1),
  };
  const at = (row: unknown[], i: number) => (i < 0 ? "" : row[i]);

  if (COL.category === -1) {
    problems.push({
      sheet: clean(sheetName),
      row: null,
      severity: "warning",
      message:
        "No Categories column. Charge types will be worked out from the " +
        "description text alone, which is less reliable.",
    });
  }

  /* ---------------------------------------------------------- the rows */
  let current: { code: string; name: string } | null = null;
  const lineReps = new Map<string, Set<string>>();
  const lineIndustries = new Map<string, string>();
  const lineStatus = new Map<string, string>();

  for (let i = headerAt + 1; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    const first = clean(row[0]);

    // "Total - DORM-10 A STAR TECHNICAL SERVICES PTE. LTD."
    const totalMatch = /^total\s*-\s*(DORM-\d+)\s+(.+)$/i.exec(first);
    if (totalMatch) {
      const total = money(row[COL.balance]);
      subtotals.push({
        customerCode: totalMatch[1].toUpperCase(),
        companyName: clean(totalMatch[2]).replace(/\.$/, ""),
        total: total ?? 0,
      });
      current = null;
      continue;
    }

    // A customer heading opens the block of invoices beneath it. The code
    // appears here and nowhere else: the invoice rows leave column A empty,
    // which is why it has to be carried down.
    const heading = splitCustomer(first);
    if (heading) {
      current = heading;
      continue;
    }

    if (first !== "") continue; // grand totals and stray labels

    const txType = clean(row[COL.txType]);
    const company = clean(row[COL.company]);
    if (txType === "" && company === "") continue;

    if (!current) {
      problems.push({
        sheet: clean(sheetName),
        row: i + 1,
        severity: "warning",
        message:
          `A ${txType || "data"} row for "${company || "an unnamed company"}" ` +
          "sits outside any customer block, so it has no customer code. Skipped.",
      });
      continue;
    }

    const balance = money(row[COL.balance]);
    if (balance === null) {
      problems.push({
        sheet: clean(sheetName),
        row: i + 1,
        severity: "error",
        message: `${current.name}: could not read the open balance. Row skipped rather than imported as zero.`,
      });
      continue;
    }

    const ageRaw = row[COL.age];
    const age =
      typeof ageRaw === "number"
        ? Math.round(ageRaw)
        : clean(ageRaw) !== "" && Number.isFinite(Number(clean(ageRaw)))
          ? Math.round(Number(clean(ageRaw)))
          : null;

    if (age === null) {
      problems.push({
        sheet: clean(sheetName),
        row: i + 1,
        severity: "warning",
        message:
          `${current.name}: no age on this line, so it cannot be placed in ` +
          "an aging bucket. Counted in the total but not in any column.",
      });
    }

    const description = clean(row[COL.description]);
    const documentNumber = clean(row[COL.document]);
    const category = clean(at(row, COL.category));

    const repCell = clean(at(row, COL.rep));
    if (repCell !== "") {
      const key = norm(current.code);
      const seen = lineReps.get(key) ?? new Set<string>();
      seen.add(repCell);
      lineReps.set(key, seen);
    }
    const industryCell = clean(at(row, COL.industry));
    if (industryCell !== "") lineIndustries.set(norm(current.code), industryCell);
    const statusCell = clean(at(row, COL.status));
    if (statusCell !== "") lineStatus.set(norm(current.code), statusCell);

    invoices.push({
      customerCode: current.code,
      companyName: (company || current.name).replace(/\.$/, ""),
      transactionType: txType,
      date: excelDate(row[COL.date]),
      dueDate: excelDate(row[COL.dueDate]),
      description: description.slice(0, 400),
      documentNumber,
      linkedContract: clean(row[COL.contract]) || null,
      age,
      bucket: age === null ? "" : bucketLabelForAge(age),
      openBalance: balance,
      category,
      property: propertyFromDocument(documentNumber, fallbackProperty),
      revenueType: revenueType(description, documentNumber, category),
      isOneFm: isOneFm(description, documentNumber, category),
    });
  }

  /* ------------------------------------------------ roll up into accounts */

  // An account is company + dormitory. The same company renting at two
  // dormitories owes two separate balances under two separate contracts to
  // two separate legal entities, so it is two accounts and always has been.
  const byAccount = new Map<string, Account>();

  for (const inv of invoices) {
    const id = `${inv.customerCode}-${inv.property}`.toLowerCase();
    let acct = byAccount.get(id);
    if (!acct) {
      acct = {
        id,
        customerCode: inv.customerCode,
        companyName: inv.companyName,
        property: inv.property,
        propertyName: PROPERTY_NAMES[inv.property],
        // No Status column in this export. "Live" is the assumption, and the
        // contact list overwrites it on import. Guessing Terminated from an
        // absence would stop reminders going to tenants who are still here.
        status: (lineStatus.get(norm(inv.customerCode)) ?? "")
          .toUpperCase()
          .startsWith("TERM")
          ? "Terminated"
          : "Live",
        buckets: { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 },
        total: 0,
        legacyNote: null,
        emails: [],
        hasContact: false,
        industry: lineIndustries.get(norm(inv.customerCode)) ?? null,
        entity,
        invoiceCount: 0,
        isOneFm: false,
        revenueTypes: [],
        lateFeeCount: 0,
      };
      byAccount.set(id, acct);
    }

    acct.total += inv.openBalance;
    acct.invoiceCount += 1;
    if (inv.isOneFm) acct.isOneFm = true;
    if (inv.revenueType === "Late Payment Fee") acct.lateFeeCount += 1;
    if (inv.age !== null) acct.buckets[bucketForAge(inv.age)] += inv.openBalance;
  }

  for (const acct of Array.from(byAccount.values())) {
    const mine = invoices.filter(
      (i) => i.customerCode === acct.customerCode && i.property === acct.property,
    );
    acct.revenueTypes = Array.from(new Set(mine.map((i) => i.revenueType))).sort();
    acct.total = round2(acct.total);
    acct.buckets = {
      current: round2(acct.buckets.current),
      d30: round2(acct.buckets.d30),
      d60: round2(acct.buckets.d60),
      d90: round2(acct.buckets.d90),
      d90plus: round2(acct.buckets.d90plus),
    };
    const reps = Array.from(lineReps.get(norm(acct.customerCode)) ?? []).sort();
    if (reps.length > 1) {
      // Real case in MES's own export: one customer's lines carry two
      // different sales reps. Taking whichever came last would put the whole
      // balance on one manager's report and leave it off the other's, with
      // nothing to say so. The first is used and the split is named.
      problems.push({
        sheet: clean(sheetName),
        row: null,
        severity: "warning",
        message:
          `${acct.companyName} appears under more than one sales rep ` +
          `(${reps.join(", ")}). Assigned to the first. If the account really ` +
          "is shared, one manager's report will understate it.",
      });
    }
    if (reps.length > 0) (acct as Account & { rm?: string }).rm = reps[0];
  }

  const accounts = Array.from(byAccount.values()).sort(
    (a, b) => b.total - a.total || a.companyName.localeCompare(b.companyName),
  );

  /* ------------------------------------- check ours against MES's own totals */

  // MES print a subtotal under every customer. Ours is built from the lines
  // above it, so the two should agree exactly. Where they do not, the export
  // is inconsistent or we have mis-read a row, and either way somebody needs
  // to look rather than trust the screen.
  const oursByCode = new Map<string, number>();
  for (const a of accounts) {
    oursByCode.set(
      a.customerCode,
      round2((oursByCode.get(a.customerCode) ?? 0) + a.total),
    );
  }
  for (const s of subtotals) {
    const ours = oursByCode.get(s.customerCode);
    if (ours === undefined) {
      problems.push({
        sheet: clean(sheetName),
        row: null,
        severity: "warning",
        message: `${s.companyName} has a total line of ${s.total.toFixed(2)} but no invoice rows above it.`,
      });
      continue;
    }
    if (Math.abs(ours - s.total) > 0.02) {
      problems.push({
        sheet: clean(sheetName),
        row: null,
        severity: "warning",
        message:
          `${s.companyName}: the lines add to ${ours.toFixed(2)} but MES's ` +
          `own total says ${s.total.toFixed(2)}.`,
      });
    }
  }

  if (invoices.length === 0) {
    problems.push({
      sheet: clean(sheetName),
      row: null,
      severity: "error",
      message: "No invoice rows were found in this workbook.",
    });
  }

  return {
    kind: "ar-aging-detail",
    asOf,
    entity,
    sheets: wb.SheetNames.map(clean),
    invoices,
    accounts,
    subtotals,
    problems,
  };
}

/** Money adds up in binary and drifts. Rounded once, at the boundary. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
