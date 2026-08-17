/**
 * Runs the real parser against the real workbooks MES supplied.
 *
 *   node scripts/test-parser.mjs
 *
 * Checks the figures against what we already know is correct, so a change to
 * the parser cannot quietly alter the numbers.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";

const DIR = path.join(
  homedir(),
  "Downloads/documents/documents/filesSharedByClient",
);

// The parser is a .ts module written for the browser, so the pure functions
// are re-declared here would be duplication. Instead compile it on the fly.
const { parseSummary, parseDetail, detectKind } = await import(
  "./_parser-bridge.mjs"
);

function open(file) {
  return XLSX.read(readFileSync(path.join(DIR, file)), { cellDates: true });
}

let failures = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(44)} ${String(actual).padStart(8)}  expected ${expected}`,
  );
};

console.log("AR Report.xlsx  (the per property summary)\n");
const sum = parseSummary(open("AR Report (2).xlsx"));
check("kind detected", detectKind(open("AR Report (2).xlsx")), "ar-summary");
check("accounts parsed", sum.accounts.length, 53);
check("as of date", sum.asOf, "2026-05-25");
check(
  "live accounts",
  sum.accounts.filter((a) => a.status === "Live").length,
  33,
);
check(
  "terminated accounts",
  sum.accounts.filter((a) => a.status === "Terminated").length,
  20,
);
check(
  "accounts in credit",
  sum.accounts.filter((a) => a.total < 0).length,
  4,
);
check(
  "OKINAWAN appears at two properties",
  sum.accounts.filter((a) => a.companyName.startsWith("OKINAWAN")).length,
  2,
);
check(
  "promise notes captured",
  sum.accounts.filter((a) => a.legacyNote).length,
  5,
);
const grand = sum.accounts.reduce((s, a) => s + a.total, 0);
check("total outstanding", grand.toFixed(2), "44970.81");
console.log(
  `  ${sum.problems.filter((p) => p.severity === "error").length} error(s), ` +
    `${sum.problems.filter((p) => p.severity === "warning").length} warning(s)`,
);
for (const p of sum.problems.slice(0, 6)) {
  console.log(`      ${p.severity}: ${p.sheet} row ${p.row ?? "-"}: ${p.message}`);
}

console.log("\nAR reports-Final.xlsx  (the invoice detail)\n");
const det = parseDetail(open("AR reports-Final (2).xlsx"));
check(
  "kind detected",
  detectKind(open("AR reports-Final (2).xlsx")),
  "ar-detail",
);
check("invoices parsed", det.invoices.length, 172);
check("contacts parsed", det.contacts.length, 8);
check("industry rows", det.industries.length, 9);
check("managers found", det.managers.length, 2);
check(
  "1FM invoices found",
  det.invoices.filter((i) => i.isOneFm).length,
  18,
);
check(
  "charge types found",
  new Set(det.invoices.map((i) => i.revenueType)).size,
  13,
);
check(
  "late payment fees",
  det.invoices.filter((i) => i.revenueType === "Late Payment Fee").length,
  4,
);
const emails = det.contacts.reduce((s, c) => s + c.emails.length, 0);
check("email addresses", emails, 21);
console.log(
  `  ${det.problems.filter((p) => p.severity === "error").length} error(s), ` +
    `${det.problems.filter((p) => p.severity === "warning").length} warning(s)`,
);

console.log(
  failures === 0
    ? "\nALL CHECKS PASSED against the real MES workbooks."
    : `\n${failures} CHECK(S) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
