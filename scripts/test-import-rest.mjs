/**
 * Importing a report must never destroy what somebody did.
 *
 *   npm run test:import:rest
 *
 * The same guarantee scripts/test-import.mjs asserts, reached a different way.
 * That one opens a direct Postgres connection with SUPABASE_DB_PASSWORD, wraps
 * everything in a transaction and rolls it back. It has never run, because the
 * password in .env.local is rejected and cannot currently be changed.
 *
 * This one goes through PostgREST with the service role key, which does work.
 * The difference matters in one respect and it is worth being honest about it:
 * every call is its own transaction, so nothing can be rolled back. The test
 * therefore writes real rows and deletes them afterwards, and the last thing it
 * does is check they are gone.
 *
 * Everything it writes is fenced off from real data twice over. Tenant ids are
 * prefixed `zz-test-`, and the report dates are in 1999, which is twenty-seven
 * years before MES's oldest line. The import function's own deletes are scoped
 * to a report date, so a 1999 import cannot reach a 2026 one.
 *
 * What is being proved, in MES's terms: they upload three or more times a
 * month. Balances are meant to be replaced by that. Phone calls, promises,
 * emails and fees are not. Losing a call raises no error and looks like
 * nothing, so the guarantee is asserted rather than read out of the SQL.
 */
import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!BASE || !KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed.");
  process.exit(1);
}

const H = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

let failures = 0;
const ok = (name, condition) => {
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${name}`);
  if (!condition) failures += 1;
};

async function rest(path, init = {}) {
  const r = await fetch(`${BASE}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${path} :: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

const get = (path) => rest(path);
const del = (path) => rest(path, { method: "DELETE" });
const rpc = (fn, args) =>
  rest(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });

/* ------------------------------------------------------------- the fixture */

const PREFIX = "zz-test-";
const DATES = ["1999-01-04", "1999-01-07", "1999-01-16"];
const PERIOD = "1999-01-01";

/** Two tenants, so the test can tell "replaced" from "deleted everything". */
const tenants = [
  {
    id: `${PREFIX}alpha`,
    customer_code: "ZZ-TEST-1",
    company_name: "ZZ TEST ALPHA PTE LTD",
    property_code: "BSD",
    industry: "Testing",
    entity: "ZZ Test Entity",
  },
  {
    id: `${PREFIX}beta`,
    customer_code: "ZZ-TEST-2",
    company_name: "ZZ TEST BETA PTE LTD",
    property_code: "JPD1",
    industry: "Testing",
    entity: "ZZ Test Entity",
  },
];

const snapshotsFor = (reportDate, total) =>
  tenants.map((t) => ({
    tenant_id: t.id,
    report_date: reportDate,
    period: PERIOD,
    status: "live",
    bucket_current: 0,
    bucket_30: total,
    bucket_60: 0,
    bucket_90: 0,
    bucket_90_plus: 0,
    total,
    is_onefm: false,
    late_fee_count: 0,
  }));

const invoicesFor = (reportDate, amount) =>
  tenants.map((t, n) => ({
    // Required. The function links each line to its snapshot by looking one up
    // for this tenant and report date, so a line without it lands with a null
    // snapshot_id, survives every later delete, and quietly accumulates.
    tenant_id: t.id,
    period: PERIOD,
    transaction_type: "Invoice",
    document_number: `ZZTEST/${reportDate}/${n}`,
    issued_on: reportDate,
    due_on: reportDate,
    age_days: 20,
    bucket: "30 days",
    description: "ZZ test occupancy fee",
    revenue_type: "Occupancy Fee",
    is_onefm: false,
    open_balance: amount,
  }));

async function importOne(reportDate, amount) {
  return rpc("import_ar_report", {
    p_report_date: reportDate,
    p_period: PERIOD,
    p_tenants: tenants,
    p_snapshots: snapshotsFor(reportDate, amount),
    p_invoices: invoicesFor(reportDate, amount),
    p_ar_filename: `zz-test ${reportDate}`,
  });
}

/* ------------------------------------------------------------------ clean */

/**
 * Removes everything this test wrote, and nothing else.
 *
 * Runs before the test as well as after it, so a run that died halfway through
 * last time cannot make this one fail for the wrong reason.
 */
const ALL_DATES = [...DATES, "1999-01-21"];

