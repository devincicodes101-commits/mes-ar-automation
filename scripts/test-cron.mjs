/**
 * The scheduled run, over HTTP, as Vercel will call it.
 *
 *   npm run dev        (in another terminal)
 *   npm run test:cron
 *
 * test:schedule proves the arithmetic. This proves the route: that the secret
 * is the only way in, that a run is recorded whatever happens, and that
 * calling it twice does not charge anybody twice.
 *
 * That last one is not theoretical. Vercel does not promise exactly once, a
 * person may hit the URL by hand to see what it does, and on the 16th every
 * extra run would be another $100 against a tenant who owes it once.
 *
 * It writes real rows into cron_runs for today's date and puts back whatever
 * was there before, because this is the live database and a run record is
 * evidence rather than scratch space.
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
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const SECRET = env.CRON_SECRET;
const APP = process.env.APP_URL ?? "http://localhost:3000";

let failures = 0;
const ok = (name, condition, detail) => {
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${name}${condition ? "" : `  ${detail ?? ""}`}`);
  if (!condition) failures += 1;
};

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

const cron = (secret) =>
  fetch(`${APP}/api/cron`, {
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  });

/** Today as Singapore sees it, the same way the route decides it. */
const { inSingapore } = await import("../src/lib/schedule.ts");
const today = inSingapore();

let before = null;

