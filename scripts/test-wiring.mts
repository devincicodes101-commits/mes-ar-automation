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
import { readFileSync, existsSync } from "node:fs";
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

console.log(failures === 0 ? "\nALL CHECKS PASS\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
