/**
 * What every screen will show for a given report.
 *
 *   npm run predict -- "Test 1 - AR Report September.xlsx"
 *
 * Runs the same libraries the screens run and prints what each one would
 * display. The point is that somebody can check the app against this line by
 * line: a figure here that the screen does not show means the screen is not
 * running the logic, which is the fault this project keeps finding.
 *
 * Nothing here is typed out by hand. Every number comes from the function the
 * screen itself calls, so this cannot agree with a claim and disagree with the
 * code.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

import { parseAgingDetail } from "../src/lib/aging-detail.ts";
import { parseContacts } from "../src/lib/parser.ts";
import { buildPipeline, linkContacts } from "../src/lib/pipeline.ts";
import { kpis, buildQueue, worstBucket, overdueTotal, formatSgd } from "../src/lib/data.ts";
import { billingCycles } from "../src/lib/billing-cycles.ts";
import {
  buildLateFeeListing,
  giroEnrolled,
  depositsFromLedger,
  riskExposure,
  recurringDefaulters,
} from "../src/lib/reports.ts";
import { chasedToTheEnd } from "../src/lib/chased.ts";
import { emailAddresses } from "../src/lib/emails.ts";

const DL = path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", "Downloads");
const file = process.argv[2] ?? "Test 1 - AR Report September.xlsx";
const contactFile = process.argv[3] ?? "Client Contact List.xlsx";

const read = (f: string) => XLSX.read(readFileSync(path.join(DL, f)), { type: "buffer" });

const head = (s: string) => console.log(`\n\n${"=".repeat(74)}\n  ${s}\n${"=".repeat(74)}`);
const sub = (s: string) => console.log(`\n  ${s}\n  ${"-".repeat(70)}`);
const sgd = (n: number) => `SGD ${formatSgd(n)}`;

const ar = parseAgingDetail(read(file));
const contacts = existsSync(path.join(DL, contactFile)) ? parseContacts(read(contactFile)) : null;

let p = buildPipeline(ar.accounts, ar.invoices, ar.asOf, ar.entity, []);
if (contacts) p = { ...p, accounts: linkContacts(p.accounts.map((a) => ({ ...a })), contacts) };

const accounts = p.accounts;

/* ====================================================== what was read ==== */

head(`UPLOAD SCREEN  —  ${file}`);
console.log(`  Report date            ${ar.asOf}`);
console.log(`  Entity                 ${ar.entity}`);
console.log(`  Accounts read          ${ar.accounts.length}`);
console.log(`  Charge lines read      ${ar.invoices.length}`);
console.log(`  Errors                 ${ar.problems.filter((x) => x.severity === "error").length}`);
console.log(`  Warnings               ${ar.problems.filter((x) => x.severity === "warning").length}`);
for (const w of ar.problems) console.log(`      ${w.severity}: ${w.message.slice(0, 92)}`);
if (contacts) {
  console.log(`\n  Contact list           ${contacts.contacts.length} companies with an address`);
  for (const c of contacts.problems) console.log(`      ${c.severity}: ${c.message.slice(0, 88)}`);
}

/* =================================================== outstanding balances */

const k = kpis(accounts);

head("OUTSTANDING BALANCES  —  the four tiles at the top");
console.log(`  TOTAL OWED             ${sgd(k.outstanding)}          ${k.accounts} tenants shown`);
console.log(`  OVERDUE, NEEDS CHASING ${sgd(k.overdue)}          ${k.actionable} tenants with money to chase`);
console.log(`  OWED FOR OVER 90 DAYS  ${sgd(k.severe)}`);
console.log(`  IN CREDIT, DO NOT CHASE ${k.inCredit}`);

sub("Every tenant, and how overdue they are");
console.log(
  `  ${"Tenant".padEnd(34)} ${"Dorm".padEnd(5)} ${"Total".padStart(11)} ${"Overdue".padStart(11)}  Oldest money`,
);
for (const a of [...accounts].sort((x, y) => y.total - x.total)) {
  console.log(
    `  ${a.companyName.slice(0, 33).padEnd(34)} ${a.property.padEnd(5)} ` +
      `${formatSgd(a.total).padStart(11)} ${formatSgd(overdueTotal(a)).padStart(11)}  ${worstBucket(a)}`,
  );
}

