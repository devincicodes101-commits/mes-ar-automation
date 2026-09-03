/**
 * The revenue type rules, checked against every real description MES has sent.
 *
 *   npm run test:revenue
 *
 * This file is the specification. The table below is one row per distinct
 * shape of description, with the type it must produce. Changing a rule in
 * revenue-rules.ts without changing this table means the build fails, which is
 * the point: Occupancy Fee alone is 75% of the value in the sample, and 51%
 * of MES's real BSD export.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  REVENUE_RULES,
  categoryDisagrees,
  isOneFm,
  isUnrecognised,
  matchRule,
  normaliseDescription,
  revenueType,
  typeForCategory,
  unrecognisedDescriptions,
} from "../src/lib/revenue-rules.ts";
import { emailAddresses, looksLikeUnreadableContact } from "../src/lib/emails.ts";
import {
  IMPORT_MUST_NOT_TOUCH,
  IMPORT_REPLACES,
  IMPORT_UPSERTS,
  buildImportPlan,
  periodOf,
} from "../src/lib/import.ts";
import {
  CHEQUE_ADMIN_FEE,
  CHEQUE_ADMIN_FEE_FROM,
  DEFAULT_FEE_RULE,
  feesDue,
} from "../src/lib/data.ts";
import { DEFAULT_TEMPLATES, templateDueOn } from "../src/lib/store.ts";
import * as XLSX from "xlsx";
import { detectKind, parseDetail } from "../src/lib/parser.ts";

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

/* The document number carries 1FM even when the line's own text does not.
 * These are real invoices from MES's export. JP1FM/2656 is the one that
 * matters: four lines, every one of them 1FM, and not one says so. */
console.log("\n1FM is decided by the invoice number, not the wording\n");
check("VAT line on a 1FM invoice", revenueType("VAT", "JP1FM/2705"), "1FM Maintenance");
check("Sick Bay line on a 1FM invoice", revenueType("Sick Bay Usage", "JP1FM/2656"), "1FM Maintenance");
check("Maintenance line on a 1FM invoice", revenueType("Maintenance Works", "JP1FM/2659"), "1FM Maintenance");
check("Opening Balance on a 1FM invoice", revenueType("Opening Balance - AR", "JP1FM/2159"), "1FM Maintenance");
check("MES's own spelling, JPD1FM", revenueType("VAT", "JPD1FM/0001"), "1FM Maintenance");

/* Every dormitory numbers its own 1FM invoices, and the prefix is that
 * dormitory's code rather than JPD. Built around JPD because JPD1 was the only
 * dormitory we had ever been sent; the BSD export then arrived with 542 of
 * these and the pattern matched none of them. One row per dormitory, so the
 * next one MES send is a one line addition and not another silent zero. */
check("BSD numbers its own, BSDFM", revenueType("VAT", "BSDFM/1598"), "1FM Maintenance");
check("and the maintenance line on it", revenueType("Maintenance Works", "BSDFM/1471"), "1FM Maintenance");
check("LEO would number LEOFM", revenueType("VAT", "LEOFM/0001"), "1FM Maintenance");
check("JPD2 would number JPD2FM", revenueType("VAT", "JPD2FM/0001"), "1FM Maintenance");
check("isOneFm agrees on BSD too", isOneFm("Tenant Transfer", "BSDFM/1598"), true);

/* The prefixes that live alongside them in the same BSD file and must not be
 * swept up. KTM is the KT Mesdorm entity, REC a payment receipt, BSDCN a
 * credit note, and BSD-786 the ordinary occupancy invoice run. */
check("an ordinary BSD invoice is untouched", revenueType("VAT", "BSD-786/002070"), "VAT");
check("the KT Mesdorm entity prefix is untouched", revenueType("Opening Balance - AR", "KTM-1251"), "Opening Balance");
check("a BSD credit note is untouched", revenueType("VAT", "BSDCN/017"), "VAT");
check("a payment receipt is untouched", revenueType("Occupancy Fee Charges", "REC-BSD367"), "Occupancy Fee");
check("a 1FM credit note, caught by the wording", revenueType("ADMISSION TO SICKBAY AS PER ONEFM", "JP1CN/070"), "1FM Maintenance");
check("an ordinary invoice is untouched", revenueType("VAT", "JPD1-786/002429"), "VAT");
check("ordinary sick bay stays Sick Bay", revenueType("Sick Bay Usage", "JPD1-786/002430"), "Sick Bay");
check("no document number still works", revenueType("Occupancy Fee Charges"), "Occupancy Fee");
check("isOneFm agrees with the type", isOneFm("VAT", "JP1FM/2705"), true);
check("isOneFm is false for ordinary lines", isOneFm("VAT", "JPD1-786/002429"), false);

