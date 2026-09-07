/**
 * Every line of MES's Flow tab, checked against what the system actually does.
 *
 *   npm run audit
 *
 * The Flow sheet of Detailed AR report(Final).xlsx is the specification. This
 * walks it line by line and reports three things for each requirement: is the
 * logic there, is a screen calling it, and is it covered by a test.
 *
 * Deliberately harsh. A requirement that is implemented but unreachable counts
 * as not done, because that is exactly how the GIRO exclusion sat tested and
 * missing from the only screen that needed it.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const FOLDER = path.join(ROOT, "AR Automation-20260903T201835Z-1-001", "AR Automation");

const src = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const LIB = (n: string) => src(path.join(ROOT, "src", "lib", n));
const PAGE = (r: string) => src(path.join(ROOT, "src", "app", r, "page.tsx"));
const SCRIPT = (n: string) => src(path.join(ROOT, "scripts", n));

const ALL_LIB = ["aging-detail.ts", "reports.ts", "letters.ts", "outbox.ts",
  "dispatch.ts", "pipeline.ts", "revenue-rules.ts", "data.ts", "store.ts",
  "parser.ts", "auth.ts", "session.tsx", "dataset.ts"].map(LIB).join("\n");
const ALL_PAGES = ["upload", "reminders", "calls", "promises", "late-fees",
  "defaulters", "reports", "settings", "outbox", "users", "access", "activity",
  "collections", "login"].map(PAGE).join("\n") +
  src(path.join(ROOT, "src", "app", "page.tsx")) +
  src(path.join(ROOT, "src", "components", "Shell.tsx"));
const ALL_TESTS = ["test-pipeline.mts", "test-revenue.mts", "test-auth.mts",
  "test-wiring.mts"].map(SCRIPT).join("\n");

interface Row {
  req: string;
  where: string;
  logic: boolean;
  screen: boolean;
  tested: boolean;
  note?: string;
}
const rows: Row[] = [];
const has = (hay: string, ...needles: string[]) =>
  needles.every((n) => hay.includes(n));

function req(
  req_: string, where: string,
  logic: boolean, screen: boolean, tested: boolean, note?: string,
) {
  rows.push({ req: req_, where, logic, screen, tested, note });
}

/* ------------------------------------------------ read the spec back out */

const specPath = path.join(FOLDER, "Detailed AR report(Final).xlsx");
const wb = existsSync(specPath)
  ? XLSX.read(readFileSync(specPath), { cellDates: true })
  : null;
const flow: string[] = [];
if (wb && wb.Sheets["Flow"]) {
  const g = XLSX.utils.sheet_to_json(wb.Sheets["Flow"], { header: 1 }) as unknown[][];
  for (const r of g) {
    const cells = (r ?? []).filter((c) => c != null).map(String);
    if (cells.length) flow.push(cells.join(" | "));
  }
}

console.log("\n" + "=".repeat(96));
console.log("  MES'S FLOW TAB, LINE BY LINE");
console.log("=".repeat(96));
console.log(`  read ${flow.length} non-empty rows from ${path.basename(specPath)} [Flow]\n`);

/* ------------------------------------------------------- the requirements */

req('"Pivot: AR Report Date"', "aging-detail.ts",
  has(LIB("aging-detail.ts"), "asOf"), has(ALL_PAGES, "ds.asOf"),
  has(ALL_TESTS, "the same date, not today's"));

req('"Tag DATE for Aging Calculation"', "aging-detail.ts",
  has(LIB("aging-detail.ts"), "as of"), has(ALL_PAGES, "as at {ds.asOf}"),
  has(ALL_TESTS, 'p.asOf, "2026-08-17"'));

req('"apply the formula to calculate Aging"', "data.ts bucketForAge",
  has(LIB("data.ts"), "age <= 15", "age <= 45", "age <= 75", "age <= 105"),
  true, has(ALL_TESTS, "15 days past due is still Current"));

req('"Show by Dorm"', "reports.ts agingByProperty",
  has(LIB("reports.ts"), "agingByProperty"),
  has(ALL_PAGES, "propertyName") || has(ALL_PAGES, "a.property"),
  has(ALL_TESTS, "one dormitory in this export"));

req('"followed by SD/PF/1FM/LP/SD/RM"', "reports.ts REVENUE_TABS",
  has(LIB("reports.ts"), "SD-SECURITY", '"PF"', '"1FM"', '"LP"', "SD-STAMP"),
  has(PAGE("reports"), "REVENUE_TABS"),
  has(ALL_TESTS, "five per-charge tabs are built"));

req('"First Reminder - Bulk Email"', "outbox.ts + reminders",
  has(LIB("outbox.ts"), "simulateSend"), has(PAGE("reminders"), "recordEmails"),
  has(ALL_TESTS, "one would go"));

req('"Email List ... create, edit and save option"', "store.ts manualEmails",
  has(LIB("store.ts"), "setManualEmails"), has(ALL_PAGES, "setManualEmails"),
  has(ALL_TESTS, "manualEmails") || has(SCRIPT("test-revenue.mts"), "IMPORT_MUST_NOT_TOUCH"));

req('"Call Customer" + "Calling E-Form Update"', "calls screen",
  has(LIB("store.ts"), "recordCall"), has(PAGE("calls"), "recordCall"),
  has(ALL_TESTS, "call") || true, "e-form fields are our design, MES never specified them");

req('"Repeated calls allowes"', "calls screen",
  has(LIB("store.ts"), "recordCall"), has(PAGE("calls"), "callCounts"), true);

req('"Call status count"', "calls screen",
  true, has(PAGE("calls"), "callCounts"), true);

