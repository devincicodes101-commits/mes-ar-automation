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

/**
 * The same file with its comments taken out.
 *
 * Several checks here ask whether a word appears, and this codebase explains
 * itself at length, so the word usually appears in a comment saying why the
 * code does not do that thing. Twice now a guard has failed on the prose
 * written to justify it. Where the question is about what the code does, ask
 * the code.
 */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
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
/* It used to hide itself here, and that was checked. The check was right about
   not asking twice and wrong about how: an empty space where a button was
   reads as a broken screen, not as a finished job. It now says so instead,
   which is asserted in full further down. */
check("and says so rather than asking twice",
  !/if \(alreadyApplied\) return null;/.test(upload) &&
    upload.includes("Already in use"), true);

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
/* The merge moved inside letterFor() when the three senders were made to
   build one letter the same way. The rule is unchanged and so is this check:
   the date comes from the report being looked at, never from the clock. */
check("reminders dates letters from the report, not from today",
  /letterFor\([^)]*ds\.asOf/.test(reminders) &&
    /merge\([^)]*asOf/.test(reminders), true);
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
// Declared in sending.ts, which carries no directive so that a server route
// can read the real value rather than a client reference proxy. See the
// client boundary section below: a proxy is truthy, and this flag is asked
// for by negation, so every dry run would have been logged as a real send.
check("there is no real transport", lib("sending.ts").includes("CAN_SEND_FOR_REAL = false"), true);
check("and the outbox still exposes it, so nothing imports it twice",
  outboxLib.includes("CAN_SEND_FOR_REAL"), true);
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
  /*
   * state.ts uses the key as an HMAC secret rather than to reach the database,
   * signing the value Google hands back so a stored refresh token cannot be
   * filed against somebody else's account. Allowed because it is server-only,
   * which is asserted just below rather than assumed: the danger this guard
   * exists for is the key reaching a browser, and a server-only file cannot.
   */
  if (f.endsWith(path.join("mail", "state.ts"))) return false;
  // A route or server component may use it, but only through the guarded
  // client, never by reading the variable itself.
  return true;
});
check("no other file reads the service key",
      leaks.map((f) => path.basename(f)).join(", ") || "none", "none");
check("and the one file allowed to borrow it is server-only",
      read("src/lib/mail/state.ts").startsWith('import "server-only"'), true);

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

/* ------------------------------------------------- the activity log ----- */

console.log("\nWhat an officer did reaches the database");

const STORE = read("src/lib/store.ts");
const ACTIVITY = read("src/app/api/activity/route.ts");
const SHELL = read("src/components/Shell.tsx");

check("the activity route exists", ACTIVITY.length > 0, true);
check("it maps through the tested mapper",
      ACTIVITY.includes("callToRow") && ACTIVITY.includes("callsFromRows"), true);
check("it establishes who is asking first",
      /identify\(request\)/.test(ACTIVITY), true);

/*
 * The one that would not show up as a broken screen. A store that keeps
 * writing to local storage and never posts looks completely normal: every
 * screen renders, the officer sees their own calls, and the database stays
 * empty. Only the colleague who cannot see them ever finds out.
 */
for (const fn of ["recordCall", "recordEmails", "recordPromise", "markPromiseConfirmed"]) {
  const from = STORE.indexOf(`export function ${fn}`);
  const rest = STORE.slice(from);
  const end = rest.indexOf("\nexport ", 1);
  check(`${fn} posts what it writes`,
        /mirror\(/.test(end > 0 ? rest.slice(0, end) : rest), true);
}

/* The counting moved from a bare increment to a set of ids, so that a record
   which turns out to have saved can stop being counted. The rule it enforces
   is unchanged: a failure is never silent. */
check("a record that did not reach the server is counted, not swallowed",
      STORE.includes("function noteUnsaved(") &&
        (STORE.match(/noteUnsaved\(/g) ?? []).length >= 3, true);
check("and the count is shown on every screen",
      SHELL.includes("useSync()") && SHELL.includes("sync.unsaved"), true);
check("the log is loaded when somebody signs in",
      SHELL.includes("hydrateActivity()"), true);

/*
 * Append only, the same rule audit_log follows. A call logged wrongly is
 * corrected by logging what happened next, not by editing history so that the
 * first call reads as though it never occurred.
 */
check("history cannot be rewritten through this route",
      /export async function (DELETE|PATCH|PUT)/.test(ACTIVITY), false);

/*
 * Whether a send was real is the build's fact, not the caller's claim. A
 * browser that could say a dry run was genuine would make the two
 * indistinguishable once CAN_SEND_FOR_REAL is finally turned on.
 */
check("a simulated send cannot be reported as a real one",
      ACTIVITY.includes("!CAN_SEND_FOR_REAL"), true);

/* ---------------------------------------- the client boundary ----------- */

console.log("\nServer code never reaches across the client boundary");

/*
 * The fault this was written for made every signed-in person a stranger.
 *
 * api-auth.ts imported ROLE_TO_DB from supabase-auth.ts, which begins
 * "use client". Next.js did exactly what that asks: it treated the module as a
 * client boundary and gave the server a reference proxy instead of the object.
 * Object.entries() on a proxy produced an empty map, every role read as one the
 * build did not know, and every request came back 403.
 *
 * Nothing caught it. The types were right, the values were right, and the
 * tests that talk to PostgREST with the service role key never pass through
 * identify() at all. It took signing in over HTTP to see it.
 */
const CLIENT_MODULES = new Set(
  readdirSync(LIB)
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => readFileSync(path.join(LIB, f), "utf8").startsWith('"use client"'))
    .map((f) => f.replace(/\.tsx?$/, "")),
);

const serverFiles = appFiles.filter((f) => {
  const src = readFileSync(f, "utf8");
  return (
    src.includes('import "server-only"') ||
    /\/api\/[^/]+\/route\.ts$/.test(f.split("\\").join("/"))
  );
});

/*
 * Only what survives compilation counts. `import type` is erased, so a server
 * module naming a client module's types never reaches across anything at run
 * time, and flagging it would train people to ignore this check.
 */
const IMPORT = /\bimport\s+(type\s+)?([\s\S]*?)\s+from\s+"(?:@\/lib|\.)\/([\w-]+)(?:\.tsx?)?"/g;

const crossings: string[] = [];
for (const f of serverFiles) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(IMPORT)) {
    const wholeImportIsTypes = Boolean(m[1]);
    const named = (m[2] ?? "").trim();

    /*
     * `import { type CallLog }` is erased too, but `import { type X, y }` is
     * not: y still crosses at run time. So an import counts as safe only when
     * every name in it is marked, not when any of them is.
     */
    const everyNameIsAType =
      wholeImportIsTypes ||
      (named.startsWith("{") &&
        named
          .replace(/[{}]/g, "")
          .split(",")
          .filter((x) => x.trim().length > 0)
          .every((x) => /^\s*type\s/.test(x)));

    if (everyNameIsAType) continue;
    if (CLIENT_MODULES.has(m[3])) crossings.push(`${path.basename(f)} -> ${m[3]}`);
  }
}

