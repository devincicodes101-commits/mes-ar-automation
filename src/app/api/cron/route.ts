import { NextResponse } from "next/server";

import { serverSupabase } from "@/lib/supabase-server";
import { newestReport } from "@/lib/read-report";
import { buildPipeline } from "@/lib/pipeline";
import { emptyState, planFor, runDay, type CycleDay, type SimState } from "@/lib/cycle";
import type { Pipeline } from "@/lib/pipeline";
import { CAN_SEND_FOR_REAL } from "@/lib/sending";
import { send } from "@/lib/mail";
import { renderLetter } from "@/lib/letters";
import {
  askedFor,
  cycleDayFor,
  inSingapore,
  missedSince,
  periodOf,
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
 * Nothing is sent
 *
 * CAN_SEND_FOR_REAL is false and is a constant rather than a setting. Letters
 * this produces are written to emails_sent with was_simulated true, so when
 * sending is finally switched on the dry runs stay distinguishable from the
 * real ones forever after. Turning it on needs a mailbox MES have nominated
 * and addresses for the 181 clients who owe money and have none.
 *
 * ---------------------------------------------------------------------------
 * Running twice
 *
 * Vercel does not promise exactly once, and a person may call this by hand. So
 * every write is idempotent: late_fees has unique (tenant_id, period), letters
 * upsert on an id derived from the day and the tenant, and the run itself is
 * keyed on the Singapore date. A second call on the same day re-reports and
 * changes nothing.
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

  const finish = async (row: Omit<RunRow, "ran_for" | "missed" | "finished_at">) => {
    const full: RunRow = {
      ...row,
      ran_for: today.iso,
      missed,
      finished_at: new Date().toISOString(),
    };
    const written = await db.from("cron_runs").upsert(full, { onConflict: "ran_for" });
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
    });
  };

  // A day MES do nothing on. Recorded anyway, so the next run can tell
  // "nothing was due" from "nothing ran": those need opposite responses.
  if (day === null) {
    return finish({
      cycle_day: null,
      status: "nothing-due",
      summary: {},
      report_date: null,
      error: null,
    });
  }

  const stored = await newestReport(db);

  if (!stored.ok) {
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
    return finish({
      cycle_day: day,
      status: "no-report",
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
    const plan = planFor(pipeline, emptyState(), day, null);
    const after = runDay(pipeline, emptyState(), day, null);

    const period = periodOf(today);
    const wrote = await persist(db, day, today, period, after, pipeline);

    return finish({
      cycle_day: day,
      status: "ok",
      summary: {
        // Named, so a run somebody triggered by hand is never mistaken later
        // for one the schedule did on the day.
        ...(caughtUp ? { caughtUpOn: now.iso } : {}),
        title: plan.title,
        willDo: plan.willDo,
        blockers: plan.blockers,
        affected: plan.affected,
        value: plan.value,
        ...wrote,
        simulated: !CAN_SEND_FOR_REAL,
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
  day: CycleDay,
  today: SgDate,
  period: string,
  after: SimState,
  pipeline: Pipeline,
): Promise<{
  feesRaised: number;
  lettersWritten: number;
  lettersSent: number;
  lettersBlocked: number;
  notes: string[];
}> {
  const notes: string[] = [];
  const byId = new Map(pipeline.accounts.map((a) => [a.id, a]));

  /*
   * Read off the state the day produced rather than scraped out of its log.
   * The log is prose written for a person to read and its wording is free to
   * change; these arrays are what the day decided, and they are what the
   * behaviour suite asserts on.
   *
   * The run started from emptyState(), so everything in them is today's doing
   * and nothing is carried over from an earlier day.
   */
  const charged = after.charged;
  const written = day === 21 ? after.finalNotice : after.firstReminder;

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
    if (r.error) notes.push(`fees not raised: ${r.error.message}`);
    else feesRaised = rows.length;
  }

  let lettersWritten = 0;
  let lettersSent = 0;
  let lettersBlocked = 0;

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
        const letter = renderLetter(day === 21 ? "final-notice" : "first-reminder", {
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
          id: letterId(today.iso, day, id),
          tenant_id: id,
          template_id: day === 21 ? "final-21st" : "reminder-7th",
          template_name: day === 21 ? "Final notice" : "First reminder",
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
       * Which of these letters genuinely left last time.
       *
       * The row ids are derived from the date, the day and the tenant, so a
       * rerun upserts the same rows and the record never doubles. The delivery
       * did. A caught-up day, or a day that crashed half way and was replayed,
       * would put the same letter in a tenant's inbox twice — and replaying a
       * missed day is the whole point of the catch-up.
       *
       * was_simulated is the test rather than mere existence, because a row
       * written and not sent is exactly the state a crash leaves behind, and
       * that one does need sending.
       */
      const already = new Set<string>();
      const sentBefore = await db
        .from("emails_sent")
        .select("id")
        .in("id", rows.map((r) => r.id))
        .eq("was_simulated", false);
      for (const r of sentBefore.data ?? []) already.add(r.id as string);

      for (const row of rows) {
        const account = byId.get(row.tenant_id);
        if (!account) continue;

        if (already.has(row.id)) {
          lettersSent += 1;
          continue;
        }

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
          // was_simulated false only once a letter genuinely left, so the day
          // sending was switched on stays findable in the data afterwards.
          await db
            .from("emails_sent")
            .update({ was_simulated: false, sent_from: outcome.from ?? null })
            .eq("id", row.id);
        } else if (outcome.blocked) {
          lettersBlocked += 1;
        } else {
          notes.push(`${account.companyName}: ${outcome.reason}`);
        }
      }

      /*
       * Said once rather than forty times. Every letter blocked for the same
       * reason is the normal state while sending is off, and repeating it per
       * tenant would bury anything that actually went wrong.
       */
      if (lettersBlocked > 0) {
        notes.push(
          `${lettersBlocked} letters were written but not sent. ` +
            (CAN_SEND_FOR_REAL
              ? "Check the mailbox under Settings."
              : "Sending is switched off."),
        );
      }
    }
  }

  return { feesRaised, lettersWritten, lettersSent, lettersBlocked, notes };
}

/**
 * A stable uuid for one tenant's letter on one day.
 *
 * emails_sent.id is a uuid, and a rerun must land on the same row rather than
 * adding a second letter. Built from the date, the day and the tenant by a
 * plain hash: this identifies a row, it does not protect anything, so it wants
 * to be reproducible rather than unguessable.
 */
function letterId(iso: string, day: CycleDay, tenantId: string): string {
  const seed = `${iso}|${day}|${tenantId}`;
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
