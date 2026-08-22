/**
 * The revenue type rules, checked against every real description MES has sent.
 *
 *   npm run test:revenue
 *
 * This file is the specification. The table below is one row per distinct
 * shape of description, with the type it must produce. Changing a rule in
 * revenue-rules.ts without changing this table means the build fails, which is
 * the point: Occupancy Fee alone is 92% of the value in the sample.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  REVENUE_RULES,
  matchRule,
  normaliseDescription,
  revenueType,
  unrecognisedDescriptions,
} from "../src/lib/revenue-rules.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${name.slice(0, 62).padEnd(62)} ` +
      (ok ? "" : `got ${String(actual)}, expected ${String(expected)}`),
  );
}

/* ------------------------------------------------------------ the table ---
 * One row per distinct shape. The 35 real 1FM descriptions reduce to four
 * shapes that differ only by block number and payment notice id, so four are
 * listed rather than 35: every one of the 345 real lines is still checked by
 * the completeness test further down.
 */
const CASES: [description: string, expected: string][] = [
  // -- 1FM, all four shapes. Each contains a keyword another rule wants.
  ["ROOM ISSUES - MAINTENANCE/REPLACEMENT ETC AT JPD1, Block 50 #02-14 AS PER ONEFM CLIENT PAYMENT NOTICE ID:PYNIJPD1202604074597922", "1FM Maintenance"],
  ["ADMISSION TO SICKBAY AT JPD1 DHANISH FROM 28 OCTOBER 2025 TO 15 NOVEMBER 2025 AS PER ONEFM CLIENT PAYMENT NOTICE", "1FM Maintenance"],
  ["TENANT TRANSFER AT JPD1 AS PER ONEFM CLIENT PAYMENT NOTICE ID: PYNJPD12026042680436661", "1FM Maintenance"],
  ["UNIT REINSTATEMENT WORKS FOR VACATED UNIT AT JPD1, BLOCK 56B #04-59 AS PER ONEFM CLIENT PAYMENT NOTICE", "1FM Maintenance"],

  // -- Late payment, including the two months MES typed without a space.
  ["Admin Fee For Late Payment - JAN '26", "Late Payment Fee"],
  ["Admin Fee For Late Payment - APR'26", "Late Payment Fee"],
  ["Admin Fee For Late Payment - JUL '26", "Late Payment Fee"],

  ["Admin Fee For The Rejected GIRO ( 01-Dec-25 )", "Rejected GIRO Fee"],

  // -- Negatives that must not hide in Other Charges.
  ["REF NO: JPD/3445/2023 (BLK 56 - #04-59) PLEASE TAKE NOTE THAT THIS CREDIT NOTE WILL BE OFFSET TO", "Credit Note"],
  ["BEING LTMC AR TRANSFERRED - MIRADOR BUILDING CONTRACTOR PTE LTD - INV:LTM-5884 .", "AR Transfer"],

  // -- VAT: exact and starts with, but never contains.
  ["VAT", "VAT"],
  ["VAT 9%", "VAT"],
  ["VAT - JUL", "VAT"],

  ["Occupancy Fee Charges", "Occupancy Fee"],
  ["Service & Conservancy Charges", "Service & Conservancy"],
  ["Furniture & Fittings Charges", "Furniture & Fittings"],
  ["CREAM Services", "CREAM Services"],
  ["CREAM Services Charges", "CREAM Services"],
  ["Security Deposit - REFUNDABLE", "Security Deposit"],
  ["Security Deposit - REFUNDABLE ( Additional Deposit )", "Security Deposit"],
  ["QUARTERLY CHARGES FOR SEASON PARKING OF VEHICLE(S) AT JPD 1 @ $50.00 PER MONTH FOR THE PERIOD: 01", "Season Parking"],
  ["QUARTERLY CHARGES FOR SEASON PARKING OF VEHICLE(S) AT JPD 1 @ $150.00 PER MONTH FOR THE PERIOD: 01", "Season Parking"],
  ["REIMBURSEMENT OF STAMP DUTY REF NO: JPD/4152/2025 - 2511057192087", "Stamp Duty"],
  ["REIMBURSEMENT OF STAMP DUTY REF NO: JPD/4111/2025 - 2511057187460", "Stamp Duty"],
  ["Sick Bay Usage", "Sick Bay"],
  ["Maintenance Works", "Maintenance"],
  ["ONE-TIME ISSUANCE FEE - BED BOARD, STORAGE BOX, BIN AND BROOM", "Issuance Fee"],
  ["Opening Balance - AR", "Opening Balance"],

  // -- Both spellings. ADMIN FEE is not a substring of ADMINISTRATION FEE.
  ["Admin Fee - NON-REFUNDABLE", "Admin Fee"],
  ["Administration Fee - NON-REFUNDABLE", "Admin Fee"],

  ["Other Charges", "Other Charges"],
];

/* Descriptions no rule should claim. They still classify as Other Charges,
 * but must be reported as unrecognised so the keyword list can grow. */
const SHOULD_NOT_MATCH: string[] = [
  "SOMETHING MES HAS NOT WRITTEN BEFORE",
  "REFUSE COLLECTION SURCHARGE",
];

