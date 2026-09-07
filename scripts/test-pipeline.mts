/**
 * The September pipeline, checked against MES's real files.
 *
 *   npm run test:pipeline
 *
 * Every expected number below was taken from MES's own workbook independently
 * of this code, so a passing run means the parser agrees with the source, not
 * with itself. The reconciliation check is the important one: MES print a
 * subtotal under each of their 190 customers, and ours has to add up to the
 * same cent.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

import {
  isAgingDetail,
  parseAgingDetail,
  propertyForEntity,
  propertyFromDocument,
  round2,
} from "../src/lib/aging-detail.ts";
import { bucketForAge, bucketLabelForAge } from "../src/lib/data.ts";
import { isOneFm, revenueType, matchRule } from "../src/lib/revenue-rules.ts";
import {
  MANAGER_COLUMNS,
  MANAGER_UNAVAILABLE,
  REVENUE_TABS,
  buildLateFeeListing,
  buildRevenueTab,
  giroEnrolled,
  recurringDefaulters,
} from "../src/lib/reports.ts";
import {
  DEADLINE_DAYS,
  addDays,
  currency,
  longDate,
  longOrdinalDate,
  renderLetter,
  shortDate,
  lateFeeEmail,
  rmEmail,
} from "../src/lib/letters.ts";
import {
  CAN_SEND_FOR_REAL,
  assertSimulationOnly,
  buildMessage,
  simulateSend,
} from "../src/lib/outbox.ts";
import { runPipeline } from "../src/lib/pipeline.ts";
import {
  DEFAULT_RECIPIENTS,
  simulateReportSend,
  type Recipient,
} from "../src/lib/dispatch.ts";
import { detectKind, parseContacts } from "../src/lib/parser.ts";
import { DEFAULT_TEMPLATES } from "../src/lib/store.ts";
import { LETTER_BODIES, fillLetter } from "../src/lib/letters.ts";
import { datasetFromResults } from "../src/lib/dataset.ts";
import type { Account } from "../src/lib/types.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const FOLDER = path.join(ROOT, "AR Automation-20260903T201835Z-1-001", "AR Automation");
const AGING = path.join(FOLDER, "3. CustomA_RAgingDetail-WithDescription.xlsx");
const CONTACTS = path.join(FOLDER, "4. Client Contact List", "R1 - 20260511.xlsx");

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${name.slice(0, 64).padEnd(64)} ` +
      (ok ? "" : `got ${String(actual)}, expected ${String(expected)}`),
  );
}
function section(title: string) {
  console.log(`\n${title}\n`);
}

if (!existsSync(AGING)) {
  console.error(`Cannot run: MES's export is not at\n  ${AGING}`);
  process.exit(1);
}

/* ============================================================ the parser */

section("Reading MES's Custom A/R Aging Detail export");

const wb = XLSX.read(readFileSync(AGING), { cellDates: true });
check("the file is recognised as the aging detail export", isAgingDetail(wb), true);

const p = parseAgingDetail(wb);

check("the report date is read from the header block", p.asOf, "2026-08-17");
check("so is the legal entity", p.entity, "KT Mesdorm Pte Ltd");
check("every invoice line is read", p.invoices.length, 3117);
check("customers become accounts", p.accounts.length, 190);
check("MES's own subtotal lines are kept", p.subtotals.length, 190);
check("nothing failed to parse", p.problems.filter((q) => q.severity === "error").length, 0);

const ourTotal = round2(p.accounts.reduce((n, a) => n + a.total, 0));
const theirTotal = round2(p.subtotals.reduce((n, s) => n + s.total, 0));
check("our total matches MES's own subtotals to the cent", ourTotal, theirTotal);
check("and it is the figure their workbook shows", ourTotal, 2782348.27);

const bucketSum = round2(
  p.accounts.reduce(
    (n, a) => n + a.buckets.current + a.buckets.d30 + a.buckets.d60 + a.buckets.d90 + a.buckets.d90plus,
    0,
  ),
);
check("the five buckets add back up to the total", bucketSum, ourTotal);