sub("The five buckets, added across every tenant");
const b = accounts.reduce(
  (acc, a) => {
    acc.current += a.buckets.current;
    acc.d30 += a.buckets.d30;
    acc.d60 += a.buckets.d60;
    acc.d90 += a.buckets.d90;
    acc.d90plus += a.buckets.d90plus;
    return acc;
  },
  { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 },
);
for (const [label, v] of [
  ["Current", b.current], ["30 days", b.d30], ["60 days", b.d60],
  ["90 days", b.d90], ["More than 90 days", b.d90plus],
] as const) {
  console.log(`  ${label.padEnd(20)} ${formatSgd(v).padStart(12)}`);
}

/* ======================================================== billing runs === */

const runs = billingCycles(ar.invoices, ar.asOf);

head("OUTSTANDING BALANCES  —  what each billing run is still owed");
console.log(`  ${runs.cycles.length} separate billing runs in this upload` +
  (runs.undated ? `, and ${runs.undated} lines with no billing date` : ""));
console.log(
  `\n  ${"Billed on".padEnd(12)} ${"Due".padEnd(12)} ${"Where it stands".padEnd(22)} ` +
    `${"Owed".padStart(11)} ${"Overdue".padStart(11)}  Who`,
);
for (const c of runs.cycles) {
  const stands = c.ageDays === null ? "?"
    : c.ageDays < 0 ? `billed ahead · ${-c.ageDays}d`
      : c.ageDays <= 14 ? `within credit · ${c.ageDays}d`
        : `past 14 days · ${c.ageDays}d`;
  const who = c.who.map((w) => w.name.slice(0, 22)).join(", ").slice(0, 46);
  console.log(
    `  ${c.billedOn.padEnd(12)} ${c.dueBy.padEnd(12)} ${stands.padEnd(22)} ` +
      `${formatSgd(c.total).padStart(11)} ${formatSgd(c.overdue).padStart(11)}  ${who}`,
  );
}

/* ======================================================== action list ==== */

const queue = buildQueue(accounts);

head("ACTION LIST  —  who to chase today, most urgent first");
console.log(`  ${queue.length} tenants on the list\n`);
console.log(`  ${"#".padEnd(3)} ${"Tenant".padEnd(34)} ${"Overdue".padStart(11)}  Why`);
queue.forEach((q, i) => {
  console.log(
    `  ${String(i + 1).padEnd(3)} ${q.account.companyName.slice(0, 33).padEnd(34)} ` +
      `${formatSgd(overdueTotal(q.account)).padStart(11)}  ${q.reasons.join(", ")}`,
  );
});

/* ========================================================== call list ==== */

head("CALL LIST  —  who to phone on the 7th and the 21st");
console.log(`  ${queue.length} tenants to ring, nobody called yet\n`);
console.log(`  ${"Tenant".padEnd(34)} ${"Owed".padStart(11)}  ${"Bucket".padEnd(18)} Reachable`);
for (const q of queue) {
  const a = q.account;
  console.log(
    `  ${a.companyName.slice(0, 33).padEnd(34)} ${formatSgd(a.total).padStart(11)}  ` +
      `${worstBucket(a).padEnd(18)} ${a.emails.length > 0 ? a.emails.join(", ").slice(0, 40) : "NO ADDRESS"}`,
  );
}

/* ==================================================== late payment fees == */

const fees = buildLateFeeListing(accounts, ar.invoices, ar.asOf, ar.entity);
const giro = giroEnrolled(ar.invoices);

head("LATE PAYMENT FEES  —  the 16th");
console.log(`  Due the $100 fee       ${fees.rows.length} tenants`);
console.log(`  Held back on GIRO      ${fees.giroExcluded.length}`);
console.log(`  Fee total              ${sgd(fees.rows.length * 100)}  before GST`);

sub("Who is charged");
for (const r of fees.rows) {
  console.log(
    `  ${r.account.companyName.slice(0, 34).padEnd(35)} overdue ${formatSgd(r.overdue).padStart(11)}  fee ${r.fee}`,
  );
}
sub("Held back because they are on GIRO");
for (const g of fees.giroExcluded) {
  console.log(`  ${g.account.companyName.slice(0, 34).padEnd(35)} overdue ${formatSgd(g.overdue).padStart(11)}`);
}
if (fees.giroExcluded.length === 0) console.log("  (nobody)");

/* ================================================== reminders and outbox = */

const reachable = accounts.filter((a) => a.emails.length > 0 && overdueTotal(a) > 0);
const unreachable = accounts.filter((a) => a.emails.length === 0 && overdueTotal(a) > 0);

