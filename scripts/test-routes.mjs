/**
 * The API routes, over HTTP, signed in as real people.
 *
 *   npm run dev          (in another terminal)
 *   npm run test:routes
 *
 * Everything else tests a layer. test:activity:rest goes straight to PostgREST
 * with the service role key, which bypasses every policy in the database.
 * test:wiring reads source text. Neither of them proves the thing the officer
 * actually does: sign in, and have the right doors open and the wrong ones
 * shut.
 *
 * So this signs in with the demo passwords, takes the access token Supabase
 * issues, and calls the routes the way the browser does. It is the only test
 * that exercises identify(), the role check on upload, and the fact that one
 * officer's call is visible to another.
 *
 * It writes a call against a `zz-test-` tenant and deletes it afterwards, the
 * same fence test:activity:rest uses. It never uploads: replacing a report
 * date on the live database is not something a test should do casually, and
 * test:import:rest already proves that path against dates in 1999.
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

const SUPA = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const APP = process.env.APP_URL ?? "http://localhost:3000";

let failures = 0;
const ok = (name, condition, detail) => {
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${name}${condition ? "" : `  ${detail ?? ""}`}`);
  if (!condition) failures += 1;
};

/** Signs in the way the login screen does, and returns the access token. */
async function signIn(email, password) {
  const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`sign in as ${email}: ${JSON.stringify(body).slice(0, 200)}`);
  return body.access_token;
}

