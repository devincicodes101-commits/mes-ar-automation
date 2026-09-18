/**
 * Two small AR reports, four companies each, for testing by eye.
 *
 *   npm run simple
 *
 * Small enough that every number on every screen can be checked by hand. The
 * scenario files are richer and prove more; these prove you can follow one
 * company through a month and agree with what the system says about it.
 *
 * The companies are all in the contact list already in Downloads, so the
 * addresses link up and reminders can actually be composed.
 *
 * ---------------------------------------------------------------------------
 * What the two files are for
 *
 * Between them they cover the four things a comparison can say about a tenant,
 * which is the part of the system that cannot be checked from one file:
 *
 *   Harbourfront   in September, gone in October        paid in full
 *   Keppel Steel   owes less in October                 part paid
 *   Blue Horizon   owes more, and older                 getting worse
 *   Merlion Food   unchanged                            no movement
 *   Changi Marine  absent in September, there in October new
 *
 * Within each file there is a GIRO client, a credit note, a deposit and a 1FM
 * line, because those are the four things people most often ask to see working
 * and they cannot be seen in a plain rent-only file.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

const OUT = path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", "Downloads");

const pad = (n: number) => String(n).padStart(2, "0");

function plus(from: string, days: number): string {
  const [y, m, d] = from.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d!, 12);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function between(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`);
  const b = new Date(`${to}T12:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** MES's due dates land 15 days after the billing date. */
const TERM = 15;

/** Their own formula, from the Formula tab. */
const bucketOf = (age: number) =>
  age <= 15 ? "Current"
    : age <= 45 ? "30 days"
      : age <= 75 ? "60 days"
        : age <= 105 ? "90 days" : "More than 90 days";

interface Company {
  code: string;
  name: string;
  dorm: "JPD1" | "BSD";
  rep: string;
  industry: string;
}

/* Every one of these is in Client Contact List.xlsx already. */
const HARBOURFRONT: Company = { code: "DORM-101", name: "HARBOURFRONT MARINE PTE. LTD.",
  dorm: "JPD1", rep: "2611 Ray Ang", industry: "Marine & Offshore" };
const KEPPEL: Company = { code: "DORM-102", name: "KEPPEL STEEL WORKS PTE. LTD.",
  dorm: "JPD1", rep: "2611 Ray Ang", industry: "Marine & Offshore" };
const BLUE_HORIZON: Company = { code: "DORM-201", name: "BLUE HORIZON LOGISTICS PTE. LTD.",
  dorm: "BSD", rep: "1842 Wei Ling", industry: "Logistics" };
const MERLION: Company = { code: "DORM-204", name: "MERLION FOOD PROCESSING PTE. LTD.",
  dorm: "BSD", rep: "1842 Wei Ling", industry: "Food & Beverage" };
const CHANGI: Company = { code: "DORM-205", name: "CHANGI MARINE SUPPLY PTE. LTD.",
  dorm: "BSD", rep: "1842 Wei Ling", industry: "Marine & Offshore" };

interface Line {
  company: Company;
  billedDaysAgo: number;
  description: string;
  amount: number;
  doc?: string;
  expect: string;
}

const RENT = "Occupancy Fee Charges for the month";

/* --------------------------------------------------------------- month one */

const SEPT = "2026-09-30";

const SEPTEMBER: Line[] = [
  { company: HARBOURFRONT, billedDaysAgo: 40, description: RENT, amount: 9000,
    expect: "25 days overdue, 30 day bucket. Gone entirely next month: paid in full." },

  { company: KEPPEL, billedDaysAgo: 55, description: RENT, amount: 14000,
    expect: "40 days overdue, 30 day bucket." },
  { company: KEPPEL, billedDaysAgo: 55, description: "Credit note for overcharged occupancy",
    amount: -2000, doc: "JPD1CN/0041",
    expect: "A credit note. Their total should read 12,000, not 14,000." },

  { company: BLUE_HORIZON, billedDaysAgo: 80, description: RENT, amount: 20000,
    expect: "65 days overdue. Worse next month." },
  { company: BLUE_HORIZON, billedDaysAgo: 200, description: "Security deposit held",
    amount: 6000, doc: "BSDSD/0012",
    expect: "A deposit, 185 days old, so it is their oldest money and puts their worst bucket at 90+. Risk Exposure 26,000 - 6,000 = 20,000." },

  { company: MERLION, billedDaysAgo: 30, description: RENT, amount: 11000,
    expect: "15 days overdue. Current, so not chased. Unchanged next month." },
  { company: MERLION, billedDaysAgo: 46, description: "Admin Fee For The Rejected GIRO",
    amount: 100, doc: "BSDGR/0021",
    expect: "Marks them as a GIRO client. Held back from the $100 fee on the 16th." },
];

/* --------------------------------------------------------------- month two */

const OCT = "2026-10-31";

const OCTOBER: Line[] = [
  // Harbourfront is absent. That is the point: absent means paid in full.

  { company: KEPPEL, billedDaysAgo: 86, description: RENT, amount: 5000,
    expect: "Part paid. Was 12,000, now 5,000, and the money has aged to 60 days." },

  { company: BLUE_HORIZON, billedDaysAgo: 111, description: RENT, amount: 20000,
    expect: "The same rent, now 96 days overdue." },
  { company: BLUE_HORIZON, billedDaysAgo: 20, description: RENT, amount: 8000,
    expect: "And a new charge on top, so they owe more as well as older." },
  { company: BLUE_HORIZON, billedDaysAgo: 231, description: "Security deposit held",
    amount: 6000, doc: "BSDSD/0012",
    expect: "The same deposit, still held." },

  { company: MERLION, billedDaysAgo: 61, description: RENT, amount: 11000,
    expect: "The identical 11,000. No movement, though it has aged." },
  { company: MERLION, billedDaysAgo: 77, description: "Admin Fee For The Rejected GIRO",
    amount: 100, doc: "BSDGR/0021",
    expect: "Still on GIRO, still held back from the fee." },

  { company: CHANGI, billedDaysAgo: 35, description: RENT, amount: 7500,
    expect: "Not in September at all. Owing for the first time." },
  { company: CHANGI, billedDaysAgo: 35, description: "1FM maintenance charges for the month",
    amount: 1200, doc: "BSDFM/0031",
    expect: "1FM, recognised from the BSDFM prefix. Its own revenue tab." },
];

