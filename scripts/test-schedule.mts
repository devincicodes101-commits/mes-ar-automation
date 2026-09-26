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
  tooOldToAct,
  STALE_AFTER_DAYS,
  AGEING_AFTER_DAYS,
} from "../src/lib/schedule.ts";
import { CYCLE_DAYS } from "../src/lib/cycle.ts";

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

// Out since the 14th: the 15th and the 16th both went by. The 16th is the
// expensive one.
check("a gap names every cycle day inside it",
      missedSince("2026-09-14", sept18), ["2026-09-15", "2026-09-16"]);

// A gap over days MES do nothing on is not a gap worth reporting.
check("quiet days in between are not reported",
      missedSince("2026-09-17", at("2026-09-20T01:00:00Z")), ["2026-09-18", "2026-09-19"].filter(
        (d) => (CYCLE_DAYS as readonly number[]).includes(Number(d.slice(-2))),
      ));

check("a gap across a month end still names both months' days",
      missedSince("2026-08-30", at("2026-09-05T01:00:00Z")),
      ["2026-09-01", "2026-09-04"]);

/*
 * A database restored from an old backup would otherwise walk years a day at a
 * time and produce a list nobody can act on.
 */
const ancient = missedSince("2020-01-01", sept18);
check("an absurd gap is capped rather than unbounded", ancient.length <= 60 / 4 + 1, true);
check("and it is not empty, so the gap is still visible", ancient.length > 0, true);

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

check("the 16th acts on a report from the 7th", tooOldToAct(16, 9).act, true);
check("and on one at the edge of the window", tooOldToAct(16, STALE_AFTER_DAYS).act, true);
check("but not one a day past it", tooOldToAct(16, STALE_AFTER_DAYS + 1).act, false);
check("the 7th is refused too", tooOldToAct(7, 40).act, false);
check("and the 21st", tooOldToAct(21, 40).act, false);

/* The three that write are the three that matter. A day that only records
   that it woke is harmless on any data. */
check("the 1st still runs, however old the report", tooOldToAct(1, 400).act, true);
check("so does the 4th, which is the day an upload arrives", tooOldToAct(4, 400).act, true);
check("and the 15th", tooOldToAct(15, 400).act, true);

check("an ageing report is acted on and flagged",
      tooOldToAct(16, AGEING_AFTER_DAYS + 1).act === true &&
        (tooOldToAct(16, AGEING_AFTER_DAYS + 1) as { warn: string | null }).warn !== null, true);
check("a fresh one is not flagged",
      (tooOldToAct(16, 3) as { warn: string | null }).warn, null);
check("a future-dated report is never refused",
      tooOldToAct(16, -40).act, true);


console.log(failures === 0 ? "\nALL CHECKS PASS\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
