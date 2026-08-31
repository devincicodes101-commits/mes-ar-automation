/**
 * The snapshot model, checked against the real database.
 *
 *   npm run test:snapshots
 *
 * MES upload the AR report several times a month. Two things have to be true
 * and neither is obvious from reading the schema: every upload has to be
 * stored rather than rejected, and no upload may touch a phone call. The
 * second is the one that would never be noticed, because losing a call
 * produces no error at all.
 *
 * Everything runs inside a transaction that is rolled back, so the database is
 * exactly as it was afterwards.
 */
import fs from "node:fs";
import pg from "pg";
const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/).filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const c = new pg.Client({host:"aws-0-ap-southeast-1.pooler.supabase.com",port:5432,
  user:"postgres."+env.SUPABASE_PROJECT_REF,password:env.SUPABASE_DB_PASSWORD,
  database:"postgres",ssl:{rejectUnauthorized:false}});
let fail = 0;
const ok = (n,c2)=>{ console.log(`  ${c2?"PASS":"FAIL"}  ${n}`); if(!c2) fail++; };

await c.connect();
await c.query("begin");
const t = (await c.query("select id from tenants limit 1")).rows[0].id;

await c.query(`insert into calls (tenant_id, period, called_at, reached, outcome, notes)
               values ($1,'2026-08-01','2026-08-07','Mrs Tan','promised_to_pay','promised by the 29th')`,[t]);
const before = (await c.query("select count(*)::int n from calls where tenant_id=$1",[t])).rows[0].n;

for (const d of ["2026-08-04","2026-08-07","2026-08-16"])
  await c.query(`insert into account_snapshots (tenant_id, report_date, period, total)
                 values ($1,$2,'2026-08-01',1000)`,[t,d]);

const snaps = (await c.query("select count(*)::int n from account_snapshots where tenant_id=$1 and period='2026-08-01'",[t])).rows[0].n;
ok(`three uploads in one month all stored (${snaps} snapshots)`, snaps===3);

const after = (await c.query("select count(*)::int n from calls where tenant_id=$1",[t])).rows[0].n;
ok(`the call logged on the 7th survived all three uploads (${before} -> ${after})`, before===after && after>0);

const v = (await c.query("select report_date::text as d, total from current_accounts where tenant_id=$1",[t])).rows;
const d = v[0] && v[0].d;   // read as text: a DATE through toISOString() shifts a day east of Greenwich
ok(`current_accounts gives one row, the newest (${d})`, v.length===1 && d==="2026-08-16");

await c.query("savepoint s");
let dup = false;
try { await c.query(`insert into account_snapshots (tenant_id, report_date, period, total)
                     values ($1,'2026-08-07','2026-08-01',9999)`,[t]); }
catch(e){ dup = e.code==="23505"; }
await c.query("rollback to savepoint s");
ok("re-uploading the same report date is rejected, not duplicated", dup);

ok("the old accounts table is gone",
   (await c.query("select to_regclass('public.accounts') r")).rows[0].r === null);

const cols = (await c.query(`select table_name from information_schema.columns
  where table_schema='public' and column_name='account_id'`)).rows.map(r=>r.table_name);
ok(`no table still has an account_id column${cols.length?" ("+cols.join(", ")+")":""}`, cols.length===0);

const pol = (await c.query(`select tablename, count(*)::int n from pg_policies
  where schemaname='public' and tablename in
  ('tenants','account_snapshots','invoices','calls','promises','emails_sent','late_fees','giro_failures')
  group by tablename order by tablename`)).rows;
ok(`all eight repointed tables have policies (${pol.map(p=>p.tablename+":"+p.n).join(" ")})`,
   pol.length===8 && pol.every(p=>p.n===2));

await c.query("rollback");
await c.end();
console.log(fail ? `\n${fail} FAILED` : "\nALL CHECKS PASS");
process.exit(fail?1:0);
