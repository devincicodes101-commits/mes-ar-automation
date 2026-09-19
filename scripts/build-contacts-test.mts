/**
 * A contact list for the test reports, addressed to the tester.
 *
 *   npm run build:contacts:test
 *
 * Every tenant in Test 1 points at a mailbox the tester owns, so a reminder
 * run can be watched end to end without a single real tenant hearing from it.
 *
 * ---------------------------------------------------------------------------
 * This is a test fixture and is named like one
 *
 * The file it produces says so in its own name and in its first row, because
 * the one thing that must never happen is somebody uploading this over MES's
 * real contact list and quietly redirecting every reminder to a personal Gmail
 * account. Contacts are stored by customer code and survive later uploads, so
 * that mistake would not correct itself the next month: it would sit there
 * until a tenant complained about not being chased.
 *
 * The sending gate is the real protection. MAIL_MODE is "off", and when it is
 * turned on it should go to "allowed" with exactly these addresses on the
 * list, so anything addressed anywhere else is refused rather than sent.
 * ---------------------------------------------------------------------------
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

const OUT = path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", "Downloads");

/*
 * The tester's own mailboxes.
 *
 * The third was given as "iyusrakhan03" with no domain. Completed to gmail.com
 * because the other two are Gmail and no other reading is plausible, but it is
 * a guess and it is flagged rather than buried: if it is wrong, that tenant's
 * reminder goes nowhere and the run looks like it worked.
 */
const IYUSRAK = "iyusrak@gmail.com";
const DEVINCI = "devincicodes101@gmail.com";
const KHAN03 = "iyusrakhan03@gmail.com"; // assumed domain

/*
 * The four tenants in Test 1, and only those. A contact for a tenant who is
 * not in the report is not wrong, but it is noise in a file whose whole
 * purpose is to make one report's reminders observable.
 *
 * Merlion carries two addresses deliberately. MES's real list has a tenant
 * with two, the parser splits on the semicolon, and a path that is only ever
 * exercised by real data is a path that breaks in front of the client.
 */
const ROWS: { code: string; name: string; status: "Live" | "Terminated"; emails: string[] }[] = [
  { code: "DORM-101", name: "HARBOURFRONT MARINE PTE. LTD.", status: "Live", emails: [IYUSRAK] },
  { code: "DORM-102", name: "KEPPEL STEEL WORKS PTE. LTD.", status: "Live", emails: [DEVINCI] },
  { code: "DORM-201", name: "BLUE HORIZON LOGISTICS PTE. LTD.", status: "Live", emails: [KHAN03] },
  {
    code: "DORM-204",
    name: "MERLION FOOD PROCESSING PTE. LTD.",
    status: "Live",
    emails: [IYUSRAK, DEVINCI],
  },
  /*
   * Changi only appears in Test 2, and is included so the same file serves
   * both reports. A tenant with no charges is simply never written to.
   */
  { code: "DORM-205", name: "CHANGI MARINE SUPPLY PTE. LTD.", status: "Live", emails: [DEVINCI] },
  /*
   * Sentosa arrives in December with no history at all, so they are the one
   * tenant who can be taken round the whole cycle in front of somebody. They
   * need an address or they go to the call list instead, which is a different
   * demonstration.
   */
  { code: "DORM-309", name: "SENTOSA COLD STORAGE PTE. LTD.", status: "Live", emails: [IYUSRAK] },
  /*
   * Tuas is deliberately left out. They arrive already carrying three of MES's
   * own late payment fees and no address, which is how a real tenant reaches
   * Send By Hand and the call list rather than the email run.
   */
];

/* The layout MES send: the header on the third row, the code and the name
   joined in the first column, addresses separated by a semicolon. */
const rows: unknown[][] = [
  ["As of 2026-09-30  —  TEST FILE, addresses belong to the tester", "", "", ""],
  ["", "", "", ""],
  ["Company Name", "Status", "Company Name", "Email Address"],
];

for (const r of ROWS) {
  rows.push([`${r.code} ${r.name}`, r.status, r.name, r.emails.join("; ")]);
}

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Total");

const name = "Test 1 - Client Contact List (TEST ADDRESSES).xlsx";
const file = path.join(OUT, name);
writeFileSync(file, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

console.log(`\n  ${file}\n`);
for (const r of ROWS) {
  console.log(`  ${r.code}  ${r.name.padEnd(34)} ${r.emails.join(", ")}`);
}
console.log(
  `\n  ${ROWS.length} tenants, ${new Set(ROWS.flatMap((r) => r.emails)).size} distinct addresses.`,
);
console.log("  Every one of them is the tester's. No real tenant is in this file.\n");
