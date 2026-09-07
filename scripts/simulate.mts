/**
 * A full month of MES's cycle, run against their real files.
 *
 *   npm run simulate
 *
 * Nothing is sent. The email step builds every message, renders MES's own
 * letter into it and reports who it would reach and who it could not, then
 * stops. See src/lib/outbox.ts for why that is structural rather than a
 * setting.
 *
 * Read the output as a walkthrough of one cycle: upload, group by dorm, build
 * the six tabs, work out the late payment listing, then the 7th and the 21st.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { runPipeline } from "../src/lib/pipeline.ts";
import { simulateSend, CAN_SEND_FOR_REAL } from "../src/lib/outbox.ts";
import { lateFeeEmail, rmEmail, addDays, currency } from "../src/lib/letters.ts";
import { MANAGER_UNAVAILABLE } from "../src/lib/reports.ts";
import { parseAgingDetail } from "../src/lib/aging-detail.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const FOLDER = path.join(ROOT, "AR Automation-20260903T201835Z-1-001", "AR Automation");

const AGING = path.join(FOLDER, "3. CustomA_RAgingDetail-WithDescription.xlsx");
const CONTACTS = path.join(FOLDER, "4. Client Contact List", "R1 - 20260511.xlsx");
const OLDER = path.join(FOLDER, "Detailed AR report(Final).xlsx");

const money = (n: number) => `$${currency(n)}`;
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const rpad = (s: string | number, n: number) => String(s).padStart(n);

function rule(title: string) {
  console.log(`\n${"=".repeat(78)}\n${title}\n${"=".repeat(78)}`);
}
function head(title: string) {
  console.log(`\n${title}\n${"-".repeat(title.length)}`);
}

for (const f of [AGING, CONTACTS]) {
  if (!existsSync(f)) {
    console.error(`Missing input file:\n  ${f}`);
    process.exit(1);
  }
}

/* ------------------------------------------------------------ 1. upload */

rule("1.  UPLOAD  ·  the standard routine that runs on every import");

const wb = XLSX.read(readFileSync(AGING), { cellDates: true });
const contactsWb = XLSX.read(readFileSync(CONTACTS), { cellDates: true });
const p = runPipeline(wb, contactsWb);

console.log(`File          ${path.basename(AGING)}`);
console.log(`Entity        ${p.entity}`);
console.log(`Report date   ${p.asOf}   <- every figure below is keyed off this,`);
console.log(`                          not off today's date`);
console.log(`Invoice lines ${p.invoices.length}`);
console.log(`Accounts      ${p.accounts.length}   (company + dormitory)`);
console.log(
  `Outstanding   ${money(p.accounts.reduce((n, a) => n + a.total, 0))}`,
);

const errors = p.problems.filter((q) => q.severity === "error");
const warnings = p.problems.filter((q) => q.severity === "warning");
console.log(`Problems      ${errors.length} errors, ${warnings.length} warnings`);
for (const q of warnings.slice(0, 4)) console.log(`   warning: ${q.message}`);

/* ------------------------------------------------------ 2. show by dorm */

rule("2.  SHOW BY DORM  ·  aging buckets, MES's own 15/45/75/105 formula");

console.log(
  `${pad("Dorm", 7)}${rpad("Accts", 6)}${rpad("Current", 14)}${rpad("30 days", 13)}` +
    `${rpad("60 days", 12)}${rpad("90 days", 12)}${rpad("90+ days", 13)}${rpad("Total", 14)}`,
);
for (const row of p.byProperty) {
  console.log(
    pad(row.property, 7) +
      rpad(row.accounts, 6) +
      rpad(money(row.buckets.current), 14) +
      rpad(money(row.buckets.d30), 13) +
      rpad(money(row.buckets.d60), 12) +
      rpad(money(row.buckets.d90), 12) +
      rpad(money(row.buckets.d90plus), 13) +
      rpad(money(row.total), 14),
  );
}

/* ------------------------------------------------- 3. the six report tabs */

rule("3.  THE SIX TABS  ·  SD / PF / 1FM / LP / SD / RM");

for (const r of p.revenueTabs) {
  head(`${r.name}   [MES shorthand: ${r.shorthand}]`);
  console.log(`  lines ${r.lineCount}, total ${money(r.total)}`);
  for (const b of r.blocks) {
    console.log(`  ${b.title}: ${b.rows.length} lines, ${money(b.total)}`);
  }
  if (r.lineCount === 0) console.log("  (nothing on this tab in this export)");
  for (const n of r.notes) console.log(`  note: ${n}`);
  const sample = r.blocks[0]?.rows.slice(0, 3) ?? [];
  for (const row of sample) {
    console.log(
      `    ${pad(row.documentNumber, 16)}${pad(String(row.date ?? ""), 12)}` +
        `${rpad(money(Number(row.openBalance)), 12)}  ${String(row.description).slice(0, 40)}`,
    );
  }
}

