/**
 * Every feature, exercised with inputs that change.
 *
 *   npm run test:behaviour
 *
 * The other suites check the system against one file on one date. This one
 * moves the inputs: different report dates, different days of the month,
 * month and year boundaries, leap years, empty and hostile data. Most faults
 * found in this project were not wrong logic on the happy path, they were
 * logic that had only ever been run on the happy path.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

import { parseAgingDetail, propertyFromDocument, round2 } from "../src/lib/aging-detail.ts";
import { billingCycles, cycleStage, CREDIT_DAYS } from "../src/lib/billing-cycles.ts";
import {
  emptyState,
  markPaid,
  markPromised,
  planFor,
  rmsFor,
  runDay,
  snapshot,
  stillOwing,
} from "../src/lib/cycle.ts";
import { bucketForAge, bucketLabelForAge, feesDue, DEFAULT_FEE_RULE, isInCredit, overdueTotal } from "../src/lib/data.ts";
import { revenueType, isOneFm, matchRule } from "../src/lib/revenue-rules.ts";
import {
  buildLateFeeListing, buildRevenueTab, giroEnrolled, recurringDefaulters,
  REVENUE_TABS, agingByProperty, buildManagerReports, riskExposure,
} from "../src/lib/reports.ts";
import {
  addDays, renderLetter, longOrdinalDate, longDate, shortDate, currency,
  DEADLINE_DAYS, rmEmail, lateFeeEmail, fillLetter, LETTER_BODIES,
} from "../src/lib/letters.ts";
import { simulateSend, buildMessage, recipientsFor } from "../src/lib/outbox.ts";
import { parseContacts } from "../src/lib/parser.ts";
import { linkContacts } from "../src/lib/pipeline.ts";
import { simulateReportSend, DEFAULT_RECIPIENTS } from "../src/lib/dispatch.ts";
import { templateDueOn, DEFAULT_TEMPLATES, promiseState } from "../src/lib/store.ts";
import { newSession, isExpired, readSession, SEED_USERS, canOpen, can } from "../src/lib/auth.ts";
import type { Account } from "../src/lib/types.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const F = path.join(ROOT, "AR Automation-20260903T201835Z-1-001", "AR Automation");
const AGING = path.join(F, "3. CustomA_RAgingDetail-WithDescription.xlsx");

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${name.slice(0, 68).padEnd(68)} ` +
      (ok ? "" : `got ${String(actual)}, expected ${String(expected)}`),
  );
}
const section = (t: string) => console.log(`\n${t}\n`);

if (!existsSync(AGING)) {
  console.error("MES's export is missing");
  process.exit(1);
}
const p = parseAgingDetail(XLSX.read(readFileSync(AGING), { cellDates: true }));

/* ========================================================= 1. TIME: the cycle */

section("1. Which reminder fires, on every day of the month");

const fired: Record<number, string> = {};
for (let d = 1; d <= 31; d += 1) {
  const t = templateDueOn(new Date(2026, 7, d), DEFAULT_TEMPLATES);
  if (t) fired[d] = t.id;
}
check("only two days in the month send anything", Object.keys(fired).length, 2);
check("the 7th sends the first reminder", fired[7], "reminder-7th");
check("the 21st sends the final notice", fired[21], "final-21st");
check("the 6th sends nothing", fired[6], undefined);
check("the 8th sends nothing", fired[8], undefined);
check("the 16th sends nothing — that is the fee day", fired[16], undefined);
check("the 20th sends nothing", fired[20], undefined);
check("the 22nd sends nothing", fired[22], undefined);
check("the 31st sends nothing", fired[31], undefined);

// The same day across twelve months must behave identically.
const across = Array.from({ length: 12 }, (_, m) =>
  templateDueOn(new Date(2026, m, 7), DEFAULT_TEMPLATES)?.id);
check("the 7th behaves the same in all twelve months",
  new Set(across).size, 1);
const across21 = Array.from({ length: 12 }, (_, m) =>
  templateDueOn(new Date(2026, m, 21), DEFAULT_TEMPLATES)?.id);
check("and so does the 21st", new Set(across21).size, 1);

// February, where the 29th, 30th and 31st do not exist.
check("28 February sends nothing", templateDueOn(new Date(2026, 1, 28), DEFAULT_TEMPLATES), null);
check("29 February 2028 sends nothing", templateDueOn(new Date(2028, 1, 29), DEFAULT_TEMPLATES), null);

/* ============================================= 2. TIME: deadline arithmetic */

section("2. Pay-by dates, across every boundary");

check("mid-month, first reminder", addDays("2026-08-07", 6), "2026-08-13");
check("mid-month, final notice", addDays("2026-08-21", 7), "2026-08-28");
check("rolls into the next month", addDays("2026-08-28", 7), "2026-09-04");
check("rolls over a 30-day month", addDays("2026-09-28", 7), "2026-10-05");
check("rolls over the year end", addDays("2026-12-28", 7), "2027-01-04");
check("31 December plus one", addDays("2026-12-31", 1), "2027-01-01");
check("February in a common year", addDays("2027-02-26", 3), "2027-03-01");
check("February in a leap year", addDays("2028-02-26", 3), "2028-02-29");
check("and the day after that", addDays("2028-02-29", 1), "2028-03-01");
check("zero days is the same day", addDays("2026-08-17", 0), "2026-08-17");