console.log("\nThe rule table\n");
for (const [description, expected] of CASES) {
  check(normaliseDescription(description).slice(0, 60), revenueType(description), expected);
}

console.log("\nOrdering, the part that breaks silently\n");
check("Late Payment beats Admin Fee", revenueType("Admin Fee For Late Payment - JUL '26"), "Late Payment Fee");
check("Rejected GIRO beats Admin Fee", revenueType("Admin Fee For The Rejected GIRO"), "Rejected GIRO Fee");
check("1FM beats Maintenance", revenueType("ROOM ISSUES - MAINTENANCE AS PER ONEFM NOTICE"), "1FM Maintenance");
check("1FM beats Sick Bay", revenueType("ADMISSION TO SICKBAY AS PER ONEFM NOTICE"), "1FM Maintenance");
check("Sick Bay without 1FM stays Sick Bay", revenueType("Sick Bay Usage"), "Sick Bay");
check("Maintenance without 1FM stays Maintenance", revenueType("Maintenance Works"), "Maintenance");
check("VAT is not a contains rule", revenueType("REIMBURSEMENT OF VAT ON STAMP DUTY"), "Stamp Duty");
check("rules are in declared order", REVENUE_RULES.map((r) => r.order).join(","), REVENUE_RULES.map((_, i) => i + 1).join(","));

console.log("\nThe fallback means \"we do not recognise this\"\n");
check("MES's own \"Other Charges\" is not a miss", matchRule("Other Charges")?.order, 19);
for (const d of SHOULD_NOT_MATCH) {
  check(`unrecognised: ${d.slice(0, 40)}`, matchRule(d), null);
  check(`  still typed as`, revenueType(d), "Other Charges");
}

/* ------------------------------------------------------- the real corpus ---
 * Every description MES has actually sent, from both exports.
 */
interface SampleInvoice { companyName: string; description: string; openBalance: number }
interface Sample { asOfSummary: string; asOfDetail: string; accounts: { companyName: string; total: number }[]; invoices: SampleInvoice[] }

const sample: Sample = JSON.parse(
  readFileSync(path.join(ROOT, "src/lib/mock/arData.json"), "utf8"),
);

console.log("\nEvery real description, and the money behind it\n");

const byType = new Map<string, { lines: number; amount: number }>();
let total = 0;
for (const inv of sample.invoices) {
  const t = revenueType(inv.description);
  const row = byType.get(t) ?? { lines: 0, amount: 0 };
  row.lines += 1;
  row.amount += inv.openBalance;
  byType.set(t, row);
  total += inv.openBalance;
}

// Nothing dropped, nothing counted twice. This is what protects the money:
// a rule that stops matching sends its lines somewhere else, and a rule that
// matches too much steals them, but either way these two must still agree.
const linesByType = Array.from(byType.values()).reduce((n, r) => n + r.lines, 0);
const amountByType = Array.from(byType.values()).reduce((n, r) => n + r.amount, 0);
check("every invoice lands in exactly one type", linesByType, sample.invoices.length);
check("sum of the types equals the sum of the invoices", Math.round(amountByType * 100), Math.round(total * 100));

const missed = unrecognisedDescriptions(sample.invoices.map((i) => i.description));
check("no unrecognised description in the sample", missed.length, 0);
for (const m of missed) console.log(`         ${String(m.count).padStart(3)}  ${m.description}`);

console.log("\n  breakdown");
for (const [type, row] of Array.from(byType).sort((a, b) => b[1].amount - a[1].amount)) {
  console.log(`    ${type.padEnd(24)} ${String(row.lines).padStart(4)} lines  ${row.amount.toFixed(2).padStart(12)}`);
}

/* ------------------------------------------------------- the blocked check ---
 * Reported, not asserted. See the note printed below.
 */
console.log("\nSummary against detail, diagnostic only\n");
const key = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const detail = new Map<string, number>();
for (const inv of sample.invoices) {
  detail.set(key(inv.companyName), (detail.get(key(inv.companyName)) ?? 0) + inv.openBalance);
}
const summary = new Map<string, number>();
for (const a of sample.accounts) {
  summary.set(key(a.companyName), (summary.get(key(a.companyName)) ?? 0) + a.total);
}
const overlap = Array.from(detail.keys()).filter((k) => summary.has(k) && Math.abs(detail.get(k)!) > 0.001);
const agree = overlap.filter((k) => Math.abs(detail.get(k)! - summary.get(k)!) < 0.02);
console.log(`  summary as of ${sample.asOfSummary}, detail as of ${sample.asOfDetail}`);
console.log(`  ${summary.size} companies in the summary, ${overlap.length} of them have invoice detail`);
console.log(`  ${agree.length} of ${overlap.length} reconcile`);
console.log(
  "\n  Not asserted, because it cannot pass on this data. The two workbooks\n" +
    "  are five months apart, so the invoice detail is not the detail behind\n" +
    "  those balances. Asserting it would mean a permanently red build that\n" +
    "  everyone learns to ignore. Turn this into a real check once MES sends\n" +
    "  a summary and a detail export from the same month, with amounts.",
);

console.log(failures === 0 ? "\nALL CHECKS PASS\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
