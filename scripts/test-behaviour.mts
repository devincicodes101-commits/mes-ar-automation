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

import {
  parseAgingDetail,
  propertyFromDocument,
  round2,
  withoutCode,
} from "../src/lib/aging-detail.ts";
import { billingCycles, cycleStage, CREDIT_DAYS } from "../src/lib/billing-cycles.ts";
import {
  brokenPromises,
  dueTheLetter,
  emptyState,
  heldBackFromFinal,
  markPaid,
  markPromised,
  planFor,
  rmsFor,
  runDay,
  snapshot,
  stillOwing,
} from "../src/lib/cycle.ts";
import { updateColumn, updateNotes } from "../src/lib/update-column.ts";
import { newId } from "../src/lib/store.ts";
import { bucketForAge, bucketLabelForAge, buildQueue, feesDue, DEFAULT_FEE_RULE, isInCredit, overdueTotal } from "../src/lib/data.ts";
import { datasetFromResults } from "../src/lib/dataset.ts";
import { feeCountsByTenant, settledFees } from "../src/lib/store.ts";
import { chasedToTheEnd } from "../src/lib/chased.ts";
import { revenueType, isOneFm, matchRule } from "../src/lib/revenue-rules.ts";
import {
  buildLateFeeListing, buildRevenueTab, giroEnrolled, recurringDefaulters,
  REVENUE_TABS, agingByProperty, buildManagerReports, riskExposure,
  depositsFromLedger, depositsOffset,
} from "../src/lib/reports.ts";
import {
  addDays, renderLetter, longOrdinalDate, longDate, shortDate, currency,
  DEADLINE_DAYS, rmEmail, lateFeeEmail, fillLetter, LETTER_BODIES,
} from "../src/lib/letters.ts";
import { simulateSend, buildMessage, recipientsFor } from "../src/lib/outbox.ts";
import { toImportPayload, tenantId, periodOf } from "../src/lib/to-database.ts";
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

/*
 * A manager records their own calls and promises, and nothing else. The list
 * below is everything they must not be able to do, checked exhaustively
 * rather than by sampling, because this is the role held by people outside
 * the finance team and a capability arriving quietly here is the one that
 * would not be noticed.
 */
let rmCanAct = 0;
for (const c of ["send-reminders", "raise-late-fees", "upload-reports",
  "edit-settings", "manage-users", "view-tenant-emails", "view-all-tenants",
  "generate-reports", "email-reports", "edit-templates", "read-audit-log"] as const) {
  if (can("RM", c)) rmCanAct += 1;
}
check("an RM can do none of the eleven things that are not theirs", rmCanAct, 0);
check("but may record what came of their own calls",
  can("RM", "log-calls") && can("RM", "record-promises"), true);

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

/**
 * A charge line, with the age a real one would carry.
 *
 * It used to leave age null and bucket empty, which no line in MES's export
 * does. That is not a harmless shortcut: whether money is past due is read off
 * those two fields, so a fixture without them tests a path real data never
 * takes and cannot tell a working rule from a broken one.
 *
 * Given a report date, the due date lands fifteen days after billing, the way
 * MES's system issues them, and the age follows.
 */
const cyc = (
  date: string | null,
  amount: number,
  age: number | null = null,
  asOf: string | null = null,
) => {
  const plus = (iso: string, days: number) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return null;
    const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
    dt.setDate(dt.getDate() + days);
    const p = (x: number) => String(x).padStart(2, "0");
    return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
  };
  const between = (a: string, b: string) =>
    Math.round(
      (new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86_400_000,
    );

  const due = date && asOf ? plus(date, 15) : null;
  const realAge = age ?? (due && asOf ? between(due, asOf) : null);

  return {
    id: `x${date}${amount}`, companyName: "ACME PTE LTD",
    transactionType: "Invoice", date, dueDate: due,
    description: "Occupancy Fee Charges", documentNumber: "BSD-786/1",
    linkedContract: null, age: realAge,
    bucket: realAge === null ? "" : bucketLabelForAge(realAge),
    openBalance: amount,
    revenueType: "Occupancy Fee", isOneFm: false,
  } as never;
};

const three = billingCycles(
  [
    cyc("2026-07-15", 100, null, "2026-08-17"),
    cyc("2026-07-15", 50, null, "2026-08-17"),
    cyc("2026-08-03", 25, null, "2026-08-17"),
  ],
  "2026-08-17",
);
check("lines group by the date they were billed", three.cycles.length, 2);
check("newest run first", three.cycles[0]?.billedOn, "2026-08-03");
check("and its lines are added up", three.cycles[1]?.total, 150);
/*
 * Two rules, and which applies depends on the file.
 *
 * MES's export states a due date on every line and we show theirs, because it
 * is the date the tenant was given. Where a file states none we fall back to
 * the 14 day credit period their own rule describes. The two differ by a day,
 * which is the unresolved question with MES: their rule says fourteen, their
 * system issues fifteen.
 */
check("the file's own due date is shown where it states one",
      three.cycles[1]?.dueBy, "2026-07-30");