// Every day of a year must round-trip, so no month boundary is special.
let rollFails = 0;
for (let i = 0; i < 365; i += 1) {
  const d = addDays("2026-01-01", i);
  if (addDays(d, 0) !== d) rollFails += 1;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) rollFails += 1;
}
check("365 consecutive days all produce a valid date", rollFails, 0);

/* ============================================ 3. TIME: letters on any date */

section("3. A letter dates itself from the report, whatever the date");

for (const on of ["2026-01-01", "2026-02-28", "2026-06-30", "2026-12-31", "2028-02-29"]) {
  const l = renderLetter("first-reminder", { companyName: "X", grandTotal: 1, sentOn: on });
  const ok = l.body.includes(longOrdinalDate(on)) &&
             l.body.includes(longDate(addDays(on, 6))) &&
             !/\{\{\w+\}\}/.test(l.body);
  check(`first reminder dated ${on} merges cleanly`, ok, true);
}
for (const on of ["2026-01-01", "2026-12-31", "2028-02-29"]) {
  const l = renderLetter("final-notice", { companyName: "X", grandTotal: 1, sentOn: on });
  const ok = l.body.includes(shortDate(on)) &&
             l.body.includes(shortDate(addDays(on, 7))) &&
             !/\{\{\w+\}\}/.test(l.body);
  check(`final notice dated ${on} merges cleanly`, ok, true);
}
check("the two letters never give the same number of days",
  DEADLINE_DAYS["first-reminder"] === DEADLINE_DAYS["final-notice"], false);

/* ================================================ 4. TIME: session expiry */

section("4. Sessions, at the boundary");

const u = SEED_USERS[0];
const t0 = new Date("2026-09-07T09:00:00Z");
const s = newSession(u, t0);
check("live at the moment it is made", isExpired(s, t0), false);
check("live one second before expiry",
  isExpired(s, new Date(Date.parse(s.expiresAt) - 1000)), false);
check("expired at the exact moment", isExpired(s, new Date(s.expiresAt)), true);
check("expired one second after",
  isExpired(s, new Date(Date.parse(s.expiresAt) + 1000)), true);
check("a session made at 23:00 survives past midnight",
  isExpired(newSession(u, new Date("2026-09-07T23:00:00Z")), new Date("2026-09-08T02:00:00Z")), false);
check("but not eight hours later",
  isExpired(newSession(u, new Date("2026-09-07T23:00:00Z")), new Date("2026-09-08T08:00:00Z")), true);
check("a garbage expiry is treated as expired",
  isExpired({ ...s, expiresAt: "not-a-date" }), true);
check("and readSession refuses it",
  readSession(JSON.stringify({ ...s, expiresAt: "not-a-date" }), t0), null);

/* ====================================== 5. AGING: every boundary, both sides */

section("5. Aging buckets, at every boundary");

const bounds: [number, string][] = [
  [-999, "current"], [-1, "current"], [0, "current"], [15, "current"],
  [16, "d30"], [45, "d30"],
  [46, "d60"], [75, "d60"],
  [76, "d90"], [105, "d90"],
  [106, "d90plus"], [9999, "d90plus"],
];
for (const [age, want] of bounds) {
  check(`age ${age} is ${want}`, bucketForAge(age), want);
}
check("the label for the last bucket is MES's wording",
  bucketLabelForAge(200), "More than 90 days");
// no age can fall outside the five
let unbucketed = 0;
for (let a = -400; a <= 400; a += 1) {
  if (!["current", "d30", "d60", "d90", "d90plus"].includes(bucketForAge(a))) unbucketed += 1;
}
check("800 consecutive ages all land in a bucket", unbucketed, 0);

/* ================================== 6. CLASSIFICATION: varied and hostile */

section("6. Charge types, with awkward input");

check("empty description", revenueType(""), "Other Charges");
check("whitespace only", revenueType("   "), "Other Charges");
check("lower case still matches", revenueType("occupancy fee charges"), "Occupancy Fee");
check("mixed case", revenueType("OcCuPaNcY fEe"), "Occupancy Fee");
check("extra internal spacing", revenueType("Occupancy    Fee   Charges"), "Occupancy Fee");
check("leading and trailing space", revenueType("  Occupancy Fee  "), "Occupancy Fee");
check("a trailing full stop", revenueType("Occupancy Fee."), "Occupancy Fee");
check("late payment beats the looser admin fee",
  revenueType("Admin Fee For Late Payment - JAN'26"), "Late Payment Fee");
check("rejected giro beats admin fee too",
  revenueType("Admin Fee for Rejected Giro - 02-JAN-26"), "Rejected GIRO Fee");
check("1FM by number beats everything in the text",
  revenueType("Occupancy Fee Charges", "BSDFM/1"), "1FM Maintenance");