const app = (path, token, init = {}) =>
  fetch(`${APP}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

const service = (path, init = {}) =>
  fetch(`${SUPA}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

const ID = "zz-test-routes";

async function cleanup() {
  await service(`calls?tenant_id=eq.${ID}`, { method: "DELETE" });
  await service(`emails_sent?tenant_id=eq.${ID}`, { method: "DELETE" });
  await service(`tenants?id=eq.${ID}`, { method: "DELETE" });
}

try {
  const ping = await fetch(`${APP}/api/dataset`).catch(() => null);
  if (!ping) {
    console.error(`\n  Nothing is serving ${APP}. Start it with: npm run dev\n`);
    process.exit(1);
  }

  console.log(`\napp: ${APP}\n`);
  await cleanup();

  /* ------------------------------------------------------ signed out ---- */

  console.log("A signed out caller gets nothing");

  for (const path of ["/api/dataset", "/api/activity"]) {
    const r = await app(path, null);
    ok(`  ${path} refuses without a token`, r.status === 401, `got ${r.status}`);
  }

  /*
   * A token the caller made up themselves. This is the attack identify()
   * exists to stop: the session object in local storage is a claim the browser
   * wrote, and a route that trusted it would be trusting that claim.
   */
  const forged = await app("/api/dataset", "not.a.real.token");
  ok("  and refuses a made up one", forged.status === 401, `got ${forged.status}`);

  /* ---------------------------------------------------------- the CSD ---- */

  console.log("\nThe AR team can read the report and log a call");

  const csd = await signIn("csd@mesgroup.com", "csd@2026");

  const ds = await app("/api/dataset", csd);
  const dsBody = await ds.json();
  ok("  the stored report comes back", ds.status === 200 && dsBody.ok === true, `got ${ds.status}`);
  ok(
    "  with tenants in it",
    (dsBody.dataset?.accounts?.length ?? 0) > 0,
    `got ${dsBody.dataset?.accounts?.length} accounts`,
  );
  ok(
    "  and it is a real report date, not today",
    /^\d{4}-\d{2}-\d{2}$/.test(dsBody.dataset?.asOf ?? ""),
    `got ${dsBody.dataset?.asOf}`,
  );

  /*
   * PostgREST caps a response at 1,000 rows and does it silently: the request
   * succeeds and the array is simply short. Their August report has 3,117
   * charge lines, so the aging board was summing under a third of them and
   * presenting the result as the total, with no error anywhere.
   *
   * Compared against the count the database reports rather than a number
   * written here, so this keeps working when they upload a bigger month.
   */
  const counted = await service(
    `invoices?select=id&snapshot_id=not.is.null&period=eq.${dsBody.dataset.period}-01`,
    { headers: { Prefer: "count=exact" } },
  );
  const inDb = Number((counted.headers.get("content-range") ?? "/0").split("/")[1]);

  ok(
    "  every charge line comes back, not the first thousand",
    dsBody.dataset.invoices.length === inDb,
    `route gave ${dsBody.dataset.invoices.length}, the database holds ${inDb}`,
  );
  ok(
    "  and there are more than one page of them, so that meant something",
    inDb > 1000,
    `only ${inDb} lines, so this proves nothing until a bigger report is loaded`,
  );

  await service("tenants", {
    method: "POST",
    body: JSON.stringify({
      id: ID,
      customer_code: "ZZ-ROUTE-1",
      company_name: "ZZ ROUTE TEST PTE LTD",
      property_code: "BSD",
      first_seen: "1999-01-01",
      last_seen: "1999-01-01",
    }),
  });

  const callId = crypto.randomUUID();
  const logged = await app("/api/activity", csd, {
    method: "POST",
    body: JSON.stringify({
      kind: "call",
      record: {
        id: callId,
        accountId: ID,
        companyName: "ZZ ROUTE TEST PTE LTD",
        at: "1999-01-07T09:30:00.000Z",
        reached: "Mr Tan",
        outcome: "promised-to-pay",
        promisedAmount: 999.99,
        promisedDate: "1999-01-21",
        nextActionDate: "1999-01-22",
        notes: "Logged through the API.",
        agingBucket: "30 days",
        deductionFailDate: null,
      },
    }),
  });
  ok("  the call is accepted", logged.status === 200, `got ${logged.status} ${await logged.text()}`);

  /*
   * The point of the whole phase. Until now this call lived in one browser and
   * the officer at the next desk would have rung the same tenant again.
   */
  console.log("\nAnd somebody else can see it");

  const admin = await signIn("admin@mesgroup.com", "admin@2026");
  const theirs = await (await app("/api/activity", admin)).json();
  const found = (theirs.calls ?? []).find((c) => c.id === callId);

  ok("  a second person reads the same call", Boolean(found));
  ok("  with the notes intact", found?.notes === "Logged through the API.", `got ${found?.notes}`);
  ok("  and the promised amount to the cent", found?.promisedAmount === 999.99, `got ${found?.promisedAmount}`);

  /*
   * Whether a send was real is decided by the route from the build's own flag,
   * never from what the caller claims. Worth testing here and not only in the
   * mapper, because the route reads CAN_SEND_FOR_REAL across a module boundary
   * and briefly read it across a client one, where it would have been a proxy:
   * truthy, negated to false, and every dry run logged as a genuine send.
   */
  console.log("\nA simulated letter is stored as simulated");

  const emailId = crypto.randomUUID();
  const sent = await app("/api/activity", csd, {
    method: "POST",
    body: JSON.stringify({
      kind: "email",
      record: {
        id: emailId,
        accountId: ID,
        companyName: "ZZ ROUTE TEST PTE LTD",
        templateId: "reminder-7th",
        templateName: "First reminder",
        subject: "Outstanding balance",
        body: "Dear Sir or Madam",
        to: ["ar@example.com"],
        at: "1999-01-07T09:32:00.000Z",
      },
    }),
  });
  ok("  the letter is stored", sent.status === 200, `got ${sent.status}`);

  const stored = await (await service(`emails_sent?id=eq.${emailId}&select=was_simulated,body`)).json();
  ok("  and flagged as a dry run, not a real send",
     stored[0]?.was_simulated === true, `got ${stored[0]?.was_simulated}`);
  ok("  with the letter text kept",
     stored[0]?.body === "Dear Sir or Madam", `got ${JSON.stringify(stored[0]?.body)}`);

  /* ------------------------------------------------------ the RM ------- */

  console.log("\nA relationship manager may read but not replace a month");

  const rm = await signIn("rm@mesgroup.com", "rm@2026");

  const rmRead = await app("/api/activity", rm);
  ok("  they can read the log", rmRead.status === 200, `got ${rmRead.status}`);

  const rmUpload = await app("/api/upload", rm, {
    method: "POST",
    body: JSON.stringify({ accounts: [], invoices: [], reportDate: "1999-01-01" }),
  });
  ok("  but uploading is refused", rmUpload.status === 403, `got ${rmUpload.status}`);

  const why = await rmUpload.json();
  ok(
    "  and the refusal says why, not just no",
    /may read the reports but not replace one/.test(why.error ?? ""),
    `got ${why.error}`,
  );

  /*
   * A CSD officer may upload, so the refusal above is about the role and not
   * about the route being broken for everybody.
   */
  const csdUpload = await app("/api/upload", csd, {
    method: "POST",
    body: JSON.stringify({ accounts: [], invoices: [], reportDate: null }),
  });
  ok(
    "  while the AR team gets past the role check",
    csdUpload.status === 422,
    `got ${csdUpload.status}`,
  );

  const refused = await csdUpload.json();
  ok(
    "  and an unusable report is refused whole, with reasons",
    refused.ok === false && (refused.problems?.length ?? 0) > 0,
    `got ${JSON.stringify(refused).slice(0, 120)}`,
  );

  /* ------------------------------------------------------- clean up ---- */

  console.log("\nNothing is left behind");
  await cleanup();
  const left = await (await service(`calls?tenant_id=eq.${ID}&select=id`)).json();
  ok("  the test call is gone", left.length === 0, `${left.length} left`);
} catch (e) {
  failures += 1;
  console.log(`\n  FAIL  ${e.message}`);
  await cleanup().catch(() => {});
}

console.log(failures === 0 ? "\nALL CHECKS PASS\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
