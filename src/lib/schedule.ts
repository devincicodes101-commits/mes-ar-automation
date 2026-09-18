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

/** The first of the month, which is how periods are stored. */
export function periodOf(d: SgDate): string {
  return `${d.year}-${String(d.month).padStart(2, "0")}-01`;
}

/**
 * The cycle days between two dates that nothing ran on.
 *
 * A cron that fails is silent. Vercel retries nothing, and the only evidence
 * is a run that is not in the table. On MES's calendar a missed day is not a
 * missed log line: the 16th is when the late fee is raised and the 21st is
 * when the final notice goes out, so a day nobody noticed is money not charged
 * and a tenant not chased.
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
    const day = cursor.getUTCDate();
    if ((CYCLE_DAYS as readonly number[]).includes(day)) {
      const p = (n: number) => String(n).padStart(2, "0");
      missed.push(
        `${cursor.getUTCFullYear()}-${p(cursor.getUTCMonth() + 1)}-${p(day)}`,
      );
    }
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