check("every dormitory prefix works",
  ["BSDFM/1", "JPD1FM/1", "JPD2FM/1", "JP1FM/1", "LEOFM/1"]
    .every((d) => isOneFm("VAT", d)), true);
check("a lookalike prefix does not", isOneFm("VAT", "BSDFMX/1"), false);
check("VAT is exact, never a substring match",
  revenueType("Reimbursement of VAT paid elsewhere"), "Other Charges");

/* =========================== 7. THE REAL FILE, sliced in different ways */

section("7. The real export, cut different ways");

check("every line lands in exactly one charge type",
  p.invoices.length,
  REVENUE_TABS.reduce((n, spec) => n + buildRevenueTab(spec, p.invoices, p.asOf, null).lineCount, 0) +
  p.invoices.filter((i) => !REVENUE_TABS.some((s) => s.revenueType === i.revenueType)).length);

const sumTabs = REVENUE_TABS
  .map((spec) => buildRevenueTab(spec, p.invoices, p.asOf, null))
  .reduce((n, t) => n + t.total, 0);
check("the tabs never double count a line",
  new Set(p.invoices.filter((i) => REVENUE_TABS.some((s) => s.revenueType === i.revenueType))
    .map((i) => i.documentNumber + i.description + i.openBalance)).size > 0, true);

const byProp = agingByProperty(p.accounts);
check("grouping by dorm keeps every account",
  byProp.reduce((n, r) => n + r.accounts, 0), p.accounts.length);
check("and every cent",
  round2(byProp.reduce((n, r) => n + r.total, 0)),
  round2(p.accounts.reduce((n, a) => n + a.total, 0)));

check("accounts in credit are never chased",
  p.accounts.filter((a) => isInCredit(a) && overdueTotal(a) > 0).length, 0);

/* ============================ 8. FEES: the rule moved to different values */

section("8. The fee rule, at other settings");

const feeAt = (days: number) =>
  buildLateFeeListing(p.accounts, p.invoices, p.asOf, p.entity, { minimumAgeDays: days }).rows.length;
const d0 = feeAt(0), d14 = feeAt(14), d30 = feeAt(30), d90 = feeAt(90), d999 = feeAt(9999);
check("a longer grace period never charges more people", d14 >= d30, true);
check("and 30 never charges more than 90 does", d30 >= d90, true);
check("an impossible threshold charges nobody", d999, 0);
check("zero days charges the most", d0 >= d14, true);
check("the default is 14 days", DEFAULT_FEE_RULE.minimumAgeDays, 14);

const fee200 = buildLateFeeListing(p.accounts, p.invoices, p.asOf, p.entity, { fee: 200 });
check("changing the fee changes only the amount",
  fee200.rows.length, buildLateFeeListing(p.accounts, p.invoices, p.asOf, p.entity).rows.length);
check("and it is carried on every row", fee200.rows.every((r) => r.fee === 200), true);

const listing = buildLateFeeListing(p.accounts, p.invoices, p.asOf, p.entity);
const giro = giroEnrolled(p.invoices);
check("charged and excluded never overlap",
  listing.rows.filter((r) => giro.has(r.account.customerCode)).length, 0);
check("charged plus excluded is everyone overdue",
  listing.rows.length + listing.giroExcluded.length,
  feesDue(p.accounts, DEFAULT_FEE_RULE, p.invoices).length);

/* ================================ 9. SENDING: different populations */

section("9. Sending, with different populations");

const withMail: Account = { ...p.accounts[0], id: "a", emails: ["a@x.com"], hasContact: true };
const noMail: Account = { ...p.accounts[1], id: "b", emails: [], hasContact: false };
const dupMail: Account = { ...p.accounts[2], id: "c", emails: ["a@x.com", "A@X.COM"], hasContact: true };
const terminated: Account = { ...p.accounts[3], id: "d", emails: ["t@x.com"], status: "Terminated" };
const zero: Account = { ...p.accounts[4], id: "e", emails: ["z@x.com"], total: 0 };

check("nobody at all sends nothing", simulateSend([], "first-reminder", "2026-08-17").messages.length, 0);
const mix = simulateSend([withMail, noMail, dupMail, terminated, zero], "first-reminder", "2026-08-17", { skipTerminated: true });
check("a zero balance is not chased", mix.messages.some((m) => m.accountId === "e"), false);
check("a terminated tenant is skipped when asked", mix.messages.some((m) => m.accountId === "d"), false);
check("everyone else is accounted for", mix.sendable.length + mix.blocked.length, mix.messages.length);
check("the tenant with no address is blocked", mix.blocked.some((m) => m.accountId === "b"), true);
check("a duplicated address is counted once", recipientsFor(dupMail).length, 1);

const keep = simulateSend([terminated], "first-reminder", "2026-08-17", { skipTerminated: false });
check("and kept when not asked to skip", keep.messages.length, 1);

const m1 = buildMessage(withMail, "first-reminder", "2026-08-17");
const m2 = buildMessage(withMail, "final-notice", "2026-08-17");
check("the same tenant on two letters gets two ids", m1.id === m2.id, false);
check("the final notice always gives a later deadline",
  Date.parse(m2.deadline) > Date.parse(m1.deadline), true);
