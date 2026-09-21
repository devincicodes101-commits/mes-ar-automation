/**
 * Store a report in the database without a browser.
 *
 *   npm run load:report -- "<AR file>" ["<contact list>"]
 *
 * The upload screen parses the workbook in the browser and posts the result to
 * /api/upload, which checks who is asking and then calls import_ar_report. The
 * parsing and the import are the same functions either way, so this runs them
 * directly with the service key and reaches exactly the same rows.
 *
 * It exists for one question: does the schedule send on its own? Answering
 * that means loading a report and then touching nothing, and a test whose
 * first step is "open the website and click upload" leaves the doubt that
 * something a person did is what made the letters go.
 *
 * What it deliberately does NOT do is send anything or run a day. It loads the
 * figures and stops. Everything after that has to happen by itself or not at
 * all.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

import { parseAgingDetail } from "../src/lib/aging-detail.ts";
import { parseContacts } from "../src/lib/parser.ts";
import { toImportPayload } from "../src/lib/to-database.ts";

const [arFile, contactFile] = process.argv.slice(2);

if (!arFile) {
  console.error("\n  Give it an AR report.\n");
  console.error('  npm run load:report -- "C:\\\\path\\\\to\\\\report.xlsx" ["contacts.xlsx"]\n');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("\n  NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n");
  process.exit(1);
}

const report = parseAgingDetail(XLSX.read(readFileSync(arFile), { cellDates: true }));

console.log(`\n  ${path.basename(arFile)}`);
console.log(`    as of ${report.asOf}   ${report.accounts.length} tenants   ${report.invoices.length} lines`);

let contacts = null;
if (contactFile) {
  const parsed = parseContacts(XLSX.read(readFileSync(contactFile), { cellDates: true }));
  contacts = parsed.contacts;
  console.log(`\n  ${path.basename(contactFile)}`);
  console.log(`    ${contacts.length} companies with an address`);
}

const { payload, problems } = toImportPayload(
  report.accounts,
  report.invoices,
  report.asOf,
  path.basename(arFile),
  contacts,
  false,
);

if (!payload) {
  console.error("\n  This report cannot be stored as it stands:\n");
  for (const p of problems) console.error(`    ${typeof p === "string" ? p : JSON.stringify(p)}`);
  console.error("");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await db.rpc("import_ar_report", payload);

if (error) {
  console.error(`\n  The database refused the import, so nothing was stored.`);
  console.error(`    ${error.message}\n`);
  process.exit(1);
}

console.log(`\n  stored: ${JSON.stringify(data)}`);
console.log(
  `    ${payload.p_tenants.length} tenants, ${payload.p_invoices.length} lines, ` +
    `${payload.p_contacts?.length ?? 0} contacts\n`,
);
console.log("  Nothing was sent and no day was run. That is for the schedule to do.\n");
