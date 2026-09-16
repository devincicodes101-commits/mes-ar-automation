/**
 * Builds a fresh AR report to test against, and the cases that check it.
 *
 *   npm run build:test-data
 *
 * MES have sent two files and both have been used to build this system, which
 * makes them poor evidence: passing on the data you were built against shows
 * only that nothing has regressed. This writes a third file the code has never
 * seen, in the exact shape of their Finance AR Download, with the billing
 * dates chosen rather than inherited.
 *
 * Every row is placed deliberately. Some sit exactly on a bucket boundary,
 * some one day either side of it, some exactly on the 14 and 30 day credit
 * deadlines. Each carries every charge type MES group by, across all four
 * dormitories, three sales reps, tenants with and without an address, and one
 * company renting at two dormitories.
 *
 * The file and the expectations come out of the same list below, so they
 * cannot drift apart: change a billing date here and both the spreadsheet and
 * the case that checks it move together. That is the control the client asked
 * for.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

/* ------------------------------------------------------------- calendar */

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 12);
};
const plus = (s: string, n: number) => {
  const d = at(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};
const between = (a: string, b: string) =>
  Math.round((at(b).getTime() - at(a).getTime()) / 86400000);

/**
 * The day this report was pulled. Deliberately not August, and deliberately
 * not a date either of MES's files uses, so nothing can pass by coincidence.
 */
const REPORT = "2026-09-15";

/** NetSuite's terms on MES's own data: due date is fifteen days after billing. */
const TERM = 15;

/** MES's stated credit periods, from the Flow tab and the cycle diagram. */
const CREDIT = 14;
const FINAL = 30;

/* --------------------------------------------------------------- tenants */

interface Tenant {
  code: string;
  name: string;
  dorm: "JPD1" | "JPD2" | "BSD" | "LEO";
  rep: string;
  /** Null means this tenant has no address anywhere, so cannot be emailed. */
  emails: string[] | null;
}

const TENANTS: Tenant[] = [
  { code: "DORM-9001", name: "ANVIL MARINE PTE. LTD.", dorm: "JPD1", rep: "1001 Test Rep One", emails: ["ap@anvilmarine.test"] },
  { code: "DORM-9002", name: "BEACON STEELWORKS PTE. LTD.", dorm: "JPD1", rep: "1001 Test Rep One", emails: ["finance@beacon.test", "Ops Desk <ops@beacon.test>"] },
  { code: "DORM-9003", name: "CINDER ENGINEERING PTE. LTD.", dorm: "JPD2", rep: "1001 Test Rep One", emails: ["accounts@cinder.test"] },
  { code: "DORM-9004", name: "DELTA FABRICATION PTE. LTD.", dorm: "JPD2", rep: "1002 Test Rep Two", emails: null },
  { code: "DORM-9005", name: "EMBER LOGISTICS PTE. LTD.", dorm: "BSD", rep: "1002 Test Rep Two", emails: ["a@ember.test", "b@ember.test", "c@ember.test"] },
  { code: "DORM-9006", name: "FULCRUM SERVICES PTE. LTD.", dorm: "BSD", rep: "1002 Test Rep Two", emails: ["ar@fulcrum.test"] },
  { code: "DORM-9007", name: "GANTRY WORKS PTE. LTD.", dorm: "LEO", rep: "1003 Test Rep Three", emails: null },
  { code: "DORM-9008", name: "HALYARD MARINE PTE. LTD.", dorm: "LEO", rep: "1003 Test Rep Three", emails: ["h@halyard.test"] },
  { code: "DORM-9009", name: "IRONGATE PTE. LTD.", dorm: "JPD1", rep: "1003 Test Rep Three", emails: ["i@irongate.test"] },
  // Rents at two dormitories, so it is two accounts and two balances.
  { code: "DORM-9010", name: "JUNCTION BUILDERS PTE. LTD.", dorm: "JPD1", rep: "1001 Test Rep One", emails: ["j@junction.test"] },
  { code: "DORM-9010", name: "JUNCTION BUILDERS PTE. LTD.", dorm: "BSD", rep: "1001 Test Rep One", emails: ["j@junction.test"] },
];

const DOC_PREFIX: Record<Tenant["dorm"], string> = {
  JPD1: "JPD1-786", JPD2: "JPD2-786", BSD: "BSD-786", LEO: "LEO-786",
};

/* ----------------------------------------------------------------- rows */

interface Row {
  code: string;
  /** Days before the report date this was billed. Negative bills in future. */
  billedDaysAgo: number;
  description: string;
  /** Overrides the "<DORM>-786/nnn" default, for 1FM and credit notes. */
  docOverride?: string;
  amount: number;
  /** What the aging bucket must come out as. */
  bucket?: string;
  /** What charge type it must be classified as. */
  type?: string;
  /** Why this row is here, for the case that checks it. */
  why: string;
}

let seq = 2000;
const doc = (t: Tenant) => `${DOC_PREFIX[t.dorm]}/${String((seq += 1)).padStart(6, "0")}`;

/*
 * Bucket boundaries. MES's formula buckets the Age column, and Age is the
 * report date minus the due date, so to land a row on an exact age we bill it
 * that many days before the report plus the fifteen day term.
 */
const ageRow = (code: string, age: number, bucket: string, amount: number): Row => ({
  code,
  billedDaysAgo: age + TERM,
  description: "Occupancy Fee Charges for the month",
  amount,
  bucket,
  type: "Occupancy Fee",
  why: `Age lands on exactly ${age} days, which MES's formula calls "${bucket}"`,
});

const ROWS: Row[] = [
  /* --- every bucket boundary, and one day either side of each ----------- */
  ageRow("DORM-9001", -1, "Current", 1200),
  ageRow("DORM-9001", 0, "Current", 1300),
  ageRow("DORM-9001", 15, "Current", 1400),
  ageRow("DORM-9002", 16, "30 days", 2100),
  ageRow("DORM-9002", 45, "30 days", 2200),
  ageRow("DORM-9003", 46, "60 days", 3100),
  ageRow("DORM-9003", 75, "60 days", 3200),
  ageRow("DORM-9004", 76, "90 days", 4100),
  ageRow("DORM-9004", 105, "90 days", 4200),
  ageRow("DORM-9005", 106, "More than 90 days", 5100),
  ageRow("DORM-9005", 400, "More than 90 days", 5200),

  /* --- credit deadlines, by billing date ------------------------------- */
  { code: "DORM-9006", billedDaysAgo: 0, description: "Occupancy Fee Charges for the month", amount: 6100,
    why: "Billed on the report date itself, so the run is inside its credit period" },
  { code: "DORM-9006", billedDaysAgo: CREDIT, description: "Occupancy Fee Charges for the month", amount: 6200,
    why: `Billed exactly ${CREDIT} days ago: the last day still inside credit` },
  { code: "DORM-9007", billedDaysAgo: CREDIT + 1, description: "Occupancy Fee Charges for the month", amount: 7100,
    why: `Billed ${CREDIT + 1} days ago: the first day past the credit period` },
  { code: "DORM-9007", billedDaysAgo: FINAL, description: "Occupancy Fee Charges for the month", amount: 7200,
    why: `Billed exactly ${FINAL} days ago: on the second deadline, not past it` },
  { code: "DORM-9008", billedDaysAgo: FINAL + 1, description: "Occupancy Fee Charges for the month", amount: 8100,
    why: `Billed ${FINAL + 1} days ago: the first day past the second deadline` },
  { code: "DORM-9008", billedDaysAgo: -5, description: "Occupancy Fee Charges for next month", amount: 8200,
    why: "Billed after the report date, so nothing is due yet" },

  /* --- every charge type MES group by ---------------------------------- */
  { code: "DORM-9008", billedDaysAgo: 40, description: "Security Deposit - REFUNDABLE", amount: 9000,
    type: "Security Deposit", why: "A deposit still on the ledger, which is the source of the Security Deposit column" },
  { code: "DORM-9009", billedDaysAgo: 60, description: "BEING SECURITY DEPOSIT OF IRONGATE P/L HAS BEEN OFFSET AGAINST A/R OUTSTANDING",
    docOverride: "JPD1CN/0091", amount: -4000, type: "Security Deposit",
    why: "A deposit already spent against arrears, which is not a deposit held" },
  { code: "DORM-9007", billedDaysAgo: 35, description: "Admin Fee For Late Payment", amount: 100,
    type: "Late Payment Fee", why: "The $100 fee already raised, which is the Late Payment tab" },
  { code: "DORM-9006", billedDaysAgo: 35, description: "Admin Fee for Rejected Giro - 01-SEP-26", amount: 100,
    type: "Rejected GIRO Fee", why: "A bounced GIRO, which is how a tenant is known to be on GIRO" },
  { code: "DORM-9005", billedDaysAgo: 65, description: "Admin Fee for Rejected Giro - 02-JUL-26", amount: 100,
    type: "Rejected GIRO Fee", why: "A second bounced GIRO, which makes this tenant a repeat defaulter" },
  { code: "DORM-9005", billedDaysAgo: 95, description: "Admin Fee for Rejected Giro - 02-JUN-26", amount: 100,
    type: "Rejected GIRO Fee", why: "A third bounce for the same tenant" },
  { code: "DORM-9002", billedDaysAgo: 50, description: "Stamp Duty", amount: 350,
    type: "Stamp Duty", why: "MES categorise stamp duty as Reimbursement, so it is found by its wording" },
  { code: "DORM-9003", billedDaysAgo: 50, description: "Quarterly Charges for Season Parking of vehicle SGX1234A", amount: 480,
    type: "Season Parking", why: "The parking tab, which no MES export has ever contained a line for" },
  { code: "DORM-9004", billedDaysAgo: 25, description: "ONEFM maintenance works for the quarter",
    docOverride: "JPD2FM/5501", amount: 2750, type: "1FM Maintenance",
    why: 'Identified by the document prefix, per MES: 1FM = Prefix "DORMFM"' },
  { code: "DORM-9004", billedDaysAgo: 25, description: "GST output tax",
    docOverride: "JPD2FM/5501", amount: 247.5, type: "1FM Maintenance",
    why: "The VAT line on a 1FM invoice belongs to 1FM too, by its document number" },

  /* --- one company, two dormitories ------------------------------------ */
  // Two rows, because the split is on the account and an account is company
  // plus dormitory. One row would leave the second account empty, which is
  // not the case worth testing.
  { code: "DORM-9010", billedDaysAgo: 20, description: "Occupancy Fee Charges for the month", amount: 10100,
    why: "The same company at its first dormitory" },
  { code: "DORM-9010", billedDaysAgo: 20, description: "Occupancy Fee Charges for the month", amount: 3300,
    why: "And at its second, which is a separate account and a separate balance" },

  /* --- awkward but legitimate ------------------------------------------ */
  { code: "DORM-9001", billedDaysAgo: 70, description: "Credit note for overcharged occupancy",
    docOverride: "JPD1CN/0092", amount: -250,
    why: "A credit note, so the arithmetic has to cope with a negative on a live tenant" },
  { code: "DORM-9009", billedDaysAgo: 22, description: "Occupancy Fee Charges for the month", amount: 0.005,
    why: "Half a cent, which is where rounding that leans one way shows itself" },
];

/* --------------------------------------------------- build the workbook */

const tenantAt = (code: string, n: number) =>
  TENANTS.filter((t) => t.code === code)[n] ?? TENANTS.find((t) => t.code === code)!;

const bucketOf = (age: number) =>
  age <= 15 ? "Current"
    : age <= 45 ? "30 days"
      : age <= 75 ? "60 days"
        : age <= 105 ? "90 days" : "More than 90 days";

const HEADER = [
  "Customer", "Transaction Type", "Company Name", "End User: Industry Type",
  "Date", "Description", "Document Number", "Linked Contract",
  "Contract Item Start Date", "Contract: Contract End Date", "Due Date",
  "Age", "Aging", "Open Balance", "Primary Sales Rep",
];

/*
 * MES's own layout, which is not one row per line.
 *
 * Column A carries the customer on a group header row, then every line of
 * that customer follows with column A blank and the name repeated in column
 * C, and the group closes with a "Total - DORM-x" row. Writing a flat sheet
 * instead produced a file the parser refused outright, which is the parser
 * being right: a flat sheet is not the export MES send.
 */
const sheet: unknown[][] = [HEADER];
const built: { row: Row; tenant: Tenant; billed: string; due: string; age: number }[] = [];

interface Group { tenant: Tenant; rows: Row[] }
const groups: Group[] = [];
let junctionSeen = 0;
for (const row of ROWS) {
  const tenant =
    row.code === "DORM-9010"
      ? tenantAt(row.code, junctionSeen++ === 0 ? 0 : 1)
      : tenantAt(row.code, 0);
  const key = `${tenant.code}-${tenant.dorm}`;
  let g = groups.find((x) => `${x.tenant.code}-${x.tenant.dorm}` === key);
  if (!g) { g = { tenant, rows: [] }; groups.push(g); }
  g.rows.push(row);
}

for (const g of groups) {
  const label = `${g.tenant.code} ${g.tenant.name}`;
  sheet.push([label, "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);

  let subtotal = 0;
  for (const row of g.rows) {
    const billed = plus(REPORT, -row.billedDaysAgo);
    const due = plus(billed, TERM);
    const age = between(due, REPORT);
    subtotal += row.amount;

    sheet.push([
      "",
      row.amount < 0 ? "Credit Memo" : "Invoice",
      label,
      "Marine & Offshore",
      billed,
      row.description,
      row.docOverride ?? doc(g.tenant),
      "",
      "",
      "",
      due,
      age,
      bucketOf(age),
      row.amount,
      g.tenant.rep,
    ]);
    built.push({ row, tenant: g.tenant, billed, due, age });
  }

  // MES close each customer with their own total, which is what lets our
  // figures be checked against theirs rather than only against themselves.
  const t = Math.round(subtotal * 100) / 100;
  sheet.push([
    `Total - ${label}`, "", "", "", "", "", "", "", "", "", "", "", "",
    t, "",
  ]);
}

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  wb, XLSX.utils.aoa_to_sheet(sheet), "Finance AR Download",
);

/*
 * Written to public/ as well as test-data/.
 *
 * The terminal reads it off disk; the Checks screen fetches it and parses it
 * in the browser with the same reader an upload goes through. That is the
 * version of this evidence worth showing a client: a file the code has never
 * seen, read in front of them rather than described to them.
 */
mkdirSync(path.join(ROOT, "test-data"), { recursive: true });
mkdirSync(path.join(ROOT, "public", "test-data"), { recursive: true });
const outPath = path.join(ROOT, "test-data", "AR Test Data.xlsx");
const bytes = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
writeFileSync(outPath, bytes);
writeFileSync(path.join(ROOT, "public", "test-data", "AR Test Data.xlsx"), bytes);

/* ------------------------------------------- and the matching contact list */

const contactRows: unknown[][] = [["Company Name", "Status", "Company Name", "Email Address"]];
const seenContact = new Set<string>();
for (const t of TENANTS) {
  if (seenContact.has(t.code)) continue;
  seenContact.add(t.code);
  if (!t.emails) continue;
  contactRows.push([`${t.code} ${t.name}`, "Live", t.name, t.emails.join("; ")]);
}
const cwb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(cwb, XLSX.utils.aoa_to_sheet(contactRows), "Total");
const cbytes = XLSX.write(cwb, { type: "buffer", bookType: "xlsx" });
writeFileSync(path.join(ROOT, "test-data", "Contact Test Data.xlsx"), cbytes);
writeFileSync(
  path.join(ROOT, "public", "test-data", "Contact Test Data.xlsx"), cbytes,
);

/* ------------------------------------------------- report what was built */

console.log(`\n  ${outPath}`);
console.log(`  report date ${REPORT}, ${built.length} charge lines ` +
  `(${sheet.length - 1} sheet rows with headers and totals), ` +
  `${new Set(TENANTS.map((t) => `${t.code}-${t.dorm}`)).size} accounts`);
console.log(`  billing dates: ${new Set(built.map((b) => b.billed)).size} distinct`);
console.log(`  total: ${built.reduce((n, b) => n + b.row.amount, 0).toFixed(2)}`);
console.log(`\n  ages placed: ${built.map((b) => b.age).sort((a, b) => a - b).join(", ")}`);

// The facts the case file needs, printed so build-cases.py can be kept honest
// against them rather than having them typed in twice.
const facts = {
  report: REPORT,
  lines: built.length,
  accounts: new Set(TENANTS.map((t) => `${t.code}-${t.dorm}`)).size,
  billingDates: new Set(built.map((b) => b.billed)).size,
  total: Number(built.reduce((n, b) => n + b.row.amount, 0).toFixed(2)),
  reps: new Set(TENANTS.map((t) => t.rep)).size,
  rows: built.map((b) => ({
    code: b.tenant.code,
    dorm: b.tenant.dorm,
    billed: b.billed,
    due: b.due,
    age: b.age,
    bucket: bucketOf(b.age),
    expectBucket: b.row.bucket ?? null,
    expectType: b.row.type ?? null,
    amount: b.row.amount,
    billedDaysAgo: b.row.billedDaysAgo,
    description: b.row.description,
    documentNumber: b.row.docOverride ?? null,
    why: b.row.why,
  })),
};
writeFileSync(
  path.join(ROOT, "test-data", "facts.json"),
  JSON.stringify(facts, null, 2),
  "utf8",
);
console.log(`\n  facts written to test-data/facts.json\n`);
