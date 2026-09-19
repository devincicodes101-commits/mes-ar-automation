/**
 * December: a company nobody has chased yet.
 *
 *   npm run build:december
 *
 * The earlier files all carry history by now. Blue Horizon has had both
 * letters and three fees, Keppel has had a reminder, Merlion is held back on
 * GIRO every month. Useful for showing what a long chase looks like, and no
 * use at all for showing one starting.
 *
 * So this adds SENTOSA COLD STORAGE, at The Leo, which nothing has ever been
 * done about: no letter, no call, no fee, no promise. They can be taken round
 * the whole cycle in front of somebody — first reminder, final notice, the
 * call, the $100 — and every screen moves as it happens rather than already
 * being full.
 *
 * The Leo is deliberate too. It is the fourth dormitory and no test file has
 * used it, so the document numbers, the property filter and the aging board's
 * fourth column all get exercised for the first time here.
 *
 * ---------------------------------------------------------------------------
 * Everyone else carries on
 *
 * Blue Horizon owes more again, Keppel ages, Merlion still carries the
 * rejected-GIRO fee. Tuas keeps the three late payment fees MES's own ledger
 * gave them. A demo that resets the world every month is not showing a system
 * that runs every month.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

const OUT = path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", "Downloads");
const REPORT_DATE = "2026-12-31";
const TERM = 15;

interface Company {
  code: string;
  name: string;
  dorm: "JPD1" | "JPD2" | "BSD" | "LEO";
  rep: string;
  industry: string;
}

const SENTOSA: Company = {
  code: "DORM-309", name: "SENTOSA COLD STORAGE PTE. LTD.",
  dorm: "LEO", rep: "1842 Wei Ling", industry: "Food & Beverage",
};
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

const DECEMBER: Line[] = [
  /*
   * Sentosa: two months unpaid and nothing else. Old enough to be chased on
   * the day the report is read — 47 days past due on the older line — so the
   * first reminder can go out in the meeting rather than next month.
   */
  { company: SENTOSA, billedDaysAgo: 62, description: "Occupancy Fee Charges for the month", amount: 12500 },
  { company: SENTOSA, billedDaysAgo: 31, description: "Occupancy Fee Charges for the month", amount: 5900 },

  // Blue Horizon, worse again.
  { company: BLUE_HORIZON, billedDaysAgo: 292, description: "Security deposit held", amount: 6000, doc: "BSDSD/0012" },
  { company: BLUE_HORIZON, billedDaysAgo: 171, description: "Occupancy Fee Charges for the month", amount: 20000 },
  { company: BLUE_HORIZON, billedDaysAgo: 80, description: "Occupancy Fee Charges for the month", amount: 8000 },
  { company: BLUE_HORIZON, billedDaysAgo: 49, description: "Occupancy Fee Charges for the month", amount: 5000 },
  { company: BLUE_HORIZON, billedDaysAgo: 19, description: "Occupancy Fee Charges for the month", amount: 4000 },

  { company: KEPPEL, billedDaysAgo: 146, description: "Occupancy Fee Charges for the month", amount: 5000 },

  { company: MERLION, billedDaysAgo: 121, description: "Occupancy Fee Charges for the month", amount: 11000 },
  { company: MERLION, billedDaysAgo: 137, description: "Admin Fee For The Rejected GIRO", amount: 100, doc: "BSDGR/0021" },

  { company: TUAS, billedDaysAgo: 76, description: "Occupancy Fee Charges for the month", amount: 14500 },
  { company: TUAS, billedDaysAgo: 136, description: "Admin Fee For Late Payment", amount: 100, doc: "JPD2LP/0071" },
  { company: TUAS, billedDaysAgo: 106, description: "Admin Fee For Late Payment", amount: 100, doc: "JPD2LP/0082" },
  { company: TUAS, billedDaysAgo: 76, description: "Admin Fee For Late Payment", amount: 100, doc: "JPD2LP/0093" },
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
for (const l of DECEMBER) {
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
      l.doc ?? `${g.company.dorm}786/${3200 + n}`,
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
const file = path.join(OUT, "Test 5 - AR Report December (a new company to chase).xlsx");
writeFileSync(file, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

console.log(`\n  ${file}\n`);
for (const s of said) console.log(s);
console.log(`\n  ${n} charge lines, grand total ${grand.toFixed(2)}`);
console.log("  SENTOSA COLD STORAGE is new, at The Leo, and has never been chased.\n");
