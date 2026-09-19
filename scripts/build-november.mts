/**
 * November: the month the chase runs out of road.
 *
 *   npm run build:november
 *
 * September and October showed a month working. This one shows what the
 * system is for once a month has been round more than once, which is the
 * question MES's own process leaves hanging: their lifecycle note ends at
 * "still unpaid, rolls into next month one bucket older, and the cycle
 * restarts". There is no escalation to build. What they have instead is a
 * need to tell a tenant who pays late every month from one who forgot once.
 *
 * ---------------------------------------------------------------------------
 * What each tenant is for
 *
 *   BLUE HORIZON  owes more again. Third month running. Once November's fee
 *                 is raised they cross MES's three-fee line and become a
 *                 repeat defaulter — the rule that had never fired.
 *
 *   KEPPEL        pays nothing and ages. Second cycle.
 *
 *   MERLION       carries a rejected-GIRO fee, so the $100 is held back for
 *                 the third month. The exclusion has to survive repetition,
 *                 not just work once.
 *
 *   CHANGI        absent. Paid in full, and the fee raised against them in
 *                 October stops being chargeable.
 *
 *   TUAS          new to this system and not new to being late. Their lines
 *                 carry three of MES's own "Admin Fee For Late Payment"
 *                 charges from August, September and October, so they arrive
 *                 already a repeat defaulter on the first upload — without
 *                 this system having chased them once.
 *
 * That last one matters more than it looks. It is the difference between a
 * screen that only knows what it did itself and one that reads MES's ledger
 * too, and it is the case that caught three separate faults in this project.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

const OUT = path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", "Downloads");
const REPORT_DATE = "2026-11-30";

/** MES issue a due date fifteen days after billing. */
const TERM = 15;

interface Company {
  code: string;
  name: string;
  dorm: "JPD1" | "JPD2" | "BSD";
  rep: string;
  industry: string;
}

const BLUE_HORIZON: Company = {
  code: "DORM-201", name: "BLUE HORIZON LOGISTICS PTE. LTD.",
  dorm: "BSD", rep: "1842 Wei Ling", industry: "Logistics",
};
const KEPPEL: Company = {
  code: "DORM-102", name: "KEPPEL STEEL WORKS PTE. LTD.",
  dorm: "JPD1", rep: "2611 Ray Ang", industry: "Marine & Offshore",
};
const MERLION: Company = {
  code: "DORM-204", name: "MERLION FOOD PROCESSING PTE. LTD.",
  dorm: "BSD", rep: "1842 Wei Ling", industry: "Food & Beverage",
};
const TUAS: Company = {
  code: "DORM-118", name: "TUAS PRECISION ENGINEERING PTE. LTD.",
  dorm: "JPD2", rep: "2611 Ray Ang", industry: "Precision Engineering",
};

interface Line {
  company: Company;
  billedDaysAgo: number;
  description: string;
  amount: number;
  doc?: string;
}

const NOVEMBER: Line[] = [
  // Blue Horizon: the March deposit and the July rent are still there, and
  // another month's occupancy has gone unpaid on top.
  { company: BLUE_HORIZON, billedDaysAgo: 262, description: "Security deposit held", amount: 6000, doc: "BSDSD/0012" },
  { company: BLUE_HORIZON, billedDaysAgo: 141, description: "Occupancy Fee Charges for the month", amount: 20000 },
  { company: BLUE_HORIZON, billedDaysAgo: 50, description: "Occupancy Fee Charges for the month", amount: 8000 },
  { company: BLUE_HORIZON, billedDaysAgo: 19, description: "Occupancy Fee Charges for the month", amount: 5000 },

  // Keppel: the same 5,000, one month older.
  { company: KEPPEL, billedDaysAgo: 116, description: "Occupancy Fee Charges for the month", amount: 5000 },

  // Merlion: unchanged, and still carrying the bounced deduction that keeps
  // them out of the fee run.
  { company: MERLION, billedDaysAgo: 91, description: "Occupancy Fee Charges for the month", amount: 11000 },
  { company: MERLION, billedDaysAgo: 107, description: "Admin Fee For The Rejected GIRO", amount: 100, doc: "BSDGR/0021" },

  // Tuas: new to us, and MES have already charged them three times.
  { company: TUAS, billedDaysAgo: 46, description: "Occupancy Fee Charges for the month", amount: 14500 },
  { company: TUAS, billedDaysAgo: 106, description: "Admin Fee For Late Payment", amount: 100, doc: "JPD2LP/0071" },
  { company: TUAS, billedDaysAgo: 76, description: "Admin Fee For Late Payment", amount: 100, doc: "JPD2LP/0082" },
  { company: TUAS, billedDaysAgo: 46, description: "Admin Fee For Late Payment", amount: 100, doc: "JPD2LP/0093" },
];

