/**
 * Reads an AR report and puts it in the database.
 *
 *   node scripts/import-report.mjs <path to .xlsx> [--dry]
 *
 * The same path an upload takes, without the browser: parse, map, call
 * import_ar_report, read it back. It exists so the chain can be proved on a
 * real file before any screen depends on it, and so a report can be loaded
 * from a terminal when something has gone wrong with the app.
 *
 * --dry maps and reports without writing, which is how to see what a file
 * would do before it does it.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const file = args.find((a) => !a.startsWith("--"));

if (!file) {
  console.error("Usage: node scripts/import-report.mjs <report.xlsx> [--dry]");
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error(`No such file: ${file}`);
  process.exit(1);
}

/* The parser and the mapper are TypeScript, so they are loaded the same way
 * the other scripts load them: node's type stripping, via a dynamic import. */
const XLSX = await import("xlsx");
const { parseAgingDetail } = await import(
  pathToFileURL(path.resolve("src/lib/aging-detail.ts")).href
);
const { toImportPayload } = await import(
  pathToFileURL(path.resolve("src/lib/to-database.ts")).href
);

const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

/* ------------------------------------------------------------------ read */

const parsed = parseAgingDetail(
  XLSX.read(fs.readFileSync(file), { type: "buffer" }),
);

console.log(`\n${path.basename(file)}`);
console.log(`  report date   ${parsed.asOf ?? "(none)"}`);
console.log(`  entity        ${parsed.entity ?? "(none)"}`);
console.log(`  accounts      ${parsed.accounts.length}`);
console.log(`  charge lines  ${parsed.invoices.length}`);

const errors = parsed.problems.filter((p) => p.severity === "error");
const warnings = parsed.problems.filter((p) => p.severity === "warning");
if (errors.length) {
  console.log(`\n  ${errors.length} error(s) reading the file:`);
  for (const e of errors) console.log(`    ${e.message.slice(0, 150)}`);
  process.exit(1);
}
if (warnings.length) {
  console.log(`\n  ${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`    ${w.message.slice(0, 150)}`);
}

/* ------------------------------------------------------------------- map */

const { payload, problems } = toImportPayload(
  parsed.accounts,
  parsed.invoices,
  parsed.asOf,
  path.basename(file),
);

if (!payload) {
  console.log(`\n  This report cannot be stored as it stands:\n`);
  for (const p of problems) console.log(`    ${p.what}\n      ${p.detail}`);
  process.exit(1);
}

console.log(`\n  maps to ${payload.p_tenants.length} tenants, ` +
  `${payload.p_snapshots.length} snapshots, ${payload.p_invoices.length} lines`);
console.log(`  period ${payload.p_period}`);

if (dry) {
  console.log("\n  --dry, so nothing was written.\n");
  process.exit(0);
}

/* ----------------------------------------------------------------- store */

const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const before = await countRows(payload.p_report_date);

const r = await fetch(`${BASE}/rest/v1/rpc/import_ar_report`, {
  method: "POST",
  headers: H,
  body: JSON.stringify(payload),
});
const text = await r.text();

if (!r.ok) {
  console.log(`\n  The database refused it (${r.status}). Nothing was stored.`);
  console.log(`  ${text.slice(0, 300)}\n`);
  process.exit(1);
}

console.log(`\n  stored: ${text}`);

/* --------------------------------------------------------- read it back */

const after = await countRows(payload.p_report_date);

console.log("\nREAD BACK FROM THE DATABASE");
console.log(`  snapshots on ${payload.p_report_date}  ${before.snapshots} -> ${after.snapshots}`);
console.log(`  lines on that date                     ${before.lines} -> ${after.lines}`);
console.log(`  tenants in total                       ${before.tenants} -> ${after.tenants}`);
console.log(`  total owed on that date                ${after.total.toFixed(2)}`);

const expected = payload.p_snapshots.reduce((s, x) => s + Number(x.total), 0);
const agrees = Math.abs(expected - after.total) < 0.01;
console.log(`  the file said                          ${expected.toFixed(2)}`);
console.log(`  ${agrees ? "they agree" : "THEY DISAGREE"}\n`);
process.exit(agrees ? 0 : 1);

async function countRows(reportDate) {
  const n = async (q) => {
    const res = await fetch(`${BASE}/rest/v1/${q}`, {
      headers: { ...H, Prefer: "count=exact" },
    });
    return Number((res.headers.get("content-range") ?? "0-0/0").split("/")[1]);
  };
  const snaps = await (
    await fetch(
      `${BASE}/rest/v1/account_snapshots?report_date=eq.${reportDate}&select=total`,
      { headers: H },
    )
  ).json();
  return {
    snapshots: snaps.length,
    total: snaps.reduce((s, x) => s + Number(x.total), 0),
    lines: await n(
      `invoices?select=id&limit=1&snapshot_id=not.is.null&period=eq.${reportDate.slice(0, 8)}01`,
    ),
    tenants: await n("tenants?select=id&limit=1"),
  };
}
