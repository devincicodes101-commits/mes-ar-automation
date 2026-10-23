/**
 * The schedule, and the eight hours that separate Vercel from MES.
 *
 *   npm run test:schedule
 *
 * Vercel runs cron in UTC. MES's month is in Singapore, UTC+8. For eight hours
 * of every day those two disagree about what the date is, and on this calendar
 * being one day out is not cosmetic: the $100 fee is raised on the 16th and the
 * final notice goes out on the 21st, so a run that thinks it is the 15th
 * charges nobody and a run that thinks it is the 22nd has already missed.
 *
 * Nothing here touches a network or a database. It is arithmetic, and it is
 * the arithmetic that decides whether a tenant gets charged.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  askedFor,
  CRON_EXPRESSION,
  SGT_OFFSET_MINUTES,
  cycleDayFor,
  inSingapore,
  missedSince,
  periodOf,
  reportAgeDays,
  reportAgeWarning,
  AGEING_AFTER_DAYS,
  runNeedsLookingAt,
  needsAttention,
} from "../src/lib/schedule.ts";
import { CYCLE_DAYS } from "../src/lib/cycle.ts";
import { refusedByChecks, UNKNOWN } from "../src/lib/upload-verdict.ts";
import { runLog } from "../src/lib/run-log.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${name.slice(0, 64).padEnd(64)} ` +
      (ok ? "" : `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`),
  );
}

const at = (iso: string) => inSingapore(new Date(iso));

/* ------------------------------------------------------ the eight hours -- */

console.log("\nThe date is Singapore's, not the server's\n");

check("Singapore is eight hours ahead", SGT_OFFSET_MINUTES, 480);

// 16:00 UTC is midnight in Singapore, so this is already the 16th there while
// most of the world is still on the 15th.
check("16:00 UTC on the 15th is the 16th in Singapore", at("2026-09-15T16:00:00Z").iso,
      "2026-09-16");
check("and it is one minute past midnight there", at("2026-09-15T16:01:00Z").hour, 0);

// The other end. 15:59 UTC is 23:59 the same day.
check("15:59 UTC on the 15th is still the 15th", at("2026-09-15T15:59:00Z").iso,
      "2026-09-15");

// The hour the cron actually fires.
check("01:00 UTC is 09:00 in Singapore, the same day",
      at("2026-09-16T01:00:00Z").hour, 9);
check("and it is the 16th there too", at("2026-09-16T01:00:00Z").iso, "2026-09-16");

// Month and year rollovers, where an off-by-one is easiest to write and
// hardest to spot.
check("31 December 16:00 UTC is New Year's Day in Singapore",
      at("2026-12-31T16:00:00Z").iso, "2027-01-01");
check("28 February 16:00 UTC in a leap year is the 29th",
      at("2028-02-28T16:00:00Z").iso, "2028-02-29");

/* -------------------------------------------------------- MES's own days -- */

console.log("\nMES's six days, and only those\n");

for (const d of CYCLE_DAYS) {
  const iso = `2026-09-${String(d).padStart(2, "0")}T01:00:00Z`;
  check(`the ${d}th is a cycle day`, cycleDayFor(at(iso)), d);
}

for (const d of [2, 5, 8, 12, 17, 20, 25, 30]) {
  const iso = `2026-09-${String(d).padStart(2, "0")}T01:00:00Z`;
  check(`the ${d}th is not`, cycleDayFor(at(iso)), null);
}

/*
 * The one that matters most. If this read UTC, a run firing at 17:00 UTC on
 * the 15th would see the 15th and skip the fees entirely, and the next run
 * would see the 17th and think the 16th had been handled.
 */
check("17:00 UTC on the 15th is the 16th, so the fees are raised",
      cycleDayFor(at("2026-09-15T17:00:00Z")), 16);

/* ------------------------------------------------------------- periods --- */

console.log("\nPeriods are the first of the month\n");

check("mid month", periodOf(at("2026-09-16T01:00:00Z")), "2026-09-01");
check("and across the UTC boundary it is the Singapore month",
      periodOf(at("2026-09-30T16:00:00Z")), "2026-10-01");

/* --------------------------------------------------------- missed days --- */

console.log("\nA day nothing ran on is a day somebody has to know about\n");

const sept18 = at("2026-09-18T01:00:00Z");

check("a run yesterday missed nothing", missedSince("2026-09-17", sept18), []);
check("nothing to compare against yet", missedSince(null, sept18), []);

// Out since the 14th: the 15th, 16th and 17th all went by. Reminders run
// every morning now, so every morning counts, not MES's old six days.
check("a gap names every morning inside it",
      missedSince("2026-09-14", sept18), ["2026-09-15", "2026-09-16", "2026-09-17"]);

check("a gap across a month end names both months' mornings",
      missedSince("2026-08-30", at("2026-09-02T01:00:00Z")),
      ["2026-08-31", "2026-09-01"]);

