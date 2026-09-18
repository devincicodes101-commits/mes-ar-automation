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

check("a record that did not reach the server is counted, not swallowed",
      STORE.includes("unsaved: sync.unsaved + 1"), true);
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

check("nothing it writes claims to be a real send",
      CRON.includes("was_simulated: !CAN_SEND_FOR_REAL"), true);

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

console.log(failures === 0 ? "\nALL CHECKS PASS\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