head("RM — clients by dorm");
if (p.managerReports.length === 0) {
  console.log("  0 manager reports built.");
  console.log(
    "  This export has no Primary Sales Rep column, so there is nothing to",
  );
  console.log("  group by. This is the blocker, showing up where it bites.");
} else {
  for (const m of p.managerReports) {
    console.log(`  ${m.managerName}: ${m.lineCount} clients, ${money(m.total)}`);
  }
}
console.log("\n  Columns that cannot be filled from any file MES has sent:");
for (const c of MANAGER_UNAVAILABLE) console.log(`    - ${c.label}: ${c.unavailable}`);

/* ---------------------------- the manager report proved on the older file */

head("RM builder, proved against MES's other export");
if (existsSync(OLDER)) {
  const olderWb = XLSX.read(readFileSync(OLDER), { cellDates: true });
  const older = parseAgingDetail(olderWb);
  const reps = new Map<string, number>();
  for (const a of older.accounts) {
    const rep = (a as { rm?: string }).rm;
    if (rep) reps.set(rep, (reps.get(rep) ?? 0) + 1);
  }
  if (reps.size > 0) {
    console.log(
      `  Detailed AR report(Final).xlsx carries Primary Sales Rep. Grouping ` +
        `finds ${reps.size} managers:`,
    );
    for (const [rep, n] of Array.from(reps).sort()) {
      console.log(`    ${pad(rep, 24)} ${n} accounts`);
    }
    console.log(
      "  Amounts are blank throughout that file, so this proves the grouping,",
    );
    console.log("  not the figures. Both columns in one export and it is done.");
  } else {
    console.log("  No Primary Sales Rep found on that file either.");
  }
}

/* ------------------------------------------------- 4. late payment listing */

rule("4.  THE 16th  ·  late payment listing, GIRO clients excluded");

const lf = p.lateFees;
console.log(`Fee                  $${lf.fee} before GST`);
console.log(`Charged on           anything over ${lf.minimumAgeDays} calendar days past due`);
console.log(`Tenants to charge    ${lf.rows.length}`);
console.log(`Excluded, on GIRO    ${lf.giroExcluded.length}`);
console.log(`Fees this cycle      ${money(lf.rows.length * lf.fee)}`);

head("Top of the listing");
console.log(`  ${pad("Customer", 12)}${pad("Company", 34)}${rpad("Overdue", 14)}${rpad("Fee", 8)}${rpad("Charged before", 16)}`);
for (const r of lf.rows.slice(0, 8)) {
  console.log(
    "  " +
      pad(r.account.customerCode, 12) +
      pad(r.account.companyName.slice(0, 32), 34) +
      rpad(money(r.overdue), 14) +
      rpad(`$${r.fee}`, 8) +
      rpad(`${r.alreadyCharged}x`, 16),
  );
}

head("Excluded because they are on GIRO");
for (const g of lf.giroExcluded) {
  console.log(
    `  ${pad(g.account.customerCode, 12)}${pad(g.account.companyName.slice(0, 32), 34)}${rpad(money(g.overdue), 14)}`,
  );
}
for (const n of lf.notes) console.log(`\n  note: ${n}`);

head("The covering email to the AR team");
const feeMail = lateFeeEmail(p.asOf ?? "2026-08-17");
console.log(`  Subject:    ${feeMail.subject}`);
console.log(`  Attachment: ${feeMail.attachment}`);
console.log(feeMail.body.split("\n").map((l) => `  | ${l}`).join("\n"));

/* --------------------------------------------------- 5. recurring defaulters */

rule("5.  RECURRING DEFAULTERS  ·  from the AR report alone");

console.log(
  `${p.giroCustomers.size} tenants have had a GIRO deduction bounce. ` +
    `Each failure leaves a\ndated "Admin Fee for Rejected Giro" line, so the ` +
    `pattern is visible without\nthe bank file MES dropped.\n`,
);
console.log(
  `  ${pad("Customer", 12)}${pad("Company", 32)}${rpad("GIRO fails", 12)}${rpad("Late fees", 11)}  Months`,
);
for (const d of p.defaulters.slice(0, 10)) {
  console.log(
    "  " +
      pad(d.customerCode, 12) +
      pad(d.companyName.slice(0, 30), 32) +
      rpad(d.failures, 12) +
      rpad(d.lateFees, 11) +
      "  " +
      d.months.join(" "),
  );
}