console.log("\nOrdering, the part that breaks silently\n");
check("Late Payment beats Admin Fee", revenueType("Admin Fee For Late Payment - JUL '26"), "Late Payment Fee");
check("Rejected GIRO beats Admin Fee", revenueType("Admin Fee For The Rejected GIRO"), "Rejected GIRO Fee");
check("1FM beats Maintenance", revenueType("ROOM ISSUES - MAINTENANCE AS PER ONEFM NOTICE"), "1FM Maintenance");
check("1FM beats Sick Bay", revenueType("ADMISSION TO SICKBAY AS PER ONEFM NOTICE"), "1FM Maintenance");
check("Sick Bay without 1FM stays Sick Bay", revenueType("Sick Bay Usage"), "Sick Bay");
check("Maintenance without 1FM stays Maintenance", revenueType("Maintenance Works"), "Maintenance");
check("VAT is not a contains rule", revenueType("REIMBURSEMENT OF VAT ON STAMP DUTY"), "Stamp Duty");
check("a cheque fee beats the generic admin fee",
      revenueType("Admin Fee For Cheque Payment"), "Cheque Admin Fee");
check("however MES word it", revenueType("CHEQUE HANDLING CHARGE"), "Cheque Admin Fee");
check("an ordinary admin fee is untouched",
      revenueType("Admin Fee - NON-REFUNDABLE"), "Admin Fee");
check("rules are in declared order", REVENUE_RULES.map((r) => r.order).join(","), REVENUE_RULES.map((_, i) => i + 1).join(","));

/* ---------------------------------------------------- contact addresses ---
 * Every shape MES actually writes, taken from their contact list. The third
 * is the one that matters: splitting on semicolons and keeping anything with
 * an "@" yields the whole "AKR engg <...>" string as the address, and a
 * reminder sent to that bounces while the screen still says it was sent.
 */
console.log("\nEmail addresses, as MES actually types them\n");
const EMAILS: [cell: string, expected: string[]][] = [
  ["durga@akilaglobal.com.sg", ["durga@akilaglobal.com.sg"]],
  ["AKR engg <akrpteltd@gmail.com>", ["akrpteltd@gmail.com"]],
  ["'best.meengineering@gmail.com'", ["best.meengineering@gmail.com"]],
  ["aeoncontractor@gmail.com; Admin Finance <admin@aeoncontractor.com>",
   ["aeoncontractor@gmail.com", "admin@aeoncontractor.com"]],
  ["Kameswaran <kamesh@appali.com>; Appali Account <accounts@appali.com>; Appali Engineering Pte Ltd",
   ["kamesh@appali.com", "accounts@appali.com"]],
  [" finance@brightsun.com.sg; sathiya@brightsun.com.sg",
   ["finance@brightsun.com.sg", "sathiya@brightsun.com.sg"]],
  ["jeevan@veroengg.com.sg;THIRU  <admin@veroengg.com.sg>; kannan@veroengg.com.sg",
   ["jeevan@veroengg.com.sg", "admin@veroengg.com.sg", "kannan@veroengg.com.sg"]],
  ["Sathiya@brightsun.com.sg; sathiya@brightsun.com.sg", ["sathiya@brightsun.com.sg"]],
  ["", []],
  ["Appali Engineering Pte Ltd", []],
];
for (const [cell, expected] of EMAILS) {
  check(cell === "" ? "(an empty cell)" : cell.slice(0, 58),
        emailAddresses(cell).join(" "), expected.join(" "));
}
check("an empty cell is a missing contact, not an unreadable one",
      looksLikeUnreadableContact(""), false);
check("text with no address in it is flagged as unreadable",
      looksLikeUnreadableContact("Appali Engineering Pte Ltd"), true);

console.log("\nThe fallback means \"we do not recognise this\"\n");
check("MES's own \"Other Charges\" is not a miss", matchRule("Other Charges") !== null, true);
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

const missed = unrecognisedDescriptions(sample.invoices);
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

/* -------------------------------------------------------- the import plan ---
 * Turning a parsed report into rows. The database side is checked by
 * test-import.mjs; this is the decision making, which needs no database.
 */
console.log("\nBuilding the rows for one upload\n");

