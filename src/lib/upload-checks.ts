"use client";

import type { ParseResult, ParsedContacts } from "./parser.ts";
import type { ParsedAgingDetail } from "./aging-detail.ts";
import type { Dataset } from "./dataset.ts";

/**
 * What is wrong with an upload, before anybody acts on it.
 *
 * The parser already reports rows it could not read. These are the other kind
 * of fault: files that each parsed perfectly and are wrong *together*, or
 * wrong for the moment they were uploaded. Nothing in a single file can catch
 * those, and every one of them has already happened on this project:
 *
 *   - a contact list for JPD uploaded against a Blue Stars AR report, so 185
 *     of 190 tenants silently became unreachable
 *   - a contact list three months older than the balances it addresses
 *   - the AR report uploaded on its own, so the reminder run had nobody to
 *     send to and said nothing about why
 *
 * Each finding says what is wrong, what it means, and what to do. A warning
 * nobody can act on is noise, and noise is how the real ones get ignored.
 */

export type Severity = "error" | "warning" | "note";

export interface Finding {
  severity: Severity;
  /** Short enough to scan in a list. */
  title: string;
  /** What it means and what to do about it. */
  detail: string;
}

const pct = (n: number, of: number) => (of === 0 ? 0 : Math.round((n / of) * 100));

/** Days between two ISO dates, or null if either is unreadable. */
function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const t1 = Date.parse(a);
  const t2 = Date.parse(b);
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return null;
  return Math.round((t1 - t2) / 86_400_000);
}

export function checkUpload(
  results: ParseResult[],
  /** What every screen is using now, so a step backwards can be spotted. */
  active: Dataset | null,
): Finding[] {
  const out: Finding[] = [];

  const aging = results.find((r) => r.kind === "ar-aging-detail") as
    | ParsedAgingDetail
    | undefined;
  const summary = results.find((r) => r.kind === "ar-summary");
  const contacts = results.find((r) => r.kind === "contact-list") as
    | ParsedContacts
    | undefined;
  const unreadable = results.filter((r) => r.kind === "unreadable");

  /* ------------------------------------------------------- the AR report */

  if (unreadable.length > 0) {
    out.push({
      severity: "error",
      title: `${unreadable.length} file${unreadable.length === 1 ? "" : "s"} could not be read at all`,
      detail:
        "Nothing in them was used. The reasons are listed below, row by row.",
    });
  }

  if (!aging && !summary) {
    out.push({
      severity: "error",
      title: "No AR report in this upload",
      detail:
        "Every figure on every screen comes from the AR report, so without " +
        "one there is nothing to show. Add the Custom A/R Aging Detail export.",
    });
    return out;
  }

  if (aging && !aging.asOf) {
    out.push({
      severity: "error",
      title: "The AR report carries no date",
      detail:
        'Aging is worked out from the "As of" row above the column headers. ' +
        "Without it nothing can be aged, and the figures must not be used.",
    });
  }

  if (aging) {
    const total = aging.accounts.reduce((n, a) => n + a.total, 0);
    const theirs = aging.subtotals.reduce((n, s) => n + s.total, 0);
    if (aging.subtotals.length > 0 && Math.abs(total - theirs) > 0.02) {
      out.push({
        severity: "error",
        title: "Our total does not match MES's own subtotals",
        detail:
          `We read ${total.toFixed(2)} but the file's own "Total - DORM-x" ` +
          `lines add to ${theirs.toFixed(2)}. Something was mis-read, or the ` +
          "export is inconsistent. Do not act on these figures.",
      });
    }

    if (aging.accounts.length === 0) {
      out.push({
        severity: "error",
        title: "No tenant accounts were found",
        detail:
          "The file was read but produced no customers. Check it is the aging " +
          "detail export and not a summary or a different report.",
      });
    }

    // Uploading an older report than the one in use is almost always an
    // accident, and it silently rewinds every figure on every screen.
    if (active && active.source === "uploaded" && aging.asOf) {
      const gap = daysBetween(aging.asOf, active.asOf);
      if (gap !== null && gap < 0) {
        out.push({
          severity: "warning",
          title: "This report is older than the one currently loaded",
          detail:
            `It is dated ${aging.asOf}; the system is using ${active.asOf}. ` +
            `Using it would move every figure back ${Math.abs(gap)} days. ` +
            "Check you picked the right export.",
        });
      }
    }
  }

  /* ----------------------------------------------------- the contact list */

  const accounts = aging?.accounts ?? [];

  if (!contacts) {
    out.push({
      severity: "warning",
      title: "No contact list in this upload",
      detail:
        "Addresses already in the system are kept, so this is only a problem " +
        "if none were loaded before. Without them the bulk reminders on the " +
        "7th and the 21st have nobody to send to.",
    });
  } else {
    const codes = new Set(contacts.contacts.map((c) => c.customerCode.toUpperCase()));
    const matched = accounts.filter((a) => codes.has(a.customerCode.toUpperCase()));
    const reach = pct(matched.length, accounts.length);

    out.push({
      severity: "note",
      title: `${contacts.contacts.length} companies on the contact list`,
      detail:
        `${contacts.contacts.reduce((n, c) => n + c.emails.length, 0)} addresses ` +
        `in total, across ${contacts.sheets.length} sheets.`,
    });

    // The one that matters. Two files that each parsed perfectly can still be
    // about different dormitories, and nothing inside either one says so.
    if (accounts.length > 0 && reach < 50) {
      out.push({
        severity: "warning",
        title: `Only ${matched.length} of ${accounts.length} tenants can be emailed`,
        detail:
          `The contact list matches ${reach}% of the accounts in this AR ` +
          "report. The two files are probably about different dormitories. " +
          `The other ${accounts.length - matched.length} can only be phoned.`,
      });
    } else if (accounts.length > 0 && reach < 100) {
      out.push({
        severity: "note",
        title: `${matched.length} of ${accounts.length} tenants can be emailed`,
        detail: `${accounts.length - matched.length} have no address and stay on the call list.`,
      });
    }

    // An address list older than the balances it addresses will be missing
    // whoever moved in since.
    const gap = daysBetween(aging?.asOf ?? null, contacts.asOf);
    if (gap !== null && gap > 45) {
      out.push({
        severity: "warning",
        title: `The contact list is ${gap} days older than the AR report`,
        detail:
          `It is dated ${contacts.asOf}, the AR report ${aging?.asOf}. Any ` +
          "tenant who moved in since will have no address on it.",
      });
    }

    if (contacts.contacts.length === 0) {
      out.push({
        severity: "error",
        title: "The contact list has no email addresses in it",
        detail:
          "Only the combined sheet carries addresses; the per-dormitory sheets " +
          "are names and status. Check the right workbook was uploaded.",
      });
    }
  }

  return out;
}

/** The worst severity present, for a badge at the top of the panel. */
export function worst(findings: Finding[]): Severity | null {
  if (findings.some((f) => f.severity === "error")) return "error";
  if (findings.some((f) => f.severity === "warning")) return "warning";
  return findings.length > 0 ? "note" : null;
}