/*
 * A database restored from an old backup would otherwise walk years a day at a
 * time and produce a list nobody can act on.
 */
const ancient = missedSince("2020-01-01", sept18);
check("an absurd gap is capped rather than unbounded", ancient.length <= 60, true);
check("and it is not empty, so the gap is still visible", ancient.length > 0, true);

/* ------------------------------------------------- needs attention ---- */

console.log("\nThe schedule says what needs a hand, rather than asking for a date\n");

const ok = (d: string, summary: Record<string, unknown> | null = null) =>
  ({ ran_for: d, status: "ok", error: null, summary });
const oct23am = at("2026-10-23T02:00:00Z"); // 10am in Singapore
const oct23pm = at("2026-10-23T06:00:00Z"); // 2pm

check("a run every morning needs nothing",
      needsAttention([ok("2026-10-22"), ok("2026-10-21"), ok("2026-10-20")], oct23am), []);
check("no history yet is not a problem to report",
      needsAttention([], oct23pm), []);
check("before the morning is over, today not having run yet is not flagged",
      needsAttention([ok("2026-10-22")], oct23am), []);
check("after it, it is",
      needsAttention([ok("2026-10-22")], oct23pm).map((i) => i.kind), ["not-today"]);

const gap = needsAttention([ok("2026-10-22"), ok("2026-10-18")], oct23am);
check("a missed ordinary morning is said, with no button needed",
      gap, [{ kind: "gap", dates: ["2026-10-19", "2026-10-20", "2026-10-21"] }]);

check("a gap more than a month old is not raised again",
      needsAttention([ok("2026-10-22"), ok("2026-09-10")], oct23am).find((i) => i.kind === "gap")?.kind === "gap" &&
        (needsAttention([ok("2026-10-22"), ok("2026-09-10")], oct23am).find((i) => i.kind === "gap") as { dates: string[] }).dates[0],
      "2026-09-22");

const feeMissed = needsAttention([ok("2026-10-18"), ok("2026-10-14")], oct23am);
check("a missed 16th is its own item: its fees were never raised",
      feeMissed.filter((i) => i.kind === "fee-day").map((i) => (i as { date: string }).date), ["2026-10-16"]);
check("and is not lumped in with the ordinary gap",
      (feeMissed.find((i) => i.kind === "gap") as { dates: string[] }).dates, ["2026-10-15", "2026-10-17"]);

check("a 16th that stopped is an item too, with its reason",
      needsAttention([ok("2026-10-17"), { ran_for: "2026-10-16", status: "report-too-old", error: "The report is 20 days old.", summary: null }], at("2026-10-17T06:00:00Z")),
      [{ kind: "fee-day", date: "2026-10-16", error: "The report is 20 days old.", needsUpload: false }]);

check("a morning whose letters did not all go says how many",
      needsAttention([ok("2026-10-22", { lettersWritten: 208, lettersSent: 81, lettersDeferred: 127 })], oct23am),
      [{ kind: "unfinished", date: "2026-10-22", notSent: 127, written: 208, why: null }]);
check("but not while today's follow-up runs may still send them",
      needsAttention([ok("2026-10-23", { lettersWritten: 208, lettersSent: 81, lettersDeferred: 127 }), ok("2026-10-22")], oct23am), []);
check("letters test mode held back are not a problem",
      needsAttention([ok("2026-10-22", { lettersWritten: 5, lettersSent: 0, lettersBlocked: 5 })], oct23am), []);
check("a morning that stopped is said at once, not after the follow-ups",
      needsAttention([{ ran_for: "2026-10-23", status: "report-too-old", error: "The report is 38 days old.", summary: null }, ok("2026-10-22")], oct23am),
      [{ kind: "failed", date: "2026-10-23", error: "The report is 38 days old.", needsUpload: false }]);
check("a morning that stopped for want of a report still needs an upload",
      (needsAttention([{ ran_for: "2026-10-23", status: "no-report", error: null, summary: null }, ok("2026-10-22")], oct23am)[0] as { needsUpload: boolean }).needsUpload,
      true);
check("the newest morning stopping is an item",
      needsAttention([{ ran_for: "2026-10-22", status: "failed", error: "Could not read the report.", summary: null }], oct23am).map((i) => i.kind),
      ["failed"]);

/* ----------------------------------------------------- catching up ------ */

console.log("\nA missed day can be caught up, but not run early\n");

const err = (v: string | null) => {
  const r = askedFor(v, sept18);
  return "error" in r ? "refused" : r.date.iso;
};

check("a past cycle day is allowed", err("2026-09-16"), "2026-09-16");
check("today is allowed", err("2026-09-18"), "2026-09-18");

/*
 * A fee dated ahead of itself is one nobody can explain to a tenant, and the
 * report it would need does not exist yet.
 */
