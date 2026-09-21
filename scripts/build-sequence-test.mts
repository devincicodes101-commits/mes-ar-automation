/**
 * Two reports that show the sequence, and the contact list to go with them.
 *
 *   npm run build:sequence
 *
 * Report A introduces three companies nobody has ever chased. Report B, a
 * month later, carries them on and adds the two facts that are the point of
 * the exercise:
 *
 *   - PUNGGOL is absent. Absent from a later file means paid, so they stop
 *     being chased and any fee raised against them settles.
 *   - WOODLANDS is new. They arrive after the 7th, so they must NOT receive
 *     the final notice on the 21st: they wait for next month's reminder and
 *     go round in order. That is the rule the scheduled run was missing, and
 *     this is the file that proves it.
 *
 * ---------------------------------------------------------------------------
 * Why the dates are in 2027
 *
 * Only the newest report is ever read, and newest means the date printed on
 * the front of the file. The database already holds December 2026, so a file
 * dated September would be stored and then ignored, and the test would look
 * like a failure of the sequence rather than of the date.
 *
 * The billing month is a separate thing and comes from the calendar, so
 * letters sent while testing are filed under the real month whatever these
 * files say.
 *
 * ---------------------------------------------------------------------------
 * The old tenants are still here
 *
 * An AR report is a photograph of everyone who owes right now, not a list of
 * this month's work. A file that suddenly held three companies would tell the
 * system every other tenant had paid. So Blue Horizon, Keppel, Merlion, Tuas
 * and Sentosa carry on with their debts ageing, exactly as they would.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

const OUT = path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", "Downloads");
const TERM = 15;

/* The tester's own mailboxes. Nothing here may reach a real tenant, and the
   allowlist on the deployment is what enforces that. */
const IYUSRAK = "iyusrak@gmail.com";
const DEVINCI = "devincicodes101@gmail.com";
const KHAN03 = "iyusrakhan03@gmail.com";

interface Company {
  code: string;
  name: string;
  dorm: "JPD1" | "JPD2" | "BSD" | "LEO";
  rep: string;
  industry: string;
  emails: string[];
}

/* ------------------------------------------------- the ones to watch ---- */

const ORCHARD: Company = {
  code: "DORM-401", name: "ORCHARD FACILITIES PTE. LTD.",
  dorm: "JPD1", rep: "2611 Ray Ang", industry: "Facilities Management",
  emails: [IYUSRAK],
};
const SELETAR: Company = {
  code: "DORM-402", name: "SELETAR ENGINEERING PTE. LTD.",
  dorm: "BSD", rep: "1842 Wei Ling", industry: "Precision Engineering",
  emails: [DEVINCI],
};
/* Pays between the two reports, so they vanish from Report B. */
const PUNGGOL: Company = {
  code: "DORM-403", name: "PUNGGOL MARINE SERVICES PTE. LTD.",
  dorm: "LEO", rep: "1842 Wei Ling", industry: "Marine & Offshore",
  emails: [KHAN03],
};
/* Arrives only in Report B, after the 7th has been run. Must be held back
   from the 21st. */
const WOODLANDS: Company = {
  code: "DORM-404", name: "WOODLANDS LOGISTICS PTE. LTD.",
  dorm: "JPD2", rep: "2611 Ray Ang", industry: "Logistics",
  emails: [DEVINCI],
};

/* ----------------------------------------------- everybody carrying on -- */

const BLUE_HORIZON: Company = {
  code: "DORM-201", name: "BLUE HORIZON LOGISTICS PTE. LTD.",
  dorm: "BSD", rep: "1842 Wei Ling", industry: "Logistics", emails: [KHAN03],
};
const KEPPEL: Company = {
  code: "DORM-102", name: "KEPPEL STEEL WORKS PTE. LTD.",
  dorm: "JPD1", rep: "2611 Ray Ang", industry: "Marine & Offshore", emails: [DEVINCI],
};
const MERLION: Company = {
  code: "DORM-204", name: "MERLION FOOD PROCESSING PTE. LTD.",
  dorm: "BSD", rep: "1842 Wei Ling", industry: "Food & Beverage",
  emails: [IYUSRAK, DEVINCI],
};
const TUAS: Company = {
  code: "DORM-118", name: "TUAS PRECISION ENGINEERING PTE. LTD.",
  dorm: "JPD2", rep: "2611 Ray Ang", industry: "Precision Engineering", emails: [],
};
const SENTOSA: Company = {
  code: "DORM-309", name: "SENTOSA COLD STORAGE PTE. LTD.",
  dorm: "LEO", rep: "1842 Wei Ling", industry: "Food & Beverage", emails: [IYUSRAK],
};