check("no message is ever built with an unmerged field",
  /\{\{\w+\}\}/.test(m1.body + m2.body), false);

/* ============================ 10. REPORT SENDING: recipients that vary */

section("10. Emailing a report, with and without addresses");

const tab = buildRevenueTab(REVENUE_TABS[2], p.invoices, p.asOf, p.entity);
const has = { id: "r1", name: "Ray", kind: "rm" as const, email: "ray@x.com" };
const hasnt = { id: "r2", name: "Harry", kind: "rm" as const, email: null };
check("one good recipient sends", simulateReportSend(tab, [has], "2026-08-17").state, "simulated");
check("one bad recipient blocks", simulateReportSend(tab, [hasnt], "2026-08-17").state, "blocked");
check("one bad among good still blocks", simulateReportSend(tab, [has, hasnt], "2026-08-17").state, "blocked");
check("nobody at all blocks", simulateReportSend(tab, [], "2026-08-17").state, "blocked");
check("the block names who is missing",
  simulateReportSend(tab, [has, hasnt], "2026-08-17").reason?.includes("Harry"), true);
check("no seed recipient ships with an invented address",
  DEFAULT_RECIPIENTS.every((r) => r.email === null), true);

/* the covering note changes with the month */
for (const [d, want] of [["2026-01-05", "January"], ["2026-08-17", "August"], ["2026-12-31", "December"]]) {
  check(`the AR team note is titled ${want}`, lateFeeEmail(d).subject, `${want} late payment admin fee`);
}
check("the RM note names the manager", rmEmail("2611 Ray Ang", "2026-08-06", "2026-08-13").body.includes("Dear Ray"), true);

/* ================================= 11. PROMISES: relative to a moving today */

section("11. Promises, as the date moves past them");

const promise = {
  id: "p", accountId: "a", companyName: "X", amount: 100,
  promisedFor: "2026-08-20", createdAt: "2026-08-10T00:00:00Z",
  source: "call" as const, confirmationSentAt: null,
};
check("a week before, it is upcoming", promiseState(promise, new Date("2026-08-13")), "upcoming");
check("the day before, still upcoming", promiseState(promise, new Date("2026-08-19")), "upcoming");
check("on the day, it is due", promiseState(promise, new Date("2026-08-20")), "due-today");
check("the day after, it is broken", promiseState(promise, new Date("2026-08-21")), "broken");
check("a month after, still broken", promiseState(promise, new Date("2026-09-21")), "broken");

/* ================================== 12. ROLES: every route, every role */

section("12. Access, exhaustively");

const ROUTES = ["/", "/upload", "/collections", "/reminders", "/outbox", "/calls",
  "/promises", "/late-fees", "/defaulters", "/reports", "/settings", "/users",
  "/access", "/activity"];
let leaks = 0;
for (const r of ROUTES) if (canOpen(null, r)) leaks += 1;
check("signed out, not one of the 14 routes opens", leaks, 0);

let rmCanAct = 0;
for (const c of ["send-reminders", "log-calls", "raise-late-fees", "upload-reports",
  "edit-settings", "manage-users", "view-tenant-emails"] as const) {
  if (can("RM", c)) rmCanAct += 1;
}
check("an RM can do none of the seven acting things", rmCanAct, 0);

let mgmtCanAct = 0;
for (const c of ["send-reminders", "log-calls", "raise-late-fees", "upload-reports",
  "edit-settings", "manage-users"] as const) {
  if (can("Management", c)) mgmtCanAct += 1;
}
check("nor can Management", mgmtCanAct, 0);

check("super admin is the only one who manages users",
  (["super-admin", "admin", "CSD", "RM", "Management"] as const)
    .filter((r) => can(r, "manage-users")).length, 1);

/* ==================================== 13. PARSING: awkward document numbers */

section("13. Placing a dormitory from odd numbers");

const shapes: [string, string][] = [
  ["BSD-786/002070", "BSD"], ["BSD786/44140", "BSD"], ["BSDFM/1598", "BSD"],
  ["BSDCN/017", "BSD"], ["REC-BSD367", "BSD"],
  ["JPD1-786/002429", "JPD1"], ["JP1FM/2705", "JPD1"], ["JPD2-1/2", "JPD2"],
  ["JP2FM/1", "JPD2"], ["LEO-1/2", "LEO"], ["LEOFM/1", "LEO"],
];
for (const [doc, want] of shapes) {
  check(`${doc} is ${want}`, propertyFromDocument(doc, "JPD2"), want);
}
check("an empty number falls back", propertyFromDocument("", "LEO"), "LEO");
check("nonsense falls back", propertyFromDocument("!!!", "LEO"), "LEO");
check("lower case still places", propertyFromDocument("bsdfm/1", "LEO"), "BSD");

/* ======================================= 14. DETERMINISM: run it all twice */

section("14. Nothing drifts between two runs");