/* ------------------------------------------------------- 6. contact coverage */

rule("6.  CONTACT LIST  ·  who a bulk email can actually reach");

const c = p.contactCoverage;
console.log(`Accounts in the AR report      ${c.total}`);
console.log(`With an email address          ${c.withEmail}`);
console.log(`With none                      ${c.withoutEmail}`);
console.log(`Distinct addresses             ${c.addresses}`);
console.log(
  `Reachable                      ${((c.withEmail / c.total) * 100).toFixed(1)}%`,
);
console.log(
  "\nThis is a data gap, not a bug, and it is worse than a headcount suggests.\n" +
    "The contact list carries 49 companies with addresses. Only 5 of them are\n" +
    "in this AR export, because the two files are about different dormitories:\n" +
    "the addresses sit almost entirely against JPD tenants, while this export\n" +
    "is entirely Blue Stars. 44 of the 49 addressed companies do not appear\n" +
    "here at all, and 172 of the 190 accounts are on no list of any kind.\n" +
    "\nThe screens name the unreachable ones rather than quietly skipping them.",
);

/* -------------------------------------------------------- 7. the 7th, 21st */

rule("7.  THE 7th  ·  first reminder, bulk email (simulated)");

const sentOn = p.asOf ?? "2026-08-17";
const first = simulateSend(p.accounts, "first-reminder", sentOn, {
  minimumBalance: 0,
  skipTerminated: true,
});

console.log(`Letter               ${first.letterName}`);
console.log(`Dated                ${sentOn}`);
console.log(`Tenants in scope     ${first.messages.length}`);
console.log(`Would be sent        ${first.sendable.length}`);
console.log(`Blocked, no address  ${first.blocked.length}`);
console.log(`Distinct recipients  ${first.recipients}`);
console.log(`Balance chased       ${money(first.totalChased)}`);
console.log(`Real sending wired   ${CAN_SEND_FOR_REAL ? "YES" : "no — simulation only"}`);

head("One rendered letter, exactly as it would go out");
const sample = first.sendable[0];
if (sample) {
  console.log(`  To:      ${sample.to.join(", ")}`);
  console.log(`  Subject: ${sample.subject}`);
  console.log(`  Pay by:  ${sample.deadline}`);
  console.log("  " + "-".repeat(72));
  console.log(sample.body.split("\n").map((l) => `  | ${l}`).join("\n"));
}

head("Blocked — these need a phone call instead");
for (const b of first.blocked.slice(0, 6)) {
  console.log(
    `  ${pad(b.customerCode, 12)}${pad(b.companyName.slice(0, 34), 36)}${rpad(money(b.amount), 13)}  ${b.reason}`,
  );
}
if (first.blocked.length > 6) {
  console.log(`  ... and ${first.blocked.length - 6} more`);
}

rule("8.  THE 21st  ·  final notice (simulated)");

const finalSend = simulateSend(p.accounts, "final-notice", addDays(sentOn, 14), {
  minimumBalance: 0,
  skipTerminated: true,
});
console.log(`Letter               ${finalSend.letterName}`);
console.log(`Dated                ${finalSend.sentOn}`);
console.log(`Would be sent        ${finalSend.sendable.length}`);
console.log(`Blocked              ${finalSend.blocked.length}`);

head("The escalation, side by side");
const f1 = first.sendable[0];
const f2 = finalSend.messages.find((m) => m.accountId === f1?.accountId);
if (f1 && f2) {
  console.log(`  Same tenant: ${f1.companyName}`);
  console.log(`    7th : "${f1.subject}"  pay by ${f1.deadline}`);
  console.log(`    21st: "${f2.subject}"  pay by ${f2.deadline}`);
  const cites = f2.body.includes("Employment of Foreign Manpower");
  const threatens = f2.body.includes("disruption of our services");
  console.log(`    the final notice cites the EFMA regulations : ${cites}`);
  console.log(`    and raises disruption of services           : ${threatens}`);
  console.log(`    the first reminder does neither             : ${
    !f1.body.includes("Employment of Foreign Manpower") &&
    !f1.body.includes("disruption of our services")
  }`);
}

/* ------------------------------------------------------- 9. the RM emails */

rule("9.  ON DEMAND  ·  emailing a report to a relationship manager");

const rm = rmEmail("2611 Ray Ang", sentOn, addDays(sentOn, 7));
console.log(`  Subject:    ${rm.subject}`);
console.log(`  Attachment: ${rm.attachment}`);
console.log(rm.body.split("\n").map((l) => `  | ${l}`).join("\n"));

rule("SIMULATION COMPLETE — nothing was sent");