async function clean() {
  for (const d of ALL_DATES) await del(`uploads?report_date=eq.${d}`);
  await del(`uploads?ar_filename=eq.connectivity%20probe`);
  // Belt and braces: a line whose snapshot link is null is reachable by
  // neither the upload cascade nor the snapshot cascade.
  await del(`invoices?document_number=like.ZZTEST*`);
  await del(`account_snapshots?tenant_id=like.${PREFIX}*`);
  await del(`calls?tenant_id=like.${PREFIX}*`);
  await del(`promises?tenant_id=like.${PREFIX}*`);
  await del(`emails_sent?tenant_id=like.${PREFIX}*`);
  await del(`late_fees?tenant_id=like.${PREFIX}*`);
  await del(`tenants?id=like.${PREFIX}*`);
}

/* ------------------------------------------------------------------- run */

console.log("\nImporting a report must never destroy what somebody did\n");

await clean();

// Three uploads, the way MES actually work: the 4th, the 7th and the 16th.
await importOne(DATES[0], 1000);
await importOne(DATES[1], 1000);
await importOne(DATES[2], 1000);

const snapshots = await get(
  `account_snapshots?tenant_id=like.${PREFIX}*&select=report_date,total`,
);
ok(
  `all three report dates are kept (${snapshots.length} snapshots for 2 tenants)`,
  snapshots.length === 6,
);

/*
 * The officer's work, logged between uploads. This is what the whole test is
 * about: MES upload three times a month, and a phone call logged on the 7th
 * has to still be there on the 16th.
 */
const tenantId = tenants[0].id;
await rest("calls", {
  method: "POST",
  body: JSON.stringify({
    tenant_id: tenantId,
    period: PERIOD,
    called_at: `${DATES[1]}T09:00:00Z`,
    outcome: "promised_to_pay",
    notes: "zz test call, must survive the next import",
  }),
});
await rest("promises", {
  method: "POST",
  body: JSON.stringify({
    tenant_id: tenantId,
    amount: 1000,
    promised_for: "1999-02-01",
    source: "call",
  }),
});

const callsBefore = await get(`calls?tenant_id=eq.${tenantId}&select=id`);
const promisesBefore = await get(`promises?tenant_id=eq.${tenantId}&select=id`);
ok("a call and a promise were logged against the tenant",
   callsBefore.length === 1 && promisesBefore.length === 1);

// Two more imports on top, one of them replacing a date already loaded.
await importOne(DATES[2], 400);
await importOne("1999-01-21", 400);

const callsAfter = await get(`calls?tenant_id=eq.${tenantId}&select=id`);
const promisesAfter = await get(`promises?tenant_id=eq.${tenantId}&select=id`);
ok("every call survived two more uploads", callsAfter.length === 1);
ok("and so did the promise", promisesAfter.length === 1);

// Re-importing a date replaces that date. It must not stack up, and it must
// not take the other dates with it.
const afterReplace = await get(
  `account_snapshots?tenant_id=like.${PREFIX}*&select=report_date,total&order=report_date`,
);
const dates = [...new Set(afterReplace.map((s) => s.report_date))];
ok(`re-uploading a date replaced it rather than stacking (${dates.length} dates, not 5)`,
   dates.length === 4);

const replaced = afterReplace.filter((s) => s.report_date === DATES[2]);
ok(`the replaced date carries the new figures (${replaced.map((r) => r.total).join(", ")})`,
   replaced.length === 2 && replaced.every((r) => Number(r.total) === 400));

const untouched = afterReplace.filter((s) => s.report_date === DATES[0]);
ok(`an earlier date was left alone (${untouched.map((r) => r.total).join(", ")})`,
   untouched.length === 2 && untouched.every((r) => Number(r.total) === 1000));

const invoices = await get(
  `invoices?document_number=like.ZZTEST/*&select=document_number`,
);
ok(`invoice lines were replaced too, not stacked up (${invoices.length})`,
   invoices.length === 8);

// Tenants are upserted, never duplicated, however many times they appear.
const tenantRows = await get(`tenants?id=like.${PREFIX}*&select=id`);
ok(`five imports produced two tenants, not ten (${tenantRows.length})`,
   tenantRows.length === 2);

/* ---------------------------------------------------------------- tidy up */

await clean();

const leftover = {
  tenants: (await get(`tenants?id=like.${PREFIX}*&select=id`)).length,
  snapshots: (await get(`account_snapshots?tenant_id=like.${PREFIX}*&select=id`)).length,
  calls: (await get(`calls?tenant_id=like.${PREFIX}*&select=id`)).length,
};
ok(`nothing this test wrote is left behind (${JSON.stringify(leftover)})`,
   Object.values(leftover).every((n) => n === 0));

console.log(failures === 0 ? "\nALL CHECKS PASS\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
