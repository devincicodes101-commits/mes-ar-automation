/**
 * March 2027: a fresh month that will definitely be the one on screen.
 *
 *   npm run build:march
 *
 * Dated 2027-03-31, after Test 7's 2027-02-28, because only the newest report
 * is ever read and newest means the date printed on the front of the file. A
 * report dated earlier is stored and then ignored, which looks exactly like
 * the upload not working.
 *
 * ---------------------------------------------------------------------------
 * What moved since February
 *
 *   SENTOSA paid in full and is gone. Absent from a later file means paid.
 *   TUAS part paid — 14,700 down to 9,700.
 *   CHANGI is new, at Boon Lay, and has never been chased.
 *   Everyone else carries on with a month added and their oldest money older.
 *
 * Enough movement that What Changed has something to say, and few enough
 * tenants that somebody can check every row by hand.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

const OUT = path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", "Downloads");
const REPORT_DATE = "2027-03-31";
const TERM = 15;

interface Company {
  code: string;
  name: string;
  dorm: "JPD1" | "JPD2" | "BSD" | "LEO";
  rep: string;
  industry: string;
}

const ORCHARD: Company = { code: "DORM-401", name: "ORCHARD FACILITIES PTE. LTD.", dorm: "JPD1", rep: "2611 Ray Ang", industry: "Facilities Management" };
const KEPPEL: Company = { code: "DORM-102", name: "KEPPEL STEEL WORKS PTE. LTD.", dorm: "JPD1", rep: "2611 Ray Ang", industry: "Marine & Offshore" };
const TUAS: Company = { code: "DORM-118", name: "TUAS PRECISION ENGINEERING PTE. LTD.", dorm: "JPD2", rep: "2611 Ray Ang", industry: "Precision Engineering" };
const WOODLANDS: Company = { code: "DORM-404", name: "WOODLANDS LOGISTICS PTE. LTD.", dorm: "JPD2", rep: "2611 Ray Ang", industry: "Logistics" };
const BLUE_HORIZON: Company = { code: "DORM-201", name: "BLUE HORIZON LOGISTICS PTE. LTD.", dorm: "BSD", rep: "1842 Wei Ling", industry: "Logistics" };
const MERLION: Company = { code: "DORM-204", name: "MERLION FOOD PROCESSING PTE. LTD.", dorm: "BSD", rep: "1842 Wei Ling", industry: "Food & Beverage" };
const SELETAR: Company = { code: "DORM-402", name: "SELETAR ENGINEERING PTE. LTD.", dorm: "BSD", rep: "1842 Wei Ling", industry: "Precision Engineering" };
/* New this month, at Boon Lay, never chased. */
const CHANGI: Company = { code: "DORM-205", name: "CHANGI MARINE SUPPLY PTE. LTD.", dorm: "BSD", rep: "1842 Wei Ling", industry: "Marine & Offshore" };

interface Line { company: Company; billedDaysAgo: number; description: string; amount: number; doc?: string }

const OCCUPANCY = "Occupancy Fee Charges for the month";
const GIRO_FEE = "Admin Fee For The Rejected GIRO";
const LATE_FEE = "Admin Fee For Late Payment";

const MARCH: Line[] = [
  // Ray's book
  { company: ORCHARD, billedDaysAgo: 154, description: OCCUPANCY, amount: 9200 },
  { company: ORCHARD, billedDaysAgo: 93, description: OCCUPANCY, amount: 4100 },
  { company: ORCHARD, billedDaysAgo: 62, description: OCCUPANCY, amount: 3800 },
  { company: ORCHARD, billedDaysAgo: 31, description: OCCUPANCY, amount: 4400 },

  { company: KEPPEL, billedDaysAgo: 236, description: OCCUPANCY, amount: 5000 },
  { company: KEPPEL, billedDaysAgo: 31, description: OCCUPANCY, amount: 2600 },

  /* Part paid: 14,700 in February, 9,700 now. One late fee cleared and
     5,000 off the occupancy. */
  { company: TUAS, billedDaysAgo: 166, description: OCCUPANCY, amount: 9500 },
  { company: TUAS, billedDaysAgo: 226, description: LATE_FEE, amount: 100, doc: "JPD2LP/0071" },
  { company: TUAS, billedDaysAgo: 196, description: LATE_FEE, amount: 100, doc: "JPD2LP/0093" },

  { company: WOODLANDS, billedDaysAgo: 89, description: OCCUPANCY, amount: 11800 },
  { company: WOODLANDS, billedDaysAgo: 31, description: OCCUPANCY, amount: 3900 },

  // Wei Ling's book
  { company: BLUE_HORIZON, billedDaysAgo: 382, description: "Security deposit held", amount: 6000, doc: "BSDSD/0012" },
  { company: BLUE_HORIZON, billedDaysAgo: 261, description: OCCUPANCY, amount: 20000 },
  { company: BLUE_HORIZON, billedDaysAgo: 170, description: OCCUPANCY, amount: 8000 },
  { company: BLUE_HORIZON, billedDaysAgo: 139, description: OCCUPANCY, amount: 5000 },
  { company: BLUE_HORIZON, billedDaysAgo: 109, description: OCCUPANCY, amount: 4000 },
  { company: BLUE_HORIZON, billedDaysAgo: 31, description: OCCUPANCY, amount: 4500 },

  { company: MERLION, billedDaysAgo: 211, description: OCCUPANCY, amount: 11000 },
  { company: MERLION, billedDaysAgo: 227, description: GIRO_FEE, amount: 100, doc: "BSDGR/0021" },

  { company: SELETAR, billedDaysAgo: 124, description: OCCUPANCY, amount: 15400 },
  { company: SELETAR, billedDaysAgo: 62, description: OCCUPANCY, amount: 6200 },
  { company: SELETAR, billedDaysAgo: 31, description: OCCUPANCY, amount: 7100 },

  /* New. Two months unpaid, so old enough to be chased on the day it is read
     rather than next month. */
  { company: CHANGI, billedDaysAgo: 71, description: OCCUPANCY, amount: 8600 },
  { company: CHANGI, billedDaysAgo: 40, description: OCCUPANCY, amount: 4200 },

  /* SENTOSA is deliberately absent. They paid in full. */
];

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
for (const l of MARCH) {
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
      l.doc ?? `${g.company.dorm}786/${5500 + n}`,
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
  said.push(`  ${label.padEnd(46)} ${g.company.dorm.padEnd(5)} ${t.toFixed(2).padStart(12)}`);
}

rows.push(blank(15));
rows.push(["Grand Total", ...blank(12), Math.round(grand * 100) / 100, ""]);

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Finance AR Download");

mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, "Test 8 - AR Report March 2027.xlsx");
writeFileSync(file, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

console.log(`\n  ${file}   as of ${REPORT_DATE}\n`);
for (const s of said) console.log(s);
console.log(`\n  ${n} charge lines, grand total ${grand.toFixed(2)}`);
console.log("\n  Since February:");
console.log("    DORM-309 SENTOSA    gone          paid in full");
console.log("    DORM-118 TUAS       14,700 -> 9,700   part paid");
console.log("    DORM-205 CHANGI     new           at Boon Lay, never chased");
console.log("    everyone else       a month older, most owing more\n");