check("tomorrow is refused", err("2026-09-19"), "refused");
check("next year is refused", err("2027-01-16"), "refused");

// Dates that a naive parser rolls over instead of rejecting. 2026-02-31 would
// silently become the 3rd of March, and run the wrong day's step.
check("the 31st of February is refused", err("2026-02-31"), "refused");
check("a thirteenth month is refused", err("2026-13-01"), "refused");
check("a day zero is refused", err("2026-09-00"), "refused");
check("nonsense is refused", err("the sixteenth"), "refused");
check("nothing at all is refused", err(null), "refused");

// The point of allowing it: the day it names is the day that gets run.
const caught = askedFor("2026-09-16", sept18);
check("and the day it names is the one that runs",
      "error" in caught ? null : cycleDayFor(caught.date), 16);

/* ------------------------------------------------- the config agrees ----- */

console.log("\nThe schedule in the config is the one the code describes\n");

const vercel = JSON.parse(
  readFileSync(path.join(HERE, "..", "vercel.json"), "utf8"),
) as { crons?: { path: string; schedule: string }[] };

const cron = vercel.crons?.find((c) => c.path === "/api/cron");

check("vercel.json schedules the cron route", Boolean(cron), true);
check("at the expression the code documents", cron?.schedule, CRON_EXPRESSION);

/*
 * Daily, not one entry per cycle day. Six entries would put MES's calendar in
 * a config file where nothing tests it, and would leave no run on the days
 * between, so a failure on the 16th would first be noticed on the 21st.
 */
check("it runs every day, so a gap can be seen",
      /^\S+ \S+ \* \* \*$/.test(cron?.schedule ?? ""), true);

console.log("\nA report too far behind is not acted on");

/*
 * MES's Age column is fixed when they press export. It does not advance as
 * days pass, so a report pulled on the 4th and still newest on the 21st is
 * seventeen days stale and every decision from it is seventeen days old. On
 * the 16th that is $100 charged to somebody who paid a fortnight ago.
 *
 * Refused rather than done anyway: a missed fee is caught up the moment the
 * report arrives, and a wrong charge needs a phone call and a credit note.
 */
const sg = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return { iso, year: y!, month: m!, day: d!, hour: 9 };
};

check("a report from today is nought days behind",
      reportAgeDays("2026-09-16", sg("2026-09-16")), 0);
check("and one from a fortnight ago is fourteen",
      reportAgeDays("2026-09-02", sg("2026-09-16")), 14);
check("a report dated in the future is negative, not stale",
      reportAgeDays("2026-12-31", sg("2026-09-16"))! < 0, true);
check("no report date gives no answer rather than a guess",
      reportAgeDays(null, sg("2026-09-16")), null);

/* Agreed 24 October: keeping the report current is MES's, so an old report
   is acted on and flagged, never refused. A morning recorded as refused for
   an old report before then is simply run again: no upload is asked for. */
check("a fresh report is not flagged", reportAgeWarning(3), null);
check("nor one at the edge", reportAgeWarning(AGEING_AFTER_DAYS), null);
check("one a day past it is flagged", reportAgeWarning(AGEING_AFTER_DAYS + 1) !== null, true);
check("and the flag says how old, and what to do",
      /39 days old.*Upload a newer report/.test(reportAgeWarning(39) ?? ""), true);
check("a future-dated report is not old", reportAgeWarning(-40), null);
check("no report date, no warning", reportAgeWarning(null), null);


console.log("\nWhich recorded runs actually need attention\n");

/*
 * The schedule screen counted every run whose status was not "ok" as a
 * failure. Twenty five mornings a month record "nothing-due", so a month in
 * which nothing went wrong reported five failed runs in red - on the screen
 * a client is shown first, and in the guide written from it.
 */
check("a run that did work is fine", runNeedsLookingAt("ok"), false);
check("a quiet day is fine too, not a failure", runNeedsLookingAt("nothing-due"), false);
check("a run that errored needs looking at", runNeedsLookingAt("error"), true);
check("so does one that could not read the report", runNeedsLookingAt("no-report"), true);
check("and any status nobody anticipated", runNeedsLookingAt("something-new"), true);

/* The whole point: a healthy month counts zero failures. */
const month = ["ok", "nothing-due", "nothing-due", "ok", "nothing-due", "nothing-due", "nothing-due"];
check("a month of work and quiet days has no failures",
  month.filter(runNeedsLookingAt).length, 0);
check("and one real error in that month counts exactly one",
  [...month, "error"].filter(runNeedsLookingAt).length, 1);

console.log("\nA report whose checks failed is not acted on\n");

/*
 * The upload screen's worst answer is "do not use this data". It reached a
 * person and nothing else: the checks ran in the browser and the result was
 * never written down, so the nine o'clock run went ahead on the same figures
 * and sent letters and raised fees from them.
 */