const acct = (id: string, code: string, name: string, property: string, total: number) =>
  ({
    id, customerCode: code, companyName: name, property,
    propertyName: property, status: "Live",
    buckets: { current: total, d30: 0, d60: 0, d90: 0, d90plus: 0 },
    total, legacyNote: null, emails: [], hasContact: false,
    industry: null, entity: null, invoiceCount: 0, isOneFm: false,
    revenueTypes: [], lateFeeCount: 0,
  }) as never;

const line = (company: string, amount: number) =>
  ({
    companyName: company, transactionType: "Invoice", date: "2026-08-01",
    dueDate: "2026-08-15", description: "Occupancy Fee Charges",
    documentNumber: "JPD1-786/1", linkedContract: null, age: 10,
    bucket: "Current", openBalance: amount, revenueType: "Occupancy Fee",
    isOneFm: false,
  }) as never;

check("the billing month comes from the report date", periodOf("2026-08-16"), "2026-08-01");

const simple = buildImportPlan(
  "2026-08-16",
  [acct("dorm-1-jpd1", "DORM-1", "ALPHA PTE. LTD.", "JPD1", 500)],
  [line("ALPHA PTE. LTD.", 500)],
);
check("one tenant, one snapshot, one invoice", `${simple.tenants.length}/${simple.snapshots.length}/${simple.invoices.length}`, "1/1/1");
check("the snapshot carries the report date", simple.snapshots[0].report_date, "2026-08-16");
check("the invoice is attached to the tenant", simple.invoices[0].tenant_id, "dorm-1-jpd1");
check("nothing to report", simple.problems.length, 0);

/* OKINAWAN PTE. LTD. really does rent at two dormitories and owes at both.
 * The detail export names the company but not the dormitory, so those lines
 * cannot be placed. Charging them to whichever tenant came first would make
 * one balance wrong and the other short, with nothing on screen to say so. */
const twoDorms = buildImportPlan(
  "2026-08-16",
  [
    acct("dorm-415-jpd2", "DORM-415", "OKINAWAN PTE. LTD", "JPD2", 1745.12),
    acct("dorm-415-bsd", "DORM-415", "OKINAWAN PTE. LTD", "BSD", 1158.88),
  ],
  [line("OKINAWAN PTE. LTD", 900)],
);
check("a company at two dormitories is two tenants", twoDorms.tenants.length, 2);
check("its invoice lines are not guessed at", twoDorms.invoices.length, 0);
check("and the officer is told why", twoDorms.problems[0]?.includes("more than one dormitory"), true);

const orphan = buildImportPlan(
  "2026-08-16",
  [acct("dorm-1-jpd1", "DORM-1", "ALPHA PTE. LTD.", "JPD1", 500)],
  [line("SOMEBODY ELSE PTE. LTD.", 300)],
);
check("an invoice for an unknown company is left out", orphan.invoices.length, 0);
check("and reported rather than dropped in silence", orphan.problems[0]?.includes("not in the balances file"), true);

const noDetail = buildImportPlan("2026-08-16", [acct("dorm-1-jpd1", "DORM-1", "ALPHA PTE. LTD.", "JPD1", 500)]);
check("a report with no invoice detail still imports", noDetail.snapshots.length, 1);

/* The rule the whole design turns on, written down as data so it can be
 * asserted rather than assumed. test-import.mjs checks the database keeps to
 * it; this checks nobody has quietly moved a table from one list to the other. */
check("balances and invoice lines are the replaceable ones",
      IMPORT_REPLACES.join(","), "account_snapshots,invoices");
check("the officer's own work is protected",
      IMPORT_MUST_NOT_TOUCH.join(","), "calls,promises,emails_sent,late_fees,audit_log");
check("tenants are added and updated, never deleted",
      IMPORT_UPSERTS.join(","), "tenants");

/* ------------------------------------------------------- the late fee ---
 * MES's letter states the fee as a date: charged if payment has not arrived
 * by the 15th, and rent falls due on the 1st, so fourteen days past due.
 *
 * Selecting on the aging buckets instead looks equivalent and is not. Their
 * Current bucket runs to 15 days, so on the 16th, when the fee is raised, the
 * month that has just gone unpaid is 15 days old and still sits in Current.
 * A bucket rule charges older debt and never charges the month the letter is
 * actually about.
 */
console.log("\nThe late payment fee falls on the right accounts\n");