interface Line {
  company: Company;
  billedDaysAgo: number;
  description: string;
  amount: number;
  doc?: string;
}

const OCCUPANCY = "Occupancy Fee Charges for the month";
const GIRO_FEE = "Admin Fee For The Rejected GIRO";
const LATE_FEE = "Admin Fee For Late Payment";

/* Report A, as of 2027-01-31. The three new companies are well past due, so
   they can be chased on the day the file is read rather than next month. */
const A: Line[] = [
  { company: ORCHARD, billedDaysAgo: 95, description: OCCUPANCY, amount: 9200 },
  { company: ORCHARD, billedDaysAgo: 34, description: OCCUPANCY, amount: 4100 },

  { company: SELETAR, billedDaysAgo: 65, description: OCCUPANCY, amount: 15400 },

  { company: PUNGGOL, billedDaysAgo: 80, description: OCCUPANCY, amount: 7300 },
  { company: PUNGGOL, billedDaysAgo: 49, description: OCCUPANCY, amount: 2600 },

  // Carried on from December, one month older.
  { company: BLUE_HORIZON, billedDaysAgo: 323, description: "Security deposit held", amount: 6000, doc: "BSDSD/0012" },
  { company: BLUE_HORIZON, billedDaysAgo: 202, description: OCCUPANCY, amount: 20000 },
  { company: BLUE_HORIZON, billedDaysAgo: 111, description: OCCUPANCY, amount: 8000 },
  { company: BLUE_HORIZON, billedDaysAgo: 80, description: OCCUPANCY, amount: 5000 },
  { company: BLUE_HORIZON, billedDaysAgo: 50, description: OCCUPANCY, amount: 4000 },

  { company: KEPPEL, billedDaysAgo: 177, description: OCCUPANCY, amount: 5000 },

  { company: MERLION, billedDaysAgo: 152, description: OCCUPANCY, amount: 11000 },
  { company: MERLION, billedDaysAgo: 168, description: GIRO_FEE, amount: 100, doc: "BSDGR/0021" },

  { company: TUAS, billedDaysAgo: 107, description: OCCUPANCY, amount: 14500 },
  { company: TUAS, billedDaysAgo: 167, description: LATE_FEE, amount: 100, doc: "JPD2LP/0071" },
  { company: TUAS, billedDaysAgo: 137, description: LATE_FEE, amount: 100, doc: "JPD2LP/0082" },
  { company: TUAS, billedDaysAgo: 107, description: LATE_FEE, amount: 100, doc: "JPD2LP/0093" },

  { company: SENTOSA, billedDaysAgo: 93, description: OCCUPANCY, amount: 12500 },
  { company: SENTOSA, billedDaysAgo: 62, description: OCCUPANCY, amount: 5900 },
];

/* Report B, as of 2027-02-28. Ages advance by 28 days. PUNGGOL has paid and
   is gone. WOODLANDS is new. */
