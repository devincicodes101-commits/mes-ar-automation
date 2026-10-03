import { NextResponse } from "next/server";

import { serverSupabase } from "@/lib/supabase-server";
import { newestReport } from "@/lib/read-report";
import { refusedByChecks, uploadStanding } from "@/lib/upload-verdict";
import { buildPipeline } from "@/lib/pipeline";
import { planFor, runDay, type CycleDay, type SimState } from "@/lib/cycle";
import { lettersSince, priorContact, stateFrom, type PriorContact } from "@/lib/prior-contact";
import { readReminderWindow } from "@/lib/reminder-window";
import {
  lettersToWrite,
  linesByAccount,
  remindersDueOn,
  type HeldLetter,
  type PlannedLetter,
} from "@/lib/reminder-timing";
import { runLog, type RunLog } from "@/lib/run-log";
import type { Pipeline } from "@/lib/pipeline";
import { send } from "@/lib/mail";
import { renderLetter } from "@/lib/letters";
import {
  askedFor,
  cycleDayFor,
  inSingapore,
  missedSince,
  periodOf,
  reportAgeDays,
  tooOldToAct,
  type SgDate,
} from "@/lib/schedule";

/**
 * MES's month, running without anybody opening a browser.
 *
 * Their cycle is six days: the 1st, 4th, 7th, 15th, 16th and 21st. Until now
 * every one of them needed an officer to be at a screen, which is the whole
 * reason the database had to come first. A cron job has no browser and cannot
 * read local storage.
 *
 * What this is not: a second implementation of the month. The days are decided
 * by runDay() in lib/cycle.ts, which the simulation screen runs and which 275
 * behaviour cases cover. This route reads the stored report, asks that library
 * what today does, and writes the answer down. If it grew its own idea of what
 * the 16th means, the screen and the schedule would quietly disagree and the
 * only sign would be a fee that appears in one and not the other.
 *
 * ---------------------------------------------------------------------------
 * Whether anything is sent
 *
 * MAIL_MODE decides, and it is off by default. Every letter is written to
 * emails_sent first with was_simulated true, and the flag is cleared only once
 * the letter genuinely left, so the day sending was switched on stays findable
 * in the data forever after.
 *
 * This section used to say "Nothing is sent", on the strength of
 * CAN_SEND_FOR_REAL being a constant false. That constant never gated the
 * send: the loop below calls send() regardless and the gate it meets is
 * MAIL_MODE. The header was describing a build that had not existed for some
 * time, and the run summary was repeating it.
 *
 * ---------------------------------------------------------------------------
 * Running twice, and the month's memory
 *
 * Vercel does not promise exactly once, and a person may call this by hand. So
 * every write is idempotent: late_fees has unique (tenant_id, period), letters
 * upsert on an id derived from the day and the tenant, and the run itself is
 * keyed on the Singapore date. A second call on the same day re-reports and
 * changes nothing.
 *
 * Idempotent writes were never the whole of it, though, because the run also
 * has to know what happened on the days before this one and on this one from
 * another hand. It reads that back from emails_sent and late_fees through
 * priorContact(); see lib/prior-contact.ts for what went wrong while it did
 * not.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The 21st touches every overdue tenant and writes a letter for each.
export const maxDuration = 60;

/**
 * Vercel sends this on every scheduled invocation.
 *
 * Without it the URL is a button that anybody on the internet can press to
 * raise fees and write letters. Checked before anything is read, and compared
 * in a way that does not leak the secret's length by how long it takes.
 */
function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const given = /^Bearer\s+(.+)$/i.exec(header.trim())?.[1] ?? "";
  if (given.length !== secret.length) return false;

  let diff = 0;
  for (let i = 0; i < secret.length; i += 1) {
    diff |= given.charCodeAt(i) ^ secret.charCodeAt(i);
  }
  return diff === 0;
}

interface RunRow {
  ran_for: string;
  cycle_day: number | null;
  status: string;
  summary: Record<string, unknown>;
  missed: string[];
  report_date: string | null;
  error: string | null;
  /*
   * Stamped on every run, including a rerun of a day already recorded.
   *
   * It was left to the column default, which only applies on insert. A day run
   * a second time kept the first run's started_at and took the second's
   * finished_at, so the row described a run that began on 21 September and
   * ended on 1 October - two events reported as one, and a duration of ten
   * days against a job that takes seconds.
   */
  started_at: string;
  finished_at: string;
}