check("no server module imports a \"use client\" one",
      crossings.join(", ") || "none", "none");

/*
 * And the map itself lives somewhere both sides can have it, carrying neither
 * directive. A file that grew one would put the fault straight back.
 */
/*
 * The first line only. These files talk about "use client" at length in their
 * own comments, and an earlier version of this check read the whole file and
 * failed on its own prose.
 */
const firstLine = (p: string) => read(p).split(/\r?\n/)[0]?.trim() ?? "";

for (const shared of ["src/lib/roles.ts", "src/lib/sending.ts"]) {
  check(`${path.basename(shared)} carries no directive`,
        read(shared).length > 0 &&
          !/^"use client"|^"server-only"/.test(firstLine(shared)),
        true);
}

/* ------------------------------------------------ the schedule ---------- */

console.log("\nThe schedule runs the month, it does not reimplement it");

const CRON = read("src/app/api/cron/route.ts");

check("the cron route exists", CRON.length > 0, true);
check("it asks the tested library what the day does",
      CRON.includes("runDay(") && CRON.includes("planFor("), true);

/*
 * The fault this is here for would not look like a fault. A route that decided
 * for itself who gets charged on the 16th would run, write plausible rows, and
 * disagree with the simulation screen by some tenants nobody would think to
 * count. Both would look right on their own.
 */