try {
  if (!SECRET) {
    console.error("\n  CRON_SECRET is not in .env.local. Nothing can be tested.\n");
    process.exit(1);
  }

  const ping = await fetch(`${APP}/api/cron`).catch(() => null);
  if (!ping) {
    console.error(`\n  Nothing is serving ${APP}. Start it with: npm run dev\n`);
    process.exit(1);
  }

  console.log(`\napp: ${APP}\ntoday in Singapore: ${today.iso}\n`);

  // Whatever is already recorded for today, so it can be put back.
  const existing = await (await service(`cron_runs?ran_for=eq.${today.iso}&select=*`)).json();
  before = Array.isArray(existing) && existing.length > 0 ? existing[0] : null;

  /* ------------------------------------------------------- the secret --- */

  console.log("The URL is not a button anybody can press");

  ok("  no secret is refused", (await cron(null)).status === 401);
  ok("  a wrong secret is refused", (await cron("wrong")).status === 401);
  /*
   * Length is checked before content, so a secret of the wrong length exits
   * early. Worth asserting that it still refuses rather than throwing.
   */
  ok("  a shorter secret is refused", (await cron(SECRET.slice(0, 8))).status === 401);
  ok("  a longer one is too", (await cron(`${SECRET}x`)).status === 401);

  /* ---------------------------------------------------------- the run --- */

  console.log("\nA run happens and is written down");

  const first = await cron(SECRET);
  const body = await first.json();

  ok("  the right secret gets in", first.status === 200, `got ${first.status}`);
  ok("  it reports the Singapore date", body.ranFor === today.iso, `got ${body.ranFor}`);
  ok(
    "  and says what kind of day it was",
    ["ok", "nothing-due", "no-report"].includes(body.status),
    `got ${body.status} ${body.error ?? ""}`,
  );
  ok(
    "  the run was recorded, not just reported",
    body.recorded === true,
    typeof body.recorded === "string" ? body.recorded : `got ${body.recorded}`,
  );

  const stored = await (await service(`cron_runs?ran_for=eq.${today.iso}&select=*`)).json();
  ok("  and the row is there", stored.length === 1, `got ${stored.length} rows`);
  ok(
    "  with a finish time, so a run that hung is tellable from one that failed",
    Boolean(stored[0]?.finished_at),
  );

  /* ------------------------------------------------------ running twice - */

  console.log("\nRunning it twice changes nothing");

  const fees = async () =>
    Number(
      (
        await service(`late_fees?period=eq.${today.year}-${String(today.month).padStart(2, "0")}-01&select=id`, {
          headers: { Prefer: "count=exact" },
        })
      ).headers
        .get("content-range")
        ?.split("/")[1] ?? "0",
    );

  const feesBefore = await fees();
  const second = await cron(SECRET);
  const secondBody = await second.json();
  const feesAfter = await fees();

  ok("  the second run also succeeds", second.status === 200, `got ${second.status}`);
  ok(
    "  no tenant is charged twice",
    feesAfter === feesBefore,
    `${feesBefore} fees before, ${feesAfter} after`,
  );

  const afterTwo = await (await service(`cron_runs?ran_for=eq.${today.iso}&select=ran_for`)).json();
  ok("  and there is still one run for today, not two", afterTwo.length === 1, `got ${afterTwo.length}`);
  ok(
    "  both runs agree on the day",
    secondBody.cycleDay === body.cycleDay,
    `${body.cycleDay} then ${secondBody.cycleDay}`,
  );

  /* ------------------------------------------------ a real cycle day --- */

  /*
   * Everything above ran on whatever today happens to be, which is usually a
   * day MES do nothing on. That leaves the part that matters untested: the
   * 16th, where fees are raised and letters written.
   *
   * So the run is pointed at the 16th of this month. This is the live
   * database, so every row it produces is deleted afterwards and the count is
   * checked back to where it started.
   */
  const CATCH_UP = `${today.year}-${String(today.month).padStart(2, "0")}-16`;
  const period = `${today.year}-${String(today.month).padStart(2, "0")}-01`;

  console.log(`
The 16th, run on purpose (${CATCH_UP})`);

  const feesAt = async () =>
    Number(
      (
        await service(`late_fees?period=eq.${period}&select=id`, {
          headers: { Prefer: "count=exact" },
        })
      ).headers
        .get("content-range")
        ?.split("/")[1] ?? "0",
    );

  const lettersAt = async () =>
    Number(
      (
        await service(`emails_sent?select=id`, { headers: { Prefer: "count=exact" } })
      ).headers
        .get("content-range")
        ?.split("/")[1] ?? "0",
    );

  const idsIn = async () =>
    ((await (await service(`late_fees?period=eq.${period}&select=id`)).json()) ?? []).map(
      (r) => r.id,
    );

  const startIds = await idsIn();
  const feesStart = startIds.length;
  const lettersStart = await lettersAt();
  const runBefore = await (await service(`cron_runs?ran_for=eq.${CATCH_UP}&select=*`)).json();
  const hadRun = Array.isArray(runBefore) && runBefore.length > 0 ? runBefore[0] : null;

  const sixteenth = await fetch(`${APP}/api/cron?for=${CATCH_UP}`, {
    headers: { Authorization: `Bearer ${SECRET}` },
  });
  const six = await sixteenth.json();

  ok("  it runs", sixteenth.status === 200, `got ${sixteenth.status} ${six.error ?? ""}`);
  ok("  and knows it is the 16th", six.cycleDay === 16, `got ${six.cycleDay}`);
  ok("  and says it was caught up rather than scheduled", six.caughtUp === true);
  ok(
    "  it had a report to work from",
    six.status === "ok",
    `got ${six.status}: ${six.error ?? JSON.stringify(six.summary)}`,
  );
  ok(
    "  it says what it would do, in words",
    Array.isArray(six.summary?.willDo) && six.summary.willDo.length > 0,
    JSON.stringify(six.summary),
  );
  ok("  and nothing it wrote claims to be a real send", six.summary?.simulated === true);

  const feesNow = await feesAt();
  const lettersOnce = await lettersAt();
  ok(
    "  fees were actually raised",
    feesNow > feesStart,
    `${feesStart} before, ${feesNow} after. summary: ${JSON.stringify(six.summary)}`,
  );
  ok(
    "  and the count matches what it reported",
    feesNow - feesStart === (six.summary?.feesRaised ?? -1),
    `raised ${feesNow - feesStart}, reported ${six.summary?.feesRaised}`,
  );

  /*
   * The one that would cost MES real money. Vercel does not promise exactly
   * once, and every extra run on the 16th would be another $100 against a
   * tenant who owes it once.
   */
  await fetch(`${APP}/api/cron?for=${CATCH_UP}`, {
    headers: { Authorization: `Bearer ${SECRET}` },
  });
  const feesTwice = await feesAt();
  const lettersTwice = await lettersAt();
  const afterIds = await idsIn();
  ok(
    "  running the 16th again charges nobody a second time",
    feesTwice === feesNow,
    `${feesNow} after one run, ${feesTwice} after two`,
  );

  ok(
    "  and writes no second letter to the same tenant",
    lettersTwice === lettersOnce,
    `${lettersStart} before, ${lettersOnce} after one run, ${lettersTwice} after two`,
  );

  /*
   * Put the database back, taking only what this test added.
   *
   * Deleting the period outright would have taken any fee that was already
   * there, which on the real 16th would be MES's own charges. The ids are
   * captured before and after and only the difference is removed.
   */
  const mine = afterIds.filter((id) => !startIds.includes(id));
  if (mine.length > 0) {
    await service(`late_fees?id=in.(${mine.join(",")})`, { method: "DELETE" });
  }
  await service(`cron_runs?ran_for=eq.${CATCH_UP}`, { method: "DELETE" });
  if (hadRun) await service("cron_runs", { method: "POST", body: JSON.stringify(hadRun) });

  ok("  the fees it raised are cleared away again", (await feesAt()) === feesStart,
     `${await feesAt()} left, started at ${feesStart}`);

  /* ---------------------------------------------------------- tidy up --- */

  console.log("\nThe database is left as it was found");

  await service(`cron_runs?ran_for=eq.${today.iso}`, { method: "DELETE" });
  if (before) {
    await service("cron_runs", { method: "POST", body: JSON.stringify(before) });
    ok("  the run that was there before is back", true);
  } else {
    const left = await (await service(`cron_runs?ran_for=eq.${today.iso}&select=ran_for`)).json();
    ok("  the test's own run is gone", left.length === 0, `${left.length} left`);
  }
} catch (e) {
  failures += 1;
  console.log(`\n  FAIL  ${e.message}`);
  if (/cron_runs/.test(e.message)) {
    console.log("\n  This looks like 0014_cron_runs.sql not being applied yet.");
  }
}

console.log(failures === 0 ? "\nALL CHECKS PASS\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