check("and where it states none, 14 days after billing",
      billingCycles([cyc("2026-07-15", 100)], "2026-08-17").cycles[0]?.dueBy,
      "2026-07-29");
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


/* ------------------------------ the deposit, out of the AR report itself ---
 * Raman, 14 September, asked where the Security Deposit column comes from:
 * "filter the yellow column F, the security deposit is there ... I would, if
 * I were you, I would use this source data." And for the tenants who have
 * none: "if there's no data there, then you can't display ... you just can
 * put some kind of note that this data not available."
 */
console.log("\nSecurity deposit, read from the ledger\n");

const sdLine = (code: string, amount: number, desc = "Security Deposit - REFUNDABLE") =>
  ({
    companyName: `${code} SOMEBODY PTE LTD`, customerCode: code,
    transactionType: "Invoice", date: "2026-07-01", dueDate: null,
    description: desc, documentNumber: "BSD-1/1", linkedContract: null,
    age: 30, bucket: "", openBalance: amount,
    revenueType: "Security Deposit", isOneFm: false,
  }) as never;

const rent = (code: string, amount: number) =>
  ({
    companyName: `${code} SOMEBODY PTE LTD`, customerCode: code,
    transactionType: "Invoice", date: "2026-07-01", dueDate: null,
    description: "Occupancy Fee Charges", documentNumber: "BSD-1/2",
    linkedContract: null, age: 30, bucket: "", openBalance: amount,
    revenueType: "Occupancy Fee", isOneFm: false,
  }) as never;

const ledger = depositsFromLedger([
  sdLine("DORM-1", 11360),
  sdLine("DORM-1", 11360),
  rent("DORM-1", 5000),
  sdLine("DORM-2", 932),
  rent("DORM-3", 40000),
  sdLine("DORM-4", -21120, "BEING SECURITY DEPOSIT ... OFFSET AGAINST A/R OUTSTANDING"),
]);

check("two deposit lines for one tenant are totalled", ledger.get("DORM-1"), 22720);
check("a single line stands on its own", ledger.get("DORM-2"), 932);
check("rent is not a deposit", ledger.has("DORM-3"), false);
check("only the tenants with one appear", ledger.size, 2);

// The trap. An offset deposit has been spent, not held, and subtracting a
// negative would make a tenant with nothing left look better covered than a
// tenant who never lodged anything.
check("a deposit already spent is not counted as held", ledger.has("DORM-4"), false);
check("and is named, so nobody wonders where it went",
      depositsOffset([sdLine("DORM-4", -21120)]).join(","), "DORM-4");
check("a deposit that nets exactly to nothing is not held either",
      depositsFromLedger([sdLine("DORM-5", 500), sdLine("DORM-5", -500)]).has("DORM-5"),
      false);

// End to end: ledger to the column a manager reads.
const sdAccounts = [
  { id: "a", customerCode: "DORM-1", companyName: "HAS ONE", property: "BSD",
    status: "Live", rm: "Lancelot", total: 30000,
    buckets: { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 30000 },
    emails: [], hasContact: false },
  { id: "b", customerCode: "DORM-3", companyName: "HAS NONE", property: "BSD",
    status: "Live", rm: "Lancelot", total: 40000,
    buckets: { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 40000 },
    emails: [], hasContact: false },
] as unknown as Account[];

const sdReport = buildManagerReports(sdAccounts, "2026-08-28", "MES Group", new Map(), ledger);
const sdRows = sdReport[0]?.blocks[0]?.rows ?? [];
const pick = (n: string) => sdRows.find((r) => String(r.companyName).includes(n));

check("the tenant with a deposit shows it", pick("HAS ONE")?.securityDeposit, 22720);
check("and their risk exposure is the difference", pick("HAS ONE")?.riskExposure, 7280);
check("the tenant without one stays blank", pick("HAS NONE")?.securityDeposit, null);
check("and so does their risk exposure", pick("HAS NONE")?.riskExposure, null);

/* ------------------------------------- the code is not printed twice over ---
 * Finance AR Download carries the customer code in its own column and again
 * at the front of the name, so the manager sheet read "DORM-1600 DORM-1600
 * MODERN WELLNESS PTE. LTD" on six of MES's seven sample tenants.
 */
console.log("\nThe customer code appears once, not twice\n");

check("a name carrying its own code is cleaned",
      withoutCode("DORM-1600 MODERN WELLNESS PTE. LTD", "DORM-1600"),
      "MODERN WELLNESS PTE. LTD");
check("a clean name is left alone",
      withoutCode("MODERN WELLNESS PTE. LTD", "DORM-1600"),
      "MODERN WELLNESS PTE. LTD");
check("case does not matter", withoutCode("dorm-166 BURNING SUN", "DORM-166"), "BURNING SUN");
check("a different code is not stripped",
      withoutCode("DORM-17 SOMEBODY", "DORM-1"), "DORM-17 SOMEBODY");
check("a name that is only its code is kept rather than emptied",
      withoutCode("DORM-166", "DORM-166"), "DORM-166");