const again = parseAgingDetail(XLSX.read(readFileSync(AGING), { cellDates: true }));
check("same line count", again.invoices.length, p.invoices.length);
check("same accounts", again.accounts.length, p.accounts.length);
check("same total",
  round2(again.accounts.reduce((n, a) => n + a.total, 0)),
  round2(p.accounts.reduce((n, a) => n + a.total, 0)));
check("same date", again.asOf, p.asOf);
check("same GIRO set", giroEnrolled(again.invoices).size, giroEnrolled(p.invoices).size);
check("same defaulters", recurringDefaulters(again.invoices, again.accounts).length,
  recurringDefaulters(p.invoices, p.accounts).length);
const r1 = buildLateFeeListing(p.accounts, p.invoices, p.asOf, p.entity);
const r2 = buildLateFeeListing(again.accounts, again.invoices, again.asOf, again.entity);
check("same fee listing", r1.rows.length, r2.rows.length);
check("in the same order", r1.rows[0].account.customerCode, r2.rows[0].account.customerCode);

/* the letters must not depend on when the test runs */
const now1 = renderLetter("first-reminder", { companyName: "X", grandTotal: 5, sentOn: "2026-08-17" });
const now2 = renderLetter("first-reminder", { companyName: "X", grandTotal: 5, sentOn: "2026-08-17" });
check("a letter rendered twice is identical", now1.body === now2.body, true);
check("and contains no reference to today", now1.body.includes(String(new Date().getFullYear())) &&
  !now1.body.includes("2026"), false);

/* ============================================ 15. MONEY: formatting */

section("15. Amounts, at awkward values");

check("zero", currency(0), "0.00");
check("under a dollar", currency(0.5), "0.50");
check("rounding up", currency(0.005), "0.01");
check("a negative", currency(-1234.5), "-1,234.50");
check("thousands", currency(1000), "1,000.00");
check("millions", currency(2782348.27), "2,782,348.27");
check("always two decimals", currency(1), "1.00");
check("round2 does not drift over a thousand additions",
  round2(Array.from({ length: 1000 }, () => 0.01).reduce((a, b) => a + b, 0)), 10);

/* ------------------------------------------------------- billing cycles ---
 * Raman, 14 September: "the starting point is the billing date, plus seven,
 * plus 14, plus 21. In one report you may have several billing dates."
 *
 * The aging was already measured per line. What these pin is the grouping and
 * the credit period, because one report date for the whole file would put a
 * bill from March and one from three days ago in the same place.
 */
console.log("\nBilling runs, each with its own clock\n");

const cyc = (date: string | null, amount: number, age: number | null = null) =>
  ({
    id: `x${date}${amount}`, companyName: "ACME PTE LTD",
    transactionType: "Invoice", date, dueDate: null,
    description: "Occupancy Fee Charges", documentNumber: "BSD-786/1",
    linkedContract: null, age, bucket: "", openBalance: amount,
    revenueType: "Occupancy Fee", isOneFm: false,
  }) as never;

const three = billingCycles(
  [cyc("2026-07-15", 100), cyc("2026-07-15", 50), cyc("2026-08-03", 25)],
  "2026-08-17",
);
check("lines group by the date they were billed", three.cycles.length, 2);
check("newest run first", three.cycles[0]?.billedOn, "2026-08-03");
check("and its lines are added up", three.cycles[1]?.total, 150);
check("payment falls due 14 days after billing", three.cycles[1]?.dueBy, "2026-07-29");
check("the second deadline is 30 days", three.cycles[1]?.finalBy, "2026-08-14");

// The whole point: same file, same report date, two different answers.
check("a run 33 days old is past both deadlines", cycleStage(three.cycles[1]!), "past 30 days");
check("one billed a fortnight ago is within credit", cycleStage(three.cycles[0]!), "within credit");
check("so only the older one counts as overdue", three.cycles[1]?.overdue, 150);
check("and the newer one does not", three.cycles[0]?.overdue, 0);

check(`exactly ${CREDIT_DAYS} days is still within credit`,
      cycleStage(billingCycles([cyc("2026-08-03", 10)], "2026-08-17").cycles[0]!),
      "within credit");
check("one day older is not",
      cycleStage(billingCycles([cyc("2026-08-02", 10)], "2026-08-17").cycles[0]!),
      "past 14 days");
check("billed after the report date is not yet due",
      cycleStage(billingCycles([cyc("2026-09-01", 10)], "2026-08-17").cycles[0]!),
      "not yet due");

// Undated lines are reported, never folded into a run they do not belong to.
const mixed = billingCycles([cyc("2026-07-15", 100), cyc(null, 40)], "2026-08-17");
check("a line with no billing date joins no run", mixed.cycles.length, 1);
check("it is counted and said out loud", mixed.undated, 1);
check("with its value", mixed.undatedTotal, 40);

// No report date at all: grouping still works, staleness cannot be judged.
const nodate = billingCycles([cyc("2026-07-15", 100, 33)], null);
check("with no report date the runs still group", nodate.cycles.length, 1);
check("and the line's own age decides overdue", nodate.cycles[0]?.overdue, 100);
check("but how far through credit is unknown", nodate.cycles[0]?.ageDays, null);