/* ----------------------------------------------------------------- dates */

const plus = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const between = (from: string, to: string) =>
  Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000,
  );

/** MES's own buckets, counted from the due date. */
function bucketOf(age: number): string {
  if (age <= 15) return "Current";
  if (age <= 45) return "30 days";
  if (age <= 75) return "60 days";
  if (age <= 105) return "90 days";
  return "More than 90 days";
}

/* -------------------------------------------------------------- workbook */

const HEADER = [
  "Customer", "Transaction Type", "Company Name", "End User: Industry Type",
  "Date", "Description", "Document Number", "Linked Contract",
  "Contract Item Start Date", "Contract: Contract End Date", "Due Date",
  "Age", "Aging", "Open Balance", "Primary Sales Rep",
];

const blank = (n: number) => Array.from({ length: n }, () => "");

const rows: unknown[][] = [
  [`As of ${REPORT_DATE}`, ...blank(14)],
  ["Consol : MES Group : KT Mesdorm Pte Ltd", ...blank(14)],
  blank(15),
  HEADER,
];

const groups = new Map<string, { company: Company; lines: Line[] }>();
for (const l of NOVEMBER) {
  const key = `${l.company.code}|${l.company.dorm}`;
  const g = groups.get(key) ?? { company: l.company, lines: [] };
  g.lines.push(l);
  groups.set(key, g);
}

let n = 0;
let grand = 0;
const said: string[] = [];

for (const g of groups.values()) {
  const label = `${g.company.code} ${g.company.name}`;
  rows.push([label, ...blank(14)]);

  let subtotal = 0;
  for (const l of g.lines) {
    const billed = plus(REPORT_DATE, -l.billedDaysAgo);
    const due = plus(billed, TERM);
    const age = between(due, REPORT_DATE);
    subtotal += l.amount;
    n += 1;

    rows.push([
      "",
      l.amount < 0 ? "Credit Memo" : "Invoice",
      label,
      g.company.industry,
      billed,
      l.description,
      l.doc ?? `${g.company.dorm}786/${3100 + n}`,
      "", "", "",
      due,
      age,
      bucketOf(age),
      Math.round(l.amount * 100) / 100,
      g.company.rep,
    ]);
  }

  const t = Math.round(subtotal * 100) / 100;
  grand += t;
  rows.push([`Total - ${label}`, ...blank(12), t, ""]);
  said.push(`  ${label.padEnd(48)} ${g.company.dorm.padEnd(5)} ${t.toFixed(2).padStart(12)}`);
}

rows.push(blank(15));
rows.push(["Grand Total", ...blank(12), Math.round(grand * 100) / 100, ""]);

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Finance AR Download");

mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, "Test 4 - AR Report November (the chase continues).xlsx");
writeFileSync(file, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

console.log(`\n  ${file}\n`);
for (const s of said) console.log(s);
console.log(`\n  ${n} charge lines, grand total ${grand.toFixed(2)}`);
console.log("  CHANGI MARINE SUPPLY is absent: they have paid.\n");