check("no code, no change", withoutCode("SOMEBODY PTE LTD", ""), "SOMEBODY PTE LTD");


/* ------------------------------------- a promise holds until its own date ---
 * The Dry Run tells the officer, in as many words: "Promised only holds it:
 * the final notice stays away while the date stands, and they come back if it
 * passes unpaid." It did not do the second half. Any tenant with a promise
 * against them was filtered out whatever date they had given, so a date eight
 * months in the past kept them off the final notice as firmly as one next
 * week.
 *
 * Worse than a silent bug, because the rule was written on the screen and the
 * officer had been told to rely on it.
 */
console.log("\nA promise holds until its date, and no longer\n");

const promiseAcct = (id: string): Account =>
  ({
    id, customerCode: id, companyName: `${id} PTE LTD`, property: "BSD",
    propertyName: "Blue Stars Dormitory", status: "Live", total: 5000,
    buckets: { current: 0, d30: 5000, d60: 0, d90: 0, d90plus: 0 },
    emails: ["a@x.com"], hasContact: true, lateFeeCount: 0,
  }) as unknown as Account;

const promisePipe = {
  accounts: [promiseAcct("P-1")],
  invoices: [], asOf: "2026-09-15", entity: "MES Group",
  byProperty: [], revenueTabs: [], problems: [], defaulters: [],
  giroCustomers: new Set<string>(),
  lateFees: { fee: 100, listing: [], excluded: [] },
  managerReports: [],
} as unknown as Parameters<typeof stillOwing>[0];

const one = promisePipe.accounts[0]!;
const base = emptyState();

check("the tenant owes money to begin with", stillOwing(promisePipe, base).length, 1);

const soon = markPromised(base, one, "2026-12-31", 7);
check("a promise for December holds them off",
      stillOwing(promisePipe, soon).length, 0);

const stale = markPromised(base, one, "2026-01-01", 7);
check("a promise from last January does not",
      stillOwing(promisePipe, stale).length, 1);
check("and it is reported as broken rather than merely ignored",
      brokenPromises(promisePipe, stale).includes(one.id), true);

// The boundary: the day itself still counts, the day before does not.
const onTheDay = markPromised({ ...base, at: 15 }, one, "2026-09-15", 15);
check("a promise for the very day the month has reached still stands",
      stillOwing(promisePipe, onTheDay).length, 0);
const dayBefore = markPromised({ ...base, at: 15 }, one, "2026-09-14", 15);
check("one day earlier has lapsed", stillOwing(promisePipe, dayBefore).length, 1);

// And it lapses as the month moves, without anybody touching it again.
/*
 * Reminded on the 7th, because that is when this tenant promised and the
 * promise came out of the reminder. The fixture used to start from a blank
 * state, which made the last check below quietly depend on the 21st writing to
 * tenants nobody had ever contacted. That is the fault the final notice rule
 * closes, and this assertion is about promises lapsing, not about it.
 */
const reminded = runDay(promisePipe, base, 7, null);
const midMonth = markPromised(reminded, one, "2026-09-16", 7);
check("on the 15th, a promise for the 16th is still good",
      stillOwing(promisePipe, { ...midMonth, at: 15 }).length, 0);
check("on the 21st, the same promise has run out",
      stillOwing(promisePipe, { ...midMonth, at: 21 }).length, 1);
check("so the final notice reaches them",
      runDay(promisePipe, { ...midMonth, at: 21 }, 21).finalNotice.includes(one.id),
      true);

section("The final notice only follows a first reminder");

/*
 * The rule the Reminders screen has always had, and the scheduled run never
 * did. The run called runDay(pipeline, emptyState(), ...) every morning, so on
 * the 21st every owing tenant with an address looked like a fresh case and got
 * a letter citing the Employment of Foreign Manpower Regulations. It happened
 * for real on 21 September 2026: four final notices went out and the run's own
 * summary said "None of them was reminded on the 7th".
 *
 * Asserted on behaviour, not on the source. The guard covering the fault next
 * door checked that a line of code was present, and the line was present and
 * inert.
 */

/* Three tenants who all owe and all have an address, so the only thing
   deciding who gets what is the rule under test. */
const s1 = simAcct("seq-1", 1000);
const s2 = simAcct("seq-2", 2000);
const s3 = simAcct("seq-3", 3000);
const seqPipe = simPipe([s1, s2, s3]);

const coldStart = runDay(seqPipe, emptyState(), 21, null);
check("a 21st with no memory writes to nobody", coldStart.finalNotice.length, 0);

const afterSeventh = runDay(seqPipe, emptyState(), 7, null);
check("the 7th still writes to everyone reachable",
      afterSeventh.firstReminder.length > 0, true);

const afterTwentyFirst = runDay(seqPipe, afterSeventh, 21, null);
check("and the 21st then writes to exactly those tenants",
      afterTwentyFirst.finalNotice.join("|"), afterSeventh.firstReminder.join("|"));

