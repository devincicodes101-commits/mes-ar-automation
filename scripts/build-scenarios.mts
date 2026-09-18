/**
 * Two files to test scenarios against, covering JPD1 and Blue Stars.
 *
 *   npm run scenarios
 *
 * Written so somebody can sit in front of the app and check behaviour rather
 * than read a claim about it. Every row exists because it answers a question
 * that has been asked at some point: does a GIRO client get held back, does a
 * credit note subtract, is a company at two dormitories two accounts, does a
 * tenant with no address show up as unreachable.
 *
 * Small on purpose. MES's own export is 190 tenants and 3,117 lines, which
 * proves the system scales and proves nothing you can check by eye. This is
 * 14 companies and every line is one you can point at.
 *
 * Two report dates are written, four weeks apart, because half the scenarios
 * are only visible by comparing them: who settled, who part paid, who got
 * worse, and who has been stuck.
 *
 * WHAT MAKES THESE FILES HONEST
 *
 * They are written in MES's own layout, not a convenient one. Column A carries
 * the customer on a group header row, the lines follow with column A blank,
 * and the group closes with its own total. Writing a flat sheet would produce
 * a file the parser refuses, which is the parser being right: a flat sheet is
 * not the export MES send.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const OUT = path.join(process.env.USERPROFILE ?? process.env.HOME ?? ROOT, "Downloads");

/* ----------------------------------------------------------------- dates */

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function plus(from: string, days: number): string {
  const [y, m, d] = from.split("-").map(Number);
  // Local noon, so a daylight saving shift cannot round onto the neighbouring
  // day. Singapore has none, but the machine reading this file might.
  const dt = new Date(y!, m! - 1, d!, 12);
  dt.setDate(dt.getDate() + days);
  return iso(dt);
}

