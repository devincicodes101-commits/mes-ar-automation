/**
 * The checks that run on an upload.
 *
 *   npm run test:checks
 *
 * These are the faults that do not exist inside any one file: two exports that
 * each parsed perfectly and are wrong together. Every case below has actually
 * happened on this project.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { parseAgingDetail } from "../src/lib/aging-detail.ts";
import { parseContacts } from "../src/lib/parser.ts";
import { checkUpload, worst, type Finding } from "../src/lib/upload-checks.ts";
import { datasetFromResults } from "../src/lib/dataset.ts";
import type { ParseResult } from "../src/lib/parser.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const F = path.join(HERE, "..", "AR Automation-20260903T201835Z-1-001", "AR Automation");
const AGING = path.join(F, "3. CustomA_RAgingDetail-WithDescription.xlsx");
const CONTACTS = path.join(F, "4. Client Contact List", "R1 - 20260511.xlsx");

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
const has = (fs: Finding[], text: string) =>
  fs.some((f) => f.title.includes(text) || f.detail.includes(text));

if (!existsSync(AGING)) {
  console.error("MES's export is missing");
  process.exit(1);
}
const ar = parseAgingDetail(XLSX.read(readFileSync(AGING), { cellDates: true }));
const cl = parseContacts(XLSX.read(readFileSync(CONTACTS), { cellDates: true }));

/* ================================================= the real pair of files */

section("MES's own two files, uploaded together");

const both = checkUpload([ar, cl], null);
check("the upload is usable", worst(both) === "error", false);
check("it warns that most tenants cannot be emailed",
  has(both, "of 190 tenants can be emailed"), true);
check("and says the two files are about different dormitories",
  has(both, "different dormitories"), true);
check("it warns the contact list is out of date",
  has(both, "older than the AR report"), true);
check("and gives the gap in days", has(both, "98 days"), true);
check("it does not claim there is no AR report", has(both, "No AR report"), false);

/* ============================================== the AR report on its own */

section("The AR report with no contact list");

const alone = checkUpload([ar], null);
check("still usable", worst(alone) === "error", false);
check("but says reminders have nobody to send to",
  has(alone, "No contact list"), true);
check("and that existing addresses are kept",
  has(alone, "already in the system are kept"), true);

/* ============================================ the contact list on its own */

section("A contact list with no AR report");

const noAr = checkUpload([cl], null);
check("this is an error, not a warning", worst(noAr), "error");
check("and it says why", has(noAr, "No AR report in this upload"), true);
check("it stops there rather than piling on",
  noAr.filter((f) => f.severity === "error").length, 1);

/* ================================================= going backwards in time */

section("Uploading an older report than the one in use");

const current = datasetFromResults([ar, cl] as ParseResult[], "2026-08");
const older = { ...ar, asOf: "2026-06-30" };
const back = checkUpload([older, cl], current);
check("it notices the step backwards",
  has(back, "older than the one currently loaded"), true);
check("and says how far", has(back, "48 days"), true);

const forward = checkUpload([{ ...ar, asOf: "2026-09-30" }, cl], current);
check("a newer report raises nothing",
  has(forward, "older than the one currently loaded"), false);

const same = checkUpload([ar, cl], current);
check("re-uploading the same report raises nothing either",
  has(same, "older than the one currently loaded"), false);

/* ========================================================= broken files */

section("Files that are wrong in themselves");

const undated = checkUpload([{ ...ar, asOf: null }], null);
check("no date is an error", worst(undated), "error");
check("and it says the figures must not be used",
  has(undated, "must not be used"), true);

const mismatched = checkUpload(
  [{ ...ar, subtotals: [{ customerCode: "DORM-1", companyName: "X", total: 999999 }] }],
  null,
);
check("a total that disagrees with MES's own is an error", worst(mismatched), "error");
check("and it says not to act on the figures",
  has(mismatched, "Do not act on these figures"), true);

const empty = checkUpload([{ ...ar, accounts: [], subtotals: [] }], null);
check("no accounts at all is an error", worst(empty), "error");

const noAddresses = checkUpload([ar, { ...cl, contacts: [] }], null);
check("a contact list with no addresses is an error", worst(noAddresses), "error");
check("and it points at the combined sheet",
  has(noAddresses, "Only the combined sheet"), true);

const unreadable = checkUpload(
  [{ kind: "unreadable" as const, problems: [] }, ar],
  null,
);
check("an unreadable file is reported", has(unreadable, "could not be read at all"), true);

/* ============================================================ hygiene */

section("The findings are worth reading");

check("nothing is empty", both.every((f) => f.title && f.detail), true);
check("every one says what to do or what it means",
  both.every((f) => f.detail.length > 30), true);
// An empty upload has no AR report, and saying so is right. The screen never
// calls this with nothing, but the function should not pretend an empty set is
// fine either.
check("an empty upload reports the missing AR report",
  checkUpload([], null).length, 1);
check("as an error, not a shrug", worst(checkUpload([], null)), "error");
check("worst() of nothing is null", worst([]), null);

console.log(failures === 0 ? "\nALL CHECKS PASS\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