const B: Line[] = [
  { company: ORCHARD, billedDaysAgo: 123, description: OCCUPANCY, amount: 9200 },
  { company: ORCHARD, billedDaysAgo: 62, description: OCCUPANCY, amount: 4100 },
  { company: ORCHARD, billedDaysAgo: 31, description: OCCUPANCY, amount: 3800 },

  { company: SELETAR, billedDaysAgo: 93, description: OCCUPANCY, amount: 15400 },
  { company: SELETAR, billedDaysAgo: 31, description: OCCUPANCY, amount: 6200 },

  /* PUNGGOL is deliberately absent. They paid. */

  /* Brand new, and the one to watch on the 21st. */
  { company: WOODLANDS, billedDaysAgo: 58, description: OCCUPANCY, amount: 11800 },

  { company: BLUE_HORIZON, billedDaysAgo: 351, description: "Security deposit held", amount: 6000, doc: "BSDSD/0012" },
  { company: BLUE_HORIZON, billedDaysAgo: 230, description: OCCUPANCY, amount: 20000 },
  { company: BLUE_HORIZON, billedDaysAgo: 139, description: OCCUPANCY, amount: 8000 },
  { company: BLUE_HORIZON, billedDaysAgo: 108, description: OCCUPANCY, amount: 5000 },
  { company: BLUE_HORIZON, billedDaysAgo: 78, description: OCCUPANCY, amount: 4000 },

  { company: KEPPEL, billedDaysAgo: 205, description: OCCUPANCY, amount: 5000 },

  { company: MERLION, billedDaysAgo: 180, description: OCCUPANCY, amount: 11000 },
  { company: MERLION, billedDaysAgo: 196, description: GIRO_FEE, amount: 100, doc: "BSDGR/0021" },

  { company: TUAS, billedDaysAgo: 135, description: OCCUPANCY, amount: 14500 },
  { company: TUAS, billedDaysAgo: 195, description: LATE_FEE, amount: 100, doc: "JPD2LP/0071" },
  { company: TUAS, billedDaysAgo: 165, description: LATE_FEE, amount: 100, doc: "JPD2LP/0093" },

  { company: SENTOSA, billedDaysAgo: 121, description: OCCUPANCY, amount: 12500 },
  { company: SENTOSA, billedDaysAgo: 90, description: OCCUPANCY, amount: 5900 },
];

/* ----------------------------------------------------------- plumbing --- */

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

function buildReport(lines: Line[], reportDate: string, file: string): string[] {
  const rows: unknown[][] = [
    [`As of ${reportDate}`, ...blank(14)],
    ["Consol : MES Group : KT Mesdorm Pte Ltd", ...blank(14)],
    blank(15),
    HEADER,
  ];

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
        l.doc ?? `${g.company.dorm}786/${4400 + n}`,
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
  writeFileSync(path.join(OUT, file), XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

  said.push(`\n  ${n} charge lines, grand total ${grand.toFixed(2)}`);
  return said;
}

/* -------------------------------------------------------- the contacts -- */

const EVERYONE = [
  ORCHARD, SELETAR, PUNGGOL, WOODLANDS,
  BLUE_HORIZON, KEPPEL, MERLION, SENTOSA,
  /* TUAS is left out on purpose. No address means they reach the call list
     and Send By Hand rather than the email run, which is a real state a real
     tenant is in and worth having on screen. */
];

function buildContacts(file: string): void {
  const rows: unknown[][] = [
    ["As of 2027-02-28  —  TEST FILE, addresses belong to the tester", "", "", ""],
    ["", "", "", ""],
    ["Company Name", "Status", "Company Name", "Email Address"],
  ];
  for (const c of EVERYONE) {
    rows.push([`${c.code} ${c.name}`, "Live", c.name, c.emails.join("; ")]);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Total");
  writeFileSync(path.join(OUT, file), XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

const FILE_A = "Test 6 - AR Report A (three new companies).xlsx";
const FILE_B = "Test 7 - AR Report B (one paid, one arrived).xlsx";
const FILE_C = "Test 6-7 - Client Contact List (TEST ADDRESSES).xlsx";

console.log(`\n  ${path.join(OUT, FILE_A)}   as of 2027-01-31\n`);
for (const s of buildReport(A, "2027-01-31", FILE_A)) console.log(s);

console.log(`\n  ${path.join(OUT, FILE_B)}   as of 2027-02-28\n`);
for (const s of buildReport(B, "2027-02-28", FILE_B)) console.log(s);

buildContacts(FILE_C);
console.log(`\n  ${path.join(OUT, FILE_C)}\n`);
for (const c of EVERYONE) {
  console.log(`  ${c.code}  ${c.name.padEnd(36)} ${c.emails.join(", ")}`);
}
console.log("  DORM-118  TUAS PRECISION ENGINEERING     no address, on purpose");

console.log("\n  What to watch:");
console.log("    DORM-401 ORCHARD    in both        reminder, then fee, then final notice");
console.log("    DORM-403 PUNGGOL    gone from B    paid, so the chasing stops");
console.log("    DORM-404 WOODLANDS  new in B       held back from the final notice\n");