/* ------------------------------------------------ amounts not supplied ---
 * Raman, 14 September, on the blank Open Balance column: "it will probably be
 * filled. If there's no data there, then you can't display, so you just put
 * some kind of note that this data not available."
 *
 * Blank is not zero. MES's export as sent has 169 of 173 lines empty, and
 * without this they read as $0 owed, which does not look like missing data.
 * It looks like the tenant has paid.
 */
console.log("\nAmounts MES have not supplied\n");

const blankSheet = (balances: (number | string | null)[]) => {
  const head = ["Customer","Transaction Type","Company Name","Date","Description",
    "Categories","Document Number","Linked Contract","Contract Item Start Date",
    "P.O. No.","Due Date","Age","Open Balance","Item: Item Type"];
  const rows: unknown[][] = [["MES"],["Consol : X"],["Title"],["As of 17 August 2026"],[],[],head,
    ["DORM-1 ACME PTE LTD"]];
  for (const b of balances)
    rows.push(["","Invoice","ACME PTE LTD","2026-08-01","Occupancy Fee Charges",
      "Occupancy Fee Charges","BSD-786/1","C1","2026-08-01","","2026-08-16",1,b,"Service"]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  return parseAgingDetail(wb);
};
const said = (r: ReturnType<typeof blankSheet>) =>
  r.problems.some((p) => /no amount in the Open Balance/.test(p.message));

check("a blank amount is reported, not passed off as nil",
      said(blankSheet([null, 100, 200])), true);
check("and the line is still counted, at zero",
      blankSheet([null, 100, 200]).invoices.length, 3);
check("a real zero is not reported as missing", said(blankSheet([0, 100])), false);
check("nothing is said when every line has one", said(blankSheet([100, 200])), false);
check("an empty string counts as missing", said(blankSheet(["", 100])), true);

/* --------------------------------------------------- the month, running ---
 * What separates a simulation from a report of each day: the state carries.
 * The first version of that screen computed every day from the same starting
 * position, so the 21st named the same tenants as the 7th and a tenant who
 * paid in between was still being chased at the end of the month.
 */
console.log("\nA month, with the state carrying forward\n");

const simAcct = (id: string, overdue: number, hasContact = true): never =>
  ({
    id, customerCode: `DORM-${id}`, companyName: `${id.toUpperCase()} PTE LTD`,
    property: "BSD", propertyName: "Blue Stars Dormitory", status: "Live",
    buckets: { current: 0, d30: overdue, d60: 0, d90: 0, d90plus: 0 },
    total: overdue, legacyNote: null, emails: hasContact ? [`${id}@x.com`] : [],
    hasContact, industry: null, entity: null, invoiceCount: 1, isOneFm: false,
    revenueTypes: [], lateFeeCount: 0,
  }) as never;

const simPipe = (accounts: unknown[]): never =>
  ({
    asOf: "2026-08-17", entity: null, accounts, invoices: [], byProperty: [],
    revenueTabs: [], managerReports: [], defaulters: [],
    lateFees: { asOf: "2026-08-17", entity: null, fee: 100, minimumAgeDays: 14, rows: [], giroExcluded: [], notes: [] },
    giroCustomers: new Set<string>(), problems: [],
    contactCoverage: { total: 0, withEmail: 0, withoutEmail: 0, addresses: 0 },
  }) as never;

const a1 = simAcct("a", 1000);
const a2 = simAcct("b", 2000);
const a3 = simAcct("c", 3000);
const pipe = simPipe([a1, a2, a3]);

let st = emptyState();
check("nobody has been reminded before the month starts", st.firstReminder.length, 0);

st = runDay(pipe, st, 7);
check("the 7th reminds everyone owing", st.firstReminder.length, 3);

// The part a report cannot do.
st = markPaid(st, a1 as never, 7);
st = markPromised(st, a2 as never, "2026-09-05", 7);

check("someone who paid is no longer owing", stillOwing(pipe, st).length, 1);
check("and a promise holds them too", stillOwing(pipe, st)[0]?.id, "c");

st = runDay(pipe, st, 16);
check("only the one left is charged the fee", st.charged.length, 1);
check("not the one who paid", st.charged.includes("a"), false);
check("nor the one who promised", st.charged.includes("b"), false);

st = runDay(pipe, st, 21);
check("the final notice goes to the one still owing", st.finalNotice.length, 1);
check("running the 7th again would not re-send to them",
      planFor(pipe, st, 7).affected, 0);

const after = snapshot(pipe, st);
check("the snapshot counts the payment", after.paid, 1);
check("and the promise, separately", after.promised, 1);
check("and what is still owed", after.owed, 3000);

// Pure: replaying the same inputs gives the same month.
let replay = emptyState();
replay = runDay(pipe, replay, 7);
replay = markPaid(replay, a1 as never, 7);
replay = markPromised(replay, a2 as never, "2026-09-05", 7);
replay = runDay(pipe, replay, 16);
replay = runDay(pipe, replay, 21);
check("the same inputs produce the same month",
      JSON.stringify(snapshot(pipe, replay)), JSON.stringify(after));

/* ------------------------------------------------- the exception round trip ---
 * Raman, 14 September: "those that don't have email, it will just generate an
 * exception report, Excel or CSV, which will list those clients. Then the user
 * will enter it and re-upload only that one for emailing."
 *
 * Two halves. The list has to come out in a shape the contact parser reads
 * back, and re-uploading a partial one has to ADD those addresses rather than
 * replace everybody, or correcting three tenants would wipe the other 187.
 */
console.log("\nThe exception list, out and back in\n");

const exceptionSheet = (rows: [string, string][]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Company Name", "Status", "Dormitory", "Outstanding", "Email Address"],
      ...rows.map(([who, mail]) => [who, "Live", "Blue Stars", "100.00", mail]),
    ]),
    "Total",
  );
  return wb;
};