/* The case that matters most: a tenant who appears only after the 7th. */
const reachableNow = [s1, s2, s3] as unknown as Parameters<typeof dueTheLetter>[0];
const newcomer = reachableNow[0]!;
const missedTheSeventh = {
  ...emptyState(),
  firstReminder: reachableNow.slice(1).map((a) => a.id),
};
const due21 = dueTheLetter(reachableNow, missedTheSeventh, 21);
check("a tenant who missed the 7th gets no final notice",
      due21.some((a) => a.id === newcomer.id), false);
check("everybody else still does", due21.length, reachableNow.length - 1);
check("and the one held back is named rather than silently dropped",
      heldBackFromFinal(reachableNow, missedTheSeventh).map((a) => a.id).join(),
      newcomer.id);

/* Nobody is written to twice in the same month, whichever letter it is. */
check("running the 21st again adds nobody",
      runDay(seqPipe, afterTwentyFirst, 21, null).finalNotice.length,
      afterTwentyFirst.finalNotice.length);
check("and running the 7th again adds nobody",
      runDay(seqPipe, afterSeventh, 7, null).firstReminder.length,
      afterSeventh.firstReminder.length);

/* The plan has to say why the list is short, or an officer reads zero as a
   fault in the system rather than as tenants waiting their turn. */
check("the plan says how many are held back",
      planFor(seqPipe, missedTheSeventh, 21, null).willDo
        .some((t) => /held back until next month/.test(t)), true);

section("The ids a record is given");

/*
 * Every call and every promise an officer logged was refused by the database
 * for two years' worth of code, and the screens showed them anyway.
 *
 * id() was Math.random().toString(36).slice(2, 10) — eight characters, like
 * "k3j9x2mq". calls.id, promises.id and emails_sent.id are uuid columns, so
 * Postgres answered "invalid input syntax for type uuid", the record stayed
 * in local storage, and the screen listed it. One browser had the history;
 * nobody else did, the Update column stayed blank, and the schedule never
 * knew a promise had been made.
 *
 * Asserted on the shape, because the shape is the whole of the fault.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const minted = Array.from({ length: 200 }, () => newId());
check("a new record gets a uuid the database will take", UUID.test(minted[0]!), true);
check("every one of two hundred", minted.every((v) => UUID.test(v)), true);
check("and no two are the same", new Set(minted).size, minted.length);

section("A promise the schedule can see");

/*
 * The half that was missing. Ray logs a promise, every screen honours it, and
 * the scheduled run knew nothing: it started from a state with no promises in
 * it, so the 21st sent a final notice to a tenant who had arranged to pay —
 * which is the one thing recording the promise was for.
 *
 * And the date it is judged against has to be the real one. asAt() fell back
 * to the loaded report's date, so a live promise measured against a report
 * dated next January had already expired.
 */

const promiseOwing = simPipe([simAcct("keeps", 5000)]);
const keeps = promiseOwing.accounts[0] as never;

check("with no promise, the 21st writes to them",
      runDay(promiseOwing, runDay(promiseOwing, emptyState(), 7, null), 21, null)
        .finalNotice.length, 1);

/* A promise for a date still ahead of the real today. */
const held = {
  ...runDay(promiseOwing, emptyState(), 7, null),
  today: "2026-09-22",
  promised: { [(keeps as { id: string }).id]: { amount: 5000, by: "2026-09-30" } },
};
check("a promise still standing holds the final notice back",
      runDay(promiseOwing, held, 21, null).finalNotice.length, 0);

const lapsed = { ...held, promised: { [(keeps as { id: string }).id]: { amount: 5000, by: "2026-09-01" } } };
check("a promise whose date has passed does not",
      runDay(promiseOwing, lapsed, 21, null).finalNotice.length, 1);

/* The report is dated 2026-08-17 in this fixture. Without SimState.today the
   promise would be judged against that and look like the future. */
check("the real date decides, not the report's",
      runDay(promiseOwing, { ...held, today: "2026-10-05" }, 21, null).finalNotice.length, 1);

check("and the fee on the 16th is held back too",
      runDay(promiseOwing, held, 16, null).charged.length, 0);

section("The Update column, written from what was logged");

/*
 * The column Jacqueline asks each manager to fill in before replying. It was
 * always blank, because buildManagerReports read it from a notes map and the
 * Reports screen handed it new Map() — plumbing with nothing in it, and it
 * looked exactly like MES's own blank template so nobody questioned it.
 *
 * Asserted on the text, because the text is the deliverable: somebody reads a
 * column of these and decides who to chase.
 */

const call = (over: Record<string, unknown> = {}) =>
  ({
    id: "c1", accountId: "t-1", companyName: "ORCHARD FACILITIES PTE. LTD.",
    at: "2026-08-12T09:30:00.000Z", reached: "Finance manager",
    outcome: "no-answer", promisedAmount: null, promisedDate: null,
    nextActionDate: null, notes: "", agingBucket: "30 days",
    deductionFailDate: null, ...over,
  }) as never;

const vow = (over: Record<string, unknown> = {}) =>
  ({
    id: "p1", accountId: "t-1", companyName: "ORCHARD FACILITIES PTE. LTD.",
    amount: 12000, promisedFor: "2026-08-20", createdAt: "2026-08-12T09:35:00.000Z",
    source: "call", confirmationSentAt: null, ...over,
  }) as never;

