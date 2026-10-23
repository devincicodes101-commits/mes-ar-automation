/**
 * Which of MES's days it is, decided in Singapore rather than in UTC.
 *
 * Vercel runs cron in UTC. MES's month is in Singapore. Those disagree for
 * eight hours of every day, and the disagreement is not academic: a job set to
 * run at 20:00 UTC on the 15th fires at 04:00 on the 16th in Singapore, and a
 * job set for 00:00 UTC on the 16th fires at 08:00 on the 16th, which is what
 * is wanted. Get it wrong by one and the $100 late fee is raised on the wrong
 * day, or the final notice goes out before the 30 day credit has expired.
 *
 * So nothing here reads the server's local date. The instant is converted to
 * Singapore first and the day of the month taken from that.
 *
 * Singapore is UTC+8 all year and has been since 1982. It has no daylight
 * saving and no plans for any, so a fixed offset is exact rather than an
 * approximation, and is preferred to a timezone database that would have to be
 * shipped and kept current to tell us the same thing.
 */

import { CYCLE_DAYS, type CycleDay } from "./cycle.ts";

/** Singapore Standard Time, fixed since 1982. */
export const SGT_OFFSET_MINUTES = 8 * 60;

export interface SgDate {
  /** ISO date as Singapore sees it, which is what everything is keyed on. */
  iso: string;
  year: number;
  month: number;
  /** Day of the month, 1 to 31. */
  day: number;
  /** Hour, 0 to 23, for saying when a run happened. */
  hour: number;
}

