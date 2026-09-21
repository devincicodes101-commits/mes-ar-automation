/**
 * What the schedule will do next, worked out the way the schedule works it out.
 *
 *   npm run predict:schedule
 *
 * Reads the stored report and the month's record from the live database, then
 * asks the same two functions /api/cron asks — priorContact() and runDay() —
 * for each of the six days. Nothing is typed out by hand and nothing is
 * written: if this says seven letters go out on the 7th and six arrive, the
 * disagreement is real and worth chasing.
 *
 * It exists so that "is it automatic" can be answered by checking rather than
 * by trusting. Write the prediction down before the day, touch nothing, and
 * compare afterwards.
 *
 * ---------------------------------------------------------------------------
 * The month matters more than the day
 *
 * Each letter and each fee happens once per tenant per calendar month, so a
 * prediction for the 7th of next month is not the same as for the 7th of this
 * one: next month the record is empty again and everybody is due. The day is
 * given as a real date for that reason, not as a number.
 */
import { createClient } from "@supabase/supabase-js";

import { newestReport } from "../src/lib/read-report.ts";
import { buildPipeline } from "../src/lib/pipeline.ts";
import { CYCLE_DAYS, planFor, runDay, type CycleDay } from "../src/lib/cycle.ts";
import { priorContact, stateFrom } from "../src/lib/prior-contact.ts";
import { inSingapore, periodOf } from "../src/lib/schedule.ts";
import { overdueTotal } from "../src/lib/data.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("\n  NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

const stored = await newestReport(db);
if (!stored.ok || !stored.report) {
  console.error(`\n  No report to predict from. ${!stored.ok ? stored.error : stored.reason}\n`);
  process.exit(1);
}
const report = stored.report;

const today = inSingapore();
console.log(`\n  Singapore today   ${today.iso}`);
console.log(`  Report loaded     ${report.asOf}  (${report.accounts.length} tenants)`);

/* The next six dates the schedule will act on, starting after today. Real
   dates, because the month decides what is already done. */
function nextDates(count: number): { iso: string; day: CycleDay }[] {
  const out: { iso: string; day: CycleDay }[] = [];
  const d = new Date(`${today.iso}T00:00:00Z`);
  for (let i = 1; out.length < count && i < 120; i += 1) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDate();
    if ((CYCLE_DAYS as readonly number[]).includes(day)) {
      out.push({ iso: d.toISOString().slice(0, 10), day: day as CycleDay });
    }
  }
  return out;
}

const pipeline = buildPipeline(report.accounts, report.invoices, report.asOf, null, []);
const byId = new Map(report.accounts.map((a) => [a.id, a]));

/*
 * Chained within a month, reset at its boundary.
 *
 * The 21st has to know the 7th will have run, or the prediction says nobody
 * gets a final notice and the reason reads as a fault rather than as a
 * sequence. So each day's outcome becomes the next day's starting point for
 * as long as the month lasts, which is what the database will be holding by
 * the time that day arrives.
 *
 * A new month starts from what is stored, because that is all a new month
 * has: the record is per calendar month and October knows nothing of
 * September.
 */
const started = new Map<string, Awaited<ReturnType<typeof priorContact>>>();
let carried: ReturnType<typeof stateFrom> | null = null;
let carriedFor: string | null = null;

for (const { iso, day } of nextDates(6)) {
  const period = periodOf({ ...today, iso, year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)), day });

  let memory = started.get(period);
  if (!memory) {
    memory = await priorContact(db, period);
    started.set(period, memory);
  }
  if (!memory.ok) {
    console.log(`\n  ${iso}  could not read the month: ${memory.error}`);
    continue;
  }

  if (carriedFor !== period) {
    carried = stateFrom(memory.prior);
    carriedFor = period;
  }

  const before = carried!;
  const plan = planFor(pipeline, before, day, null);
  const after = runDay(pipeline, before, day, null);

  /* What this day adds, which is what lands in an inbox. Measured against the
     day before it rather than against the month's opening record, or the 7th's
     letters would be counted a second time on the 21st. */
  const hadBefore = day === 21 ? before.finalNotice : before.firstReminder;
  const newLetters = (day === 21 ? after.finalNotice : after.firstReminder).filter(
    (id) => !hadBefore.includes(id),
  );
  const newFees = after.charged.filter((id) => !before.charged.includes(id));

  carried = after;

  console.log(`\n  ${iso}   the ${day}${day === 1 || day === 21 ? "st" : "th"}   month ${period.slice(0, 7)}`);
  console.log(`    ${plan.title}`);

  if (day === 7 || day === 21) {
    const what = day === 21 ? "final notice" : "first reminder";
    if (newLetters.length === 0) {
      console.log(`    no ${what} goes to anybody`);
    } else {
      console.log(`    ${newLetters.length} ${what}${newLetters.length === 1 ? "" : "s"}:`);
      for (const id of newLetters) {
        const a = byId.get(id);
        if (!a) continue;
        console.log(
          `      ${(a.customerCode || "?").padEnd(9)} ${a.companyName.slice(0, 30).padEnd(31)}` +
            ` ${a.emails.join(", ")}`,
        );
      }
    }
    const held = plan.willDo.filter((t) => /held back/.test(t));
    for (const h of held) console.log(`    ${h}`);
  } else if (day === 16) {
    if (newFees.length === 0) {
      console.log("    no fee is raised");
    } else {
      console.log(`    $${pipeline.lateFees.fee} raised against ${newFees.length}:`);
      for (const id of newFees) {
        const a = byId.get(id);
        if (a) console.log(`      ${(a.customerCode || "?").padEnd(9)} ${a.companyName.slice(0, 30)}`);
      }
    }
  } else {
    console.log("    nothing is written on this day");
  }
}

const owing = report.accounts.filter((a) => overdueTotal(a) > 0);
const noAddress = owing.filter((a) => !a.hasContact);
console.log(
  `\n  ${owing.length} tenants owe money. ${noAddress.length} have no address and can only be rung:` +
    ` ${noAddress.map((a) => a.customerCode).join(", ") || "none"}\n`,
);
