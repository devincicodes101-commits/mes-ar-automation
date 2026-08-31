/**
 * Importing a report must never destroy what somebody did.
 *
 *   npm run test:import
 *
 * MES upload the AR report three or more times a month. Balances are supposed
 * to be replaced by that; phone calls, promises, emails and fees are not.
 *
 * Losing a call produces no error. The screen looks fine, the numbers look
 * fine, and the only sign is that a note somebody typed six weeks ago is not
 * there any more. It would take months to notice. So the guarantee is
 * asserted here rather than assumed from reading the SQL.
 *
 * Runs inside a transaction that is rolled back, so the database is exactly
 * as it was afterwards.
 */
import fs from "node:fs";
import pg from "pg";

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

const c = new pg.Client({
  host: "aws-0-ap-southeast-1.pooler.supabase.com",
  port: 5432,
  user: "postgres." + env.SUPABASE_PROJECT_REF,
  password: env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});

let fail = 0;
const ok = (name, cond) => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) fail += 1;
};

const tenant = (id, code, name, property) => ({
  id,
  customer_code: code,
  company_name: name,
  property_code: property,
  industry: null,
  entity: null,
  first_seen: null,
  last_seen: null,
  giro: "unknown",
  created_at: null,
});

const snapshot = (id, total) => ({
  tenant_id: id,
  report_date: null,
  period: null,
  status: "live",
  bucket_current: total,
  bucket_30: 0,
  bucket_60: 0,
  bucket_90: 0,
  bucket_90_plus: 0,
  total,
  is_onefm: false,
  late_fee_count: 0,
  legacy_note: null,
});

const invoice = (id, amount, desc) => ({
  tenant_id: id,
  transaction_type: "Invoice",
  document_number: "JPD1-786/000001",
  linked_contract: null,
  issued_on: "2026-08-01",
  due_on: "2026-08-15",
  age_days: 10,
  bucket: "Current",
  description: desc,
  revenue_type: "Occupancy Fee",
  is_onefm: false,
  open_balance: amount,
});

async function importReport(date, tenants, snapshots, invoices) {
  const { rows } = await c.query(
    "select import_ar_report($1::date, $2::date, $3::jsonb, $4::jsonb, $5::jsonb, $6) as r",
    [
      date,
      date.slice(0, 7) + "-01",
      JSON.stringify(tenants),
      JSON.stringify(snapshots),
      JSON.stringify(invoices),
      "test.xlsx",
    ],
  );
  return rows[0].r;
}

await c.connect();
await c.query("begin");

const T = "dorm-9001-jpd1";
const tenants = [tenant(T, "DORM-9001", "TEST TENANT PTE. LTD.", "JPD1")];

/* ------------------------------------------------ the officer does her work */
await importReport("2026-08-04", tenants, [snapshot(T, 1000)], [invoice(T, 1000, "August rent")]);

await c.query(
  `insert into calls (tenant_id, period, called_at, reached, outcome, notes)
   values ($1,'2026-08-01','2026-08-07','Mrs Tan','promised_to_pay','pay by the 29th')`,
  [T],
);
await c.query(
  `insert into promises (tenant_id, amount, promised_for)
   values ($1,1000,'2026-08-29')`,
  [T],
);
await c.query(
  `insert into emails_sent (tenant_id, template_id, template_name, subject, recipients)
   values ($1,'reminder-7th','First reminder','Outstanding rental payment', array['a@b.com'])`,
  [T],
);
await c.query(
  `insert into late_fees (tenant_id, period, basis, rule_value, amount)
   values ($1,'2026-08-01','flat',100,100)`,
  [T],
);

const work = async () => {
  const q = async (t) =>
    (await c.query(`select count(*)::int n from ${t} where tenant_id=$1`, [T]))
      .rows[0].n;
  return {
    calls: await q("calls"),
    promises: await q("promises"),
    emails: await q("emails_sent"),
    fees: await q("late_fees"),
  };
};

const before = await work();
ok(
  `her work is recorded (${before.calls} call, ${before.promises} promise, ${before.emails} email, ${before.fees} fee)`,
  before.calls === 1 && before.promises === 1 && before.emails === 1 && before.fees === 1,
);

/* --------------------------------------------- then MES upload twice more */
await importReport("2026-08-07", tenants, [snapshot(T, 1200)], [invoice(T, 1200, "August rent")]);
await importReport("2026-08-16", tenants, [snapshot(T, 1400)], [invoice(T, 1400, "August rent")]);

const after = await work();
ok(
  "every call, promise, email and fee survived two more uploads",
  after.calls === before.calls &&
    after.promises === before.promises &&
    after.emails === before.emails &&
    after.fees === before.fees,
);

const snaps = (
  await c.query(
    "select count(*)::int n from account_snapshots where tenant_id=$1",
    [T],
  )
).rows[0].n;
ok(`all three report dates are kept (${snaps} snapshots)`, snaps === 3);

const latest = (
  await c.query("select total from current_accounts where tenant_id=$1", [T])
).rows[0];
ok(
  `the balance moved to the newest report (${latest && latest.total})`,
  latest && Number(latest.total) === 1400,
);

/* ------------------------------- re-uploading a date replaces, not doubles */
await importReport("2026-08-16", tenants, [snapshot(T, 1500)], [invoice(T, 1500, "August rent")]);

const snapsAgain = (
  await c.query(
    "select count(*)::int n from account_snapshots where tenant_id=$1",
    [T],
  )
).rows[0].n;
ok(`re-uploading the same date replaced it (${snapsAgain} snapshots, not 4)`, snapsAgain === 3);

const invs = (
  await c.query("select count(*)::int n from invoices where tenant_id=$1", [T])
).rows[0].n;
ok(`invoice lines were replaced too, not stacked up (${invs})`, invs === 3);

const still = await work();
ok(
  "and her work is still untouched after the replace",
  still.calls === 1 && still.promises === 1 && still.emails === 1 && still.fees === 1,
);

/* -------------------------------------- the function itself, read as text */
const src = (
  await c.query(
    "select prosrc from pg_proc where proname = 'import_ar_report'",
  )
).rows[0].prosrc.toLowerCase();

for (const table of ["calls", "promises", "emails_sent", "late_fees", "audit_log"]) {
  ok(
    `the import function contains no delete or update against ${table}`,
    !new RegExp(`(delete\\s+from|update)\\s+${table}\\b`).test(src),
  );
}

await c.query("rollback");
await c.end();
console.log(fail ? `\n${fail} FAILED` : "\nALL CHECKS PASS");
process.exit(fail ? 1 : 0);