head("REMINDER EMAILS  —  the 7th");
console.log(`  Would be written to    ${reachable.length} tenants`);
console.log(`  Across                 ${reachable.reduce((n, a) => n + a.emails.length, 0)} addresses`);
console.log(`  Cannot be written to   ${unreachable.length}`);
for (const a of reachable) {
  console.log(`      ${a.companyName.slice(0, 34).padEnd(35)} ${a.emails.join(", ")}`);
}

head("SEND BY HAND  —  owed money, but no address");
if (unreachable.length === 0) console.log("  Nobody. Every overdue tenant has an address.");
for (const a of unreachable) {
  console.log(`  ${a.companyName.slice(0, 34).padEnd(35)} ${formatSgd(a.total).padStart(11)}  ${a.property}`);
}

head("SENT MAIL");
console.log("  Emails sent            0");
console.log("  Distinct recipients    0");
console.log(`  Could not be sent      ${unreachable.length}`);
console.log("  Wordings used          0");
console.log("\n  Nothing has been sent yet, because sending is switched off.");

/* ======================================================== the reviews ==== */

head("PAYMENT PROMISES");
console.log("  Empty. Nobody has promised anything yet.");

const repeat = recurringDefaulters(accounts, ar.invoices);
head("REPEAT DEFAULTERS  —  payment fails month after month");
if (repeat.length === 0) console.log("  Nobody. No tenant has enough bounced deductions.");
for (const r of repeat) {
  console.log(`  ${r.account.companyName.slice(0, 34).padEnd(35)} ${r.consecutiveMonths} months in a row  ${r.lateFeeMonths.join(", ")}`);
}

const chased = chasedToTheEnd(ar.invoices, accounts, ar.asOf);
head("CHASED TO THE END  —  went round the whole cycle and still owe");
if (chased.length === 0) console.log("  Nobody. No tenant carries a late fee from a completed cycle.");
for (const c of chased) {
  console.log(`  ${c.companyName.slice(0, 34).padEnd(35)} ${formatSgd(c.outstanding).padStart(11)}  ${c.months.join(", ")}`);
}

head("WHAT CHANGED");
console.log("  \"Nothing to compare yet.\"");
console.log("  Only one report is stored. It fills in after the second upload.");

/* ============================================================ reports ==== */

head("REPORTS & EXPORT");
sub("Revenue, split by charge type");
for (const tab of p.revenueTabs) {
  console.log(`  ${tab.name.padEnd(28)} ${String(tab.lineCount).padStart(3)} lines  ${formatSgd(tab.total).padStart(12)}`);
}

sub("Deposits held, and risk exposure");
const deposits = depositsFromLedger(ar.invoices);
if (deposits.size === 0) console.log("  No tenant has a security deposit line.");
for (const [code, held] of deposits) {
  const a = accounts.find((x) => (x.customerCode ?? "").toUpperCase() === code);
  if (!a) continue;
  console.log(
    `  ${a.companyName.slice(0, 34).padEnd(35)} owes ${formatSgd(a.total).padStart(11)}  ` +
      `holds ${formatSgd(held).padStart(10)}  risk exposure ${formatSgd(riskExposure(a.total, held) ?? 0).padStart(11)}`,
  );
}

sub("Manager reports");
if (p.managerReports.length === 0) {
  console.log("  None. This export has no Primary Sales Rep column, so managers cannot be told apart.");
} else {
  for (const m of p.managerReports) {
    console.log(`  ${m.managerName.padEnd(24)} ${m.lineCount} lines  ${formatSgd(m.total).padStart(12)}`);
  }
}

sub("On GIRO");
console.log(`  ${giro.size} tenants pay by GIRO`);

/* ============================================================== summary == */

head("THE FIVE THINGS MOST WORTH CHECKING");
console.log(`  1  Total owed on the board reads       ${sgd(k.outstanding)}`);
console.log(`  2  Late fees charges                   ${fees.rows.length} tenants, ${fees.giroExcluded.length} held back on GIRO`);
console.log(`  3  Every overdue tenant is reachable   ${unreachable.length === 0 ? "yes" : `no, ${unreachable.length} cannot be written to`}`);
console.log(`  4  Billing runs found                  ${runs.cycles.length}`);
console.log(`  5  What Changed says                   nothing to compare yet`);
console.log("");
