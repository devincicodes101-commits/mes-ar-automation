/**
 * A call the officer logs must survive the round trip to Postgres.
 *
 *   npm run test:activity:rest
 *
 * Written after a fault the source-reading guards could never have caught.
 * src/lib/activity-db.ts was built from 0001's schema, where the activity
 * tables keyed on account_id. 0005 had already renamed that to tenant_id and
 * dropped the accounts table outright. Every offline suite passed: the mapper
 * was internally consistent, the route imported it, and the wiring guards saw
 * the imports they were looking for. Nothing compares a column name against
 * the database until something actually writes to it.
 *
 * So this writes to it. Every field the browser holds goes out, comes back,
 * and is compared. A field quietly dropped on the way to Postgres is a
 * conversation lost, and it raises no error at all.
 *
 * Like test:import:rest, this goes through PostgREST because the direct
 * Postgres password is rejected. Each call is its own transaction, so nothing
 * rolls back: it writes real rows, deletes them, and checks they are gone.
 * Everything is fenced behind a `zz-test-` tenant that no report can produce.
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
const ok = (name, condition, detail) => {
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${name}${condition ? "" : `  ${detail ?? ""}`}`);
  if (!condition) failures += 1;
};

async function rest(path, init = {}) {
  const r = await fetch(`${BASE}/rest/v1/${path}`, {
    ...init,
    headers: { ...H, ...(init.headers ?? {}) },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${path} :: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const get = (path) => rest(path);
const del = (path) => rest(path, { method: "DELETE" });
const post = (path, body) =>
  rest(path, {
    method: "POST",
    headers: { Prefer: "return=representation,resolution=merge-duplicates" },
    body: JSON.stringify(body),
  });

const ID = "zz-test-activity";
const TENANT = {
  id: ID,
  customer_code: "ZZ-ACT-1",
  company_name: "ZZ ACTIVITY TEST PTE LTD",
  property_code: "BSD",
  first_seen: "1999-01-01",
  last_seen: "1999-01-01",
};

/*
 * The mapping under test, imported rather than restated. A test that spelled
 * the column names out itself would pass while the application used different
 * ones, which is precisely the fault that prompted this file.
 */
const {
  callToRow,
  promiseToRow,
  emailToRow,
  callsFromRows,
  promisesFromRows,
  emailsFromRows,
} = await import("../src/lib/activity-db.ts");

const CALL = {
  id: crypto.randomUUID(),
  accountId: ID,
  companyName: TENANT.company_name,
  at: "1999-01-07T09:30:00.000Z",
  reached: "Mr Tan, accounts",
  outcome: "promised-to-pay",
  promisedAmount: 12345.67,
  promisedDate: "1999-01-21",
  nextActionDate: "1999-01-22",
  notes: "Said the payment run is on the 21st.",
  agingBucket: "30 days",
  deductionFailDate: "1999-01-03",
};

const PROMISE = {
  id: crypto.randomUUID(),
  accountId: ID,
  companyName: TENANT.company_name,
  amount: 12345.67,
  promisedFor: "1999-01-21",
  createdAt: "1999-01-07T09:31:00.000Z",
  source: "call",
  confirmationSentAt: null,
};

const EMAIL = {
  id: crypto.randomUUID(),
  accountId: ID,
  companyName: TENANT.company_name,
  templateId: "first-reminder",
  templateName: "First reminder",
  subject: "Outstanding balance",
  body: "Dear Sir or Madam,\n\nOur records show 12,345.67 outstanding.",
  to: ["ar@example.com", "finance@example.com"],
  at: "1999-01-07T09:32:00.000Z",
};

async function cleanup() {
  await del(`calls?tenant_id=eq.${ID}`);
  await del(`promises?tenant_id=eq.${ID}`);
  await del(`emails_sent?tenant_id=eq.${ID}`);
  await del(`tenants?id=eq.${ID}`);
}

try {
  console.log(`\nproject: ${BASE}\n`);
  await cleanup();

  await post("tenants", TENANT);

  /* ------------------------------------------------------------ going out */

  console.log("What the browser holds reaches Postgres");

  await post("calls", callToRow(CALL));
  await post("promises", promiseToRow(PROMISE));
  await post("emails_sent", emailToRow(EMAIL, true));
  ok("every record is accepted by the columns that actually exist", true);

  /* --------------------------------------------------------- coming back */

  console.log("\nAnd comes back as the same thing");

  const sel = "select=*,tenants(company_name)";
  const { calls, unreadable } = callsFromRows(await get(`calls?tenant_id=eq.${ID}&${sel}`));
  const back = calls[0];

  ok("the call is there", calls.length === 1, `got ${calls.length}`);
  ok("no call was unreadable", unreadable === 0, `got ${unreadable}`);

  for (const [field, expected] of Object.entries(CALL)) {
    if (field === "at") continue; // Postgres normalises the timestamp format.
    const actual = back?.[field];
    ok(
      `  ${field}`,
      JSON.stringify(actual) === JSON.stringify(expected),
      `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
    );
  }
  ok("  at", new Date(back?.at ?? 0).toISOString() === CALL.at, `got ${back?.at}`);

  const [promise] = promisesFromRows(await get(`promises?tenant_id=eq.${ID}&${sel}`));
  ok(
    "the promise keeps its amount to the cent",
    promise?.amount === PROMISE.amount,
    `got ${promise?.amount}`,
  );
  ok(
    "and the date it was promised for",
    promise?.promisedFor === PROMISE.promisedFor,
    `got ${promise?.promisedFor}`,
  );

  const [email] = emailsFromRows(await get(`emails_sent?tenant_id=eq.${ID}&${sel}`));
  ok(
    "the letter keeps both recipients",
    JSON.stringify(email?.to) === JSON.stringify(EMAIL.to),
    `got ${JSON.stringify(email?.to)}`,
  );

  /*
   * The two that only 0012 makes possible, and the reason it has to be run.
   * Without those columns the letter comes back with no text and every
   * simulated send reads as genuine, both without error.
   */
  ok(
    "the letter body survives, which is the only place a template fault shows",
    email?.body === EMAIL.body,
    `got ${JSON.stringify(email?.body)}`,
  );

  const [raw] = await get(`emails_sent?tenant_id=eq.${ID}&select=was_simulated`);
  ok("a dry run is stored as a dry run", raw?.was_simulated === true, `got ${raw?.was_simulated}`);

  const [rawP] = await get(`promises?tenant_id=eq.${ID}&select=confirmation_sent_at`);
  ok(
    "an unconfirmed promise says so rather than erroring",
    rawP !== undefined && rawP.confirmation_sent_at === null,
    `got ${JSON.stringify(rawP)}`,
  );

  /* ------------------------------------------------------- and cleans up */

  console.log("\nNothing is left behind");
  await cleanup();
  const left = await get(`calls?tenant_id=eq.${ID}&select=id`);
  ok("the test rows are gone", left.length === 0, `${left.length} left`);
} catch (e) {
  failures += 1;
  console.log(`\n  FAIL  ${e.message}`);
  if (/was_simulated|body|confirmation_sent_at/.test(e.message)) {
    console.log("\n  This looks like 0012_activity_columns.sql not being applied yet.");
  }
  await cleanup().catch(() => {});
}

console.log(failures === 0 ? "\nALL CHECKS PASS\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