const feeAcct = (id: string, total: number, buckets: Record<string, number> = {}) =>
  ({
    id, customerCode: "DORM-1", companyName: `FEE ${id} PTE. LTD.`,
    property: "JPD1", propertyName: "JPD1", status: "Live",
    buckets: {
      current: buckets.current ?? total, d30: buckets.d30 ?? 0,
      d60: buckets.d60 ?? 0, d90: buckets.d90 ?? 0, d90plus: buckets.d90plus ?? 0,
    },
    total, legacyNote: null, emails: [], hasContact: true, industry: null,
    entity: null, invoiceCount: 0, isOneFm: false, revenueTypes: [],
    lateFeeCount: 0,
  }) as never;

const feeInv = (company: string, age: number, amount: number) =>
  ({
    id: `${company}-${age}`, companyName: company, transactionType: "Invoice",
    date: null, dueDate: null, description: "Occupancy Fee Charges",
    documentNumber: "JPD1-786/1", linkedContract: null, age,
    bucket: age <= 15 ? "Current" : "30 days", openBalance: amount,
    revenueType: "Occupancy Fee", isOneFm: false,
  }) as never;

check("the rule is $100 flat", `${DEFAULT_FEE_RULE.basis} ${DEFAULT_FEE_RULE.value}`, "flat 100");
check("and it starts at 14 days past due", DEFAULT_FEE_RULE.minimumAgeDays, 14);

/* The case a bucket rule gets wrong: rent due on the 1st, unpaid, fee raised
 * on the 16th. Fifteen days old, still Current, and it must be charged. */
const justCrossed = feesDue([feeAcct("a", 1000)], DEFAULT_FEE_RULE, [feeInv("FEE a PTE. LTD.", 15, 1000)]);
check("a tenant 15 days past due is charged", justCrossed.length, 1);
check("even though their bucket still says Current", justCrossed[0]?.overdue, 1000);
check("and it is not flagged approximate", justCrossed[0]?.approximate, false);

const notYet = feesDue([feeAcct("b", 1000)], DEFAULT_FEE_RULE, [feeInv("FEE b PTE. LTD.", 13, 1000)]);
check("a tenant 13 days past due is not charged yet", notYet.length, 0);

const mixed = feesDue([feeAcct("c", 1500)], DEFAULT_FEE_RULE, [
  feeInv("FEE c PTE. LTD.", 40, 1000),
  feeInv("FEE c PTE. LTD.", 5, 500),
]);
check("only the part old enough is charged on", mixed[0]?.overdue, 1000);
check("and the fee is the flat $100 regardless", mixed[0]?.fee, 100);

const bucketsOnly = feesDue([feeAcct("d", 900, { current: 0, d30: 900 })], DEFAULT_FEE_RULE, []);
check("with no invoice dates it falls back to the buckets", bucketsOnly.length, 1);
check("and says so rather than presenting it as fact", bucketsOnly[0]?.approximate, true);

/* --------------------------------------- when reminders fire on their own ---
 * MES asked for reminders to go out unattended. The wiring that runs it lives
 * in a browser effect and cannot be checked from here, but the decision it
 * asks can: which wording, if any, is due today.
 *
 * The last case is the one that matters. Firing the wrong template on the
 * wrong day would send the final notice, which cites the Employment of
 * Foreign Manpower Regulations and raises disruption of services, to somebody
 * who is six days late.
 */
/* The two charges in MES's reminder letter. The $100 the system raises, and
 * the $50 it cannot, because no export MES send records how a payment was
 * made. Both figures are read off that letter and neither should drift
 * silently. The second is asserted to reach the screen as well as exist,
 * because it spent months as a constant nothing imported, which read as though
 * we had missed the charge rather than decided we could not apply it. */
console.log("\nThe two charges in MES's letter\n");
check("the late fee is $100", DEFAULT_FEE_RULE.value, 100);
check("the cheque admin fee is $50", CHEQUE_ADMIN_FEE, 50);
check("and it dates from MES's letter", CHEQUE_ADMIN_FEE_FROM, "1 August 2022");

const lateFeeScreen = readFileSync(
  path.join(ROOT, "src/app/late-fees/page.tsx"),
  "utf8",
);
check("the cheque fee reaches the screen, not just the constant",
      lateFeeScreen.includes("CHEQUE_ADMIN_FEE"), true);
check("and the screen says plainly that we do not raise it",
      lateFeeScreen.includes("Not raised here"), true);
check("nothing charges it, because nothing can",
      feesDue([feeAcct("q", 5000)], DEFAULT_FEE_RULE, [
        feeInv("FEE q PTE. LTD.", 40, 5000),
      ]).some((l) => l.fee === CHEQUE_ADMIN_FEE), false);