export async function GET(request: Request) {
  if (!authorised(request)) {
    /*
     * Deliberately says nothing about why. A missing secret and a wrong one
     * are the same answer here, because the difference is only useful to
     * somebody guessing.
     */
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }

  const now = inSingapore();
  /* When this run began, for the row below. See RunRow.started_at. */
  const startedAt = new Date().toISOString();

  /*
   * Catching up a day that did not run.
   *
   * missedSince reports which cycle days went by unrun, and reporting a gap
   * with no way to close it is half a feature: on the 16th that gap is the
   * $100 fee, and "it did not run and cannot now" is not an answer anybody can
   * act on.
   *
   * Not a hole in the door. The secret has already been checked, and anybody
   * holding it can trigger a run regardless. What this changes is which day is
   * run, not who may run one.
   */
  const requested = new URL(request.url).searchParams.get("for");
  const chosen = requested ? askedFor(requested, now) : { date: now };

  if ("error" in chosen) {
    return NextResponse.json({ ok: false, error: chosen.error }, { status: 400 });
  }

  const today = chosen.date;
  const day = cycleDayFor(today);
  const caughtUp = today.iso !== now.iso;

  let db;
  try {
    db = serverSupabase();
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }

  /*
   * What ran last, so a gap is visible. A cron that fails is silent: Vercel
   * retries nothing and tells nobody, and the only evidence is a row that is
   * not there. On this calendar a missed 16th is money not charged and a
   * missed 21st is a tenant not chased.
   */
  const last = await db
    .from("cron_runs")
    .select("ran_for")
    .lt("ran_for", today.iso)
    .order("ran_for", { ascending: false })
    .limit(1)
    .maybeSingle();

  const missed = missedSince((last.data?.ran_for as string) ?? null, today);

  /*
   * The diary. Lines are held in memory and written once, after cron_runs
   * exists — run_log points at it, so the parent row has to be there first.
   */
  const log = runLog(db, today.iso);
  log.say("start", `The schedule woke for ${today.iso}`, {
    singaporeDate: today.iso,
    cycleDay: day,
    askedFor: requested ?? null,
    caughtUp,
    missedDays: missed,
  });

  const finish = async (
    row: Omit<RunRow, "ran_for" | "missed" | "started_at" | "finished_at">,
  ) => {
    log.say("finish", `The run ended as "${row.status}"`, {
      status: row.status,
      error: row.error,
      summary: row.summary,
    }, { level: row.status === "failed" ? "error" : "info" });

    const full: RunRow = {
      ...row,
      ran_for: today.iso,
      missed,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    };
    const written = await db.from("cron_runs").upsert(full, { onConflict: "ran_for" });

    /*
     * After the upsert, never before: run_log.ran_for references cron_runs,
     * so the day has to exist. And swallowed rather than raised — the run has
     * happened, and reporting the day as failed because its diary could not
     * be written would be the tail wagging the dog.
     */
    const logged = await log.flush();
    return NextResponse.json({
      ok: row.status !== "failed",
      ranFor: today.iso,
      cycleDay: row.cycle_day,
      status: row.status,
      caughtUp,
      missed,
      summary: row.summary,
      error: row.error,
      /*
       * Said out loud. If the run worked but could not be recorded, the next
       * run will think this one never happened and report it as missed, and
       * somebody should know which of the two is wrong.
       */
      recorded: written.error ? `not recorded: ${written.error.message}` : true,
      logged: logged ?? `${log.size()} lines`,
    });
  };

  /*
   * No early exit on the days MES do nothing on.
   *
   * There used to be one here: anything but the 1st, 4th, 7th, 15th, 16th or
   * 21st was recorded as nothing-due without reading anything. Reminders are
   * now counted from each tenant's billing date, so any day can carry a
   * letter, and the only way to know is to read the report. A day with
   * nothing to write is still recorded as nothing-due, further down, once
   * that has been established rather than assumed.
   */

  const stored = await newestReport(db);

  if (!stored.ok) {
    log.say("report", "Could not read the stored report", {
      error: stored.error, detail: stored.detail,
    }, { level: "error" });
    return finish({
      cycle_day: day,
      status: "failed",
      summary: {},
      report_date: null,
      error: `${stored.error} ${stored.detail ?? ""}`.trim(),
    });
  }

  /*
   * A cycle day with nothing to run against. This is a real situation rather
   * than an error: MES upload on the 4th, so the 1st of a month where nothing
   * has been loaded yet has no figures. Recorded as its own status so it does
   * not read as a failure, and so that it does read as something to look at if
   * it happens on the 16th.
   */
  if (!stored.report) {
    log.say("report", "There is no stored report to run against", {
      reason: stored.reason, checked: stored.checked ?? null,
    }, { level: "warn" });
    return finish({
      cycle_day: day,
      /* On a day that is not one of MES's, an empty database is simply a day
         with nothing to do, as it always was. */
      status: day === null ? "nothing-due" : "no-report",
      summary: { reason: stored.reason },
      report_date: null,
      error: null,
    });
  }

  const report = stored.report;

  try {
    const pipeline = buildPipeline(
      report.accounts,
      report.invoices,
      report.asOf,
      null,
      [],
    );

    /*
     * A fresh state each run, not one carried across days.
     *
     * The simulation screen carries state because a person is stepping through
     * a hypothetical month and the 21st has to know the 7th happened. Out here
     * that knowledge lives in the database instead: who was written to is in
     * emails_sent, who was charged is in late_fees, who promised is in
     * promises. Carrying a second copy in a state object would mean two
     * answers to the same question, and the one in memory would be the one
     * that vanished when the function returned.
     */
    const period = periodOf(today);

    /*
     * What has already been done to these tenants this month.
     *
     * This used to be emptyState(). The run woke every morning knowing
     * nothing: not who was written to on the 7th, not who it had written to
     * itself the last time it ran, not what an officer had sent by hand. So
     * the 21st sent the final notice to every owing tenant with an address,
     * reminded or not, and a replayed day sent the lot again.
     *
     * Still read by calendar month, because the $100 fee is charged once a
     * month and promises are read from here too. Letters are no longer decided
     * from this: see lettersSince below.
     *
     * A failed read is not an empty one. If the record cannot be read the run
     * stops rather than proceeding as though nothing had happened, because
     * "nothing has happened" is the answer that causes a second letter.
     */
    const memory = await priorContact(db, period);
    if (!memory.ok) {
      log.say("memory", "Could not read this month's record, so the run stopped", {
        error: memory.error,
      }, { level: "error" });
      return finish({
        cycle_day: day,
        status: "failed",
        summary: {},
        report_date: report.asOf,
        error: memory.error,
      });
    }
    log.say("memory", "Read what has already been done this month", {
      period,
      alreadyCharged: Array.from(memory.prior.charged),
      promisesStanding: Array.from(memory.prior.promises).map(([id, p]) => ({
        tenantId: id, amount: p.amount, by: p.by,
      })),
    });

    /*
     * ------------------------------------------------------------------
     * Which reminders fall due today, counted from each tenant's own
     * billing date.
     *
     * This used to be "is today the 7th or the 21st". MES's reports carry
     * dozens of billing dates, so a fixed day gave a tenant billed on the
     * 2nd five days' grace and one billed on the 28th forty. Now each tenant
     * is chased the same number of days into their own newest bill, and those
     * two numbers are read from the database - the Settings screen writes
     * them there - rather than carried in the code.
     *
     * Worked out before the gates, not after, because the gates only matter
     * on a day that writes to somebody, and that is no longer a fact about
     * the calendar. It is a fact about the tenants.
     * ------------------------------------------------------------------
     */
    const timing = await readReminderWindow(db);
    const days = timing.window;
    log.say("plan", `Reminders counted from the billing date: first after ${days.first} days, final after ${days.final}`, {
      days,
      source: timing.source,
      problem: timing.problem,
    }, { level: timing.problem ? "warn" : "info" });

    const due = remindersDueOn(
      pipeline.accounts,
      linesByAccount(pipeline.accounts, report.invoices),
      today.iso,
      days,
    );

    /*
     * What each of them has really been sent since their bill was raised.
     * Read no further back than the oldest bill in question, and only when
     * there is a question: a day with nobody due reads nothing.
     */
    const oldestBill = due.reduce<string | null>(
      (min, d) => (min === null || d.billedOn < min ? d.billedOn : min),
      null,
    );
    const sent = oldestBill
      ? await lettersSince(db, oldestBill)
      : { ok: true as const, letters: [] };
    if (!sent.ok) {
      log.say("memory", "Could not read which reminders have gone, so the run stopped", {
        error: sent.error,
      }, { level: "error" });
      return finish({
        cycle_day: day,
        status: "failed",
        summary: {},
        report_date: report.asOf,
        error: sent.error,
      });
    }

    const decided = lettersToWrite(due, sent.letters, today.iso, days);

    /*
     * The two holds that are about the tenant rather than the timing. No
     * address beats everything: they go to the call list and Send By Hand.
     * Then a promise that has not yet passed.
     */
    const byIdEarly = new Map(pipeline.accounts.map((a) => [a.id, a]));
    const letters: PlannedLetter[] = [];
    const held: HeldLetter[] = [...decided.held];
    for (const l of decided.write) {
      const a = byIdEarly.get(l.accountId);
      const promise = memory.prior.promises.get(l.accountId);
      if (!a?.hasContact) {
        held.push({
          accountId: l.accountId,
          why: "no email address, so they go to the call list and Send By Hand",
        });
      } else if (promise && promise.by >= today.iso) {
        held.push({
          accountId: l.accountId,
          why: `promised $${promise.amount} by ${promise.by}`,
        });
      } else {
        letters.push(l);
      }
    }

    log.say("plan", `${letters.length} reminder letters due today, ${held.length} held back`, {
      due: due.length,
      first: letters.filter((l) => l.stage === "first-reminder").length,
      final: letters.filter((l) => l.stage === "final-notice").length,
      held: held.length,
    });

    /*
     * A day that writes to somebody. The 16th charges the fee; any day can
     * now carry letters.
     */
    const writesToday = day === 16 || letters.length > 0;

    /* Nothing to write and not one of MES's days: recorded and done, as
       before, but with the reasons in the diary rather than unasked. */
    if (!writesToday && day === null) {
      for (const h of held) {
        log.say("plan", `Not written to: ${byIdEarly.get(h.accountId)?.companyName ?? h.accountId} — ${h.why}`, {
          why: h.why,
        }, { tenant: h.accountId });
      }
      return finish({
        cycle_day: null,
        status: "nothing-due",
        summary: { remindersDue: due.length, heldBack: held.length },
        report_date: report.asOf,
        error: null,
      });
    }

    /*
     * How far behind the figures are, and whether this day should act on them.
     *
     * The Age column is fixed when MES press export; it does not advance as
     * days pass. So a report pulled on the 4th and still newest on the 21st is
     * seventeen days stale, and every decision from it is seventeen days out of
     * date. On a day that writes to a tenant that matters: the 16th would
     * charge $100 to somebody who paid a fortnight ago.
     *
     * Refused rather than done anyway, because a missed fee can be caught up
     * the moment the report arrives and a wrong charge cannot be taken back
     * without a phone call and a credit note. A missed reminder catches itself
     * up too: the next run finds the tenant still past their date.
     */
    const ageDays = reportAgeDays(report.asOf, today);
    const freshness = tooOldToAct(day ?? 0, ageDays, writesToday);
    if (!freshness.act) {
      log.say("report", freshness.why, {
        reportDate: report.asOf,
        ageDays,
        cycleDay: day,
      }, { level: "error" });
      return finish({
        cycle_day: day,
        status: "report-too-old",
        summary: { title: "The report is too far behind to act on", reportAgeDays: ageDays },
        report_date: report.asOf,
        error: freshness.why,
      });
    }

    /*
     * And whether the file passed its own checks.
     *
     * Second gate, same shape as the staleness one above and for the same
     * reason. That one asks whether the figures are current; this asks whether
     * they hold together. The upload screen already decides it - the strongest
     * check adds each customer up and compares against the total MES print for
     * that customer in the same file - but the answer was only ever shown to
     * whoever was looking. The run could not read it, so a file marked "do not
     * use this data" was used at nine the next morning.
     */
    const standing = await uploadStanding(db);
    const checks = refusedByChecks(day ?? 0, standing, writesToday);
    if (!checks.act) {
      log.say("report", checks.why, {
        reportDate: report.asOf,
        verdict: standing.verdict,
        failed: standing.failed,
        cycleDay: day,
      }, { level: "error" });
      return finish({
        cycle_day: day,
        status: "checks-failed",
        summary: {
          title: "The checks on this report failed, so nothing was sent",
          failed: standing.failed,
        },
        report_date: report.asOf,
        error: checks.why,
      });
    }
    /* Carried rather than pushed: the run's notes are gathered further down. */
    const checksWarning = checks.warn;
    if (checksWarning) {
      log.say("report", checksWarning, { verdict: standing.verdict }, { level: "warn" });
    }

    log.say("report", `Read the report of ${report.asOf}`, {
      reportDate: report.asOf,
      tenants: report.accounts.length,
      invoiceLines: report.invoices.length,
      ageDays,
      owing: report.accounts.filter((a) => a.total > 0).length,
      withAnAddress: report.accounts.filter((a) => a.hasContact).length,
      label: report.label,
    });

    const before = stateFrom(memory.prior, today.iso);

    /*
     * The cycle still decides the fee, and only the fee.
     *
     * runDay on the 7th or the 21st would decide letters by the calendar, and
     * those are now decided above. Only the days whose work is not a letter
     * are handed to it: the 16th charges, the 1st, 4th and 15th are read and
     * described. On every other day there is no cycle work at all.
     */
    const cycleWork = day !== null && day !== 7 && day !== 21 ? day : null;
    const plan = cycleWork !== null ? planFor(pipeline, before, cycleWork, null) : null;
    const after = cycleWork === 16 ? runDay(pipeline, before, 16, null) : before;

    const firstCount = letters.filter((l) => l.stage === "first-reminder").length;
    const finalCount = letters.length - firstCount;
    const letterLine =
      letters.length > 0
        ? `${firstCount} first reminder${firstCount === 1 ? "" : "s"} and ` +
          `${finalCount} final notice${finalCount === 1 ? "" : "s"}, counted from each tenant's billing date`
        : null;
    const title =
      [plan?.title ?? null, letterLine].filter(Boolean).join(" · ") ||
      "No reminders fall due today";

    if (plan) {
      log.say("plan", plan.title, {
        willDo: plan.willDo,
        blockers: plan.blockers,
        affected: plan.affected,
        value: plan.value,
        fromFlowTab: plan.fromFlowTab,
      });
    }

    const wrote = await persist(
      db, day, today, period, after, pipeline, memory.prior, log, checksWarning,
      letters, held,
    );
    if (freshness.warn) {
      wrote.notes.unshift(freshness.warn);
      log.say("report", freshness.warn, { ageDays }, { level: "warn" });
    }
    if (timing.source === "default") {
      wrote.notes.push(
        `Reminder timing used the built-in ${days.first} and ` +
          `${days.final} days, because the database holds no setting` +
          (timing.problem ? `: ${timing.problem}` : "."),
      );
    }

    return finish({
      cycle_day: day,
      status: "ok",
      summary: {
        // Named, so a run somebody triggered by hand is never mistaken later
        // for one the schedule did on the day.
        ...(caughtUp ? { caughtUpOn: now.iso } : {}),
        title,
        willDo: plan?.willDo ?? [],
        blockers: plan?.blockers ?? [],
        affected: plan?.affected ?? 0,
        value: plan?.value ?? 0,
        reminderWindow: days,
        ...wrote,
        /*
         * No `simulated` flag. It was `!CAN_SEND_FOR_REAL`, a constant that is
         * always false, so every run recorded simulated: true — including this
         * morning's, which really sent four final notices. The real gate is
         * MAIL_MODE, and lettersWritten, lettersSent and lettersBlocked above
         * already say exactly what happened without anybody having to know
         * that. A flag that is wrong in the direction nobody checks is worse
         * than no flag.
         */
      },
      report_date: report.asOf,
      error: null,
    });
  } catch (e) {
    return finish({
      cycle_day: day,
      status: "failed",
      summary: {},
      report_date: report.asOf,
      error: (e as Error).message,
    });
  }
}