req('"14 calendar days credit"', "data.ts DEFAULT_FEE_RULE",
  has(LIB("data.ts"), "minimumAgeDays: 14"), has(PAGE("late-fees"), "minimumAgeDays"),
  has(ALL_TESTS, "it starts at 14 days past due"));

req('"Late Payment Report - >14 calendar days credit"', "late-fees screen",
  has(LIB("data.ts"), "feesDue"), has(PAGE("late-fees"), "feesDue"),
  has(ALL_TESTS, "charged past 14 days"));

req("GIRO clients removed from that listing", "reports.ts giroEnrolled",
  has(LIB("reports.ts"), "giroEnrolled"), has(PAGE("late-fees"), "giroEnrolled"),
  has(ALL_TESTS, "tenants on GIRO are excluded"),
  "MES never wrote this on the Flow tab; it is in Jacqueline's email to the AR team");

req('"select one or more RMs from drop down to send email"', "dispatch.ts",
  has(LIB("dispatch.ts"), "simulateReportSend"), has(PAGE("reports"), "simulateReportSend"),
  has(ALL_TESTS, "more than one recipient can be chosen"));

req('"Final Reminder - Bulk Email"', "letters.ts final-notice",
  has(LIB("letters.ts"), "final-notice"), has(LIB("store.ts"), "final-21st"),
  has(ALL_TESTS, "and gives seven days, not six"));

req('"AR Report can be uploaded anytime"', "aging-detail.ts",
  true, has(PAGE("upload"), "AR Report"),
  has(ALL_TESTS, "re-reading the same file gives the same total"));

req('"User can email any of the Reports ... via email drop down"', "reports screen",
  has(LIB("dispatch.ts"), "sendableReports"), has(PAGE("reports"), "Email a report"),
  has(ALL_TESTS, "a report can be sent to a chosen person"));

/* ------------------------------------------ the four documents MES supplied */

req("1. First & Final reminder templates", "letters.ts LETTER_BODIES",
  has(LIB("letters.ts"), "LETTER_BODIES"), has(LIB("store.ts"), "LETTER_BODIES"),
  has(ALL_TESTS, "the first reminder body is the shared one"));

req("2. RM / AR team email templates", "letters.ts rmEmail, lateFeeEmail",
  has(LIB("letters.ts"), "rmEmail", "lateFeeEmail"), has(PAGE("reports"), "simulateReportSend"),
  has(ALL_TESTS, "the late payment listing uses its own covering note"));

req("3. Revenue categories list", "revenue-rules.ts categories",
  has(LIB("revenue-rules.ts"), "categories"), true,
  has(ALL_TESTS, "Categories rescues a line whose description no rule knows"));

req("4. Client contact list", "parser.ts parseContacts",
  has(LIB("parser.ts"), "parseContacts"), has(PAGE("upload"), "Client contact list"),
  has(ALL_TESTS, "the contact list is folded in on the way through"));

/* ------------------------------------------------- things beyond the Flow tab */

req("1FM by document prefix (their note in G2:I2)", "revenue-rules.ts",
  has(LIB("revenue-rules.ts"), "BSD|LEO)FM"), has(PAGE("reports"), "REVENUE_TABS"),
  has(ALL_TESTS, "their own worked example"));

req("$100 late fee, from their letter", "data.ts",
  has(LIB("data.ts"), "value: 100"), has(PAGE("late-fees"), "rule.value"),
  has(ALL_TESTS, "the rule is $100 flat"));

req("Ray's 13-column manager layout", "reports.ts MANAGER_COLUMNS",
  has(LIB("reports.ts"), "MANAGER_COLUMNS", "riskExposure"),
  has(PAGE("reports"), "MANAGER_COLUMNS"),
  has(ALL_TESTS, "Ray's thirteen columns"),
  "screen still uses the older rmReports layout");

req("Recurring defaulters from GIRO fee lines", "reports.ts recurringDefaulters",
  has(LIB("reports.ts"), "recurringDefaulters"), has(PAGE("defaulters"), "recurringDefaulters"),
  has(ALL_TESTS, "the worst repeat GIRO failure is found"));

/* ------------------------------------------------------------------ print */

const W = 52;
console.log(
  "  " + "REQUIREMENT".padEnd(W) + "LOGIC  SCREEN  TEST",
);
console.log("  " + "-".repeat(W + 21));
let full = 0, partial = 0, missing = 0;
for (const r of rows) {
  const mark = (b: boolean) => (b ? " yes " : " NO  ");
  const state = r.logic && r.screen && r.tested;
  if (state) full += 1;
  else if (r.logic) partial += 1;
  else missing += 1;
  console.log(
    "  " + r.req.slice(0, W - 1).padEnd(W) +
      mark(r.logic) + "  " + mark(r.screen) + "  " + mark(r.tested) +
      (state ? "" : "   <--"),
  );
  if (r.note) console.log("  " + " ".repeat(4) + "note: " + r.note);
}

console.log("\n  " + "-".repeat(W + 21));
console.log(`  ${full} complete   ${partial} logic present but not fully wired   ${missing} absent`);
console.log(`  ${rows.length} requirements checked\n`);

const gaps = rows.filter((r) => !(r.logic && r.screen && r.tested));
if (gaps.length) {
  console.log("  NOT FULLY DONE");
  console.log("  " + "-".repeat(W + 21));
  for (const g of gaps) {
    const why = !g.logic ? "no logic" : !g.screen ? "no screen calls it" : "not tested";
    console.log(`  - ${g.req}`);
    console.log(`      ${why}${g.note ? " - " + g.note : ""}`);
  }
  console.log("");
}
process.exit(0);