const failed = { ...UNKNOWN, verdict: "error" as const, failed: ["Our total does not match MES's own subtotals"] };
const clean = { ...UNKNOWN, verdict: null };
const warned = { ...UNKNOWN, verdict: "warning" as const };
const overridden = {
  ...failed,
  overriddenAt: "2026-09-07T01:00:00Z",
  overriddenBy: "someone",
  overrideNote: "checked against NetSuite, figures are right",
};

/* The three days that write to a tenant or charge one. */
for (const day of [7, 16, 21]) {
  check(`day ${day}: a failed file is refused`, refusedByChecks(day, failed).act, false);
  check(`day ${day}: a clean file acts`, refusedByChecks(day, clean).act, true);
  check(`day ${day}: a warning is not a refusal`, refusedByChecks(day, warned).act, true);
  check(`day ${day}: an override lets it through`, refusedByChecks(day, overridden).act, true);
}

/* The three that only read and rebuild. Nothing leaves the building on those,
   and refusing them would hide the problem rather than show it. */
for (const day of [1, 4, 15]) {
  check(`day ${day}: a failed file still runs, because nothing is sent`,
    refusedByChecks(day, failed).act, true);
}

check("the refusal names the check that failed",
  (refusedByChecks(7, failed) as { why: string }).why.includes("does not match MES"), true);
check("and says how to clear it",
  (refusedByChecks(7, failed) as { why: string }).why.includes("mark this one usable"), true);
check("an override is said out loud rather than passing silently",
  (refusedByChecks(7, overridden) as { warn: string | null }).warn?.includes("usable anyway") ?? false, true);
check("and repeats the reason given",
  (refusedByChecks(7, overridden) as { warn: string | null }).warn?.includes("checked against NetSuite") ?? false, true);

/* A database without 0021 applied has no verdict to read. It must not stop
   MES's collections. */
check("an unknown verdict acts, so a missing migration is not an outage",
  refusedByChecks(7, UNKNOWN).act, true);

console.log("\nA day run twice still gets written down\n");

/*
 * run_log is unique on (ran_for, seq) and every run numbered its lines from 1,
 * so a day run a second time - a catch-up, or an officer pressing the button
 * after a failure - collided on seq 1 and the whole batch was refused. Because
 * a failed log must never stop a letter, the refusal was swallowed: the diary
 * silently recorded nothing about the rerun, which is exactly the run somebody
 * would be reading it to understand.
 */

/** Just enough Supabase to be wrong in the same way Postgres is. */
function stubDb() {
  const rows: { ran_for: string; seq: number }[] = [];
  const api = {
    rows,
    from() {
      return {
        select() {
          const q: Record<string, unknown> = {};
          const chain = {
            eq(_col: string, v: string) { q.ran_for = v; return chain; },
            order() { return chain; },
            limit() { return chain; },
            async maybeSingle() {
              const mine = rows.filter((r) => r.ran_for === q.ran_for);
              if (mine.length === 0) return { data: null, error: null };
              const top = mine.reduce((a, b) => (b.seq > a.seq ? b : a));
              return { data: { seq: top.seq }, error: null };
            },
          };
          return chain;
        },
        async insert(batch: { ran_for: string; seq: number }[]) {
          for (const r of batch) {
            if (rows.some((x) => x.ran_for === r.ran_for && x.seq === r.seq)) {
              /* The unique constraint, as Postgres reports it. */
              return { error: { message: 'duplicate key value violates unique constraint "run_log_ran_for_seq_key"' } };
            }
          }
          rows.push(...batch);
          return { error: null };
        },
      };
    },
  };
  return api;
}

const db = stubDb();

const first = runLog(db as never, "2026-09-07");
first.say("start", "woke");
first.say("report", "read the report");
first.say("finish", "done");
const firstProblem = await first.flush();

check("the first run writes its lines", db.rows.length, 3);
check("numbered from one", db.rows.map((r) => r.seq).join(","), "1,2,3");
check("and reports no problem", firstProblem, null);

const second = runLog(db as never, "2026-09-07");
second.say("start", "woke again");
second.say("finish", "refused, the checks failed");
const secondProblem = await second.flush();

check("the rerun is written down too", db.rows.length, 5);
check("carrying on from where the day left off", db.rows.map((r) => r.seq).join(","), "1,2,3,4,5");
check("and it reports no problem either", secondProblem, null);

/* A different day is numbered from one again. */
const other = runLog(db as never, "2026-09-16");
other.say("start", "a different day");
await other.flush();
check("another day starts at one", db.rows.filter((r) => r.ran_for === "2026-09-16")[0]?.seq, 1);
check("without disturbing the first day", db.rows.filter((r) => r.ran_for === "2026-09-07").length, 5);

console.log(failures === 0 ? "\nALL CHECKS PASS\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