console.log("\nWhich reminder is due today\n");
const dueOn = (day: number) => templateDueOn(new Date(2026, 7, day), DEFAULT_TEMPLATES);
check("the 7th sends the first reminder", dueOn(7)?.id, "reminder-7th");
check("the 21st sends the final notice", dueOn(21)?.id, "final-21st");
check("the 6th sends nothing", dueOn(6), null);
check("the 8th sends nothing", dueOn(8), null);
check("the 16th sends nothing, that is the manager report day", dueOn(16), null);
check("the 22nd sends nothing", dueOn(22), null);
check("the 7th can never fire the final notice", dueOn(7)?.id === "final-21st", false);
check("templates with no trigger day exist and never fire",
      DEFAULT_TEMPLATES.some((t) => t.triggerDay === undefined), true);

/* ------------------------------------------------- MES's own Categories ---
 * Their column fills gaps and never overrides. It looks like it should be the
 * other way round, so these say plainly why it is not: their categories are
 * coarser than these rules exactly where MES's own reports need the detail.
 */
console.log("\nMES's Categories column\n");

// Where our rules claim the line, ours wins. All three of these sit inside
// MES's single "Admin fee" category, and MES have asked for a late payment
// report their own column could not produce.
check("a late payment fee stays a late payment fee",
      revenueType("Admin Fee For Late Payment - JUN'26", "BSD-786/1", "Admin fee"), "Late Payment Fee");
check("a rejected GIRO fee stays its own thing",
      revenueType("Admin Fee for Rejected Giro - 01-JUL-26", "BSD-786/1", "Admin fee"), "Rejected GIRO Fee");
check("and a real admin fee is still an admin fee",
      revenueType("Administration Fee - NON-REFUNDABLE", "BSD-786/1", "Admin fee"), "Admin Fee");
check("stamp duty beats their Reimbursement",
      revenueType("Reimbursement of Stamp Duty", "BSD-786/1", "Reimbursement"), "Stamp Duty");

// Where our rules find nothing, theirs is used. These are the 10 real lines
// on the BSD export that we had no rule for at all.
check("a vending machine commission comes from their column",
      revenueType("COMMISSION FOR THE VENDING MACHINE AT BSD FOR JAN' 2026", "BSD-786/1", "Commission"), "Commission");
check("a bad debt write off comes from their column",
      revenueType("BEING BAD DEBTS WRITTEN OFF. - LCK CONSTRUCTION PTE. LTD.", "KTM-1", "Bad debts"), "Bad Debt");
check("with no category it still falls back to Other Charges",
      revenueType("SOMETHING NOBODY HAS EVER WRITTEN", "BSD-786/1"), "Other Charges");
check("an unknown category is not invented into a type",
      revenueType("SOMETHING NOBODY HAS EVER WRITTEN", "BSD-786/1", "Marmalade"), "Other Charges");

// Their spelling must never reach a type name. The deposit report does an
// exact match on "Security Deposit" and their small d would empty it.
check("their casing is translated, not copied",
      typeForCategory("Security deposit"), "Security Deposit");
check("and their longer wording too", typeForCategory("Occupancy Fee Charges"), "Occupancy Fee");
check("a category we do not know maps to nothing", typeForCategory("Marmalade"), null);
check("no category maps to nothing", typeForCategory(""), null);

/* What the Upload screen reports as "we could not understand this". It has to
 * ask the same question the classifier asks, or it reports lines that were
 * named perfectly well by the invoice number or by MES's own column. On the
 * BSD export that was 37 reported against 3 real, and a panel that is mostly
 * noise is a panel nobody reads by month two. */
check("a line named by its invoice number is not a miss",
      isUnrecognised("TENANT TRANSFER", "BSDFM/1598"), false);
check("a line named by MES's category is not a miss",
      isUnrecognised("BEING BAD DEBTS WRITTEN OFF.", "KTM-1", "Bad debts"), false);
check("a line nothing can name still is",
      isUnrecognised("SOMETHING NOBODY HAS EVER WRITTEN", "BSD-786/1"), true);
check("and an unknown category does not rescue it",
      isUnrecognised("SOMETHING NOBODY HAS EVER WRITTEN", "BSD-786/1", "Marmalade"), true);
check("the counted list agrees",
      unrecognisedDescriptions([
        { description: "TENANT TRANSFER", documentNumber: "BSDFM/1598" },
        { description: "BEING BAD DEBTS WRITTEN OFF.", documentNumber: "KTM-1", category: "Bad debts" },
        { description: "SOMETHING NOBODY HAS EVER WRITTEN", documentNumber: "BSD-786/1" },
      ]).length, 1);