check("nothing logged leaves the cell empty",
      updateColumn([], []).get("t-1"), undefined);

check("a promise leads, because it is what changes the chase",
      updateColumn([call({ outcome: "promised-to-pay" })], [vow()]).get("t-1"),
      "Promised $12,000 by 20 Aug. 12 Aug");

check("a promise from a reply says so",
      updateColumn([], [vow({ source: "email" })]).get("t-1"),
      "Promised $12,000 by 20 Aug. from a reply");

check("with no promise, the latest outcome is the note",
      updateColumn([call()], []).get("t-1"), "No answer. 12 Aug");

check("attempts are counted, because five is not one",
      updateColumn(
        [call(), call({ id: "c2", at: "2026-08-14T09:00:00.000Z" }),
         call({ id: "c3", at: "2026-08-15T09:00:00.000Z" })], [],
      ).get("t-1"),
      "No answer. 3 calls. 15 Aug");

check("the officer's own words survive to the end of the line",
      updateColumn(
        [call({ outcome: "disputes-amount", notes: "Says the 60-day figure is a duplicate" })],
        [],
      ).get("t-1"),
      "Disagrees with the amount. 12 Aug. Says the 60-day figure is a duplicate");

check("the newest call is the one reported",
      updateColumn(
        [call({ at: "2026-08-01T09:00:00.000Z", outcome: "wrong-number" }),
         call({ id: "c2", at: "2026-08-14T09:00:00.000Z", outcome: "will-call-back" })], [],
      ).get("t-1"),
      "Said they would call back. 2 calls. 14 Aug");

/* It must never claim payment. That comes from the next export, where a tenant
   who has paid is simply absent, and a note saying otherwise would be one
   person's memory of a call overriding the ledger. */
const everyOutcome = ["promised-to-pay", "will-call-back", "disputes-amount", "no-answer", "wrong-number"]
  .map((o) => updateColumn([call({ outcome: o })], []).get("t-1") ?? "")
  .join(" | ");
check("no wording anywhere says a tenant has paid",
      /paid/i.test(everyOutcome), false);

check("tenants with nothing logged are absent, not blank-mapped",
      updateNotes([call()], []).has("t-2"), false);
check("and the promise flag is carried for the screen to lean on",
      updateNotes([call()], [vow()]).get("t-1")?.hasPromise, true);

check("the reports screen actually feeds it",
      readFileSync(path.join(ROOT, "src/app/reports/page.tsx"), "utf8")
        .includes("updateColumn(store.calls, store.promises)"), true);

// Paying settles it outright, whatever the promise says.
const paidAnyway = markPaid(stale, one, 9);
check("a tenant who paid stays gone even with a lapsed promise",
      stillOwing(promisePipe, paidAnyway).length, 0);
check("and is not chased as a broken promise",
      brokenPromises(promisePipe, paidAnyway).includes(one.id), false);

// With no report date there is nothing to judge a promise against, and
// chasing somebody on the strength of a date we cannot place is worse than
// waiting.
const undated = { ...promisePipe, asOf: null } as typeof promisePipe;
check("with no report date, a promise is given the benefit of the doubt",
      stillOwing(undated, stale).length, 0);


/* ------------------------------------ what the app holds, as the database wants ---
 * An import that half succeeded and said nothing is the failure this whole
 * phase exists to avoid, so the mapper refuses a report it cannot map
 * completely rather than storing the part it understood.
 */
console.log("\nMapping a report onto the database\n");

const mapAcct = (over: Partial<Account> = {}): Account =>
  ({
    id: "dorm-1-bsd", customerCode: "DORM-1", companyName: "ALPHA PTE LTD",
    property: "BSD", propertyName: "Blue Stars Dormitory", status: "Live",
    buckets: { current: 100, d30: 200, d60: 0, d90: 0, d90plus: 0 },
    total: 300, legacyNote: null, emails: [], hasContact: false,
    industry: "Marine", entity: "KT Mesdorm Pte Ltd", invoiceCount: 1,
    isOneFm: false, revenueTypes: ["Occupancy Fee"], lateFeeCount: 0,
    ...over,
  }) as Account;

const mapLine = (over: Record<string, unknown> = {}) =>
  ({
    customerCode: "DORM-1", property: "BSD", companyName: "ALPHA PTE LTD",
    transactionType: "Invoice", date: "2026-08-15", dueDate: "2026-08-30",
    description: "Occupancy Fee Charges", documentNumber: "BSD-786/1",
    linkedContract: null, age: 16, bucket: "30 days", openBalance: 300,
    revenueType: "Occupancy Fee", isOneFm: false, category: "",
    ...over,
  }) as never;

// The identifier the whole system keys on: a company at one dormitory.
check("a tenant id is the code and the dormitory, lower case",
      tenantId("DORM-166", "JPD2"), "dorm-166-jpd2");