/**
 * Writing down what the day did.
 *
 * Only two things outlive the run: a fee raised on the 16th, and a letter that
 * would have gone out. Everything else the day produces is a restatement of
 * the report, which is already stored, and copying it would give two places to
 * disagree.
 */
async function persist(
  db: ReturnType<typeof serverSupabase>,
  day: CycleDay | null,
  today: SgDate,
  period: string,
  after: SimState,
  pipeline: Pipeline,
  prior: PriorContact,
  log: RunLog,
  /** Said by the checks gate, which runs before this list exists. */
  checksWarning: string | null,
  /** Today's reminders, decided from each tenant's billing date. */
  letters: PlannedLetter[],
  /** And the ones due but deliberately not sent, with the reason. */
  held: HeldLetter[],
): Promise<{
  feesRaised: number;
  lettersWritten: number;
  lettersSent: number;
  lettersBlocked: number;
  notes: string[];
  /*
   * Who, not how many.
   *
   * The record said "4 letters" and nothing else, which is a number nobody
   * can check. A run is worth reading six weeks later only if it says which
   * tenants it wrote to, and — the part that matters more — which ones it
   * deliberately left alone and why. "Orchard was held back, they promised to
   * pay by the 23rd" is the difference between a schedule somebody trusts and
   * one they have to take on faith.
   */
  wrote: { code: string; name: string }[];
  chargedTo: { code: string; name: string }[];
  heldBack: { code: string; name: string; why: string }[];
}> {
  const notes: string[] = [];
  if (checksWarning) notes.push(checksWarning);
  const byId = new Map(pipeline.accounts.map((a) => [a.id, a]));

  /*
   * Read off the state the day produced rather than scraped out of its log.
   * The log is prose written for a person to read and its wording is free to
   * change; these arrays are what the day decided, and they are what the
   * behaviour suite asserts on.
   *
   * The run no longer starts from emptyState(), so these arrays are everything
   * that has happened this month and not only today's doing. Today's doing is
   * the difference, and taking it is not cosmetic: without it a rerun would
   * rewrite every letter already sent this month and report having sent them
   * all again.
   */
  const charged = after.charged.filter((id) => !prior.charged.has(id));
  /*
   * Letters are no longer read off the cycle's state. They arrive decided -
   * by billing date, against what each tenant has really been sent since that
   * bill - and this only writes them down and sends them.
   */
  const written = letters.map((l) => l.accountId);
  const planned = new Map(letters.map((l) => [l.accountId, l]));

  let feesRaised = 0;
  if (charged.length > 0) {
    /*
     * ignoreDuplicates, not merge. late_fees is unique on (tenant_id, period)
     * precisely so a rerun on the 16th cannot charge a tenant twice, and
     * merging would overwrite the original timestamp and lose when the charge
     * was actually raised.
     */
    const rows = charged.map((id) => ({
      tenant_id: id,
      period,
      basis: "flat" as const,
      rule_value: pipeline.lateFees.fee,
      amount: pipeline.lateFees.fee,
    }));
    const r = await db.from("late_fees").upsert(rows, {
      onConflict: "tenant_id,period",
      ignoreDuplicates: true,
    });
    if (r.error) {
      notes.push(`fees not raised: ${r.error.message}`);
      log.say("fee", "The fees could not be written", { error: r.error.message },
        { level: "error" });
    } else {
      feesRaised = rows.length;
      /* One line per tenant, not one for the batch. The question asked six
         weeks later is about one tenant, and a row saying "3 fees" cannot
         answer it. */
      for (const id of charged) {
        const a = byId.get(id);
        log.say("fee", `Raised $${pipeline.lateFees.fee} against ${a?.companyName ?? id}`, {
          period,
          amount: pipeline.lateFees.fee,
          overdue: a?.total ?? null,
          customerCode: a?.customerCode ?? null,
          property: a?.property ?? null,
        }, { tenant: id });
      }
    }
  }

  let lettersWritten = 0;
  let lettersSent = 0;
  let lettersBlocked = 0;
  let blockedBecause: string | null = null;

  if (written.length > 0) {
    /*
     * Written first, then sent, one at a time.
     *
     * The record goes down before the attempt so a letter that leaves and then
     * fails to be recorded is impossible: the row exists either way, and the
     * send updates it. The other order would lose a letter that went out.
     *
     * One at a time because Google does not rate limit politely. Forty at once
     * locks sending for about a day, which on the 21st means the final notice
     * reaching some tenants and not others with no way to finish.
     *
     * Nothing leaves unless the gate lets it, and the gate is off by default.
     * On a build where sending is switched off this loop still runs, still
     * records the letters, and every attempt comes back blocked with a reason.
     */
    const rows = written
      .map((id) => {
        const account = byId.get(id);
        if (!account) return null;

        /*
         * Rendered from the report date, not from today. A letter that quotes
         * a deadline counted from the day it happened to be generated would
         * give a different date to the same tenant depending on when the run
         * fired, which is the sort of thing a tenant notices and an officer
         * cannot explain.
         */
        const plannedLetter = planned.get(id)!;
        const isFinal = plannedLetter.stage === "final-notice";
        const letter = renderLetter(plannedLetter.stage, {
          companyName: account.companyName,
          grandTotal: account.total,
          sentOn: today.iso,
        });

        return {
          /*
           * Derived rather than random, so a second run on the same day
           * upserts the same row instead of writing a second letter to a
           * tenant who only got one.
           */
          /*
           * One row per tenant, per bill, per letter - not per day. A run that
           * tries again tomorrow, because sending was off or the send failed,
           * lands on the same row instead of writing a second letter.
           */
          id: letterId(`${plannedLetter.billedOn}|${plannedLetter.stage}|${id}`),
          tenant_id: id,
          /* The ids every sender already uses. Named for the 7th and the 21st,
             which they no longer mean; see lettersSince. */
          template_id: isFinal ? "final-21st" : "reminder-7th",
          template_name: isFinal ? "Final notice" : "First reminder",
          /* Which cycle this belongs to, so the screens can tell a letter
             already sent this month from one sent last month. */
          period,
          subject: letter.subject,
          recipients: account.emails,
          sent_at: new Date().toISOString(),
          was_simulated: true,
          /*
           * The letter itself, not just its subject. A subject line and a
           * recipient say a send happened, not whether it was right: every
           * date and amount is merged here, so this is the only place a broken
           * template would show.
           */
          body: letter.body,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (rows.length > 0) {
      const r = await db.from("emails_sent").upsert(rows, { onConflict: "id" });
      if (r.error) notes.push(`letters not recorded: ${r.error.message}`);
      else lettersWritten = rows.length;

      /*
       * No second check here, and that is deliberate.
       *
       * There used to be one, and it did nothing. It asked which of these row
       * ids were already marked really sent — but it asked immediately after
       * the upsert above, whose payload carries was_simulated: true, so the
       * upsert reset the flag on every row a moment before the query tested
       * it. The answer was always "none". A replayed day resent the lot, which
       * is exactly what the check had been written to prevent, and the wiring
       * guard that covered it only checked that the code was present.
       *
       * It was blind in a second way too. Row ids are derived from the date,
       * the day and the tenant, so a letter an officer sent by hand from the
       * Reminders screen — which gets a random id — could never match one.
       * Same tenant, same letter, same month, twice.
       *
       * Both are gone because the question is now asked once, earlier, and in
       * the terms it should always have been asked in: has this tenant really
       * received this letter this month, however it was sent. See
       * priorContact(), and `written` above, which is what is left after the
       * answer is taken away.
       */
      for (const row of rows) {
        const account = byId.get(row.tenant_id);
        if (!account) continue;

        /*
         * Null for the user, because the schedule is nobody. That is what the
         * nominated account is for: on the 7th at 9am there is no session to
         * read, so the send goes out as whichever connected account was chosen
         * deliberately for it.
         */
        const outcome = await send(db, null, {
          to: row.recipients,
          subject: row.subject,
          body: row.body,
          tenantId: row.tenant_id,
          companyName: account.companyName,
        });

        if (outcome.sent) {
          lettersSent += 1;
          log.say("letter", `${row.template_name} sent to ${account.companyName}`, {
            to: row.recipients,
            from: outcome.from ?? null,
            subject: row.subject,
            period,
            templateId: row.template_id,
            billedOn: planned.get(row.tenant_id)?.billedOn ?? null,
            note: planned.get(row.tenant_id)?.note ?? null,
          }, { tenant: row.tenant_id });
          // was_simulated false only once a letter genuinely left, so the day
          // sending was switched on stays findable in the data afterwards.
          await db
            .from("emails_sent")
            .update({ was_simulated: false, sent_from: outcome.from ?? null })
            .eq("id", row.id);
        } else if (outcome.blocked) {
          lettersBlocked += 1;
          /* Blocked and failed are different words here for the same reason
             they are different words on screen: one of them means trying
             again will do exactly the same thing. */
          log.say("letter", `Held back: ${account.companyName}`, {
            to: row.recipients,
            reason: outcome.reason,
            subject: row.subject,
          }, { level: "warn", tenant: row.tenant_id });
          /* The gate's own words, kept for the note below. It knows whether
             sending is off, whether the address is outside the test list, or
             whether the letter came out with a merge field still in it, and
             those need three different responses. */
          if (!blockedBecause) blockedBecause = outcome.reason ?? null;
        } else {
          notes.push(`${account.companyName}: ${outcome.reason}`);
          log.say("letter", `Failed to send to ${account.companyName}`, {
            to: row.recipients,
            reason: outcome.reason,
          }, { level: "error", tenant: row.tenant_id });
        }
      }

      /*
       * Said once rather than forty times, and in the gate's words rather than
       * a guess. This used to read "Sending is switched off" whenever
       * CAN_SEND_FOR_REAL was false — which is always, because it is a
       * constant — while the thing actually deciding is MAIL_MODE. So a run
       * blocked because an address was not on the test list reported that
       * sending was off, and sent somebody to check the wrong setting.
       */
      if (lettersBlocked > 0) {
        notes.push(
          `${lettersBlocked} letters were written but not sent. ` +
            (blockedBecause ?? "No reason was given."),
        );
      }
    }
  }

  const name = (id: string) => {
    const a = byId.get(id);
    return { code: a?.customerCode ?? id, name: a?.companyName ?? id };
  };

  /*
   * Why each tenant who owes was not written to today.
   *
   * Worked out from the same facts the day used rather than guessed at, and
   * in the order the rules are applied: no address beats everything, then a
   * promise, then having already had this letter, then — on the 21st only —
   * never having had the first one.
   */
  const heldBack: { code: string; name: string; why: string }[] = [];
  /*
   * Only the tenants a reminder was due for. Before, the 7th and the 21st
   * listed every owing tenant not written to, which was a manageable list on
   * two days a month; on every day of the month it would be the whole book
   * marked "not due today", every day, and the ones that matter would drown.
   */
  for (const h of held) {
    heldBack.push({ ...name(h.accountId), why: h.why });
    const a = byId.get(h.accountId);
    log.say("plan", `Not written to: ${a?.companyName ?? h.accountId} — ${h.why}`, {
      why: h.why,
      owes: a?.total ?? null,
      hasAddress: a?.hasContact ?? null,
    }, { tenant: h.accountId });
  }

  return {
    feesRaised,
    lettersWritten,
    lettersSent,
    lettersBlocked,
    notes,
    wrote: written.map(name),
    chargedTo: charged.map(name),
    heldBack,
  };
}

/**
 * A stable uuid for one tenant's letter on one day.
 *
 * emails_sent.id is a uuid, and a rerun must land on the same row rather than
 * adding a second letter. Built from the date, the day and the tenant by a
 * plain hash: this identifies a row, it does not protect anything, so it wants
 * to be reproducible rather than unguessable.
 */
function letterId(seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < seed.length; i += 1) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + seed.charCodeAt(i) + 1, 0x85ebca6b) >>> 0;
  }
  const hex = (n: number) => n.toString(16).padStart(8, "0");
  const a = hex(h1);
  const b = hex(h2);
  const c = hex(Math.imul(h1 ^ h2, 0xc2b2ae35) >>> 0);
  const d = hex(Math.imul(h1 + h2, 0x27d4eb2f) >>> 0);
  // Version 8, the one reserved for ids built to order rather than generated.
  return `${a}-${b.slice(0, 4)}-8${b.slice(5, 8)}-a${c.slice(1, 4)}-${c.slice(4)}${d}`;
}