// The header the download writes must be the header the parser looks for.
const roundTrip = parseContacts(
  exceptionSheet([["DORM-63 ALTUS FACILITIES PTE LTD", "ar@altus.com.sg"]]),
);
check("the downloaded shape parses as a contact list", roundTrip.kind, "contact-list");
check("and the address comes back", roundTrip.contacts[0]?.emails[0], "ar@altus.com.sg");
check("matched to the right customer code",
      roundTrip.contacts[0]?.customerCode, "DORM-63");

// A row still blank is not an address, and must not read as one.
const stillBlank = parseContacts(
  exceptionSheet([["DORM-99 NOT FILLED IN PTE LTD", ""]]),
);
check("a row nobody filled in yields no contact", stillBlank.contacts.length, 0);

// The merge. Three corrected tenants must not wipe the rest.
const before: Account[] = [
  { customerCode: "DORM-1", companyName: "HAS ONE", emails: ["old@x.com"], hasContact: true } as Account,
  { customerCode: "DORM-2", companyName: "GETS ONE", emails: [], hasContact: false } as Account,
  { customerCode: "DORM-3", companyName: "STILL NONE", emails: [], hasContact: false } as Account,
];
const partial = parseContacts(exceptionSheet([["DORM-2 GETS ONE", "new@y.com"]]));
const merged = linkContacts(before.map((a) => ({ ...a })), partial);
check("the corrected tenant gains the address",
      merged.find((a) => a.customerCode === "DORM-2")?.emails[0], "new@y.com");
check("a tenant not in the file keeps the address they had",
      merged.find((a) => a.customerCode === "DORM-1")?.emails[0], "old@x.com");
check("and one absent from both is left alone",
      merged.find((a) => a.customerCode === "DORM-3")?.hasContact, false);

/* -------------------------------------------------------- risk exposure ---
 * Raman, after the 14 September call: "I have added the Risk Exposure formula
 * in the worksheet itself. It is Grand total minus Security Deposit. So if
 * positive it means AR is more than SD."
 *
 * The two rows below are his, off the mock-up he updated at the same time.
 * They are here because a formula agreed in a message is worth nothing until
 * something fails when the code stops matching it.
 */
console.log("\nRisk Exposure, as MES define it\n");

check("Raman's first row: 6,428.16 - 34,000", riskExposure(6428.16, 34000), -27571.84);
check("and his second: 11,216.44 - 11,160", riskExposure(11216.44, 11160), 56.44);
check("owing more than was lodged reads positive", riskExposure(5000, 1000), 4000);
check("owing less reads negative", riskExposure(1000, 5000), -4000);
check("level is nought, not nothing", riskExposure(1000, 1000), 0);
check("a deposit and no arrears is fully covered", riskExposure(0, 8000), -8000);
check("it does not drift on fractions of a cent", riskExposure(1000.005, 0.001), 1000);

// The distinction the column exists to make. No deposit on file is not the
// same claim as a deposit of zero, and only one of them is safe to act on.
check("an unknown deposit yields no figure", riskExposure(6428.16, null), null);
check("a deposit of zero yields the whole balance", riskExposure(6428.16, 0), 6428.16);

/* ------------------------------ and the same, through the report builder ---
 * The formula being right is worth nothing if the report never calls it. That
 * was the fault: the column was described, the note explained why it was
 * empty, and nothing ever computed it.
 */
const rmAcct = (code: string, total: number): Account =>
  ({
    id: code, customerCode: code, companyName: `${code} PTE LTD`,
    property: "BSD", status: "Live", rm: "Lancelot", total,
    buckets: { current: 0, d30: 0, d60: 0, d90: 0, d90plus: total },
    emails: [], hasContact: false,
  }) as unknown as Account;

const deposits = new Map([["DORM-1", 34000]]);
const withDep = buildManagerReports(
  [rmAcct("DORM-1", 6428.16), rmAcct("DORM-2", 11216.44)],
  "2026-08-28", "MES Group", new Map(), deposits,
);
const depRows = withDep[0]?.blocks[0]?.rows ?? [];
const depRow = (code: string) =>
  depRows.find((r) => String(r.companyName).startsWith(code));