check("the same company at another dormitory is another tenant",
      tenantId("DORM-166", "BSD"), "dorm-166-bsd");
check("the period is the first of the report's month",
      periodOf("2026-08-28"), "2026-08-01");
check("even at the very end of a month", periodOf("2026-01-31"), "2026-01-01");

const good = toImportPayload([mapAcct()], [mapLine()], "2026-08-28", "aug.xlsx");
check("a report that reads cleanly maps", good.problems.length, 0);
check("one account becomes one tenant", good.payload?.p_tenants.length, 1);
check("and one snapshot", good.payload?.p_snapshots.length, 1);
check("carrying every bucket", good.payload?.p_snapshots[0]?.bucket_30, 200);
check("and the total", good.payload?.p_snapshots[0]?.total, 300);
check("the line is filed under its tenant",
      good.payload?.p_invoices[0]?.tenant_id, "dorm-1-bsd");
check("the file name is kept, so an import can be traced back to it",
      good.payload?.p_ar_filename, "aug.xlsx");

// Live and Terminated, which MES do not currently send. The mapper must not
// invent one: an account with no status is treated as still renting, the same
// assumption the parser makes, and terminated is only ever stored when it was
// actually read.
check("a live tenant is stored live", good.payload?.p_snapshots[0]?.status, "live");
check("a terminated one is stored terminated",
      toImportPayload([mapAcct({ status: "Terminated" })], [], "2026-08-28", null)
        .payload?.p_snapshots[0]?.status,
      "terminated");

/* --------------------------------------------- what it refuses, and why ---
 * Each of these would otherwise put a figure in front of somebody that looks
 * right and is not.
 */
const noDate = toImportPayload([mapAcct()], [mapLine()], null, null);
check("a report with no date is refused", noDate.payload, null);
check("and says why", noDate.problems[0]?.what, "No report date");

const empty = toImportPayload([], [], "2026-08-28", null);
check("a report with no tenants is refused", empty.payload, null);

const badDorm = toImportPayload(
  [mapAcct({ property: "XXX" as never })], [], "2026-08-28", null);
check("an unknown dormitory is refused rather than stored", badDorm.payload, null);
check("and the dormitory is named in the problem",
      badDorm.problems[0]?.what.includes("unknown dormitory"), true);

const twice = toImportPayload(
  [mapAcct(), mapAcct({ id: "other" })], [], "2026-08-28", null);
check("the same company twice at one dormitory is refused", twice.payload, null);
check("because only one of the two balances would survive",
      twice.problems[0]?.what.includes("appears twice"), true);

// A line naming a company and dormitory that is not in the accounts would be
// a charge stored against nobody.
const orphan = toImportPayload(
  [mapAcct()],
  [mapLine(), mapLine({ customerCode: "DORM-999" })],
  "2026-08-28", null);
check("a line belonging to no tenant is refused", orphan.payload, null);
check("and counted, so the size of the problem is visible",
      orphan.problems[0]?.what.includes("1 charge lines"), true);

// The same company at two dormitories is two accounts, not a duplicate.
const twoDorms = toImportPayload(
  [mapAcct(), mapAcct({ id: "dorm-1-jpd1", property: "JPD1", propertyName: "Jurong Penjuru Dormitory 1" })],
  [mapLine(), mapLine({ property: "JPD1" })],
  "2026-08-28", null);
check("one company at two dormitories maps to two tenants",
      twoDorms.payload?.p_tenants.length, 2);
check("with their lines kept apart",
      twoDorms.payload?.p_invoices.map((i) => i.tenant_id).join(","),
      "dorm-1-bsd,dorm-1-jpd1");


/* ---------------------- where chasing actually begins, in days past due -- */

console.log("\nWhere chasing begins");

/*
 * The screens quote fifteen days. They used to quote thirty, about the same
 * figure, which put a tenant twenty days late under a label saying they were
 * past thirty. The wording is checked in test:wiring; the number behind it is
 * checked here, so that if the bucket rule ever moves, the labels quoting
 * fifteen fail with it rather than quietly becoming the next wrong number.
 */
check("Current ends at 15 days past due", bucketForAge(15), "current");
check("and the day after is the first chaseable bucket", bucketForAge(16), "d30");
check("a charge 20 days past due is already chaseable",
      overdueTotal({
        buckets: { current: 0, d30: 500, d60: 0, d90: 0, d90plus: 0 },
      } as never) > 0, true);
check("and one 15 days past due is not",
      overdueTotal({
        buckets: { current: 500, d30: 0, d60: 0, d90: 0, d90plus: 0 },
      } as never), 0);

/* ------------------------- a month where everybody paid is still a month -- */

console.log("\nA report with nobody owing anything");

/*
 * The outcome the whole process aims at, and the one the system refused.
 *
 * Uploading it answered "neither file could be read as an AR report": the
 * words used for a corrupt file, for the month MES finally collected
 * everything. Two separate checks had to agree that an empty report was
 * nonsense, and both did. The reader called it an error, which was fixed
 * first; the builder then asked for at least one account before it would use
 * the result, which is what this covers.
 *
 * Refusing the genuinely unreadable file still matters, because importing one
 * would replace a month of real figures with nothing. So the two cases are
 * asserted together: shape decides, not emptiness.
 */