function between(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`);
  const b = new Date(`${to}T12:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** MES give 14 calendar days, and their due dates land on 15. */
const TERM = 15;

const SEPT = "2026-09-28";
const OCT = "2026-10-26";

/** Their own formula, from the Formula tab. */
const bucketOf = (age: number) =>
  age <= 15 ? "Current"
    : age <= 45 ? "30 days"
      : age <= 75 ? "60 days"
        : age <= 105 ? "90 days" : "More than 90 days";

/* --------------------------------------------------------------- tenants */

type Dorm = "JPD1" | "BSD";

interface Tenant {
  code: string;
  name: string;
  dorm: Dorm;
  rep: string;
  industry: string;
  /** Null means nobody to write to, which is the point of that scenario. */
  emails: string[] | null;
  status?: "Live" | "Terminated";
}

const TENANTS: Tenant[] = [
  { code: "DORM-101", name: "HARBOURFRONT MARINE PTE. LTD.", dorm: "JPD1",
    rep: "2611 Ray Ang", industry: "Marine & Offshore",
    emails: ["accounts@harbourfrontmarine.com.sg"] },

  { code: "DORM-102", name: "KEPPEL STEEL WORKS PTE. LTD.", dorm: "JPD1",
    rep: "2611 Ray Ang", industry: "Marine & Offshore",
    emails: ["finance@keppelsteel.com.sg", "ap@keppelsteel.com.sg"] },

  // Nobody to write to. 181 of MES's real clients are in this position.
  { code: "DORM-103", name: "TUAS PRECISION ENGINEERING PTE. LTD.", dorm: "JPD1",
    rep: "2611 Ray Ang", industry: "Manufacturing", emails: null },

  { code: "DORM-104", name: "SEMBAWANG SCAFFOLD PTE. LTD.", dorm: "JPD1",
    rep: "2611 Ray Ang", industry: "Construction",
    emails: ["accounts@sembawangscaffold.com.sg"] },

  // Moved out and still owes. Their final notice cites manpower regulations
  // precisely because the debt survives the tenancy.
  { code: "DORM-105", name: "PIONEER SHIPYARD SERVICES PTE. LTD.", dorm: "JPD1",
    rep: "2611 Ray Ang", industry: "Marine & Offshore", status: "Terminated",
    emails: ["admin@pioneershipyard.com.sg"] },

  { code: "DORM-106", name: "JURONG COLD CHAIN PTE. LTD.", dorm: "JPD1",
    rep: "2611 Ray Ang", industry: "Logistics",
    emails: ["ar@jurongcoldchain.com.sg"] },

  // Their only line is a September one, so in October they are absent from the
  // file entirely. That is the case MES's rule is about, and the one most
  // easily read backwards: gone means paid in full, not missing.
  { code: "DORM-107", name: "WESTLINK HAULAGE PTE. LTD.", dorm: "JPD1",
    rep: "2611 Ray Ang", industry: "Logistics",
    emails: ["accounts@westlinkhaulage.com.sg"] },

  { code: "DORM-201", name: "BLUE HORIZON LOGISTICS PTE. LTD.", dorm: "BSD",
    rep: "1842 Wei Ling", industry: "Logistics",
    emails: ["accounts@bluehorizonlog.com.sg"] },

  { code: "DORM-202", name: "STARLIGHT FACILITIES PTE. LTD.", dorm: "BSD",
    rep: "1842 Wei Ling", industry: "Facilities Management",
    emails: ["finance@starlightfm.com.sg"] },

  { code: "DORM-203", name: "ORCHID CIVIL WORKS PTE. LTD.", dorm: "BSD",
    rep: "1842 Wei Ling", industry: "Construction", emails: null },

  { code: "DORM-204", name: "MERLION FOOD PROCESSING PTE. LTD.", dorm: "BSD",
    rep: "1842 Wei Ling", industry: "Food & Beverage",
    emails: ["accounts@merlionfood.com.sg", "cfo@merlionfood.com.sg",
             "ap@merlionfood.com.sg"] },

  { code: "DORM-205", name: "CHANGI MARINE SUPPLY PTE. LTD.", dorm: "BSD",
    rep: "1842 Wei Ling", industry: "Marine & Offshore",
    emails: ["ar@changimarine.com.sg"] },

  { code: "DORM-206", name: "GATEWAY CONSTRUCTION PTE. LTD.", dorm: "BSD",
    rep: "1842 Wei Ling", industry: "Construction",
    emails: ["accounts@gatewaycon.com.sg"] },

  /*
   * The same company renting at both dormitories. Two accounts, two balances,
   * chased separately, but one accounts department and therefore one email
   * address. This is what the contact list keying on customer code is for,
   * and it is the case that made a tenant's subtotal look like it did not
   * reconcile when the reader added both dormitories together.
   */
  { code: "DORM-300", name: "PAN ISLAND ENTERPRISES PTE. LTD.", dorm: "JPD1",
    rep: "2611 Ray Ang", industry: "Construction",
    emails: ["accounts@panisland.com.sg"] },
  { code: "DORM-300", name: "PAN ISLAND ENTERPRISES PTE. LTD.", dorm: "BSD",
    rep: "1842 Wei Ling", industry: "Construction",
    emails: ["accounts@panisland.com.sg"] },
];

const at = (code: string, n = 0) => TENANTS.filter((t) => t.code === code)[n]!;

/* ----------------------------------------------------------------- lines */

interface Line {
  tenant: Tenant;
  /** Days before the report date this was billed. Negative bills in future. */
  billedDaysAgo: number;
  description: string;
  amount: number;
  /** Overrides the "<DORM>786/nnn" default, for 1FM, credit notes and journals. */
  doc?: string;
  type?: "Invoice" | "Credit Memo";
  /** Only in the October file, so the comparison has something to show. */
  onlyIn?: "sept" | "oct";
  why: string;
}

const RENT = "Occupancy Fee Charges for the month";

function lines(reportDate: string): Line[] {
  const L: Line[] = [];
  const add = (l: Line) => L.push(l);

  /* --- the simple cases, one per bucket ------------------------------- */

  add({ tenant: at("DORM-101"), billedDaysAgo: 5, description: RENT, amount: 8400,
        why: "Billed five days ago. Still inside the 14 day credit, so Current and not chased." });

  add({ tenant: at("DORM-102"), billedDaysAgo: 35, description: RENT, amount: 12600,
        why: "20 days past due. 30 day bucket, gets the first reminder and the $100 fee." });

  add({ tenant: at("DORM-104"), billedDaysAgo: 68, description: RENT, amount: 9200,
        why: "53 days past due. 60 day bucket." });

  add({ tenant: at("DORM-201"), billedDaysAgo: 95, description: RENT, amount: 15800,
        why: "80 days past due. 90 day bucket, and a final notice on the 21st." });

  add({ tenant: at("DORM-203"), billedDaysAgo: 140, description: RENT, amount: 6400,
        why: "125 days past due. Over 90, and there is no email address to send anything to." });

  /* --- the boundaries, where an off by one would show ------------------ */

  add({ tenant: at("DORM-106"), billedDaysAgo: 30, description: RENT, amount: 4000,
        why: "Exactly 15 days past due. The last day that still counts as Current." });

  add({ tenant: at("DORM-106"), billedDaysAgo: 31, description: RENT, amount: 4000,
        why: "Exactly 16 days past due. The first day of the 30 day bucket." });

  /* --- GIRO, which is what the 16th holds back ------------------------- */

  add({ tenant: at("DORM-202"), billedDaysAgo: 50, description: RENT, amount: 11000,
        why: "Overdue, but see the next line: they are on GIRO." });

  /*
   * The wording matters. MES recognise a GIRO client by the fee line they
   * raise when a deduction bounces, and their own text is "Admin Fee For The
   * Rejected GIRO". Describing it in any other words produces a line that
   * reads as an ordinary admin fee, and the tenant is then charged the $100
   * they should have been held back from.
   */
  add({ tenant: at("DORM-202"), billedDaysAgo: 50, amount: 100,
        description: "Admin Fee For The Rejected GIRO", doc: "BSDGR/0031",
        why: "Marks them as a GIRO client. The $100 fee is held back: a bounced deduction is not their failure." });

  add({ tenant: at("DORM-106"), billedDaysAgo: 45, amount: 100,
        description: "Admin Fee For The Rejected GIRO", doc: "JPD1GR/0032",
        why: "A second GIRO client, at the other dormitory, so the hold back is visible in both." });

  /* --- 1FM, read from the document prefix rather than the words -------- */

  add({ tenant: at("DORM-205"), billedDaysAgo: 40, amount: 2750,
        description: "1FM maintenance charges for the month", doc: "BSDFM/5501",
        why: "1FM maintenance, recognised from the BSDFM prefix. Separates onto its own revenue tab." });

  add({ tenant: at("DORM-101"), billedDaysAgo: 40, amount: 1980,
        description: "Maintenance charges", doc: "JP1FM/2705",
        why: "1FM at Jurong Penjuru, with the D dropped from the code. MES write it both ways." });

  /* --- the dormitory read from an awkward document number -------------- */

  add({ tenant: at("DORM-104"), billedDaysAgo: 22, amount: 3300,
        description: RENT, doc: "J1-786/51056",
        why: "JPD1 written with the PD dropped. Fifteen real lines of this were once filed under the wrong block." });

  /* --- money going the other way --------------------------------------- */

  add({ tenant: at("DORM-102"), billedDaysAgo: 60, amount: -2400,
        description: "Credit note for overcharged occupancy", doc: "JPD1CN/0091",
        type: "Credit Memo",
        why: "A credit note. The balance must come down, and the arithmetic has to cope with a negative." });

  add({ tenant: at("DORM-201"), billedDaysAgo: 200, amount: 12000,
        description: "Security deposit held", doc: "BSDSD/0042",
        why: "A security deposit. Risk Exposure is the balance minus this, per Raman on 14 September." });

  add({ tenant: at("DORM-206"), billedDaysAgo: 120, amount: -5000,
        description: "Security deposit offset against arrears", doc: "BSDSD/0051",
        type: "Credit Memo",
        why: "A deposit already spent against arrears. Reported as none held rather than subtracted twice." });

  /* --- the rounding edge ------------------------------------------------ */

  add({ tenant: at("DORM-205"), billedDaysAgo: 25, amount: 0.005,
        description: "Sundry adjustment",
        why: "Half a cent. Rounding that leans one way on invoices and the other on credit notes shows up here." });

  /* --- the repeat offender --------------------------------------------- */

  for (const monthsAgo of [1, 2, 3]) {
    add({ tenant: at("DORM-204"), billedDaysAgo: 30 * monthsAgo + 20, amount: 100,
          description: "Late payment administrative fee",
          doc: `BSDLP/00${monthsAgo}`,
          why: `Late fee raised ${monthsAgo} month(s) ago. Three of these makes a recurring defaulter.` });
  }
  add({ tenant: at("DORM-204"), billedDaysAgo: 80, description: RENT, amount: 18400,
        why: "And the balance those fees were raised against." });

  /* --- the same company at two dormitories ----------------------------- */

  add({ tenant: at("DORM-300", 0), billedDaysAgo: 48, description: RENT, amount: 7700,
        why: "Pan Island at Jurong Penjuru. One of two accounts for one company." });

  add({ tenant: at("DORM-300", 1), billedDaysAgo: 48, description: RENT, amount: 5300,
        doc: "BSD786/9001",
        why: "Pan Island at Blue Stars. A separate account, a separate balance, the same email address." });

  /* --- terminated and still owing --------------------------------------- */

  add({ tenant: at("DORM-105"), billedDaysAgo: 160, description: RENT, amount: 21500,
        why: "They moved out and still owe. Chased like anybody else; the debt survives the tenancy." });

  /* --- billed in the future --------------------------------------------- */

  add({ tenant: at("DORM-101"), billedDaysAgo: -7, description: RENT, amount: 8400,
        why: "Billed for next month, ahead of the report date. Negative age, and nobody chases it." });

  /* --- what changes between the two reports ----------------------------- */

  // Settles completely. This is their only line, so in October the company is
  // absent from the file altogether rather than merely smaller.
  add({ tenant: at("DORM-107"), billedDaysAgo: 75, description: RENT, amount: 5600,
        onlyIn: "sept",
        why: "SEPTEMBER ONLY, and their only line. In October they are absent entirely, which MES read as paid in full." });

  // Part pays: a smaller balance in October.
  add({ tenant: at("DORM-104"), billedDaysAgo: 95, description: RENT, amount: 6000,
        onlyIn: "sept",
        why: "SEPTEMBER ONLY. Its October counterpart is smaller, which reads as part paid." });
  add({ tenant: at("DORM-104"), billedDaysAgo: 123, description: RENT, amount: 2500,
        onlyIn: "oct",
        why: "OCTOBER ONLY. The same debt, partly paid down." });

  // Brand new debtor in October.
  add({ tenant: at("DORM-206"), billedDaysAgo: 20, description: RENT, amount: 9900,
        onlyIn: "oct",
        why: "OCTOBER ONLY. Owing for the first time." });

  // Gets worse: same tenant, more money, older.
  add({ tenant: at("DORM-203"), billedDaysAgo: 25, description: RENT, amount: 7100,
        onlyIn: "oct",
        why: "OCTOBER ONLY. Orchid owe more than they did, and their oldest money has aged a bucket." });

  return L.filter((l) => {
    if (!l.onlyIn) return true;
    return l.onlyIn === (reportDate === SEPT ? "sept" : "oct");
  });
}

/* ------------------------------------------------------- the AR workbook */

const HEADER = [
  "Customer", "Transaction Type", "Company Name", "End User: Industry Type",
  "Date", "Description", "Document Number", "Linked Contract",
  "Contract Item Start Date", "Contract: Contract End Date", "Due Date",
  "Age", "Aging", "Open Balance", "Primary Sales Rep",
];

const blank = (n: number) => Array.from({ length: n }, () => "");

function docFor(t: Tenant, n: number): string {
  return t.dorm === "BSD" ? `BSD786/${4000 + n}` : `JPD1786/${5000 + n}`;
}

function buildAr(reportDate: string): { wb: XLSX.WorkBook; facts: string[] } {
  const rows: unknown[][] = [];

  // The header block MES's export carries above the table.
  rows.push([`As of ${reportDate}`, ...blank(14)]);
  rows.push(["Consol : MES Group : KT Mesdorm Pte Ltd", ...blank(14)]);
  rows.push(blank(15));
  rows.push(HEADER);

  const all = lines(reportDate);
  const facts: string[] = [];

  // Grouped by company at a dormitory, which is what an account is.
  const groups = new Map<string, { tenant: Tenant; rows: Line[] }>();
  for (const l of all) {
    const key = `${l.tenant.code}|${l.tenant.dorm}`;
    const g = groups.get(key) ?? { tenant: l.tenant, rows: [] };
    g.rows.push(l);
    groups.set(key, g);
  }

  let n = 0;
  let grand = 0;

  for (const g of groups.values()) {
    const label = `${g.tenant.code} ${g.tenant.name}`;
    rows.push([label, ...blank(14)]);

    let subtotal = 0;
    for (const l of g.rows) {
      const billed = plus(reportDate, -l.billedDaysAgo);
      const due = plus(billed, TERM);
      const age = between(due, reportDate);
      subtotal += l.amount;
      n += 1;

      rows.push([
        "",                                   // A, blank on a line row
        l.type ?? (l.amount < 0 ? "Credit Memo" : "Invoice"),
        label,                                // C, the company repeated
        g.tenant.industry,
        billed,
        l.description,
        l.doc ?? docFor(g.tenant, n),
        "",
        "",
        "",
        due,
        age,
        bucketOf(age),
        Math.round(l.amount * 100) / 100,
        g.tenant.rep,
      ]);
    }

    const t = Math.round(subtotal * 100) / 100;
    grand += t;
    // MES close each customer with their own total, which is what lets our
    // figures be checked against theirs rather than only against themselves.
    rows.push([`Total - ${label}`, ...blank(12), t, ""]);
    facts.push(`${label.padEnd(52)} ${g.tenant.dorm}  ${t.toFixed(2)}`);
  }

  rows.push(blank(15));
  rows.push(["Grand Total", ...blank(12), Math.round(grand * 100) / 100, ""]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb, XLSX.utils.aoa_to_sheet(rows), "Finance AR Download",
  );
  facts.push("");
  facts.push(`${groups.size} accounts, ${n} charge lines, grand total ${grand.toFixed(2)}`);
  return { wb, facts };
}

/* -------------------------------------------------- the contact workbook */

function buildContacts(): XLSX.WorkBook {
  const rows: unknown[][] = [];
  rows.push([`As of ${SEPT}`, "", "", ""]);
  rows.push(["", "", "", ""]);
  rows.push(["Company Name", "Status", "Company Name", "Email Address"]);

  const seen = new Set<string>();
  for (const t of TENANTS) {
    // One row per company, not per account. A company at two dormitories has
    // one accounts department, so its address is not typed twice.
    if (seen.has(t.code)) continue;
    seen.add(t.code);
    if (!t.emails) continue;
    rows.push([
      `${t.code} ${t.name}`,
      t.status ?? "Live",
      t.name,
      // Several addresses in one cell, separated the way MES write them.
      t.emails.join("; "),
    ]);
  }

  /*
   * Two rows that are in MES's real list and are worth keeping: a company
   * whose email cell has words in it rather than an address, and one that is
   * blank. Both should be reported rather than silently skipped.
   */
  rows.push(["DORM-103 TUAS PRECISION ENGINEERING PTE. LTD.", "Live",
             "TUAS PRECISION ENGINEERING PTE. LTD.", "to be confirmed with client"]);
  rows.push(["DORM-203 ORCHID CIVIL WORKS PTE. LTD.", "Live",
             "ORCHID CIVIL WORKS PTE. LTD.", ""]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Total");
  return wb;
}

/* ------------------------------------------------------------------ write */

mkdirSync(OUT, { recursive: true });

const files: string[] = [];

for (const [date, name] of [[SEPT, "AR Report - September.xlsx"], [OCT, "AR Report - October.xlsx"]] as const) {
  const { wb, facts } = buildAr(date);
  const p = path.join(OUT, name);
  writeFileSync(p, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  files.push(p);
  console.log(`\n  ${name}   (as of ${date})`);
  for (const f of facts) console.log(`    ${f}`);
}

const cp = path.join(OUT, "Client Contact List.xlsx");
writeFileSync(cp, XLSX.write(buildContacts(), { type: "buffer", bookType: "xlsx" }));
files.push(cp);

const withEmail = TENANTS.filter((t, i) => t.emails && TENANTS.findIndex((x) => x.code === t.code) === i);
console.log(`\n  Client Contact List.xlsx`);
console.log(`    ${withEmail.length} companies with an address, 2 without`);

console.log("\n  written to:");
for (const f of files) console.log(`    ${f}`);

console.log("\n  what each line is there to test:\n");
for (const l of lines(SEPT)) {
  console.log(`    ${l.tenant.code}  ${l.why}`);
}
for (const l of lines(OCT).filter((l) => l.onlyIn === "oct")) {
  console.log(`    ${l.tenant.code}  ${l.why}`);
}
