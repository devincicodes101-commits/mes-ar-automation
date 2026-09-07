/**
 * If MES send the Finance AR Download instead, does everything work?
 *
 *   npm run compare
 *
 * Runs the identical pipeline over both exports and reports, feature by
 * feature, what each one can and cannot produce. Written because we had
 * assumed which file was the monthly input, and the answer changes which
 * columns we have to ask for.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { parseAgingDetail } from "../src/lib/aging-detail.ts";
import { parseContacts } from "../src/lib/parser.ts";
import {
  REVENUE_TABS,
  buildLateFeeListing,
  buildRevenueTab,
  buildManagerReports,
  giroEnrolled,
  recurringDefaulters,
} from "../src/lib/reports.ts";
import { matchRule } from "../src/lib/revenue-rules.ts";
import { simulateSend } from "../src/lib/outbox.ts";
import { linkContacts } from "../src/lib/pipeline.ts";
import type { Account } from "../src/lib/types.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const F = path.join(ROOT, "AR Automation-20260903T201835Z-1-001", "AR Automation");
const CONTACTS = path.join(F, "4. Client Contact List", "R1 - 20260511.xlsx");

const contacts = existsSync(CONTACTS)
  ? parseContacts(XLSX.read(readFileSync(CONTACTS), { cellDates: true }))
  : null;

interface Row {
  feature: string;
  detail: (r: ReturnType<typeof assess>) => string;
}

function assess(file: string, sheetHint: string) {
  const wb = XLSX.read(readFileSync(file), { cellDates: true });
  const p = parseAgingDetail(wb);
  const accounts = linkContacts(p.accounts, contacts);

  const tabs = REVENUE_TABS.map((s) => buildRevenueTab(s, p.invoices, p.asOf, p.entity));
  const managers = buildManagerReports(accounts, p.asOf, p.entity);
  const lateFees = buildLateFeeListing(accounts, p.invoices, p.asOf, p.entity);
  const send = simulateSend(accounts, "first-reminder", p.asOf ?? "2026-08-17", {
    skipTerminated: true,
  });

  const hasCategory = p.invoices.filter((i) => i.category !== "").length;
  const unmatched = p.invoices.filter(
    (i) => matchRule(i.description, i.documentNumber, i.category) === null,
  ).length;
  const withBalance = p.invoices.filter((i) => i.openBalance !== 0).length;
  const total = accounts.reduce((n, a) => n + a.total, 0);
  const withRep = accounts.filter((a) => (a as Account & { rm?: string }).rm).length;
  const withInd = accounts.filter((a) => a.industry).length;
  const terminated = accounts.filter((a) => a.status === "Terminated").length;

  return {
    sheetHint, p, accounts, tabs, managers, lateFees, send,
    hasCategory, unmatched, withBalance, total, withRep, withInd, terminated,
    giro: giroEnrolled(p.invoices).size,
    defaulters: recurringDefaulters(p.invoices, accounts).length,
    oneFm: p.invoices.filter((i) => i.isOneFm).length,
    withEmail: accounts.filter((a) => a.emails.length > 0).length,
  };
}

const A = assess(path.join(F, "3. CustomA_RAgingDetail-WithDescription.xlsx"), "Custom A/R Aging Detail");
const B = assess(path.join(F, "Detailed AR report(Final).xlsx"), "Finance AR Download");

const money = (n: number) =>
  "$" + n.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ROWS: Row[] = [
  { feature: "Invoice lines read", detail: (r) => String(r.p.invoices.length) },
  { feature: "Accounts built", detail: (r) => String(r.accounts.length) },
  { feature: "Lines carrying an amount", detail: (r) => `${r.withBalance} of ${r.p.invoices.length}` },
  { feature: "Total outstanding", detail: (r) => money(r.total) },
  { feature: "Parse errors", detail: (r) => String(r.p.problems.filter((q) => q.severity === "error").length) },
  { feature: "-", detail: () => "" },
  { feature: "Aging buckets", detail: (r) => (r.p.invoices.some((i) => i.age !== null) ? "works" : "NO Age column") },
  { feature: "Categories column present", detail: (r) => (r.hasCategory > 0 ? `yes, ${r.hasCategory} lines` : "NO") },
  { feature: "Lines no rule could classify", detail: (r) => String(r.unmatched) },
  { feature: "1FM lines found", detail: (r) => String(r.oneFm) },
  { feature: "-", detail: () => "" },
  { feature: "Accounts with a Sales Rep", detail: (r) => (r.withRep ? String(r.withRep) : "NONE") },
  { feature: "Manager reports built", detail: (r) => (r.managers.length ? String(r.managers.length) : "0 — BLOCKED") },
  { feature: "Accounts with an Industry", detail: (r) => (r.withInd ? String(r.withInd) : "NONE") },
  { feature: "Accounts marked Terminated", detail: (r) => (r.terminated ? String(r.terminated) : "none — no Status column") },
  { feature: "-", detail: () => "" },
  { feature: "GIRO tenants identified", detail: (r) => String(r.giro) },
  { feature: "Late-fee listing", detail: (r) => `${r.lateFees.rows.length} to charge, ${r.lateFees.giroExcluded.length} excluded` },
  { feature: "Recurring defaulters", detail: (r) => String(r.defaulters) },
  { feature: "-", detail: () => "" },
  { feature: "Reminders sendable", detail: (r) => `${r.send.sendable.length} of ${r.send.messages.length}` },
];

console.log("\n" + "=".repeat(88));
console.log("  IF MES UPLOAD THE FINANCE AR DOWNLOAD INSTEAD — WHAT WORKS?");
console.log("=".repeat(88) + "\n");
console.log(
  "  " + "".padEnd(34) + "Custom A/R Aging Detail".padEnd(28) + "Finance AR Download",
);
console.log("  " + "-".repeat(84));
for (const row of ROWS) {
  if (row.feature === "-") {
    console.log("");
    continue;
  }
  console.log("  " + row.feature.padEnd(34) + row.detail(A).padEnd(28) + row.detail(B));
}

console.log("\n  per-report line counts");
console.log("  " + "-".repeat(84));
for (let i = 0; i < A.tabs.length; i += 1) {
  console.log(
    "  " +
      A.tabs[i].name.padEnd(34) +
      String(A.tabs[i].lineCount).padEnd(28) +
      String(B.tabs[i].lineCount),
  );
}
console.log("  " + "RM — clients by dorm".padEnd(34) +
  (A.managers.length ? String(A.managers.length) : "0 — blocked").padEnd(28) +
  (B.managers.length ? `${B.managers.length} managers` : "0 — blocked"));

console.log("\n" + "=".repeat(88));
console.log("  VERDICT");
console.log("=".repeat(88));
const bAmounts = B.withBalance / Math.max(B.p.invoices.length, 1);
console.log(`
  Finance AR Download FIXES:
    Primary Sales Rep    ${B.withRep > 0 ? "yes — " + B.managers.length + " manager reports build" : "no"}
    Industry Type        ${B.withInd > 0 ? "yes — " + B.withInd + " accounts carry a trade" : "no"}
    Classification       ${B.unmatched === 0 ? "yes — every line classified with no Categories column" : B.unmatched + " unclassified"}

  Finance AR Download DOES NOT FIX:
    Amounts              ${(bAmounts * 100).toFixed(1)}% of lines carry an Open Balance
    Status               ${B.terminated === 0 ? "still absent — no Live/Terminated anywhere" : "present"}
    Deposit held         still absent
    Risk Exposure        still undefined
    Tenant emails        ${B.withEmail} of ${B.accounts.length} accounts reachable
`);