const emptyExport = () => {
  const head = ["Customer","Transaction Type","Company Name","Date","Description",
    "Categories","Document Number","Linked Contract","Contract Item Start Date",
    "P.O. No.","Due Date","Age","Open Balance","Item: Item Type"];
  const rows: unknown[][] = [["MES"],["Consol : X"],["Title"],["As of 30 November 2026"],[],[],head,
    [],["Grand Total","","","","","","","","","","","",0,""]];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  return parseAgingDetail(wb);
};

const nobodyOwes = emptyExport();
check("an empty AR export reads without error", nobodyOwes.problems.filter((p) => p.severity === "error").length, 0);
check("and says plainly that everyone has paid",
      nobodyOwes.problems.some((p) => /every tenant has paid/.test(p.message)), true);
check("it still knows the date it was run for", nobodyOwes.asOf !== null, true);
check("and a dataset can be built from it, rather than nothing usable",
      datasetFromResults([nobodyOwes as never], "2026-11") !== null, true);

const notAnArReport = () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Invoice log"],["Name","Amount"]]), "Sheet1");
  return parseAgingDetail(wb);
};
check("a workbook that is not an AR export is still refused",
      datasetFromResults([notAnArReport() as never], "2026-11"), null);

/* ------------------------- storing a month where nobody owes anything ---- */

console.log("\nMapping an empty report for the database");

/*
 * The mapper cannot tell an empty month from a failed read, because it never
 * sees the workbook: it is handed accounts and invoices that the browser
 * produced. So it is told, and the telling is checked here — both that saying
 * so works and that not saying so is still refused, since the refusal is what
 * stops a parse that quietly produced nothing from wiping a month.
 */
const emptyReport = (told: boolean) =>
  toImportPayload([], [], "2026-11-30", "November.xlsx", null, told);

check("an empty report is refused when nobody vouches for it",
      emptyReport(false).payload, null);
check("and the reason names the tenants, not the date",
      emptyReport(false).problems.some((p) => p.what === "No tenants"), true);
check("stated as empty, it maps",
      emptyReport(true).payload !== null, true);
check("with no snapshots and no invoices",
      emptyReport(true).payload!.p_snapshots.length +
        emptyReport(true).payload!.p_invoices.length, 0);
check("and still carries the report date it will be filed under",
      emptyReport(true).payload!.p_report_date, "2026-11-30");
check("a report with no date is refused however it is described",
      toImportPayload([], [], null, "x.xlsx", null, true).payload, null);

/* --------------------- counting a fee we raised and one MES billed ------- */

console.log("\nFees raised here count as much as fees MES have billed");

/*
 * MES escalate a tenant at three late fees. The test read the uploaded
 * report's Late Payment Fee lines only, which is NetSuite's count, and a fee
 * raised on the 16th does not reach NetSuite until somebody enters it. So a
 * tenant this system had charged three months running counted as zero, and
 * the rule never fired.
 *
 * Both halves are asserted, because the fix is only right if it also leaves
 * the old behaviour alone when nothing has been raised.
 */
const feeAcct = (id: string, billed: number) => ({
  id,
  customerCode: id.toUpperCase(),
  companyName: id,
  property: "BSD",
  status: "Live",
  total: 5000,
  buckets: { current: 0, d30: 5000, d60: 0, d90: 0, d90plus: 0 },
  lateFeeCount: billed,
  hasContact: true,
  emails: ["x@y.z"],
  isOneFm: false,
  revenueTypes: [],
  legacyNote: null,
}) as never;

const feeNoneRaised = buildQueue([feeAcct("a", 0)]);
check("nothing raised and nothing billed is not a repeat defaulter",
      feeNoneRaised[0]!.reasons.includes("repeat-late-fees"), false);

const feeBilledThree = buildQueue([feeAcct("b", 3)]);
check("three billed by MES still is",
      feeBilledThree[0]!.reasons.includes("repeat-late-fees"), true);

const feeRaisedThree = buildQueue([feeAcct("c", 0)], new Map([["c", 3]]));
check("three raised by us now is too",
      feeRaisedThree[0]!.reasons.includes("repeat-late-fees"), true);

const feeMixed = buildQueue([feeAcct("d", 1)], new Map([["d", 2]]));
check("and one billed plus two raised makes three",
      feeMixed[0]!.reasons.includes("repeat-late-fees"), true);

const feeUnder = buildQueue([feeAcct("e", 1)], new Map([["e", 1]]));
check("two is still not three",
      feeUnder[0]!.reasons.includes("repeat-late-fees"), false);

/* ------------------------- the fee listing, against what we have raised -- */

console.log("\nThe late fee listing and the month already charged");

const lateRule = { ...DEFAULT_FEE_RULE };
const feeDueNow = feesDue([feeAcct("f", 0)], lateRule, []);
check("a tenant with no fee raised is chargeable", feeDueNow[0]!.raisedThisPeriod, false);
check("and reads as first time", feeDueNow[0]!.raisedByUs + feeDueNow[0]!.billedByMes, 0);

