/**
 * Is the tested logic actually the logic the screens run?
 *
 *   npm run test:wiring
 *
 * Written after three faults of the same kind: logic built and covered by
 * tests that no screen ever called. The library being right is worth nothing
 * if the screen next to it runs an older copy.
 *
 * These checks read the page source. That is blunt, and it is the point: they
 * fail when a screen stops importing the thing it is supposed to use, which is
 * exactly how the GIRO exclusion came to be tested and simultaneously absent
 * from the only screen that needed it.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, "..", "src", "app");
const LIB = path.join(HERE, "..", "src", "lib");

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${name.slice(0, 66).padEnd(66)} ` +
      (ok ? "" : `got ${String(actual)}, expected ${String(expected)}`),
  );
}
const section = (t: string) => console.log(`\n${t}\n`);

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const page = (route: string) => read(path.join(APP, route, "page.tsx"));
const lib = (name: string) => read(path.join(LIB, name));

/* ================================================== screens use the library */

section("Each screen runs the logic that was tested");

const lateFees = page("late-fees");
check("late fees imports the GIRO check", lateFees.includes("giroEnrolled"), true);
check("and actually calls it", /giroEnrolled\(/.test(lateFees), true);
check("it splits the listing in two", lateFees.includes("excluded"), true);
check("and shows who was held back, rather than only filtering",
  lateFees.includes("Held back because they are on GIRO"), true);

const upload = page("upload");
check("upload offers a drop zone for the AR report", upload.includes('title="AR Report"'), true);
check("and one for the contact list", upload.includes('title="Client contact list"'), true);
check("both files are passed to the parser",
  /\[arFile, contactFile\]/.test(upload), true);
check("the apply prompt knows when it has already been applied",
  upload.includes("alreadyApplied"), true);
check("and hides itself instead of asking twice",
  /if \(alreadyApplied\) return null;/.test(upload), true);

const outbox = page("outbox");
const letterView = read(path.join(HERE, "..", "src", "components", "LetterView.tsx"));
check("the outbox exists", outbox.length > 0, true);
check("and lists who could not be reached",
  outbox.includes("Owed money, but no address"), true);

// The letter itself is one component, used by both screens that show a sent
// email. Two copies would drift, and the thing they would drift on is the
// warning about an unfilled merge field.
check("there is one letter view", letterView.length > 0, true);
check("it shows the body, not just the subject", letterView.includes("email.body"), true);
check("it flags anything left unmerged", letterView.includes("Unfilled"), true);
check("it tells a legacy record from a genuinely empty one",
  letterView.includes("notCaptured") && letterView.includes("sentEmpty"), true);
check("the outbox uses it", outbox.includes("<LetterView"), true);
check("and so does the reminders screen",
  page("reminders").includes("<LetterView"), true);
check("the sent list on reminders is clickable",
  page("reminders").includes("Read the letter that went out"), true);
check("neither screen keeps its own copy of the letter markup",
  (outbox + page("reminders")).includes("this send predates letter capture"), false);

const defaulters = page("defaulters");
check("defaulters counts bounced deductions, not only late fees",
  defaulters.includes("recurringDefaulters"), true);
check("and names the months it bounced", defaulters.includes("bouncedMonths"), true);
check("it no longer counts lateFeeCount on its own",
  /months: a\.lateFeeCount/.test(defaulters), false);

const reports = page("reports");
check("reports can email a report on demand",
  reports.includes("simulateReportSend"), true);
check("to one or more chosen recipients", reports.includes("chosen"), true);

const settings = page("settings");
check("settings lets somebody fill in those addresses",
  settings.includes("Who reports can be emailed to"), true);

const reminders = page("reminders");
check("reminders dates letters from the report, not from today",
  /merge\([^)]*ds\.asOf/.test(reminders), true);
check("and never calls new Date() for a letter date",
  /const today = new Date\(\)/.test(reminders), false);

/* ============================================ one copy of the wording */

section("MES's letters exist once, not twice");

const letters = lib("letters.ts");
const store = lib("store.ts");
check("the wording lives in letters.ts", letters.includes("LETTER_BODIES"), true);
check("and the store takes it from there",
  store.includes('LETTER_BODIES["first-reminder"]'), true);
check("the store does not carry its own copy",
  store.includes("We hope this finds you well"), false);

/* ============================================== the gate is on every screen */

section("Nothing renders without a session");

const shell = read(path.join(HERE, "..", "src", "components", "Shell.tsx"));
check("the shell checks for a session", shell.includes("if (!session) return null;"), true);
check("it redirects when there is none", shell.includes('router.replace("/login")'), true);
check("it checks the route against the role", shell.includes("canOpen(role, pathname)"), true);
check("and the nav only offers what the role can open",
  shell.includes("canOpen(role, n.href)"), true);

/* ====================================== sending stays simulated */

section("Sending is still simulated");

const outboxLib = lib("outbox.ts");
check("there is no real transport", outboxLib.includes("CAN_SEND_FOR_REAL = false"), true);
check("nothing imports a mailer",
  /nodemailer|sendgrid|smtp|resend/i.test(outboxLib + reminders + outbox), false);

/* ------------------------------------------ nothing is handed the raw set ---
 * A screen that scopes its accounts and then hands a component the unscoped
 * invoices leaks everything the tiles above it just hid. It happened: the
 * board showed a relationship manager "0 tenants shown" and, underneath, every
 * billing run in the file and $2.3m of it.
 *
 * Caught by reading the page rather than by calling a function, because the
 * fault was not in any function. Both of them were right.
 */
console.log("\nNo screen hands a component the unscoped data\n");

const BOARD = read("src/app/page.tsx");
check("the board scopes what it gives the billing runs",
      /BillingCycles\s+invoices=\{ds\.invoices\}/.test(BOARD), false);
check("and passes its own scoped list instead",
      /BillingCycles\s+invoices=\{myInvoices\}/.test(BOARD), true);
check("which is derived from scope()",
      /const myInvoices[\s\S]{0,400}scope\(ds\.accounts\)/.test(BOARD), true);

const SIM = read("src/app/simulation/page.tsx");
check("the dry run scopes the file it reads", /scope\(full\.accounts\)/.test(SIM), true);
check("and scopes the already-uploaded one too",
      /scope\(ds\.accounts\)/.test(SIM), true);

// view-tenant-emails was declared and checked nowhere, which reads as
// protection that is not there. Management can open this screen and it shows
// the addresses a reminder would go to.
check("the dry run asks whether addresses may be shown",
      /can\("view-tenant-emails"\)/.test(SIM), true);

// Downloading is generate-reports; sending is send-reminders. canAct is the
// latter, and gating the download on it left Management able to read every
// report and download none, including the one addressed to them.
const REPORTS = read("src/app/reports/page.tsx");
check("downloading a report asks the reports permission",
      /disabled=\{!can\("generate-reports"\)\}/.test(REPORTS), true);
check("and emailing one still asks the reminder permission",
      /disabled=\{!canAct\}/.test(REPORTS), true);

/* --------------------------------- a described column is not a built one ---
 * Risk Exposure sat in the manager report for weeks as a column with a label,
 * a note explaining its absence, and `riskExposure: null` written into every
 * row by hand. It read as built. This fails if it goes back to that.
 */
console.log("\nRisk Exposure is computed, not hardcoded\n");

const reportsLib = lib("reports.ts");
check("the formula exists as a function",
      /export function riskExposure\(/.test(reportsLib), true);
check("and the manager report calls it",
      /riskExposure:\s*riskExposure\(/.test(reportsLib), true);
check("no row writes the value in by hand",
      /riskExposure:\s*null,/.test(reportsLib), false);
check("nor the deposit beside it",
      /securityDeposit:\s*null,/.test(reportsLib), false);
check("the builder takes a deposit source",
      /depositsHeld/.test(reportsLib), true);

/* ------------------------------ the dry run shows the whole of MES's cycle ---
 * Three things were in MES's workflow and absent from the walkthrough: the
 * billing runs the deadlines are counted from, the choice of which managers
 * get the 16th, and the fact that a report is uploaded three times a month
 * rather than once. All three were built elsewhere or described and not done,
 * which is exactly the failure this file exists to catch.
 */
console.log("\nThe dry run walks MES's whole cycle\n");

const SIMP = page("simulation");
const BILLING = read("src/components/BillingCycles.tsx");

check("the billing runs table is a shared component", BILLING.length > 0, true);
check("the board uses it", BOARD.includes("<BillingCycles"), true);
check("and so does the dry run", SIMP.includes("<BillingCycles"), true);
check("neither keeps its own copy of the table",
      /function BillingCycles\(/.test(BOARD + SIMP), false);
check("the dry run passes its own scoped lines, not the whole file",
      /<BillingCycles invoices=\{pipeline\.invoices\}/.test(SIMP), true);

check("the 16th offers the manager picker", SIMP.includes("<RmPicker"), true);
check("and only on the 16th", /nextDay === 16 && /.test(SIMP), true);
check("the choice reaches the plan", /planFor\(pipeline, state, nextDay, rms\)/.test(SIMP), true);
check("and reaches the run", /runDay\(pipeline, state, nextDay, rms\)/.test(SIMP), true);

const CYC = lib("cycle.ts");
check("the cycle resolves the choice in one place", /export function rmsFor\(/.test(CYC), true);
check("untouched still means everybody", /if \(rms === null\) return all;/.test(CYC), true);

// MES's row 28 names RM among the reports that can be emailed. The dropdown
// was built from the five charge tabs, so the manager sheets could be read and
// sent to nobody.
check("the report dropdown includes the manager sheets",
      /\.\.\.managerReports,/.test(REPORTS), true);

/* ------------------------ the deposit reaches the screens, not just a test ---
 * Risk Exposure has been described and not computed once already. The deposit
 * feeding it can fail the same way: a reader that works, called by nothing.
 */
console.log("\nThe deposit reaches the reports\n");

const reportsLib2 = lib("reports.ts");
check("the ledger reader exists",
      /export function depositsFromLedger\(/.test(reportsLib2), true);
check("a spent deposit is not counted as held",
      /if \(total > 0\) held\.set\(key, total\);/.test(reportsLib2), true);
check("the pipeline reads it", /depositsFromLedger\(invoices\)/.test(lib("pipeline.ts")), true);
check("and hands it to the manager reports",
      /depositsHeld,\n\s*\);/.test(lib("pipeline.ts")), true);
check("the reports screen reads it too",
      /depositsFromLedger\(ds\.invoices\)/.test(REPORTS), true);

// The notes on those two columns said no source existed. It does now, and a
// note claiming otherwise is worse than none.
check("the deposit column no longer says it has no source",
      /until MES name a source for it/.test(reportsLib2), false);
check("nor does risk exposure",
      /is in none of their files/.test(reportsLib2), false);

/* ------------------------- the checks screen runs the tested code, not a copy ---
 * The whole value of showing these to a client is that they are the same
 * cases the build runs. A second copy of the operations in the page would
 * agree until the day somebody moved a boundary in one of them.
 */
section("The checks screen and the build share one copy");

const CHECKS = lib("checks.ts");
const CHECKS_PAGE = page("checks");
const RUNNER = read("scripts/run-cases.mts");

check("the operations live in the library", /export const PURE_OPS/.test(CHECKS), true);
check("the screen runs them from there", CHECKS_PAGE.includes('from "@/lib/checks"'), true);
check("and the build runs the same ones",
      /PURE_OPS/.test(RUNNER) && RUNNER.includes("src/lib/checks.ts"), true);
check("the screen keeps no operations of its own",
      /const (ops|PURE_OPS)\s*[:=]/.test(CHECKS_PAGE), false);
// The generated report is the strongest evidence here, so it must not be the
// part that quietly stops running.
check("the generated report's cases live in the library too",
      /export function dataOps\(/.test(CHECKS), true);
check("the screen fetches that report and parses it",
      CHECKS_PAGE.includes("/test-data/AR Test Data.xlsx"), true);
check("through the same reader an upload goes through",
      CHECKS_PAGE.includes("parseAgingDetail("), true);
check("and the build answers them from the same factory",
      /\.\.\.dataOps\(/.test(RUNNER), true);
check("the runner keeps no second copy of them",
      /newBucketOn:/.test(RUNNER), false);

check("one case file, published so both can read it",
      RUNNER.includes('"public", "test-cases.csv"'), true);
check("the screen fetches that same file",
      CHECKS_PAGE.includes('fetch("/test-cases.csv")'), true);

// A screen that quietly counted what it could not run as a pass would be
// worse than no screen.
check("cases needing the workbook are named, not counted as passes",
      /export function needsTheFile\(/.test(CHECKS), true);
check("and the screen says so on its face",
      CHECKS_PAGE.includes("Needs the file"), true);
check("it does not claim to be the gate",
      CHECKS_PAGE.includes("npm run test:cases"), true);

/* ------------------ a screen must not contradict the panel beside it ---
 * Two faults of the same shape, both visible on the reports screen at once.
 *
 * The scheduled Security deposit report called depositReport without the
 * uploaded lines. That function falls back to the bundled sample data when it
 * is given none, so it did not fail: it looked for this month's deposits in
 * the demo file, found none, and said "0 rows". The panel directly beneath it
 * had passed the upload and was showing the deposit correctly.
 *
 * And the note under the manager reports counted MANAGER_UNAVAILABLE, a
 * constant, so it went on saying two columns "cannot be filled from any file
 * MES have sent" while the sheet beside it filled them.
 */
section("The reports screen reads the upload, not the sample data");

const REP = page("reports");
check("the scheduled report is built from the uploaded lines",
      /buildReport\(r\.id, accounts, ds\.invoices\)/.test(REP), true);
check("and so is the preview of it",
      /buildReport\(report\.id, accounts, invoices\)/.test(REP), true);
check("buildReport requires them rather than defaulting",
      REP.includes("invoices: Invoice[],"), true);
check("no call is left without them",
      /buildReport\([^)]*accounts\)/.test(REP), false);

check("the empty-column note counts the rows that were built",
      /depositRows === 0/.test(REP), true);
check("and not a constant list of columns",
      /MANAGER_UNAVAILABLE\.length > 0/.test(REP), false);
check("it says how many rows were filled when some were",
      REP.includes("of {managerRowCount} rows"), true);

section("Chased to the end names the months, not just a count");

const CHASED_PAGE = page("chased");
const CHASED_LIB = lib("chased.ts");
check("the screen exists", CHASED_PAGE.length > 0, true);
check("it runs the shared logic", CHASED_PAGE.includes('from "@/lib/chased"'), true);
check("and scopes, so a manager sees only their own",
      CHASED_PAGE.includes("scope(ds.accounts)"), true);
check("the months are listed, not summed",
      CHASED_PAGE.includes("row.months.map"), true);
check("the unbroken run is worked out once, in the library",
      /export function longestStreak\(/.test(CHASED_LIB), true);
check("a client who has paid drops off rather than being closed by hand",
      CHASED_LIB.includes("if (outstanding <= 0) continue;"), true);
check("a cycle is recognised by the fee MES raise on the 16th",
      CHASED_LIB.includes('"Late Payment Fee"'), true);

/* -------------------------------- a screen nobody can reach is not shipped ---
 * Chased to the End was built, routed, permitted and tested, and had no link
 * in the navigation, because the script that was supposed to add one aborted
 * before it wrote that file. Every suite passed. The page simply did not
 * exist as far as anybody using the app was concerned.
 *
 * The auth suite already walks src/app to catch a route left unguarded. This
 * walks it to catch a route left unreachable, which is the same kind of fault
 * from the other side.
 */
section("Every screen has a way to reach it");

const SHELL_SRC = read("src/components/Shell.tsx");
const LINKED = new Set(
  Array.from(SHELL_SRC.matchAll(/href:\s*"([^"]+)"/g)).map((m) => m[1]),
);

// Reached by being signed out, so it is never in a navigation meant for
// somebody who is signed in.
const NOT_IN_NAV = new Set(["/login"]);

const appDirs = readdirSync(path.join(HERE, "..", "src", "app"), {
  withFileTypes: true,
})
  .filter((d) => d.isDirectory() &&
    existsSync(path.join(HERE, "..", "src", "app", d.name, "page.tsx")))
  .map((d) => `/${d.name}`);

const unreachable = appDirs.filter(
  (r) => !LINKED.has(r) && !NOT_IN_NAV.has(r),
);

check("no screen is left with no link to it",
      unreachable.join(", ") || "none", "none");
check("the board is linked", LINKED.has("/"), true);
check("and so is Chased to the End", LINKED.has("/chased"), true);

/* ------------------------------ the one secret that would actually matter ---
 * The service role key bypasses every policy in 0002_security.sql. A
 * relationship manager who got hold of it could read all 190 tenants, their
 * balances and their addresses.
 *
 * So the check is not "is it handled carefully" but "can it reach a browser at
 * all". Anything under src/app that is a client component, and anything in
 * src/lib without the server-only import, must never name it.
 */
section("The service role key cannot reach the browser");

const SERVER_CLIENT = lib("supabase-server.ts");
check("the server client declares itself server-only",
      /^import "server-only";/m.test(SERVER_CLIENT), true);
check("and it is the only place the service key is read",
      SERVER_CLIENT.includes("SUPABASE_SERVICE_ROLE_KEY"), true);

const BROWSER_CLIENT = lib("supabase.ts");
check("the browser client never names the service key",
      BROWSER_CLIENT.includes("SERVICE_ROLE"), false);

const appFiles = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (/\.tsx?$/.test(e.name)) appFiles.push(full);
  }
})(path.join(HERE, "..", "src"));

const leaks = appFiles.filter((f) => {
  const src = readFileSync(f, "utf8");
  if (!src.includes("SUPABASE_SERVICE_ROLE_KEY")) return false;
  if (f.endsWith("supabase-server.ts")) return false;
  // A route or server component may use it, but only through the guarded
  // client, never by reading the variable itself.
  return true;
});
check("no other file reads the service key",
      leaks.map((f) => path.basename(f)).join(", ") || "none", "none");

const clientsImportingServer = appFiles.filter((f) => {
  const src = readFileSync(f, "utf8");
  return src.startsWith('"use client"') && src.includes("supabase-server");
});
check("no client component imports the server client",
      clientsImportingServer.map((f) => path.basename(f)).join(", ") || "none",
      "none");

// An import that half succeeded and said nothing is the failure this phase
// exists to avoid.
const ROUTE = read("src/app/api/upload/route.ts");
check("the upload route exists", ROUTE.length > 0, true);
check("it maps through the tested mapper", ROUTE.includes("toImportPayload"), true);
check("it refuses a report it cannot map completely",
      /if \(!payload\)/.test(ROUTE), true);
check("and calls the import function rather than writing tables itself",
      ROUTE.includes('rpc("import_ar_report"'), true);
check("it never inserts into a table directly",
      /\.from\(["']/.test(ROUTE), false);

console.log(failures === 0 ? "\nALL CHECKS PASS\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
