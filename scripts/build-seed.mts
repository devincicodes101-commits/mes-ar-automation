/**
 * Regenerates src/lib/mock/arData.json from MES's September folder.
 *
 *   npm run seed
 *
 * This is what every screen shows before anybody uploads anything. It used to
 * be built from the June pair (AR Report.xlsx + AR reports-Final.xlsx), which
 * meant the app opened on 53 accounts dated 25 May while the export MES
 * actually send now has 190 dated 17 August. Same shape, different decade of
 * the project.
 *
 * Kept as a generator rather than a hand-edited file so the seed can never
 * drift from the parser: if the parser changes, re-run this.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { parseAgingDetail } from "../src/lib/aging-detail.ts";
import { parseContacts } from "../src/lib/parser.ts";
import type { Account } from "../src/lib/types.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const FOLDER = path.join(ROOT, "AR Automation-20260903T201835Z-1-001", "AR Automation");
const AGING = path.join(FOLDER, "3. CustomA_RAgingDetail-WithDescription.xlsx");
const CONTACTS = path.join(FOLDER, "4. Client Contact List", "R1 - 20260511.xlsx");
const OUT = path.join(ROOT, "src", "lib", "mock", "arData.json");

if (!existsSync(AGING)) {
  console.error(`Cannot find MES's export at\n  ${AGING}`);
  process.exit(1);
}

const parsed = parseAgingDetail(XLSX.read(readFileSync(AGING), { cellDates: true }));
const contacts = existsSync(CONTACTS)
  ? parseContacts(XLSX.read(readFileSync(CONTACTS), { cellDates: true }))
  : null;

const accounts: Account[] = parsed.accounts.map((a) => ({ ...a }));

if (contacts) {
  const byCode = new Map(
    contacts.contacts.map((c) => [c.customerCode.toUpperCase(), c.emails]),
  );
  for (const a of accounts) {
    const found = byCode.get(a.customerCode.toUpperCase());
    if (!found || found.length === 0) continue;
    a.emails = Array.from(new Set([...a.emails, ...found]));
    a.hasContact = true;
  }
}

const invoices = parsed.invoices.map((i, n) => ({
  id: `inv-${n + 1}`,
  companyName: i.companyName,
  transactionType: i.transactionType,
  date: i.date,
  dueDate: i.dueDate,
  description: i.description,
  documentNumber: i.documentNumber,
  linkedContract: i.linkedContract,
  age: i.age,
  bucket: i.bucket,
  openBalance: i.openBalance,
  revenueType: i.revenueType,
  isOneFm: i.isOneFm,
}));

const managers = Array.from(
  new Set(
    accounts
      .map((a) => (a as Account & { rm?: string }).rm)
      .filter((r): r is string => Boolean(r)),
  ),
)
  .sort()
  .map((name) => ({ key: name, name }));

const data = {
  generatedFrom: [
    "3. CustomA_RAgingDetail-WithDescription.xlsx",
    "R1 - 20260511.xlsx",
  ],
  asOfSummary: parsed.asOf,
  asOfDetail: parsed.asOf,
  properties: [
    { code: "JPD1", name: "Jurong Penjuru Dormitory 1" },
    { code: "JPD2", name: "Jurong Penjuru Dormitory 2" },
    { code: "BSD", name: "Blue Stars Dormitory" },
    { code: "LEO", name: "The Leo" },
  ],
  accounts,
  invoices,
  contacts: (contacts?.contacts ?? []).map((c) => ({
    companyName: c.companyName,
    emails: c.emails,
  })),
  // Not in this export: it carries no End User: Industry Type column. The
  // industry report stays empty until MES add it to the saved search.
  industries: [],
  managers,
};

writeFileSync(OUT, JSON.stringify(data), "utf8");

const total = accounts.reduce((n, a) => n + a.total, 0);
const size = readFileSync(OUT).length;
console.log(`wrote ${path.relative(ROOT, OUT)}  (${(size / 1024).toFixed(0)} kB)`);
console.log(`  as of      ${parsed.asOf}`);
console.log(`  entity     ${parsed.entity}`);
console.log(`  accounts   ${accounts.length}`);
console.log(`  invoices   ${invoices.length}`);
console.log(`  with email ${accounts.filter((a) => a.emails.length > 0).length}`);
console.log(`  total      $${total.toLocaleString("en-SG", { minimumFractionDigits: 2 })}`);