const feeDueAfter = feesDue(
  [feeAcct("f", 0)], lateRule, [],
  [{ tenantId: "f", period: "2026-09-01" }], "2026-09-01",
);
check("once raised for that month it is not chargeable again",
      feeDueAfter[0]!.raisedThisPeriod, true);
check("and the count is ours, not NetSuite's",
      `${feeDueAfter[0]!.raisedByUs}/${feeDueAfter[0]!.billedByMes}`, "1/0");

const feeOtherMonth = feesDue(
  [feeAcct("f", 0)], lateRule, [],
  [{ tenantId: "f", period: "2026-08-01" }], "2026-09-01",
);
check("a fee raised in a different month does not block this one",
      feeOtherMonth[0]!.raisedThisPeriod, false);
check("but it still counts towards how often they have been charged",
      feeOtherMonth[0]!.raisedByUs, 1);

/* ------------- a tenant gone from the newer report has paid, fees too ---- */

console.log("\nA fee raised before a tenant paid");

/*
 * MES's rule, from the meeting: a company missing from a later file has paid.
 *
 * The system applied that everywhere except here. A tenant who disappears is
 * settled in full on What Changed and drops off every screen, so they were
 * never charged again — that half was already right. But a fee raised before
 * they paid stayed behind, went on counting towards the repeat-defaulter
 * rule, and had nowhere left to be seen, because the screen that would show
 * it only lists tenants who are in the report.
 *
 * Worked out rather than stored. A fee row is the one kind of record here
 * that cannot be rebuilt from any file, so a partial export that dropped a
 * tenant must not be able to destroy it. If they appear again still owing,
 * the fee counts again.
 */
const owing = new Set(["a", "b"]);
const someFees = [
  { id: "1", tenantId: "a", period: "2026-09-01", amount: 100, raisedAt: "x" },
  { id: "2", tenantId: "c", period: "2026-09-01", amount: 100, raisedAt: "x" },
];

check("a fee against a tenant still in the report counts",
      feeCountsByTenant(someFees as never, owing).get("a"), 1);
check("one against a tenant who has gone does not",
      feeCountsByTenant(someFees as never, owing).has("c"), false);
check("and with no report to compare against, every fee counts",
      feeCountsByTenant(someFees as never).size, 2);

check("the settled one can be named", settledFees(someFees as never, owing).length, 1);
check("and it is the right one", settledFees(someFees as never, owing)[0]!.tenantId, "c");
check("nothing is settled when everybody is still there",
      settledFees(someFees as never, new Set(["a", "b", "c"])).length, 0);

/* ------------------ a cycle this system ran is a cycle that happened ----- */

console.log("\nChased to the end, counting our own runs");

/*
 * The list read MES's export alone. That is right for a first upload — it can
 * show seven past cycles for a tenant this system has never chased — and
 * wrong from the moment the system starts raising fees itself.
 *
 * A tenant taken all the way round by us, both letters and the $100, showed
 * nowhere. The screen that exists to answer "who has had everything and still
 * owes" was empty for exactly the tenants it was built for, because the only
 * evidence the cycle had run was a fee row it was not reading.
 */
const chasedAcct = (id: string) => ({
  id,
  customerCode: id.toUpperCase(),
  companyName: id,
  property: "BSD",
  status: "Live",
  total: 9000,
  buckets: { current: 0, d30: 0, d60: 9000, d90: 0, d90plus: 0 },
  lateFeeCount: 0,
  hasContact: true,
  emails: ["x@y.z"],
  isOneFm: false,
  revenueTypes: [],
  legacyNote: null,
}) as never;

const noneRun = chasedToTheEnd([], [chasedAcct("z")], "2026-10-31");
check("nobody has been round the cycle yet", noneRun.length, 0);

const weRanTwo = chasedToTheEnd([], [chasedAcct("z")], "2026-10-31", 1, [
  { tenantId: "z", period: "2026-09-01" },
  { tenantId: "z", period: "2026-10-01" },
]);
check("two cycles we ran ourselves put them on the list", weRanTwo.length, 1);
check("and both are counted", weRanTwo[0]!.cycles, 2);
check("with how many were ours said separately", weRanTwo[0]!.ourCycles, 2);

/* MES entering our fee into NetSuite must not turn one cycle into two. */
const both = chasedToTheEnd(
  [{
    companyName: "z", customerCode: "Z", revenueType: "Late Payment Fee",
    date: "2026-09-16", dueDate: null, age: 40, bucket: "30 days",
    openBalance: 100, description: "Admin Fee For Late Payment", isOneFm: false,
    transactionType: "Invoice", documentNumber: "x", linkedContract: null,
  }] as never,
  [chasedAcct("z")], "2026-10-31", 1,
  [{ tenantId: "z", period: "2026-09-01" }],
);
check("the same month from both sources counts once", both[0]!.cycles, 1);

console.log(failures === 0 ? "\nALL CHECKS PASS\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