/** The instant, as Singapore sees it. */
export function inSingapore(at: Date = new Date()): SgDate {
  const shifted = new Date(at.getTime() + SGT_OFFSET_MINUTES * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  return {
    iso: `${year}-${p(month)}-${p(day)}`,
    year,
    month,
    day,
    hour: shifted.getUTCHours(),
  };
}

/** The cycle day this date is, or null if MES do nothing on it. */
export function cycleDayFor(d: SgDate): CycleDay | null {
  return (CYCLE_DAYS as readonly number[]).includes(d.day) ? (d.day as CycleDay) : null;
}

/**
 * The month we are actually in, as the first of it.
 *
 * The one answer to "which month is this", for everything that happens once
 * per tenant per month: the reminder, the final notice, the $100.
 *
 * It comes from the calendar rather than from the report on screen, and the
 * difference is not academic. The screens used to read the month off the
 * uploaded sheet, so loading a December report during November made them
 * forget every letter sent and every fee raised that month — they were
 * looking up December, finding nothing, and offering to do it all again. The
 * schedule never had the fault, because it had always used the date.
 *
 * MES's own rule is written as a calendar rule: the fee applies "if payment is
 * not received by the 15th day of each calendar month". The month is November
 * because it is November, not because of what is printed on a spreadsheet.
 */
export function currentPeriod(at: Date = new Date()): string {
  return periodOf(inSingapore(at));
}

/** The first of the month, which is how periods are stored. */
export function periodOf(d: SgDate): string {
  return `${d.year}-${String(d.month).padStart(2, "0")}-01`;
}

/**
 * The mornings between two dates that nothing ran on.
 *
 * A cron that fails is silent. Vercel retries nothing, and the only evidence
 * is a run that is not in the table. Every morning counts since reminders
 * follow each tenant's billing date rather than MES's old six days: it named
 * a missed 4th, which no longer does anything, and said nothing about a
 * missed ordinary morning. The 16th is the costly one - the 17th does not
 * raise its fees - which needsAttention() says separately.
 *
 * Both ends exclusive of the last run and inclusive of today, because the last
 * run already happened and today is the one being decided.
 */
export function missedSince(lastRun: string | null, today: SgDate): string[] {
  if (!lastRun) return [];

  const from = new Date(`${lastRun}T00:00:00Z`);
  const to = new Date(`${today.iso}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return [];

  const missed: string[] = [];
  const cursor = new Date(from.getTime());
  cursor.setUTCDate(cursor.getUTCDate() + 1);

  /*
   * Capped rather than unbounded. A database restored from an old backup, or a
   * project that sat idle over a holiday, would otherwise walk years a day at
   * a time and report a list nobody can act on. Sixty days is two full cycles,
   * which is long enough to cover a real outage and short enough to stay
   * readable.
   */
  for (let guard = 0; cursor < to && guard < 60; guard += 1) {
    missed.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return missed;
}

/**
 * When the cron should fire, as a UTC crontab expression.
 *
 * Daily rather than one entry per cycle day, and deliberately so. Six entries
 * would put MES's calendar in a configuration file where nothing tests it, and
 * would leave no run at all on the days between, so a failure on the 16th
 * would first be noticed on the 21st. Running every day means the code decides
 * what the day is, missedSince can see a gap, and there is a heartbeat.
 *
 * 01:00 UTC is 09:00 in Singapore: inside working hours, so a person is around
 * when the 7th's reminders and the 16th's fees appear, and far enough from
 * midnight that a slow run cannot slide into the following day.
 */
export const CRON_EXPRESSION = "0 1 * * *";

/**
 * A date somebody asked for by hand, checked before it is used.
 *
 * missedSince reports which cycle days went by unrun. Reporting a gap with no
 * way to close it is half a feature: MES's 16th is the $100 fee, and "it did
 * not run and cannot now" is not an answer anybody can act on. So the run can
 * be pointed at a past date.
 *
 * Refused rather than defaulted when it makes no sense, because a catch up
 * that silently ran a different day from the one asked for is worse than one
 * that did nothing. A future date is refused outright: the report it would
 * need does not exist yet, and a fee dated ahead of itself is a fee nobody can
 * explain to a tenant.
 */
export function askedFor(value: string | null, today: SgDate): { date: SgDate } | { error: string } {
  if (!value) return { error: "No date given." };

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return { error: `"${value}" is not a date in YYYY-MM-DD form.` };

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);

  // Round trips through a real date, so 2026-02-31 and 2026-13-01 are caught
  // rather than quietly rolling into March and January.
  const made = new Date(Date.UTC(year, month - 1, day));
  if (
    made.getUTCFullYear() !== year ||
    made.getUTCMonth() + 1 !== month ||
    made.getUTCDate() !== day
  ) {
    return { error: `There is no such date as ${value}.` };
  }

  if (value > today.iso) {
    return {
      error:
        `${value} has not happened yet in Singapore, where it is ${today.iso}. ` +
        "A day can be caught up, not run early.",
    };
  }

  return {
    date: { iso: value, year, month, day, hour: today.hour },
  };
}

/* --------------------------------------------- how old the report is --- */

/**
 * Where it is worth saying "this report is getting old".
 *
 * Said, never acted on. The run used to refuse to send or charge anything once
 * the newest report was more than 25 days old, so a tenant who had paid since
 * the export would not be chased. Agreed 24 October: MES may upload whenever
 * they like, and keeping the report current - so that tenants who have paid
 * drop out of it - is theirs to do. The run always acts on the newest report
 * and says when it is old, on The Schedule and in the run's notes.
 */
export const AGEING_AFTER_DAYS = 16;

/**
 * How far behind the loaded report is, in days, or null where it cannot say.
 *
 * Negative means the report is dated in the future, which happens when
 * somebody loads next month's export early. That is not stale, and treating
 * it as such would refuse a run over a report fresher than today.
 */
export function reportAgeDays(reportDate: string | null, today: SgDate): number | null {
  if (!reportDate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(reportDate);
  if (!m) return null;
  const from = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const to = Date.UTC(today.year, today.month - 1, today.day);
  return Math.round((to - from) / 86_400_000);
}

/**
 * The warning for a report that is getting old, or null.
 *
 * A report dated ahead of today (next month's export loaded early) is not old.
 */
export function reportAgeWarning(ageDays: number | null, after: number = AGEING_AFTER_DAYS): string | null {
  if (ageDays === null || ageDays <= after) return null;
  return (
    `The newest report is ${ageDays} days old. The run acted on it, but a tenant ` +
    "who has paid since it was exported is still in it. Upload a newer report."
  );
}

/**
 * Whether a recorded run needs somebody to look at it.
 *
 * Two statuses mean the morning went as it should. "ok" is a day that did
 * work. "nothing-due" is one of the twenty five mornings a month when the
 * schedule woke, found today is not one of MES's six days, and recorded that
 * it had nothing to do. The cron route writes that row deliberately, so the
 * next run can tell "nothing was due" from "nothing ran" - those need
 * opposite responses, and a morning missing from the history is the one that
 * matters.
 *
 * The schedule screen used to treat everything that was not "ok" as a
 * failure, which counted a perfectly healthy month as five failed runs and
 * badged each quiet day in red. Kept here rather than in the page because it
 * is a statement about what the statuses mean, not about how they look.
 */
export const RUN_WENT_FINE = ["ok", "nothing-due"];

export function runNeedsLookingAt(status: string): boolean {
  return !RUN_WENT_FINE.includes(status);
}

/** The part of a recorded run's summary that says what happened to its letters. */
export interface RunLetterSummary {
  lettersWritten?: number;
  lettersSent?: number;
  lettersBlocked?: number;
  lettersFailed?: number;
  lettersDeferred?: number;
  /** A morning in several parts: which part recorded this, and what the
      earlier parts sent. See continueInAnotherRun in the cron route. */
  part?: number;
  sentEarlier?: number;
  blockedBecause?: string | null;
  failedBecause?: string | null;
  notes?: string[];
  wrote?: { name: string }[];
}

export interface LetterDelivery {
  written: number;
  sent: number;
  /** Held back by the mail gate on purpose - test mode, or sending off. */
  blocked: number;
  /** Tried and went wrong - most often the Google connection. */
  failed: number;
  /** Not tried: the run's time ran out first. Tried again at the next run. */
  deferred: number;
  /** Sent by earlier parts of the same morning, and how many parts so far. */
  sentEarlier: number;
  parts: number;
  blockedBecause: string | null;
  failedBecause: string | null;
}

/**
 * What became of a run's letters, and why any did not go.
 *
 * The schedule screen listed who a run "wrote to" beside a Letters column of
 * 0, and said nothing else. From 4 to 13 October every morning's letters
 * failed because the Google connection had lapsed; the screen read as though
 * all was well, and "Runs that failed" said 0. The reason was recorded every
 * time, in the run's notes, which no screen showed.
 *
 * Runs recorded before the counts and reasons were stored separately carry
 * them only in `notes`, so they are read from there: the gate's line
 * ("N letters were written but not sent. <why>") and the per-tenant failure
 * lines ("<company>: <why>").
 *
 * Null when the run wrote no letters.
 */
export function letterDelivery(s: RunLetterSummary | null | undefined): LetterDelivery | null {
  if (!s) return null;
  const written = s.lettersWritten ?? s.wrote?.length ?? 0;
  if (written === 0 && !(s.sentEarlier ?? 0)) return null;

  const sent = s.lettersSent ?? 0;
  const blocked = s.lettersBlocked ?? 0;
  const deferred = s.lettersDeferred ?? 0;
  const failed = s.lettersFailed ?? Math.max(0, written - sent - blocked - deferred);
  const notes = s.notes ?? [];

  let blockedBecause = s.blockedBecause ?? null;
  if (blockedBecause === null && blocked > 0) {
    for (const n of notes) {
      const m = /^\d+ letters were written but not sent\. (.+)$/.exec(n);
      if (m) {
        blockedBecause = m[1]!;
        break;
      }
    }
  }

  let failedBecause = s.failedBecause ?? null;
  if (failedBecause === null && failed > 0) {
    const names = (s.wrote ?? []).map((w) => `${w.name}: `);
    for (const n of notes) {
      const who = names.find((p) => n.startsWith(p));
      if (who) {
        failedBecause = n.slice(who.length);
        break;
      }
    }
  }

  return {
    written,
    sent,
    blocked,
    failed,
    deferred,
    sentEarlier: s.sentEarlier ?? 0,
    parts: s.part ?? 1,
    blockedBecause: blockedBecause === null ? null : plainBlockedReason(blockedBecause),
    failedBecause,
  };
}

/**
 * The gate's reason, said once for the whole run.
 *
 * The gate explains each letter on its own and names that tenant's addresses,
 * which is right for one letter and wrong for 238: the first tenant's address
 * would stand for everybody's. Said in general terms where the reason is the
 * same for all of them.
 */
export function plainBlockedReason(reason: string): string {
  if (/not on the test list/i.test(reason)) {
    return "Test mode: only addresses on the test list can be written to.";
  }
  if (/sending is off/i.test(reason)) {
    return "Sending is switched off.";
  }
  return reason;
}

/**
 * A run somebody should look at: one that failed outright, one whose
 * letters failed to send, or one that ran out of time before trying them
 * all. Letters held back by test mode are not on the list: that is the gate
 * doing what it was set to do.
 */
export function runNeedsAttention(run: { status: string; summary: RunLetterSummary | null }): boolean {
  if (runNeedsLookingAt(run.status)) return true;
  const d = letterDelivery(run.summary);
  return (d?.failed ?? 0) > 0 || (d?.deferred ?? 0) > 0;
}

/* ------------------------------------------------------ needs attention --- */

/**
 * By this hour in Singapore the morning is over: the 9am run and the 10, 11
 * and 12 o'clock follow-ups (vercel.json) have all had their turn. Before it,
 * a morning with letters still to go may simply not be finished yet.
 */
export const MORNING_SETTLED_HOUR = 13;

/** Run statuses that mean the report was missing, too old, or failed its checks. */
/* Not "report-too-old": the run no longer stops for an old report, so a
   morning recorded that way before 24 October runs if it is run again. */
export const REFUSED_FOR_THE_REPORT = ["no-report", "checks-failed"];

export interface AttentionRun {
  ran_for: string;
  status: string;
  error: string | null;
  summary: RunLetterSummary | null;
}

export type AttentionItem =
  /* The 16th did not run, or stopped: that month's late fees were never raised. */
  | { kind: "fee-day"; date: string; error: string | null; needsUpload: boolean }
  /* The newest morning ran but some of its letters did not go. */
  | { kind: "unfinished"; date: string; notSent: number; written: number; why: string | null }
  /* The newest morning stopped before doing its work. */
  | { kind: "failed"; date: string; error: string | null; needsUpload: boolean }
  /* Nothing has run today, and the morning is over. */
  | { kind: "not-today"; date: string; lastRan: string }
  /* Mornings that did not run. Their reminders were not sent: each letter has
     one day, and a later morning does not send it. */
  | { kind: "gap"; dates: string[] };

/**
 * What on the schedule somebody should do something about, from its history.
 *
 * A date picker asked the officer to know which morning had gone wrong. The
 * history already says: a morning with no row, a 16th that stopped, a run
 * whose letters did not all go. Only those that need a hand get a button.
 * A missed ordinary morning is listed so somebody knows its reminders did not
 * go: each letter has one day, and the next morning does not send it. A
 * retry for those is to come; running the morning again sends them. A missed
 * 16th has its own button, because
 * the 17th does not raise the 16th's fees.
 *
 * Running a morning again is always safe: every letter and fee is keyed so a
 * second run skips what the first one did.
 */
export function needsAttention(runs: AttentionRun[], today: SgDate): AttentionItem[] {
  if (runs.length === 0) return [];
  const byDay = new Map(runs.map((r) => [r.ran_for, r]));
  const newestFirst = [...runs].sort((a, b) => b.ran_for.localeCompare(a.ran_for));
  const newest = newestFirst[0]!;
  const oldest = newestFirst[newestFirst.length - 1]!;
  const settled = today.hour >= MORNING_SETTLED_HOUR;
  const isFeeDay = (iso: string) => Number(iso.slice(8, 10)) === 16;
  /* Stopped for want of a usable report: running again refuses again. */
  const needsUpload = (status: string) => REFUSED_FOR_THE_REPORT.includes(status);

  /* Every morning from the first recorded run to the last one that should
     have happened by now, and which of them have no row. */
  const lastDue = settled ? today.iso : shiftDay(today.iso, -1);
  const missing: string[] = [];
  for (let d = shiftDay(oldest.ran_for, 1), guard = 0; d <= lastDue && guard < 90; d = shiftDay(d, 1), guard += 1) {
    if (!byDay.has(d)) missing.push(d);
  }

  const items: AttentionItem[] = [];

  for (const d of missing.filter(isFeeDay)) {
    items.push({ kind: "fee-day", date: d, error: null, needsUpload: false });
  }
  for (const r of newestFirst) {
    if (isFeeDay(r.ran_for) && runNeedsLookingAt(r.status)) {
      items.push({ kind: "fee-day", date: r.ran_for, error: r.error ?? r.status, needsUpload: needsUpload(r.status) });
    }
  }

  /* A run that stopped has stopped: the follow-ups refuse for the same
     reason. Only letters still to go may yet be sent this morning. */
  const stillRunning = newest.ran_for === today.iso && !settled;
  if (!isFeeDay(newest.ran_for) && runNeedsLookingAt(newest.status)) {
    items.push({
      kind: "failed",
      date: newest.ran_for,
      error: newest.error ?? newest.status,
      needsUpload: needsUpload(newest.status),
    });
  }
  const d = letterDelivery(newest.summary);
  const notSent = (d?.failed ?? 0) + (d?.deferred ?? 0);
  if (d && notSent > 0 && !stillRunning) {
    items.push({
      kind: "unfinished",
      date: newest.ran_for,
      notSent,
      written: d.written,
      why: d.failedBecause,
    });
  }

  const ordinary = missing.filter((m) => !isFeeDay(m));
  if (ordinary.includes(today.iso)) {
    items.push({ kind: "not-today", date: today.iso, lastRan: newest.ran_for });
  }
  /* The last month only: an older gap was answered long ago. */
  const monthAgo = shiftDay(today.iso, -31);
  const covered = ordinary.filter((m) => m < newest.ran_for && m >= monthAgo);
  if (covered.length > 0) items.push({ kind: "gap", dates: covered });

  return items;
}

function shiftDay(iso: string, by: number): string {
  const t = new Date(`${iso}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + by);
  return t.toISOString().slice(0, 10);
}