/* ------------------------------------------------------------ month three */

/*
 * Everybody has paid.
 *
 * A real export in that situation has no charge lines at all. NetSuite lists
 * what is outstanding and nothing is, so the file keeps its header, its date
 * and a Grand Total of zero and has nothing in between. Those three are what
 * tell the system this is a real report that came back empty rather than the
 * wrong file, which is a distinction worth having: one is the best month MES
 * could have and the other would wipe a month of real figures.
 *
 * Worth existing because it is the outcome the whole process aims at, and
 * until this file was written the system refused to record it.
 */
const NOV = "2026-11-30";
const NOVEMBER: Line[] = [];

/* ------------------------------------------------------------ the workbook */

const HEADER = [
  "Customer", "Transaction Type", "Company Name", "End User: Industry Type",
  "Date", "Description", "Document Number", "Linked Contract",
  "Contract Item Start Date", "Contract: Contract End Date", "Due Date",
  "Age", "Aging", "Open Balance", "Primary Sales Rep",
];

const blank = (n: number) => Array.from({ length: n }, () => "");

function build(reportDate: string, lines: Line[]) {
  const rows: unknown[][] = [];
  rows.push([`As of ${reportDate}`, ...blank(14)]);
  rows.push(["Consol : MES Group : KT Mesdorm Pte Ltd", ...blank(14)]);
  rows.push(blank(15));
  rows.push(HEADER);

  const groups = new Map<string, { company: Company; lines: Line[] }>();
  for (const l of lines) {
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
    // MES's own layout: the customer on a header row, the lines beneath with
    // column A blank, and the group closed by its own total.
    rows.push([label, ...blank(14)]);

    let subtotal = 0;
    for (const l of g.lines) {
      const billed = plus(reportDate, -l.billedDaysAgo);
      const due = plus(billed, TERM);
      const age = between(due, reportDate);
      subtotal += l.amount;
      n += 1;

      rows.push([
        "",
        l.amount < 0 ? "Credit Memo" : "Invoice",
        label,
        g.company.industry,
        billed,
        l.description,
        l.doc ?? `${g.company.dorm}786/${3000 + n}`,
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
    said.push(`  ${label.padEnd(50)} ${g.company.dorm.padEnd(5)} ${t.toFixed(2).padStart(12)}`);
  }

  rows.push(blank(15));
  rows.push(["Grand Total", ...blank(12), Math.round(grand * 100) / 100, ""]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Finance AR Download");
  return { wb, said, count: n, grand };
}

/* ------------------------------------------------------------------ write */

mkdirSync(OUT, { recursive: true });

for (const [date, lines, name] of [
  [SEPT, SEPTEMBER, "Test 1 - AR Report September.xlsx"],
  [OCT, OCTOBER, "Test 2 - AR Report October.xlsx"],
  [NOV, NOVEMBER, "Test 3 - AR Report November - everyone paid.xlsx"],
] as const) {
  const { wb, said, count, grand } = build(date, lines);
  console.log(`\n${name}    as of ${date}`);

  /*
   * A file open in Excel cannot be overwritten on Windows, and stopping there
   * would mean the other two never get written. Reported and skipped instead,
   * because the usual reason one is locked is that somebody is looking at it,
   * which is not a reason to withhold the rest.
   */
  try {
    writeFileSync(path.join(OUT, name), XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  } catch (e) {
    const busy = (e as { code?: string }).code === "EBUSY";
    console.log(
      busy
        ? "  NOT WRITTEN. It is open in Excel. Close it and run this again."
        : `  NOT WRITTEN. ${(e as Error).message}`,
    );
    continue;
  }

  for (const s of said) console.log(s);
  console.log(`  ${" ".repeat(50)} ${String(count).padStart(5)} lines ${grand.toFixed(2).padStart(12)}`);
}

console.log("\n\nWHAT EACH LINE IS THERE TO SHOW\n");
console.log("September");
for (const l of SEPTEMBER) console.log(`  ${l.company.code}  ${l.expect}`);
console.log("\nOctober");
for (const l of OCTOBER) console.log(`  ${l.company.code}  ${l.expect}`);
console.log("\n  DORM-101  Absent from October entirely. MES read that as paid in full.");

console.log("\n\nWHAT 'WHAT CHANGED' SHOULD SAY AFTER BOTH\n");
console.log("  Harbourfront Marine    PAID IN FULL   9,000  ->  gone");
console.log("  Keppel Steel           PART PAID     12,000  ->  5,000   and aged a bucket");
console.log("  Blue Horizon           OWES MORE     26,000  -> 34,000");
console.log("  Merlion Food           NO CHANGE     11,100  -> 11,100  and aged a bucket");
console.log("  Changi Marine          NEW              n/a  ->  8,700");
console.log("");
console.log("  Blue Horizon does not read as aged, and that is right: their deposit is");
console.log("  already the oldest money they have, so their worst bucket was 90+ in both");
console.log("  months. Merlion is the clearest one to watch, because the amount does not");
console.log("  move at all and only the age does.");
console.log("");