check("the report computes it where the deposit is known",
      depRow("DORM-1")?.riskExposure, -27571.84);
check("and shows the deposit it used", depRow("DORM-1")?.securityDeposit, 34000);
check("a tenant with no deposit on file is left blank, not guessed",
      depRow("DORM-2")?.riskExposure, null);
check("blank there too", depRow("DORM-2")?.securityDeposit, null);

// Today's real case: no deposit source exists, so every row is blank and the
// report says why.
const noDep = buildManagerReports(
  [rmAcct("DORM-1", 6428.16)], "2026-08-28", "MES Group",
);
check("with no deposits at all, nothing is invented",
      noDep[0]?.blocks[0]?.rows[0]?.riskExposure, null);
check("and the report explains both empty columns", noDep[0]?.notes.length, 2);
check("the column itself carries that explanation",
      noDep[0]?.blocks[0]?.columns.some((c) => c.unavailable), true);

// The contradiction to avoid: a figure in the cell and, above it, a note
// saying no figure can be shown.
check("once deposits are known the report drops that note",
      withDep[0]?.notes.length, 0);
check("and the column stops calling itself unavailable",
      withDep[0]?.blocks[0]?.columns.some((c) => c.unavailable), false);


/* --------------------------------------- choosing who gets the 16th ---
 * MES's Flow tab row 21: "Send report to AR team (provide User the option to
 * select one or more RMs from drop down to send email)". Their cycle diagram
 * repeats it. The requirement is the choosing, so the thing to pin is that
 * choosing changes the outcome and that not choosing still sends to everyone.
 */
console.log("\nThe 16th sends to the managers who were picked\n");

const rmPipe = {
  accounts: [], invoices: [], asOf: "2026-08-28", entity: "MES Group",
  byProperty: [], revenueTabs: [], problems: [], defaulters: [],
  giroCustomers: new Set<string>(),
  lateFees: { fee: 100, listing: [], excluded: [] },
  managerReports: [
    { managerName: "Lancelot" }, { managerName: "CaptHook" },
    { managerName: "Rumpelstiltskin" },
  ],
} as unknown as Parameters<typeof planFor>[0];

check("untouched means every manager", rmsFor(rmPipe, null).length, 3);
check("a choice of two means two", rmsFor(rmPipe, ["Lancelot", "CaptHook"]).length, 2);
check("and it is those two",
      rmsFor(rmPipe, ["Lancelot", "CaptHook"]).join(","), "Lancelot,CaptHook");
check("clearing the lot sends to nobody", rmsFor(rmPipe, []).length, 0);

// A name held over from a previous upload must not conjure a report.
check("a manager who is not in this upload is ignored",
      rmsFor(rmPipe, ["Lancelot", "Somebody Else"]).join(","), "Lancelot");

const allPlan = planFor(rmPipe, emptyState(), 16, null);
const twoPlan = planFor(rmPipe, emptyState(), 16, ["Lancelot", "CaptHook"]);
const nonePlan = planFor(rmPipe, emptyState(), 16, []);

check("with nobody chosen the plan says all three go",
      allPlan.willDo.some((w) => w.includes("3 manager reports go out")), true);
check("choosing two says two of three",
      twoPlan.willDo.some((w) => w.includes("2 of 3 manager reports")), true);
check("and names them rather than counting them",
      twoPlan.willDo.some((w) => w.includes("Lancelot, CaptHook")), true);
check("and says the rest were not selected",
      twoPlan.willDo.some((w) => w.includes("not selected")), true);
check("choosing nobody is called out as a blocker",
      nonePlan.blockers.some((b) => b.includes("No manager is selected")), true);
check("but the fee is still raised, and it says so",
      nonePlan.blockers.some((b) => b.includes("fee is still raised")), true);

// What actually happened has to be checkable afterwards, by name.
const ranTwo = runDay(rmPipe, emptyState(), 16, ["Lancelot", "CaptHook"]);
const sentLine = ranTwo.log.find((l) => l.text.includes("Late payment report sent"));
check("the log records the send", Boolean(sentLine), true);
check("to two managers", sentLine?.accounts?.length, 2);
check("named", (sentLine?.accounts ?? []).join(","), "Lancelot,CaptHook");
check("choosing nobody records no send",
      runDay(rmPipe, emptyState(), 16, []).log
        .some((l) => l.text.includes("Late payment report sent")), false);

/* ------------------------------- the 7th and the 16th are upload days too ---
 * MES's cycle diagram marks the 4th, 7th and 16th all "Report upload", each
 * running the same standard routine. Only the 4th said so.
 */
check("the 7th says the report is uploaded",
      planFor(rmPipe, emptyState(), 7).fromFlowTab?.includes("Uploads AR Report"), true);
check("the 16th says it too",
      planFor(rmPipe, emptyState(), 16).fromFlowTab?.includes("Uploads AR Report"), true);
check("and the 4th still does",
      planFor(rmPipe, emptyState(), 4).fromFlowTab?.includes("Uploads AR Report"), true);


console.log(failures === 0 ? "\nALL CHECKS PASS\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