check(
  "the customer code is carried down onto every invoice line",
  p.invoices.every((i) => /^DORM-\d+$/.test(i.customerCode)),
  true,
);
check(
  "no subtotal row was mistaken for an invoice",
  p.invoices.some((i) => /^total\b/i.test(i.description)),
  false,
);

/* ------------------------------------------------- reading it again is safe */

const again = parseAgingDetail(XLSX.read(readFileSync(AGING), { cellDates: true }));
check("re-reading the same file gives the same total", round2(again.accounts.reduce((n, a) => n + a.total, 0)), ourTotal);
check("and the same account count", again.accounts.length, p.accounts.length);
check("and the same date, not today's", again.asOf, "2026-08-17");

/* ================================================== which dormitory a line is */

section("Placing an invoice in a dormitory from its document number");

check("BSD-786/002070 is Blue Stars", propertyFromDocument("BSD-786/002070", "LEO"), "BSD");
check("BSD786/44140, the older numbering, too", propertyFromDocument("BSD786/44140", "LEO"), "BSD");
check("BSDFM/1598, raised through 1FM, too", propertyFromDocument("BSDFM/1598", "LEO"), "BSD");
check("BSDCN/017, a credit note, too", propertyFromDocument("BSDCN/017", "LEO"), "BSD");
check("REC-BSD367, a receipt, too", propertyFromDocument("REC-BSD367", "LEO"), "BSD");
check("JPD1-786/002429 is JPD1", propertyFromDocument("JPD1-786/002429", "BSD"), "JPD1");
check("JP1FM/2705 is JPD1 with the D dropped", propertyFromDocument("JP1FM/2705", "BSD"), "JPD1");
check("JP2FM/0001 is JPD2", propertyFromDocument("JP2FM/0001", "BSD"), "JPD2");
check("KTM-1444 has no dormitory, so it falls back", propertyFromDocument("KTM-1444", "BSD"), "BSD");
check("and the fallback is honoured, not hardcoded", propertyFromDocument("KTM-1444", "LEO"), "LEO");

check("KT Mesdorm operates Blue Stars", propertyForEntity("KT Mesdorm Pte Ltd"), "BSD");
check("Kaki Bukit operates The Leo", propertyForEntity("Kaki Bukit Developments Pte Ltd"), "LEO");
check("an entity we do not know returns nothing", propertyForEntity("Some Other Pte Ltd"), null);

check(
  "this export is entirely Blue Stars, as its header says",
  new Set(p.invoices.map((i) => i.property)).size,
  1,
);

/* ============================================ MES's own aging formula */

section("The aging formula, from MES's Formula tab");

check("an invoice not yet due is Current", bucketForAge(-2), "current");
check("15 days past due is still Current", bucketForAge(15), "current");
check("16 days is 30 days", bucketForAge(16), "d30");
check("45 days is still 30 days", bucketForAge(45), "d30");
check("46 days is 60 days", bucketForAge(46), "d60");
check("75 days is still 60 days", bucketForAge(75), "d60");
check("76 days is 90 days", bucketForAge(76), "d90");
check("105 days is still 90 days", bucketForAge(105), "d90");
check("106 days is more than 90", bucketForAge(106), "d90plus");
check("the label matches MES's wording", bucketLabelForAge(106), "More than 90 days");
check("the boundary is 15, not 30", bucketForAge(30), "d30");

const misbucketed = p.invoices.filter(
  (i) => i.age !== null && i.bucket !== bucketLabelForAge(i.age),
);
check("every line's bucket follows from its age", misbucketed.length, 0);

/* ======================================================== 1FM detection */

section("1FM, by document prefix — MES's note: 1FM = Prefix \"DORMFM\"");