// The disagreement flag. Gaps are not disagreements, and neither is a line
// with no category, which the older exports consist entirely of.
check("a disagreement is flagged",
      categoryDisagrees("Admin Fee For Late Payment - JUN'26", "BSD-786/1", "Admin fee"), true);
check("agreement is not",
      categoryDisagrees("Occupancy Fee Charges", "BSD-786/1", "Occupancy Fee Charges"), false);
check("a gap we filled is not a disagreement",
      categoryDisagrees("COMMISSION FOR THE VENDING MACHINE", "BSD-786/1", "Commission"), false);
check("no category is not a disagreement",
      categoryDisagrees("Occupancy Fee Charges", "BSD-786/1"), false);
check("1FM against their category is flagged, which is the open question",
      categoryDisagrees("VAT", "BSDFM/1598", "VAT"), true);

/* ------------------------------------------ the aging detail export shape ---
 * "Custom A/R Aging Detail - With Description" is the fourth shape MES have
 * sent and the app refused it outright: the tab name matched none of the
 * three we knew, so the whole file came back unreadable.
 *
 * The workbooks below are built here rather than read from disk. The real one
 * carries 190 named tenants and their balances, which does not belong in a
 * repository, and the three things being checked are structural.
 */
console.log("\nThe aging detail export\n");

const book = (tab: string, rows: unknown[][]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), tab);
  return wb;
};

// Header on row seven, company on its own row, no Aging column, and a title
// date that disagrees with the ages underneath it. All four are real.
const AGING_HEADER = [
  "Customer", "Transaction Type", "Company Name", "Date", "Description",
  "Categories", "Document Number", "Linked Contract", "Contract Item Start Date",
  "P.O. No.", "Due Date", "Age", "Open Balance", "Item: Item Type",
];
const agingRows: unknown[][] = [
  ["Mini Environment Service Pte Ltd (MOH)"],
  ["Consol : Mini Environment Service Pte Ltd : KT Mesdorm Pte Ltd"],
  ["Custom A/R Aging Detail - With Description"],
  ["As of 17 August 2026"],
  [],
  [],
  AGING_HEADER,
  ["DORM-10 A STAR TECHNICAL SERVICES PTE. LTD."],
  ["", "Invoice", "A STAR TECHNICAL SERVICES PTE. LTD.", "2026-08-15",
   "Occupancy Fee Charges", "Occupancy Fee Charges", "BSD-786/002070",
   "BS/3753/KT/2025-SH", "2026-01-01", "", "2026-08-30", -2, 3024, "Service"],
  ["Total - A STAR TECHNICAL SERVICES PTE. LTD."],
];

const aging = book("Custom A_R Aging Detail - With ", agingRows);
check("an unfamiliar tab name is still recognised as invoice detail",
      detectKind(aging), "ar-detail");

const parsed = parseDetail(aging);
check("and it reads", parsed.invoices.length, 1);
check("with the balance intact", parsed.invoices[0]?.openBalance, 3024);

// The title says the 17th. Due 30 August less 2 days of age is the 28th, and
// the $100 fee turns on a 14 day window, so eleven days is most of it.
check("the report date comes from the ages, not the title", parsed.asOf, "2026-08-28");
check("and the disagreement is reported",
      parsed.problems.some((p) => p.message.includes("2026-08-17") &&
                                  p.message.includes("2026-08-28")), true);

// Position eleven in this layout is Age. A positional fallback filed a raw day
// count as the bucket on every row, then warned that it disagreed with itself.
check("the bucket is worked out from the age", parsed.invoices[0]?.bucket, "Current");
check("and no bucket disagreement is invented",
      parsed.problems.some((p) => p.message.includes("by MES's own formula")), false);

/* The new check is last of the four so it can never shadow a known shape. */
const contactish = book("JPD1", [["Company Name", "Status", "Email Address"]]);
check("a contact list is still a contact list", detectKind(contactish), "contact-list");

const summaryish = book("BSD", [["Company Name", "Status", "Current", "Grand Total"]]);
check("a balances export is still a balances export", detectKind(summaryish), "ar-summary");

const nothing = book("Notes", [["hello"]]);
check("and something unrelated is still refused", detectKind(nothing), "unreadable");

console.log(failures === 0 ? "\nALL CHECKS PASS\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
