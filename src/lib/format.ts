/**
 * One way of writing dates and times, everywhere.
 *
 * MES work in Singapore and the 9am run is Singapore's 9am, so every date and
 * time on screen is Singapore time whatever the browser's own zone is: a
 * letter sent at 01:00 UTC reads 9:00 am, the time it went out in the office.
 *
 *   date      22 Oct 2026
 *   dateTime  22 Oct 2026, 9:02 am
 *   month     October 2026
 */

const TZ = "Asia/Singapore";

const DATE = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  day: "numeric",
  month: "short",
  year: "numeric",
});

const TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const MONTH = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});

/** A bare calendar date ("2026-10-22") is a day, not an instant: never shift it. */
function parse(value: string | Date): { at: Date; dayOnly: boolean } | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : { at: value, dayOnly: false };
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (day) {
    return { at: new Date(Date.UTC(+day[1], +day[2] - 1, +day[3], 4)), dayOnly: true };
  }
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : { at, dayOnly: false };
}

/** "22 Oct 2026". Falls back to the input when it is not a date. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const p = parse(value);
  return p ? DATE.format(p.at).replace("Sept", "Sep") : String(value);
}

/** "22 Oct 2026, 9:02 am", Singapore time. */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const p = parse(value);
  if (!p) return String(value);
  if (p.dayOnly) return formatDate(value);
  return `${formatDate(p.at)}, ${TIME.format(p.at).toLowerCase().replace(/\s/g, " ")}`;
}

/** "9:02 am", Singapore time. */
export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const p = parse(value);
  return p ? TIME.format(p.at).toLowerCase() : String(value);
}

/** "October 2026", from "2026-10", "2026-10-01" or a full date. */
export function formatMonth(value: string | null | undefined): string {
  if (!value) return "-";
  const m = /^(\d{4})-(\d{2})/.exec(value.trim());
  if (!m) return value;
  return MONTH.format(new Date(Date.UTC(+m[1], +m[2] - 1, 1)));
}