check("BSDFM/1598, their own worked example", isOneFm("Maintenance Works", "BSDFM/1598"), true);
check("JPD1FM/0001", isOneFm("VAT", "JPD1FM/0001"), true);
check("JP1FM/2705, abbreviated", isOneFm("VAT", "JP1FM/2705"), true);
check("JPD2FM/0001", isOneFm("VAT", "JPD2FM/0001"), true);
check("LEOFM/0001", isOneFm("VAT", "LEOFM/0001"), true);
check("an ordinary BSD invoice is not 1FM", isOneFm("Occupancy Fee Charges", "BSD-786/002070"), false);
check("and BSDFMX is not a 1FM prefix", isOneFm("VAT", "BSDFMX/1"), false);
check("the text ONEFM still works with no number", isOneFm("... AS PER ONEFM CLIENT PAYMENT NOTICE"), true);

const fmLines = p.invoices.filter((i) => /FM\//.test(i.documentNumber));
check("the export has 542 lines numbered with an FM prefix", fmLines.length, 542);
check("all of them are classified 1FM", fmLines.every((i) => i.isOneFm), true);
check(
  "including the VAT lines on a 1FM invoice, which say nothing about 1FM",
  fmLines.filter((i) => i.description.toUpperCase() === "VAT").length,
  139,
);
check("1FM lines in total, including one found by its text", p.invoices.filter((i) => i.isOneFm).length, 543);

/* ================================================ classification coverage */

section("Charge types across all 3,117 real lines");

const unmatched = p.invoices.filter((i) => matchRule(i.description, i.documentNumber, i.category) === null);
check("only the blank descriptions match no rule", unmatched.length, 3);
check("and all three are payment rows with no description", unmatched.every((i) => i.description === ""), true);

check(
  "Categories rescues a line whose description no rule knows",
  revenueType("Tenant Transfer", "BSD-786/1", "Tenant Transfer"),
  "Tenant Transfer",
);
check(
  "but the document number still wins over Categories, for 1FM",
  revenueType("Tenant Transfer", "BSDFM/1563", "Tenant Transfer"),
  "1FM Maintenance",
);
check(
  "stamp duty is found by description, since MES categorise it Reimbursement",
  revenueType("Reimbursement of Stamp Duty REF NO: 123", "BSD-786/1", "Reimbursement"),
  "Stamp Duty",
);

/* ================================================= GIRO, without the bank file */

section("GIRO enrolment, derived from the AR report alone");

const giro = giroEnrolled(p.invoices);
const lateFeeCustomers = new Set(
  p.invoices.filter((i) => i.revenueType === "Late Payment Fee").map((i) => i.customerCode),
);

check("tenants whose GIRO has bounced", giro.size, 6);
check("tenants charged the ordinary late payment fee", lateFeeCustomers.size, 6);
check(
  "and not one tenant is on both lists — MES's rule, in their own data",
  Array.from(giro).filter((c) => lateFeeCustomers.has(c)).length,
  0,
);

const giroLines = p.invoices.filter((i) => i.revenueType === "Rejected GIRO Fee");
const lateLines = p.invoices.filter((i) => i.revenueType === "Late Payment Fee");
check("rejected-GIRO fee lines", giroLines.length, 9);
check("late payment fee lines", lateLines.length, 27);
check("every late payment fee is exactly $100", lateLines.every((i) => i.openBalance === 100), true);
check(
  "and so is every rejected-GIRO fee bar one odd part-credited row",
  giroLines.filter((i) => i.openBalance === 100).length,
  8,
);

/* The $109 that fills MES's aging columns is the $100 fee plus 9% GST. Worth
 * pinning down, because 109 turns up 95 times in this export and all over the
 * manager mock-ups, and anyone reading those columns needs to know it is a
 * late fee rather than a rent line. */
const feeInvoices = Array.from(
  new Set([...giroLines, ...lateLines].map((i) => i.documentNumber)),
);
const feeInvoiceTotals = feeInvoices.map((d) =>
  round2(p.invoices.filter((i) => i.documentNumber === d).reduce((n, i) => n + i.openBalance, 0)),
);
check("there are 36 fee invoices", feeInvoices.length, 36);
check("35 of them are the full $100 fee plus $9 GST", feeInvoiceTotals.filter((t) => t === 109).length, 35);
check("so the fee invoice totals $109, which is why 109 is everywhere", 100 + 9, 109);

/* The 36th is the one that made this assertion fail the first time it was
 * written, and it is not a fault in the file. It is a fee invoice that has
 * been part paid, and NetSuite splits what is left across the invoice's lines
 * in proportion. So an open balance is the unpaid share of a line, never the
 * amount originally charged, and a rule that reads "every late fee line is
 * $100" is only true while nobody has paid part of one. */
const partPaid = p.invoices.filter((i) => i.documentNumber === "BSD-786/001363");
check("the 36th fee invoice is part paid", round2(partPaid.reduce((n, i) => n + i.openBalance, 0)), 9);
check("its two lines keep the 100:9 ratio of fee to GST",
  round2((partPaid.find((i) => i.revenueType === "Rejected GIRO Fee")?.openBalance ?? 0) /
         (partPaid.find((i) => i.revenueType === "VAT")?.openBalance ?? 1) * 1000) / 1000,
  round2((100 / 9) * 1000) / 1000);
check("which means an open balance is the unpaid share, not the charge",
  partPaid.every((i) => i.openBalance < 100), true);

/* ============================================== the six reports MES drew */

section("The six tabs from MES's workbook");

const tabs = REVENUE_TABS.map((s) => buildRevenueTab(s, p.invoices, p.asOf, p.entity));
check("five per-charge tabs are built", tabs.length, 5);
check("their codes are the tab names, not the ambiguous shorthand",
  tabs.map((t) => t.code).join(","),
  "SD-SECURITY,PF,1FM,LP,SD-STAMP");
check("MES's shorthand really does use SD twice",
  tabs.filter((t) => t.shorthand === "SD").length, 2);

const byCode = new Map(tabs.map((t) => [t.code, t]));
check("1FM tab lines", byCode.get("1FM")?.lineCount, 543);
check("Late Payment tab lines", byCode.get("LP")?.lineCount, 27);
check("Late Payment tab total is 27 fees of $100", byCode.get("LP")?.total, 2700);
check("Security Deposit tab lines", byCode.get("SD-SECURITY")?.lineCount, 14);
check("Stamp Duty tab lines", byCode.get("SD-STAMP")?.lineCount, 5);
check("Parking Fee tab is empty in this export", byCode.get("PF")?.lineCount, 0);
check("and says so rather than looking broken", (byCode.get("PF")?.notes.length ?? 0) > 0, true);
check("every tab is grouped by dormitory", tabs.every((t) => t.blocks.every((b) => b.title.length > 0)), true);

check("the manager report has Ray's thirteen columns", MANAGER_COLUMNS.length, 13);
check("two of them cannot be filled from any file MES has sent", MANAGER_UNAVAILABLE.length, 2);
check("and both say why", MANAGER_UNAVAILABLE.every((c) => (c.unavailable ?? "").length > 40), true);

/* ============================================ the late payment listing */

section("The 16th: who gets charged, and who is excluded");

const listing = buildLateFeeListing(p.accounts, p.invoices, p.asOf, p.entity);
check("the fee is $100", listing.fee, 100);
check("charged past 14 days, per MES's letter", listing.minimumAgeDays, 14);
check("tenants on GIRO are excluded", listing.giroExcluded.length, 6);
check(
  "every excluded tenant is one whose GIRO bounced",
  listing.giroExcluded.every((g) => giro.has(g.account.customerCode)),
  true,
);
check(
  "and none of them is on the charging list",
  listing.rows.filter((r) => giro.has(r.account.customerCode)).length,
  0,
);
check("nobody with nothing overdue is charged", listing.rows.every((r) => r.overdue > 0), true);
check("the exclusion is listed, not silently dropped", listing.notes.length, 2);

/* ===================================================== recurring defaulters */

section("Recurring defaulters, without the bank file");

const rd = recurringDefaulters(p.invoices, p.accounts);
const worst = rd[0];
check("the worst repeat GIRO failure is found", worst?.customerCode, "DORM-1372");
check("with three bounced deductions", worst?.failures, 3);
check("across three distinct months", worst?.months.length, 3);
check("and they are the months MES's invoices are dated",
  worst?.months.join(","), "2026-01,2026-02,2026-03");

/* ========================================================= MES's letters */

section("MES's own reminder letters, merged");

const ctx = { companyName: "ZOOMWORKS PTE. LTD.", grandTotal: 25369.29, sentOn: "2026-04-07" };
const first = renderLetter("first-reminder", ctx);

check("the company name is merged in", first.body.includes("Dear ZOOMWORKS PTE. LTD."), true);
check("so is the balance, formatted as MES write it", first.body.includes("$25,369.29"), true);
check("the letter dates itself in MES's own long form", first.body.includes("As of today, 7th April 2026"), true);
check("and gives six days to pay, as their sample does", first.body.includes("latest by 13 April 2026"), true);
check("the deadline comes back as a date the tracker can use", first.deadline, "2026-04-13");
check("the $100 fee warning is present", first.body.includes("$100.00 (before prevailing GST)"), true);
check("so is the $50 cheque fee, which only the first reminder carries", first.body.includes("cheque admin fee of $50"), true);
check("and the DBS account number", first.body.includes("011-901192-0"), true);
check("and the PayNow UEN", first.body.includes("200412284W"), true);
check("no merge field is left unfilled", /«|MERGEFIELD/.test(first.body), false);

const finalNotice = renderLetter("final-notice", { ...ctx, companyName: "JACK WAY CONSTRUCTION ENGINEERING", grandTotal: 6848.2, sentOn: "2026-04-20" });
check("the final notice uses MES's short date form", finalNotice.body.includes("as of today, 20 April 26"), true);
check("and gives seven days, not six", finalNotice.body.includes("latest by 27 April 26"), true);
check("its deadline is a week out", finalNotice.deadline, "2026-04-27");
check("it cites the Employment of Foreign Manpower Regulations", finalNotice.body.includes("Employment of Foreign Manpower (Work Passes) Regulations 2012"), true);
check("and raises disruption of services", finalNotice.body.includes("disruption of our services"), true);
check("and says reminders have already been sent", finalNotice.body.includes("Despite our reminders"), true);

check("the first reminder does NOT cite the regulations", first.body.includes("Employment of Foreign Manpower"), false);
check("nor threaten disruption of services", first.body.includes("disruption of our services"), false);
check("and the final notice drops the cheque paragraph", finalNotice.body.includes("cheque admin fee"), false);

check("first reminder deadline offset", DEADLINE_DAYS["first-reminder"], 6);
check("final notice deadline offset", DEADLINE_DAYS["final-notice"], 7);

/* dates and money, since a wrong one goes out in a letter chasing money */
check("a deadline can roll into the next month", addDays("2026-08-28", 7), "2026-09-04");
check("and over a year end", addDays("2026-12-30", 7), "2027-01-06");
check("February in a leap year", addDays("2028-02-27", 3), "2028-03-01");
check("long ordinal date", longOrdinalDate("2026-04-07"), "7th April 2026");
check("the 1st, 2nd, 3rd take their own suffixes", longOrdinalDate("2026-04-01"), "1st April 2026");
check("but 11th, 12th, 13th do not", longOrdinalDate("2026-04-11"), "11th April 2026");
check("the 21st does", longOrdinalDate("2026-08-21"), "21st August 2026");
check("long date", longDate("2026-04-13"), "13 April 2026");
check("short date", shortDate("2026-04-20"), "20 April 26");
check("money is grouped in thousands", currency(25369.29), "25,369.29");
check("and always has two decimals", currency(6848.2), "6,848.20");

/* the internal emails */
const rm = rmEmail("2611 Ray Ang", "2026-08-06", "2026-08-13");
check("the RM email is addressed by first name, as Jacqueline writes it", rm.body.includes("Dear Ray"), true);
check("its subject matches MES's own", rm.subject, "Ray's Clients as of Aug 26");
check("and it asks for a reply by 2pm", rm.body.includes("by 2pm on 13 August 2026"), true);
const fee = lateFeeEmail("2026-08-17");
check("the AR team email is titled by month", fee.subject, "August late payment admin fee");
check("and repeats the GIRO exclusion instruction", fee.body.includes("giro clients"), true);

/* ======================================================= sending, simulated */

section("Sending — simulated, and structurally unable to be otherwise");

check("no real transport is wired in", CAN_SEND_FOR_REAL, false);
assertSimulationOnly();
check("and asserting that does not throw", true, true);

const withEmail: Account = { ...p.accounts[0], emails: ["a@x.com", "b@x.com"], hasContact: true };
const withoutEmail: Account = { ...p.accounts[1], emails: [], hasContact: false };

const m1 = buildMessage(withEmail, "first-reminder", "2026-08-17");
check("a tenant with an address gets a simulated message", m1.state, "simulated");
check("addressed to every address on the row", m1.to.length, 2);
check("with no blocking reason", m1.reason, null);

const m2 = buildMessage(withoutEmail, "first-reminder", "2026-08-17");
check("a tenant with no address is blocked, not skipped", m2.state, "blocked");
check("and the reason says what to do instead", m2.reason?.includes("Phone them"), true);

const run = simulateSend([withEmail, withoutEmail], "final-notice", "2026-08-21");
check("every tenant is accounted for", run.messages.length, 2);
check("one would go", run.sendable.length, 1);
check("one could not", run.blocked.length, 1);
check("sendable and blocked partition the run", run.sendable.length + run.blocked.length, run.messages.length);
check("the balance chased counts only what would actually go", run.totalChased, round2(withEmail.total));
check("duplicate addresses are counted once", run.recipients, 2);

/* ==================================================== the whole pipeline */

section("The whole pipeline, both files");

const pipe = runPipeline(wb, existsSync(CONTACTS) ? XLSX.read(readFileSync(CONTACTS), { cellDates: true }) : null);
check("accounts survive the contact join", pipe.accounts.length, 190);
check("the total is unchanged by joining contacts", round2(pipe.accounts.reduce((n, a) => n + a.total, 0)), 2782348.27);
check("one dormitory in this export", pipe.byProperty.length, 1);
check("its bucket total matches the account total", pipe.byProperty[0].total, 2782348.27);

check("only five accounts can actually be emailed", pipe.contactCoverage.withEmail, 5);
check("which leaves 185 that cannot", pipe.contactCoverage.withoutEmail, 185);
check("the two figures cover every account", pipe.contactCoverage.withEmail + pipe.contactCoverage.withoutEmail, 190);

check(
  "no manager report can be built from this export",
  pipe.managerReports.length,
  0,
);
check(
  "and the pipeline says why rather than returning a silent empty list",
  pipe.problems.some((q) => q.message.includes("Primary Sales Rep")),
  true,
);
check("no errors across the whole run", pipe.problems.filter((q) => q.severity === "error").length, 0);

/* ================================================ the app's upload path */

section("Uploading it through the app's own front door");

check("the upload path recognises the new export", detectKind(wb), "ar-aging-detail");
check(
  "and does not mistake it for the older detail report",
  detectKind(wb) === "ar-detail",
  false,
);

const contactsWb = existsSync(CONTACTS)
  ? XLSX.read(readFileSync(CONTACTS), { cellDates: true })
  : null;
check(
  "the contact list is still recognised as itself",
  contactsWb ? detectKind(contactsWb) : "contact-list",
  "contact-list",
);

const results = [
  parseAgingDetail(wb),
  ...(contactsWb ? [parseContacts(contactsWb)] : []),
];
const ds = datasetFromResults(results, "2026-08");
check("a dataset is built from the upload", ds !== null, true);
check("with every account", ds?.accounts.length, 190);
check("and every invoice line", ds?.invoices.length, 3117);
check("dated from the file, not from today", ds?.asOf, "2026-08-17");
check(
  "the total survives the trip through the app",
  round2((ds?.accounts ?? []).reduce((n, a) => n + a.total, 0)),
  2782348.27,
);
check(
  "every invoice line is given an id on the way in",
  (ds?.invoices ?? []).every((i) => typeof i.id === "string" && i.id.length > 0),
  true,
);
check(
  "the contact list is folded in on the way through",
  (ds?.accounts ?? []).filter((a) => a.emails.length > 0).length,
  5,
);

/* ======================================= emailing a report, on demand */

section("Emailing a report — MES's two Flow-tab lines");

const oneFmTab = tabs.find((t) => t.code === "1FM")!;
const withAddr: Recipient = { id: "rm-ray", name: "Ray Ang", kind: "rm", email: "ray@example.com" };
const noAddr: Recipient = { id: "rm-harry", name: "Harry Tan", kind: "rm", email: null };

const sent = simulateReportSend(oneFmTab, [withAddr], "2026-08-17");
check("a report can be sent to a chosen person", sent.state, "simulated");
check("it names the report in the subject", sent.subject.includes("1FM"), true);
check("it carries the row count", sent.rows, 543);
check("and an attachment named the way MES name theirs", sent.attachment.endsWith("20260817.xlsx"), true);
check("the covering note is Jacqueline's wording", sent.body.includes("Please refer to the enclosed"), true);

const both = simulateReportSend(oneFmTab, [withAddr, noAddr], "2026-08-17");
check("more than one recipient can be chosen", both.to.length, 2);
check("but one missing address blocks the send", both.state, "blocked");
check("and the reason names who is missing", both.reason?.includes("Harry Tan"), true);

const none = simulateReportSend(oneFmTab, [], "2026-08-17");
check("sending to nobody is blocked, not silently done", none.state, "blocked");

const lateTab = { ...oneFmTab, code: "LATE-FEE-LISTING", name: "Late payment listing" };
const toAr = simulateReportSend(
  lateTab,
  [{ id: "ar", name: "Accounts Receivable", kind: "ar-team", email: "ar@example.com" }],
  "2026-08-17",
);
check("the late payment listing uses its own covering note", toAr.subject, "August late payment admin fee");
check("which repeats the GIRO exclusion instruction", toAr.body.includes("giro clients"), true);

check("the default recipient list covers MES's named parties", DEFAULT_RECIPIENTS.length, 5);
check("and none of them has an invented address", DEFAULT_RECIPIENTS.every((r) => r.email === null), true);

/* ============================ one copy of MES's wording, not two */

section("The screen and the simulation render the same letter");

// This is the regression that prompted the check. The reminder screen carried
// its own copy of both letters and its own date logic, and the two had drifted:
// it gave six days to pay on the final notice where MES's sample gives seven,
// and it dated the letter today rather than by the report.
check("the first reminder body is the shared one",
      DEFAULT_TEMPLATES.find((t) => t.id === "reminder-7th")?.body,
      LETTER_BODIES["first-reminder"]);
check("and so is the final notice",
      DEFAULT_TEMPLATES.find((t) => t.id === "final-21st")?.body,
      LETTER_BODIES["final-notice"]);
check("neither still contains an unfilled placeholder after rendering",
      /\{\{\w+\}\}/.test(renderLetter("final-notice", ctx).body), false);
check("the shared body does contain placeholders before rendering",
      LETTER_BODIES["first-reminder"].includes("{{company}}"), true);
check("filling it by hand gives the same text as rendering it",
      fillLetter(LETTER_BODIES["first-reminder"], {
        company: "ZOOMWORKS PTE. LTD.",
        amount: 25369.29,
        today: "7th April 2026",
        dueBy: "13 April 2026",
      }),
      renderLetter("first-reminder", ctx).body);

console.log(failures === 0 ? "\nALL CHECKS PASS\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