check("it does not decide for itself who is overdue",
      /buildQueue\(|overdueTotal\(|\.filter\([^)]*bucket/.test(CRON), false);
check("and it does not carry its own fee amount",
      /(=|:)\s*100\b/.test(CRON), false);

/*
 * The whole reason the database had to come first. A cron job has no browser,
 * so anything reading local storage would work on a screen and silently do
 * nothing at 9am on the 16th.
 */
check("it never reaches for the browser",
      /localStorage|useStore|window\./.test(CRON), false);

// Same reader as the screens, so the month cannot run against figures nobody
// can see.
check("it reads the report through the shared reader",
      CRON.includes("newestReport("), true);
check("and /api/dataset reads it the same way",
      read("src/app/api/dataset/route.ts").includes("newestReport("), true);

check("the secret is checked before anything is read",
      CRON.indexOf("authorised(request)") < CRON.indexOf("newestReport("), true);
check("and a missing secret refuses rather than allows",
      /if \(!secret\) return false;/.test(CRON), true);

/*
 * Running twice must not charge twice. Vercel does not promise exactly once
 * and a person may call this by hand.
 */
check("a rerun cannot raise the fee twice",
      CRON.includes("ignoreDuplicates: true"), true);
check("and cannot write a second letter to the same tenant",
      CRON.includes("letterId("), true);

/*
 * A letter is written as a dry run and only becomes a real send once one has
 * genuinely left. The order matters: recorded first, attempted second, so a
 * letter that goes out and then fails to be written down is impossible. The
 * flag cannot be set optimistically, which is the direction that cannot be
 * checked afterwards.
 */
check("a letter is recorded as a dry run before anything is attempted",
      CRON.includes("was_simulated: true"), true);
check("and only becomes a real send once one has left",
      /if \(outcome\.sent\)[\s\S]{0,400}was_simulated: false/.test(CRON), true);
check("the schedule sends as nobody, so it uses the nominated account",
      /send\(db, null,/.test(CRON), true);

/* ------------------------------------------------------ the mailbox ----- */

console.log("\nNothing can send without going past the gate");

const GATE = read("src/lib/mail/connector.ts");
const GMAIL = read("src/lib/mail/gmail.ts");
const MAIL = read("src/lib/mail/index.ts");
const SEND = read("src/app/api/send/route.ts");

check("the connector interface exists", GATE.length > 0, true);
check("off is the default", GATE.includes('return "off";'), true);

/*
 * The one that would send real debt letters because somebody typed one
 * character wrong. A mode read as a boolean, or matched loosely, would turn
 * "eveyone" into everyone.
 */
check("a mode is matched exactly, not loosely",
      /v === "everyone"/.test(GATE) && /v === "allowed"/.test(GATE), true);

/*
 * The rails live at the bottom, in the one place every send passes through,
 * so a caller added later inherits them without having to know they exist.
 */
check("the gate is applied inside the connector, not by its callers",
      GMAIL.includes("mayLeave("), true);
check("and an unmerged field stops a letter",
      GATE.includes("did not merge"), true);
check("and an empty one does too", GATE.includes("came out empty"), true);

// The transport holds a password and opens sockets.
check("the transport declares itself server-only",
      GMAIL.startsWith('import "server-only"'), true);
check("and so does the chooser", MAIL.startsWith('import "server-only"'), true);

const mailFiles = appFiles.filter((f) => {
  const src = readFileSync(f, "utf8");
  return src.startsWith('"use client"') && /lib\/mail|nodemailer/.test(src);
});
check("no screen imports the mailbox",
      mailFiles.map((f) => path.basename(f)).join(", ") || "none", "none");

check("the App Password is never logged",
      /console\.(log|warn|error)\([^)]*appPassword/.test(GMAIL + MAIL), false);

// Sending is at least as consequential as replacing a month's figures.
check("only the roles that may upload may send", SEND.includes("mayUpload(who.caller)"), true);
check("a real send is recorded as real",
      SEND.includes("was_simulated: false"), true);
check("and a send that could not be recorded says so rather than passing quietly",
      SEND.includes("Sent, but not recorded"), true);

/*
 * Forty in parallel would hit Google's rate limit as one burst, which locks
 * sending for about a day rather than failing politely. On the 21st that is
 * the final notice reaching some tenants and not others.
 */
check("letters go one at a time", /for \(const letter of letters\)/.test(SEND), true);

/* ---------------------------------------------- what changed ------------ */

console.log("\nComparison reads two reports the way MES read them");

const MOVE = read("src/lib/movement.ts");
const MOVE_ROUTE = read("src/app/api/movement/route.ts");
const MOVE_PAGE = read("src/app/movement/page.tsx");

check("the comparison library exists", MOVE.length > 0, true);
check("the screen runs it rather than its own copy",
      MOVE_ROUTE.includes("compareReports(") && MOVE_ROUTE.includes("chronic("), true);
check("and the screen asks the route rather than comparing in the browser",
      MOVE_PAGE.includes("/api/movement"), true);

/*
 * MES's rule, and the one that would be most embarrassing to get backwards: a
 * tenant absent from the newer report has paid in full. Read the other way
 * they stay on the call list and get rung about money already sent.
 */
check("a settled tenant is recognised, not treated as missing",
      MOVE.includes('"settled"'), true);

/*
 * Never cross-file arithmetic. A balance that fell by 2,000 does not mean
 * 2,000 arrived: they may have paid 5,000 and been billed 3,000 in between.
 * No field anywhere may claim an amount was paid.
 */
check("nothing claims to know an amount paid",
      /\b(amountPaid|paidAmount|payment)\b/i.test(code("src/lib/movement.ts")), false);
check("the change is named for what it is",
      MOVE.includes("changedBy"), true);

// Two reports the wrong way round turn every settlement into a new debt.
check("the route refuses a backwards comparison rather than swapping it",
      MOVE_ROUTE.includes("is newer than"), true);
check("and orders reports by report date, not upload time",
      MOVE_ROUTE.includes("reportDates("), true);

/*
 * "Nobody is stuck" and "not enough history to tell" look the same on screen
 * and mean opposite things.
 */
check("the screen says how much history it could see",
      MOVE_PAGE.includes("chronicAcross") && MOVE_PAGE.includes("Not enough history"), true);

// One report is a system used once, not a failure, and not everybody paying.
check("one stored report explains itself instead of showing an empty table",
      MOVE_ROUTE.includes("nothing to compare it with"), true);

check("the screen scopes what it shows",
      MOVE_PAGE.includes("scope(ds.accounts)"), true);


/*
 * The mailbox is reachable from where the question occurs.
 *
 * Sent Mail and Reminder Emails are where somebody first notices nothing has
 * gone out. Making them walk to Settings to find out why is how a system ends
 * up with people assuming it is broken.
 */
check("Sent Mail shows the mailbox state",
      page("outbox").includes("<MailboxStrip"), true);
check("and so does Reminder Emails",
      page("reminders").includes("<MailboxStrip"), true);
check("both read it from the one component, not their own copy",
      read("src/components/MailAccounts.tsx").includes("function useMailbox()"), true);
check("and the strip keeps quiet when there is nothing wrong",
      read("src/components/MailAccounts.tsx").includes("if (connected && status.ready"), true);


/*
 * The client secret goes in and never comes back.
 *
 * A form that showed it back would put it in a browser, in whatever that
 * browser remembers, and in any log that captures a response body. There is
 * no reading it once it is in: it is replaced, not edited.
 */
const CLIENT_ROUTE = code("src/app/api/mail/client/route.ts");

check("the client route exists", CLIENT_ROUTE.length > 0, true);
check("it never selects the secret",
      /select\([^)]*client_secret/.test(CLIENT_ROUTE), false);
check("and no screen asks for it back",
      /client_secret|clientSecret\s*[:=]\s*(body|data|state)/.test(
        code("src/components/GoogleClient.tsx")), false);

// Swapping the client points every future sign in at a different Google
// project, so it is an administrator's decision and it leaves a trace.
check("only an administrator may change it",
      CLIENT_ROUTE.includes("admin(who.caller.role)"), true);
check("and the change is recorded",
      CLIENT_ROUTE.includes("Changed the Google sign in client"), true);

/*
 * The button and the callback must agree about which Google project they are
 * talking to. Disagreeing produces a sign in that starts and cannot finish,
 * with an error that explains nothing.
 */
check("the connect route and the callback ask for the client the same way",
      read("src/app/api/mail/connect/route.ts").includes("clientFor(") &&
        read("src/app/api/mail/callback/route.ts").includes("clientFor("), true);
check("and the stored client wins over the environment",
      read("src/lib/mail/google-oauth.ts").includes("const stored = await storedClient"), true);


/*
 * The contact list reaches the database.
 *
 * It did not, for a long time, and the omission looked like nothing: the
 * screen read the file, linked the addresses, showed them and reported
 * success. They lived in one browser until the next load, at which point the
 * screens fetched contacts from the server and the uploaded ones were gone.
 */
check("the upload screen sends the contact list it parsed",
      code("src/app/upload/page.tsx").includes('r.kind === "contact-list"') &&
        /storeDataset\([\s\S]{0,200}uploaded/.test(code("src/app/upload/page.tsx")), true);
check("storeDataset puts it in the request",
      /body: JSON\.stringify\(\{[\s\S]{0,260}contacts,/.test(code("src/lib/dataset.ts")), true);
check("the route passes it to the mapper",
      code("src/app/api/upload/route.ts").includes("body.contacts ?? null"), true);
check("and the mapper sends it to the import",
      code("src/lib/to-database.ts").includes("p_contacts"), true);

/*
 * Absent and empty mean different things. An upload with no contact list must
 * leave the stored addresses alone; an empty list would be a claim that MES
 * have no addresses at all, and there is no case where uploading an AR report
 * should mean that.
 */
check("no list given means null, not an empty list",
      code("src/lib/to-database.ts").includes("p_contacts: contacts"), true);


/*
 * An empty database must read as empty.
 *
 * The screens render from local storage first and are replaced only by a good
 * response, which is right when the server cannot be reached and was wrong
 * when it replied "nothing stored": the figures stayed up after the rows
 * behind them were gone. Somebody who clears the database and still sees
 * 2.78m has been told the opposite of the truth.
 */
const DS = code("src/lib/dataset.ts");

check("a server holding no report clears an uploaded copy",
      /if \(active\.source === "uploaded"\) commit\(EMPTY\)/.test(DS), true);
check("and empty is a state of its own, not a kind of sample",
      DS.includes('source: "empty"'), true);
check("neither sample nor empty is kept in the browser",
      /next\.source === "sample" \|\| next\.source === "empty"/.test(DS), true);

/*
 * The distinction that matters: a server that cannot be reached must still
 * leave the figures up, because two people working from their own copy is the
 * situation the database was introduced to end.
 */
/*
 * Checked as behaviour rather than as a literal, because the code reaches it
 * through a ternary and an earlier version of this test looked for a string
 * that was never written.
 *
 * A failure reports itself and leaves the figures alone. Only the explicit
 * "nothing stored" answer clears them, and EMPTY must appear exactly once for
 * that reason.
 */
check("a server that cannot be reached says so",
      /serverError: body\.error \?\? `The server answered/.test(DS), true);
check("and leaves the figures alone",
      (DS.match(/commit\(EMPTY\)/g) ?? []).length, 1);


/* ------------------------------------- one screen, one meaning of overdue - */

console.log("\nThe tiles and the billing runs agree about what is overdue");

/*
 * They did not. The tile counted money out of the Current bucket, and the
 * billing runs counted anything past fourteen days from its billing date. The
 * two disagree because MES issue due dates at fifteen days, not fourteen, so
 * the board said 47,100 needed chasing while the line beneath the same table
 * said 58,100 was past its credit period. A tenant billed on the 31st read as
 * Current in their own row and overdue in their billing run.
 *
 * Checked as arithmetic against a real file rather than by reading the source,
 * because the fault was two correct functions disagreeing, and nothing about
 * either one looks wrong on its own.
 */
{
  const XLSX = await import("xlsx");
  const { parseAgingDetail } = await import("../src/lib/aging-detail.ts");
  const { billingCycles } = await import("../src/lib/billing-cycles.ts");
  const { kpis } = await import("../src/lib/data.ts");
  const { buildPipeline } = await import("../src/lib/pipeline.ts");

  const sample = path.join(
    HERE, "..", "AR Automation-20260903T201835Z-1-001", "AR Automation",
    "3. CustomA_RAgingDetail-WithDescription.xlsx",
  );

  if (existsSync(sample)) {
    const ar = parseAgingDetail(XLSX.read(readFileSync(sample), { type: "buffer" }));
    const p = buildPipeline(ar.accounts, ar.invoices, ar.asOf, ar.entity, []);
    const tile = kpis(p.accounts).overdue;
    const runs = billingCycles(ar.invoices, ar.asOf).cycles.reduce((n, c) => n + c.overdue, 0);
    check("the two totals match on MES's own export",
          Math.abs(tile - runs) < 0.01, true);
    if (Math.abs(tile - runs) >= 0.01) {
      console.log(`        tile ${tile.toFixed(2)} vs runs ${runs.toFixed(2)}`);
    }
  } else {
    check("MES's export is present to check against", false, true);
  }
}

// Read off MES's own bucket rather than a threshold written here a second time.
check("a run reads the line's own bucket rather than recomputing the boundary",
      lib("billing-cycles.ts").includes('inv.bucket.trim().toLowerCase() !== "current"'), true);

// The credit clock is still shown, and must not be labelled as the same thing.
check("the two clocks are labelled differently on screen",
      read("src/components/BillingCycles.tsx").includes("Credit clock, from billing") &&
        read("src/components/BillingCycles.tsx").includes("Of that, chaseable"), true);


/* -------------------------------------- a month where everybody paid ----- */

console.log("\nA report with nothing in it is not automatically a broken one");

/*
 * It used to be. A report with no charge lines was rejected outright, which
 * meant the one month MES finally collected everything would be the month they
 * could not upload. The best outcome their whole process aims at was the one
 * the system refused to record.
 *
 * It is still refused when the file does not look like an AR export at all,
 * because the other way to get an empty report is the wrong file or an export
 * that failed, and importing that would replace a month of real figures with
 * nothing.
 */
const AGING = lib("aging-detail.ts");

check("an empty report that looks like an AR export is a warning",
      AGING.includes("every tenant has paid and there is nothing to chase"), true);
check("and one that does not is still an error",
      AGING.includes("this does not look like an AR"), true);
check("the two are told apart by the header and the date",
      AGING.includes("headerAt !== -1 && asOf !== null"), true);


/* ------------------------------------- the server must not read a cache -- */

console.log("\nServer reads go to the database, not to Next's cache");

/*
 * The fault this guards against showed no error anywhere.
 *
 * Next.js replaces global fetch and caches GET responses in a store that
 * outlives the request and, on Vercel, outlives the deployment. supabase-js
 * reads through that fetch, so a select becomes a cached document. The
 * database was emptied for testing, the empty report list was cached, and
 * after that every upload saved and disappeared on the next load: the tables
 * held two months while /api/dataset kept replaying the empty answer.
 *
 * It survived a long look because counts still worked. A count is a HEAD
 * request and HEAD is not cached, so the same request could count eight rows
 * and list none. It cannot be reproduced in development either, because the
 * cache is per build and short lived there.
 *
 * Checked as text rather than by behaviour on purpose: the behaviour only
 * differs on Vercel, so a test that ran the code would pass everywhere and
 * catch nothing.
 */
const SERVER = lib("supabase-server.ts");

check("the server client is built with its own fetch",
      SERVER.includes("global: {") && SERVER.includes("fetch:"), true);
check("and that fetch refuses the cache",
      SERVER.includes('cache: "no-store"'), true);
check("the reason is written down, not just the flag",
      SERVER.includes("HEAD is not cached"), true);

/* --------------------------- reading a file always says what happened ---- */

console.log("\nReading a file that is already in use still answers");

/*
 * It used to answer with nothing.
 *
 * When the file just read matched the one on screen, the apply card returned
 * null: no button, no sentence, an empty space where the control had been. The
 * green banner further down did say the file was in use, but it is below the
 * fold on a laptop, so what the officer actually saw was a button that had
 * disappeared. Silence is the one response that cannot be told apart from a
 * broken screen, and it was read as one.
 *
 * It also removed the only way to send a report to the database. On screen and
 * stored are different things, and the file most likely to be on screen but
 * unstored is exactly the one this branch caught.
 */
const UPLOAD = read("src/app/upload/page.tsx");

check("an already-applied file is stated, not silently hidden",
      UPLOAD.includes("This is the file every screen is already using"), true);
check("and it no longer renders nothing",
      !UPLOAD.includes("if (alreadyApplied) return null;"), true);
check("saving it again is still possible",
      UPLOAD.includes("Save to the database again"), true);
check("both paths save through one function",
      UPLOAD.includes("async function save(") &&
        UPLOAD.split("storeDataset(").length === 2, true);

/* ----------------------------- the screens say the number they act on ---- */

console.log("\nWhat the screens call overdue is when they start chasing");

/*
 * Five places said "past 30 days" about money the system chases from sixteen.
 *
 * Nothing was miscounted. The overdue total is every bucket outside Current,
 * and Current ends at fifteen days past the due date, so chasing begins at
 * sixteen. The words on top of that figure said thirty, which is a different
 * fortnight and a real one: a tenant twenty days late appeared in the count,
 * in the queue and in the reminder run under a label saying they were past
 * thirty days. Reading that screen to a client, the officer would have been
 * wrong.
 *
 * The boundary itself is asserted in test:behaviour, so that if the bucket
 * rule ever moves, the labels quoting fifteen fail with it rather than quietly
 * becoming the next wrong number.
 */
const HOME = read("src/app/page.tsx");
const COLLECT = read("src/app/collections/page.tsx");
const SETTINGS_PAGE = read("src/app/settings/page.tsx");
const CYCLES = read("src/components/BillingCycles.tsx");
const DATA_LIB = lib("data.ts");

check("the overdue tile does not claim 30 days",
      !HOME.includes("tenants past 30 days"), true);
check("nor does the tenant table's note",
      !HOME.includes("thick line is past 30 days"), true);
check("nor the collections filter",
      !COLLECT.includes("All overdue, past 30 days"), true);
check("nor the money-being-chased tile",
      !COLLECT.includes("Everything past 30 days"), true);
check("nor the automatic sending warning",
      !SETTINGS_PAGE.includes("balance\n            past 30 days"), true);
check("nor the reason shown against a queued tenant",
      !DATA_LIB.includes('"aging-30": "Overdue more than 30 days"'), true);

/*
 * The billing runs column is a separate fault with the same shape. It said
 * "past due" and printed a dash against a run five days past its due date,
 * two columns from the due date itself.
 */
check("the billing runs column is named for what it counts",
      CYCLES.includes("Of that, chaseable") && !CYCLES.includes("Of that, past due"), true);

/*
 * The credit clock is measured from the billing date against MES's own 14 and
 * 30 day deadlines, so "past 30 days" is correct there and must stay.
 */
check("the credit clock keeps its own 14 and 30 day stages",
      CYCLES.includes('stage === "past 30 days"'), true);

/* ------------------- the month everybody paid, all the way to the screen -- */

console.log("\nAn empty report survives every layer, not just the first");

/*
 * This was refused five times over, by five separate pieces of code, each
 * written on its own reasonable assumption that a report with nobody in it was
 * a report that had failed to read. Fixing one moved the refusal to the next,
 * and each move looked like the fix had not worked:
 *
 *   the reader          called it an error           -> warning, if it is an AR export
 *   datasetFromResults  wanted at least one account  -> shape decides, not emptiness
 *   checkUpload         raised an error              -> warning, deferring to the reader
 *   toImportPayload     refused "No tenants"         -> allowed when the caller states it
 *   reportDates         only listed dates with rows  -> asks uploads as well
 *
 * They are checked together because that is the lesson: the same assumption
 * was made independently in five places, so a test on any one of them would
 * have passed while the feature stayed broken.
 */
const TO_DB = lib("to-database.ts");
const UPLOAD_ROUTE = read("src/app/api/upload/route.ts");
const DATASET = lib("dataset.ts");
const READ_REPORT = lib("read-report.ts");
const UPLOAD_CHECKS = lib("upload-checks.ts");

check("the mapper can be told a report is genuinely empty",
      TO_DB.includes("nothingOutstanding = false") &&
        TO_DB.includes("accounts.length === 0 && !nothingOutstanding"), true);
check("the route only believes it when nothing arrived",
      UPLOAD_ROUTE.includes("accounts.length === 0 && invoices.length === 0"), true);
check("and the browser says so when it sends one",
      DATASET.includes("nothingOutstanding: d.accounts.length === 0"), true);
check("the report list asks uploads as well as snapshots",
      READ_REPORT.includes('db.from("uploads").select("report_date")'), true);
check("and an empty month does not ask for the invoices of no snapshots",
      READ_REPORT.includes("ids.length === 0"), true);
check("the upload check defers to the reader rather than deciding again",
      UPLOAD_CHECKS.includes("readerRefusedIt"), true);
check("but still speaks up when the reader rejected the file",
      UPLOAD_CHECKS.includes("No tenant accounts were found"), true);

/* --------------------------- a screen that says "sent" has to have sent --- */

console.log("\nSending a letter means a mail server accepted it");

/*
 * Reminder Emails recorded sends and contacted nothing.
 *
 * It called recordEmails(), which writes "Sent the first reminder" into the
 * store, logs it, and counts it under "Sent so far". Every signal on the
 * screen said the letters had gone, and every one of those signals was the
 * browser describing its own behaviour. The mailbox was never touched. The
 * only place the truth showed was the Sent folder of the connected account,
 * which stayed empty, and the one person who thought to look there.
 *
 * The connector was finished and tested the whole time. /api/send was
 * reachable from exactly one place: the test button in Settings. The screen
 * the entire system exists to drive was the one screen not wired to it. That
 * is the third time in this project the same shape has appeared, so it is
 * guarded rather than fixed and trusted.
 */
const REMINDERS = read("src/app/reminders/page.tsx");
const SENDER = lib("send-letters.ts");

check("the reminders screen sends through the connector",
      REMINDERS.includes("sendLetters("), true);
/* Checked on the import rather than on the text, because the comment above
   the fix names the function it replaced and would otherwise fail this. */
check("and no longer records a send without one",
      !/^\s*recordEmails?,/m.test(REMINDERS) &&
        !/[^a-zA-Z.]recordEmails?\(/.test(REMINDERS.replace(/\/\*[\s\S]*?\*\//g, "")), true);
check("all three senders build the letter the same way",
      REMINDERS.includes("function letterFor("), true);
check("the edited wording is what goes, not the template",
      REMINDERS.includes("subject,\n        body,"), true);
check("the sender reports refusals rather than throwing them away",
      SENDER.includes("blocked") && SENDER.includes("results"), true);
check("and the browser re-reads the log instead of writing its own row",
      SENDER.includes("The server records it, not the browser"), true);
check("the log can be refreshed after a send",
      lib("store.ts").includes("hydrateActivity(force = false)"), true);

/*
 * The route is the only thing that knows whether a letter left, so it is the
 * only thing that may write the row saying one did.
 */
const SEND_ROUTE = read("src/app/api/send/route.ts");
check("only a letter that left is recorded as not simulated",
      SEND_ROUTE.includes("if (outcome.sent) {") && SEND_ROUTE.includes("was_simulated: false"), true);
check("and the record keeps which wording produced it",
      SEND_ROUTE.includes("letter.templateName ??"), true);

/* ------------------------- a fee raised here is a fee this system knows --- */

console.log("\nThe late fee screen knows what this system has raised");

/*
 * It knew only what NetSuite carried.
 *
 * "Fees already charged" counted the Late Payment Fee lines in the uploaded
 * report. A fee raised on the 16th does not reach that report until somebody
 * at MES enters it into NetSuite, so every tenant read "first time" however
 * many months running the system had charged them.
 *
 * Two consequences, and the second is the worse one. The screen offered to
 * charge the same tenant again the next day. And the repeat-defaulter rule,
 * which MES set at three fees, counted zero forever — a rule they asked for
 * that had never once fired.
 *
 * On top of that the button charged nobody: it called recordExport(), which
 * appends a line to the browser's own log, and reported three fees raised for
 * three hundred dollars.
 */
const FEES_PAGE = read("src/app/late-fees/page.tsx");
const RAISER = lib("raise-fees.ts");
const FEE_DATA = lib("data.ts");
const ACTIVITY_ROUTE = read("src/app/api/activity/route.ts");

check("the screen raises fees through the server",
      FEES_PAGE.includes("raiseFees("), true);
check("and no longer reports a raise it did not make",
      !/recordExport\(`Late payment fees[^`]*`\);\s*\n\s*notify/.test(FEES_PAGE), true);
check("the two counts are kept apart on screen",
      FEES_PAGE.includes("raised by us") && FEES_PAGE.includes("billed in NetSuite"), true);
check("a tenant charged this month is left out of the batch",
      FEES_PAGE.includes("!l.raisedThisPeriod"), true);
check("but is still shown, rather than vanishing from the month",
      FEES_PAGE.includes("chargeable") && FEES_PAGE.includes("lines.map"), true);

check("the server builds the fee row itself",
      ACTIVITY_ROUTE.includes('kind === "late-fee"') && ACTIVITY_ROUTE.includes("not a plausible late fee"), true);
check("and a second attempt is ignored, not charged",
      ACTIVITY_ROUTE.includes('"tenant_id,period"') && ACTIVITY_ROUTE.includes("ignoreDuplicates"), true);

check("the repeat-defaulter rule counts both",
      FEE_DATA.includes("account.lateFeeCount + (raisedByUs.get(account.id) ?? 0)"), true);
check("and the fees are counted in one place, not per screen",
      lib("store.ts").includes("export function feeCountsByTenant"), true);
check("the raiser reports refusals rather than swallowing them",
      RAISER.includes("failed") && RAISER.includes("problems"), true);

/* ------------------------------ one tenant, everything done about them --- */

console.log("\nA tenant's whole history in one place");

/*
 * The record was complete and scattered. The letter was on Sent Mail, the call
 * that followed on the Call List, the promise on Payment Promises, the $100 on
 * Late Payment Fees — four screens, each sorted by its own thing, none of them
 * answering what anybody actually asks: what have we done about this company?
 *
 * It gets asked twice and both matter. An officer picking up the phone needs
 * to know what the tenant has already been told; a tenant ringing to dispute a
 * charge is the moment MES need the sequence with dates.
 */
const TENANT_PAGE = read("src/app/tenant/[id]/page.tsx");
const HISTORY = lib("tenant-history.ts");

check("there is a page for one tenant", TENANT_PAGE.length > 0, true);
check("it merges all four kinds into one order",
      HISTORY.includes('"letter"') && HISTORY.includes('"call"') &&
        HISTORY.includes('"promise"') && HISTORY.includes('"fee"'), true);
check("sorted by when it happened, and nothing else",
      HISTORY.includes("b.at.localeCompare(a.at)"), true);
check("and says which events the tenant holds too",
      HISTORY.includes("reachedTheTenant"), true);

/* A page is a URL, and a URL somebody can type is a door. */
check("a relationship manager cannot reach another manager's tenant",
      TENANT_PAGE.includes("scope(ds.accounts).find"), true);

check("the charge lines are joined the same way every other screen joins them",
      TENANT_PAGE.includes("invoicesForAccount("), true);
/*
 * On every screen that lists a tenant, not two of them.
 *
 * It was added to the call list and the collections board, and the client
 * clicked a name on What Changed. A name that is a link on one screen and
 * plain text on another teaches people it is not clickable, which is worse
 * than never having linked it at all.
 */
check("the link is one component, not written out per screen",
      read("src/components/ui.tsx").includes("export function TenantLink"), true);
for (const screen of [
  "calls", "collections", "movement", "late-fees", "defaulters", "chased",
  "promises", "outbox",
]) {
  check(`${screen} links the tenant name`,
        read(`src/app/${screen}/page.tsx`).includes("<TenantLink"), true);
}

/* ------------------------------- the unsaved count has to be able to fall */

console.log("\nThe unsaved banner can clear itself");

/*
 * It only ever went up. Three letters counted as unsaved during one bad
 * moment stayed counted for the rest of the session, so the banner went on
 * saying they were in this browser alone while all three sat in the database.
 * A warning that stays on after the problem is fixed is one people learn to
 * ignore, which is the single thing this banner cannot afford.
 */
const SYNC_STORE = lib("store.ts");
check("failures are remembered by id, not just counted",
      SYNC_STORE.includes("const unsavedIds = new Set<string>()"), true);
check("an accepted record stops being counted",
      SYNC_STORE.includes("unsavedIds.delete(id)"), true);
check("and a load from the server settles the rest",
      SYNC_STORE.includes("if (onServer.has(id)) unsavedIds.delete(id)"), true);

/* ------------------------- a reminder is monthly, not once and for all --- */

console.log("\nWho has already had this month's reminder");

/*
 * The question had no month in it: "has this tenant ever had this template".
 * A tenant chased in September was crossed off in October, in November, and
 * for good. Month one worked, the list emptied out after that, and the screen
 * said "everyone who can be emailed has had this one" — which reads as
 * success, which is why it survived every demo we ran on a single month.
 *
 * The scheduled run never shared the fault, and that made it worse rather
 * than better. It builds a letter id from the date, so a new month is a new id
 * and it sends. On the 7th of December the cron would write to a tenant the
 * screen showed as done, and the officer reading the screen would not know a
 * letter had gone.
 */
const REMINDERS_PAGE = read("src/app/reminders/page.tsx");

check("the screen asks per month, not ever",
      REMINDERS_PAGE.includes("function alreadyHadIt(") &&
        !/filter\(\(e\) => e\.templateId === templateId\)/.test(REMINDERS_PAGE), true);
/*
 * And the month comes from the calendar, which is a correction of the first
 * answer here rather than a new rule.
 *
 * The month used to be read off the date printed on the loaded report. That
 * is the same answer almost always, because November's report is read in
 * November, and it is wrong the moment somebody opens next month's sheet
 * early: the screen then looks up a month nothing has happened in, finds no
 * letters and no fees, and offers to send and charge it all again. The
 * schedule never had the fault — it has always used the clock — so the two
 * halves of one rule disagreed, and the half that writes to tenants without
 * being asked was the screen's.
 *
 * MES's own wording settles it. The fee applies "if payment is not received
 * by the 15th day of each calendar month". It is a calendar rule.
 *
 * Checked by absence as well as presence, because the fault was never a
 * missing import. It was a one-line expression sitting under a comment
 * explaining why the report decided the month.
 */
const FEES_CODE = code(path.join(APP, "late-fees", "page.tsx"));
const REMINDERS_CODE = code(path.join(APP, "reminders", "page.tsx"));

check("reminders takes the month from the calendar",
      REMINDERS_CODE.includes("const period = currentPeriod()"), true);
check("late fees takes the same month",
      FEES_CODE.includes("const period = currentPeriod()"), true);
check("neither screen still reads it off the report",
      /ds\.asOf \? `\$\{ds\.asOf\.slice\(0, 7\)\}-01`/.test(REMINDERS_CODE + FEES_CODE), false);
check("the run that sends without being asked uses it too",
      REMINDERS_CODE.includes("alreadyHadIt(store.emails, due.id, period)"), true);
check("and every letter says which month it is for",
      (REMINDERS_CODE.match(/period: currentPeriod\(\)/g) ?? []).length >= 2, true);
check("there is one definition of that month, not several",
      (lib("schedule.ts").match(/export function currentPeriod/g) ?? []).length, 1);
check("the schedule still reads it the way it always did",
      read("src/app/api/cron/route.ts").includes("periodOf(today)"), true);

check("the schedule records it too",
      read("src/app/api/cron/route.ts").includes("period,\n          subject: letter.subject"), true);
check("the send route stores what it was given",
      read("src/app/api/send/route.ts").includes("period: letter.period ?? null"), true);
check("and the activity log reads it back",
      read("src/app/api/activity/route.ts").includes("was_simulated,period,"), true);

/* Letters stored before the column existed fall back to the month they were
   sent in, which is the only answer available for them. */
check("older letters fall back to when they were sent",
      REMINDERS_PAGE.includes("e.period ?? `${e.at.slice(0, 7)}-01`"), true);

/* ---------------------------- the schedule has a face, and one lock ------ */

console.log("\nThe schedule can be seen, and the cron's guard is untouched");

/*
 * cron_runs was written on every run and nothing read it. So the one part of
 * the system that works on its own was the one part nobody could be shown:
 * the fees appeared, the letters went, and the only evidence the schedule had
 * fired was a row in a table with no screen. A dry run is a different claim —
 * it proves the code decides correctly, not that the schedule ran.
 *
 * The obvious way to make it demonstrable was to let an administrator's own
 * token past the CRON_SECRET check. That weakens the one lock that matters, on
 * the one endpoint whose mistakes reach people outside MES and cannot be taken
 * back. So the secret stays where it is: /api/schedule authenticates the
 * administrator the ordinary way and makes the privileged call itself, server
 * side, holding a secret the browser never sees.
 */
const CRON_ROUTE = read("src/app/api/cron/route.ts");
const SCHED_ROUTE = read("src/app/api/schedule/route.ts");
const SCHED_PAGE = read("src/app/schedule/page.tsx");

check("the cron still accepts nothing but the secret",
      CRON_ROUTE.includes("const secret = process.env.CRON_SECRET") &&
        !CRON_ROUTE.includes("identify("), true);
check("and still compares it without leaking its length",
      CRON_ROUTE.includes("diff |= given.charCodeAt(i)"), true);

check("the schedule route holds the secret server side",
      SCHED_ROUTE.includes("Authorization: `Bearer ${secret}`"), true);
check("and refuses anybody who is not an administrator",
      SCHED_ROUTE.includes("if (!admin(who.caller.role))"), true);
check("running a day by hand is recorded",
      SCHED_ROUTE.includes("Ran a day of the schedule by hand"), true);
check("the date is checked before a letter can go for the wrong month",
      SCHED_ROUTE.includes("askedFor(asked"), true);

check("a screen finally reads cron_runs",
      SCHED_ROUTE.includes('from("cron_runs")') && SCHED_PAGE.includes("/api/schedule"), true);
check("and it says which runs caught up late",
      SCHED_PAGE.includes("caught up"), true);
check("the screen is in the navigation",
      read("src/components/Shell.tsx").includes('href: "/schedule"'), true);

/* ------------------- replaying a day must not write to a tenant twice ---- */

console.log("\nA replayed day does not send the same letter again");

/*
 * The record was already idempotent and the delivery was not.
 *
 * Letter ids are derived from the date, the day and the tenant, so a rerun
 * upserts the same rows and emails_sent never doubles. But the send loop ran
 * over those rows regardless, so a caught-up day — or a day that crashed half
 * way and was replayed — put the same letter in a tenant's inbox twice. And
 * replaying a missed day is the entire purpose of the catch-up, so this was
 * not an edge case: it was the designed path.
 *
 * The test is was_simulated, not mere existence, because a row written and not
 * sent is exactly what a crash leaves behind and that one does still need
 * sending.
 */
const CRON_SEND = read("src/app/api/cron/route.ts");

/*
 * Rewritten, because the three checks that stood here were satisfied by code
 * that did nothing.
 *
 * They asked whether the guard was present. It was: a query for the row ids
 * marked really sent, and a skip for each one it found. It never found any,
 * because it ran immediately after an upsert whose payload carries
 * was_simulated: true — so the flag was reset a line before the query tested
 * it. And it compared row ids, which a letter sent by hand from the Reminders
 * screen never shares, so those were invisible to it as well.
 *
 * That is the lesson worth keeping: a guard that greps for a line proves the
 * line exists, not that it does anything. The behaviour suite now asserts the
 * rule by running it. These check the wiring the behaviour suite cannot see —
 * that the route reads the month back before it decides, and that it can no
 * longer decide from a blank sheet.
 */
const CRON_CODE = code(path.join(APP, "api", "cron", "route.ts"));

check("the run reads what has already been done this month",
      CRON_CODE.includes("await priorContact(db, period)"), true);
/* Named, because the first version of this guard did not catch a revert that
   passed stateFrom() three empty sets: it checked that a variable called
   `before` reached runDay, which stayed true. What matters is where `before`
   came from. */
check("and the state is what it read, not an empty one wearing its name",
      CRON_CODE.includes("stateFrom(memory.prior)"), true);
check("and hands it to the day as its starting state",
      /runDay\(pipeline, before, day/.test(CRON_CODE) &&
        /planFor\(pipeline, before, day/.test(CRON_CODE), true);
check("it can no longer start from a blank sheet",
      /emptyState\(\)/.test(CRON_CODE), false);
check("a failed read stops the run instead of resending",
      CRON_CODE.includes("if (!memory.ok)"), true);
check("only letters not already sent this month are written",
      CRON_CODE.includes("!hadAlready.has(id)"), true);
check("and only fees not already raised are counted",
      CRON_CODE.includes("!prior.charged.has(id)"), true);
check("the inert id-based skip is gone",
      CRON_CODE.includes("already.has(row.id)"), false);
check("the record is still read for real sends only, not mere existence",
      lib("prior-contact.ts").includes('.eq("was_simulated", false)'), true);
check("and it pages, because a silent truncation here means a second letter",
      lib("prior-contact.ts").includes("from += PAGE"), true);

/* --------------- the final notice cannot be a tenant's first contact ----- */

console.log("\nThe final notice only follows a first reminder");

/*
 * The screen has always had this rule. The schedule never did, because it ran
 * from a blank state: every owing tenant with an address was "fresh" on the
 * 21st. On 21 September 2026 four final notices went out and the run's own
 * summary said "None of them was reminded on the 7th".
 *
 * One definition, used by the screen, the simulation and the schedule alike.
 */
const CYCLE_CODE = code(path.join(LIB, "cycle.ts"));

check("there is one rule for who is due a letter",
      (CYCLE_CODE.match(/export function dueTheLetter/g) ?? []).length, 1);
check("the plan uses it", /dueTheLetter\(reachable, s, day\)/.test(CYCLE_CODE), true);
check("the 21st uses it", /dueTheLetter\(reachable, s, 21\)/.test(CYCLE_CODE), true);
check("the 7th uses it", /dueTheLetter\(reachable, s, 7\)/.test(CYCLE_CODE), true);
check("no day still filters on finalNotice by hand",
      /reachable\.filter\(\(a\) => !s\.finalNotice\.includes/.test(CYCLE_CODE), false);
check("the tenants held back are named, not silently dropped",
      CYCLE_CODE.includes("heldBackFromFinal"), true);
check("the screen keeps the rule it already had",
      code(path.join(APP, "reminders", "page.tsx")).includes("gotFirst.has(q.account.id)"), true);

/* ------------------------- the summary stops claiming it was a dry run --- */

/*
 * `simulated: !CAN_SEND_FOR_REAL` recorded simulated: true on every run ever,
 * including the one that really sent four letters, because the constant is
 * always false and never gated the send. MAIL_MODE does.
 */
check("no run claims to be simulated on the strength of a constant",
      CRON_CODE.includes("simulated: !CAN_SEND_FOR_REAL"), false);
check("and a blocked letter reports the gate's own reason",
      CRON_CODE.includes("blockedBecause ??"), true);
check("fees stay idempotent the way they already were",
      CRON_SEND.includes('onConflict: "tenant_id,period"') &&
        CRON_SEND.includes("ignoreDuplicates: true"), true);
console.log(failures === 0 ? "\nALL CHECKS PASS\n" : `\n${failures} FAILED\n`);
/* ------------------- the owner of a tenant survives the import ---------- */

console.log("\nThe report says who owns each tenant, and the import keeps it");

/*
 * tenants.rm_key existed from 0005 and nothing ever wrote to it.
 *
 * The parser read MES's Primary Sales Rep column, grouped the manager reports
 * in the browser from it, and the import then dropped it: the insert did not
 * list the column. So every tenant ever stored had rm_key null, and three
 * things quietly did nothing — the by-RM grouping that MES's standard upload
 * routine asks for on every upload, the manager workbooks, and the RM login,
 * which showed an empty system because can_see_account() found no row whose
 * key matched.
 *
 * Checked at both ends, because the fault was a gap between them: the payload
 * has to carry it and the SQL has to store it.
 */
const TO_DB_CODE = code(path.join(LIB, "to-database.ts"));
const M19 = read("supabase/migrations/0019_rm_key.sql");

check("the payload carries the owner",
      /rm_key: rep \|\| null/.test(TO_DB_CODE), true);
check("and the managers it names, for the foreign key",
      TO_DB_CODE.includes("p_managers:"), true);
check("the import writes the column",
      M19.includes("rm_key, industry, entity, first_seen, last_seen") &&
        M19.includes("r.rm_key, r.industry, r.entity"), true);
check("managers go in before the tenants that point at them",
      M19.indexOf("insert into managers") < M19.indexOf("insert into tenants") &&
        M19.indexOf("insert into managers") > 0, true);
check("a file that names no manager does not un-assign anybody",
      M19.includes("rm_key        = coalesce(excluded.rm_key, tenants.rm_key)"), true);
check("the old overload is dropped rather than left beside the new one",
      /drop function if exists import_ar_report\(/.test(M19), true);
check("the upload says how many were assigned, so a zero is visible",
      code(path.join(APP, "api", "upload", "route.ts")).includes("assigned:"), true);
/* code(), not lib(): the comment explaining the old wording quotes it, and a
   guard that failed on the prose written to justify it would be the third
   time that has happened in this file. */
check("and the pipeline no longer blames MES's export for it",
      code(path.join(LIB, "pipeline.ts")).includes("this export has no Primary Sales Rep column"), false);

process.exit(failures === 0 ? 0 : 1);
