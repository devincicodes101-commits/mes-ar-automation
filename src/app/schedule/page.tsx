"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useSession, useToast } from "@/lib/session";
import { hydrateActivity, useStore } from "@/lib/store";
import { runNeedsLookingAt } from "@/lib/schedule";
import { useDataset } from "@/lib/dataset";
import { formatDate, formatSgd, invoicesForAccount, overdueTotal } from "@/lib/data";
import { billingForTenant } from "@/lib/billing-cycles";
import { reminderDatesFor, sane } from "@/lib/reminder-timing";
import { Card, CardHeader, EmptyState, ScrollPanel, StatTile, StatusBadge, Tag } from "@/components/ui";

/**
 * What the schedule has done, and a way to watch it do one.
 *
 * cron_runs was written on every run and nothing read it. So the one part of
 * this system that works on its own was the one part nobody could be shown:
 * the fees appeared, the letters went, and the only evidence the schedule had
 * fired was a row in a table with no screen.
 *
 * Dry Run answers a different question. It proves the code decides the right
 * thing; it does not prove the schedule ran. This page is the record, and the
 * button runs the real path — the same route Vercel calls, raising real fees
 * and sending whatever the mail gate currently allows.
 */

const CYCLE_DAYS = [1, 4, 7, 15, 16, 21] as const;

const WHAT_HAPPENS: Record<number, string> = {
  1: "GIRO deductions, and the 14-day deadline passes",
  4: "The report is uploaded and the month is rebuilt",
  7: "First reminder goes out",
  15: "The 30-day deadline passes",
  16: "The S$100 late fee is raised",
  21: "Final notice goes out",
};

interface Run {
  ran_for: string;
  cycle_day: number | null;
  status: string;
  summary: {
    title?: string;
    feesRaised?: number;
    lettersSent?: number;
    lettersBlocked?: number;
    affected?: number;
    value?: number;
    /* Who was written to, charged, and left alone. A count is not something
       anybody can check against an inbox. */
    wrote?: { code: string; name: string }[];
    chargedTo?: { code: string; name: string }[];
    heldBack?: { code: string; name: string; why: string }[];
  } | null;
  missed: string[] | null;
  report_date: string | null;
  error: string | null;
  finished_at: string;
}

interface History {
  ok: boolean;
  runs: Run[];
  today: string;
  todayIsCycleDay: boolean;
  lastRun: string | null;
  canRun: boolean;
  error?: string;
  hint?: string | null;
}

async function authHeader(): Promise<Record<string, string>> {
  try {
    const { supabase } = await import("@/lib/supabase");
    const token = (await supabase?.auth.getSession())?.data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

export default function SchedulePage() {
  const { canAct } = useSession();
  const { notify } = useToast();

  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [when, setWhen] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/schedule", { cache: "no-store", headers: await authHeader() });
      setHistory((await r.json()) as History);
    } catch (e) {
      setHistory({
        ok: false, runs: [], today: "", todayIsCycleDay: false,
        lastRun: null, canRun: false, error: (e as Error).message,
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runDay() {
    setRunning(true);
    try {
      const r = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ for: when || undefined }),
      });
      const body = (await r.json()) as {
        ok?: boolean; error?: string; ranFor?: string; cycleDay?: number | null;
        summary?: { feesRaised?: number; lettersSent?: number; title?: string };
      };

      if (!r.ok || !body.ok) {
        notify("The schedule did not run", body.error ?? `The server answered ${r.status}.`);
      } else if (body.cycleDay === null || body.cycleDay === undefined) {
        notify(
          `${body.ranFor} is not one of the six days`,
          "The schedule woke, found nothing to do, and recorded that.",
        );
      } else {
        const s = body.summary ?? {};
        notify(
          `Ran the ${body.cycleDay}${ordinal(body.cycleDay)} for ${body.ranFor}`,
          [
            s.feesRaised ? `${s.feesRaised} fees raised` : null,
            s.lettersSent ? `${s.lettersSent} letters sent` : null,
          ].filter(Boolean).join(" · ") || (s.title ?? "Recorded."),
        );
      }
    } catch (e) {
      notify("The schedule did not run", (e as Error).message);
    }
    setRunning(false);
    await load();
    /* The run may have written fees and letters, so the shared log is stale. */
    await hydrateActivity(true);
  }

  const runs = history?.runs ?? [];
  /* Which of the six have ever fired, so the grid says what has happened
     rather than only what is supposed to. */
  const daysRun = new Map<number, string>();
  for (const r of runs) {
    if (r.cycle_day && !daysRun.has(r.cycle_day)) daysRun.set(r.cycle_day, r.ran_for);
  }
  const totalFees = runs.reduce((n, r) => n + (r.summary?.feesRaised ?? 0), 0);
  const totalLetters = runs.reduce((n, r) => n + (r.summary?.lettersSent ?? 0), 0);
  // A quiet day is not a failure. See runNeedsLookingAt.
  const failures = runs.filter((r) => runNeedsLookingAt(r.status)).length;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Runs recorded"
          value={String(runs.length)}
          note="Every wake-up, whether it acted or not"
        />
        <StatTile label="Fees raised" value={String(totalFees)} note="By the schedule, on the 16th" />
        <StatTile label="Letters sent" value={String(totalLetters)} note="On the 7th and the 21st" />
        <StatTile
          label="Runs that failed"
          value={String(failures)}
          note={failures === 0 ? "None so far" : "These need looking at"}
          emphasis={failures > 0}
        />
      </div>

      <WhenEachTenantIsChased />

      <Card>
        <CardHeader
          title="The six days"
          hint="Every morning at nine, Singapore time, the schedule asks whether today is one of these. On the other twenty-five it records that it woke and found nothing to do."
          right={
            history?.lastRun ? (
              <StatusBadge kind="good" label={`last ran for ${history.lastRun}`} />
            ) : (
              <StatusBadge kind="warning" label="never run" />
            )
          }
        />
        <div className="grid gap-px bg-line-hair sm:grid-cols-2 xl:grid-cols-3">
          {CYCLE_DAYS.map((d) => (
            <div key={d} className="bg-surface px-5 py-3">
              <div className="flex items-baseline gap-3">
                <span className="tabular text-lg font-semibold text-ink">{d}</span>
                <span className="flex-1 text-xs text-ink-secondary">{WHAT_HAPPENS[d]}</span>
                {daysRun.has(d) ? (
                  <StatusBadge kind="good" label={`ran ${daysRun.get(d)}`} />
                ) : (
                  <span className="text-[11px] text-ink-muted">not yet</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {history?.canRun && canAct ? (
        <Card className="px-5 py-4">
          <div className="flex flex-wrap items-end gap-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-ink-secondary">
                Run a day now
              </span>
              <input
                id="schedule-run-date"
                type="date"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                className="rounded border border-line-hair bg-surface px-3 py-2 text-sm text-ink"
              />
            </label>

            {/*
              * The six days of this month, as buttons.
              *
              * A date field defaults to empty and the button beside it then
              * reads "Run today", so pressing it runs a day nobody asked for
              * — and on twenty-five days of the month that is a quiet day,
              * which does nothing and looks like the schedule is broken. It
              * happened twice in one sitting during testing.
              *
              * Only days that have already passed: a day can be caught up,
              * not run early, and offering one the route will refuse is worse
              * than not offering it.
              */}
            <div className="flex flex-wrap items-center gap-1.5">
              {cycleDatesSoFar(history?.today ?? "").map((d) => (
                <button
                  key={d.iso}
                  type="button"
                  onClick={() => setWhen(d.iso)}
                  className={`rounded border px-2.5 py-1.5 text-xs ${
                    when === d.iso
                      ? "border-accent bg-accent text-accent-ink"
                      : "border-line-hair text-ink-secondary hover:border-line-strong hover:text-ink"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={runDay}
              disabled={running}
              className="rounded border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? "Running..." : when ? `Run ${when}` : "Run today"}
            </button>
            <p className="max-w-[46ch] text-[11px] leading-relaxed text-ink-muted">
              This is the real schedule, not a rehearsal. It raises fees and sends
              whatever the mail settings currently allow. Running a day twice cannot
              charge a tenant twice.
            </p>
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="What it has done"
          hint="Newest first. A day that caught up late is marked, because a missed 16th is a fee that was never charged."
        />
        {loading ? (
          <EmptyState title="Reading the record" body="One moment." />
        ) : history && !history.ok ? (
          <EmptyState
            title="Could not read the schedule's history"
            body={`${history.error ?? ""} ${history.hint ?? ""}`.trim()}
          />
        ) : runs.length === 0 ? (
          <EmptyState
            title="The schedule has not run yet"
            body="It runs at nine each morning, Singapore time. Nothing here means nothing has fired."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line-hair text-left text-xs text-ink-muted">
                  <th className="px-5 py-2 font-medium">Ran for</th>
                  <th className="px-3 py-2 font-medium">Day</th>
                  <th className="px-3 py-2 font-medium">What it did</th>
                  <th className="px-3 py-2 text-right font-medium">Fees</th>
                  <th className="px-3 py-2 text-right font-medium">Letters</th>
                  <th className="px-5 py-2 font-medium">Finished</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.ran_for} className="border-b border-line-hair last:border-0">
                    <td className="tabular px-5 py-3 text-ink">{r.ran_for}</td>
                    <td className="px-3 py-3">
                      {r.cycle_day ? (
                        <span className="tabular font-medium text-ink">{r.cycle_day}</span>
                      ) : (
                        <span className="text-xs text-ink-muted">quiet day</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-ink-secondary">
                      <div>{r.summary?.title ?? (r.cycle_day ? "—" : "Nothing to do")}</div>
                      {r.missed && r.missed.length > 0 ? (
                        <Tag>caught up {r.missed.length} missed</Tag>
                      ) : null}
                      {runNeedsLookingAt(r.status) ? (
                        <StatusBadge kind="critical" label={r.error ?? r.status} />
                      ) : null}

                      {/* Named, because a number is not checkable. Somebody
                          holding an inbox open wants to know whether these
                          are the four they received. */}
                      {(r.summary?.wrote ?? []).length > 0 ? (
                        <div className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">
                          <span className="text-ink-secondary">Written to: </span>
                          {r.summary!.wrote!.map((t) => t.name).join(", ")}
                        </div>
                      ) : null}
                      {(r.summary?.chargedTo ?? []).length > 0 ? (
                        <div className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                          <span className="text-ink-secondary">Charged: </span>
                          {r.summary!.chargedTo!.map((t) => t.name).join(", ")}
                        </div>
                      ) : null}
                      {/* The more useful half. A tenant the schedule chose not
                          to write to, and the reason, is what turns "it sent
                          four" into something anybody can agree with. */}
                      {(r.summary?.heldBack ?? []).length > 0 ? (
                        <ul className="mt-1 space-y-0.5 text-[11px] leading-relaxed text-ink-muted">
                          {r.summary!.heldBack!.map((t) => (
                            <li key={t.code}>
                              <span className="text-ink-secondary">{t.name}</span> — {t.why}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </td>
                    <td className="tabular px-3 py-3 text-right text-ink-secondary">
                      {r.summary?.feesRaised ?? 0}
                    </td>
                    <td className="tabular px-3 py-3 text-right text-ink-secondary">
                      {r.summary?.lettersSent ?? 0}
                    </td>
                    <td className="tabular px-5 py-3 text-xs text-ink-muted">
                      {r.finished_at.slice(0, 16).replace("T", " ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/**
 * This month's cycle days that have already happened.
 *
 * Named by day rather than by date — "the 7th", not "2026-09-07" — because
 * that is how MES talk about them, and the full date is in the button beside
 * these anyway.
 */
function cycleDatesSoFar(todayIso: string): { iso: string; label: string }[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todayIso);
  if (!m) return [];
  const [, year, month, dayOfMonth] = m;
  return CYCLE_DAYS.filter((d) => d <= Number(dayOfMonth)).map((d) => ({
    iso: `${year}-${month}-${String(d).padStart(2, "0")}`,
    label: `the ${d}${ordinal(d)}`,
  }));
}

function ordinal(d: number): string {
  if (d === 1) return "st";
  if (d === 21) return "st";
  if (d === 4 || d === 7 || d === 15 || d === 16) return "th";
  return "th";
}

/**
 * Every tenant's own two reminder dates, worked out from their billing date.
 *
 * The reminder clock moved off the calendar and onto each tenant's billing
 * date, and nothing showed the result. The settings screen does the sum for
 * one made-up tenant billed on the 15th; this does it for the ones actually in
 * the uploaded report, which is the only way to tell whether the rule behaves
 * on real data - MES's export carries 28 different billing dates and some of
 * them are years old.
 *
 * Read only, and says so. It reports what the rule would decide; the schedule
 * still sends on the 7th and the 21st until the sending path is moved over,
 * and a screen that implied otherwise would be worse than no screen.
 */
function WhenEachTenantIsChased() {
  const store = useStore();
  const ds = useDataset();
  const [all, setAll] = useState(false);

  const window = sane({
    first: store.settings.firstReminderDays,
    final: store.settings.finalReminderDays,
  });

  /* The report's own date, not the wall clock: the figures are as at the
     report, so judging them against today would compare two different days. */
  const asOf = ds.asOf;

  const rows = useMemo(() => {
    if (!asOf) return [];
    return ds.accounts
      .filter((a) => a.total > 0)
      .map((a) => {
        const billing = billingForTenant(invoicesForAccount(a, ds.invoices), asOf);
        const dates = billing.billedOn ? reminderDatesFor(billing.billedOn, window) : null;
        return {
          id: a.id,
          name: a.companyName,
          code: a.customerCode,
          owed: overdueTotal(a) || a.total,
          billedOn: billing.billedOn,
          runs: billing.runs,
          first: dates?.first ?? null,
          final: dates?.final ?? null,
          /* What the rule says today, for this tenant. */
          stage:
            dates === null
              ? "no billing date"
              : asOf >= dates.final
                ? "final notice due"
                : asOf >= dates.first
                  ? "first reminder due"
                  : "not yet",
        };
      })
      .sort((x, y) => (x.first ?? "9999").localeCompare(y.first ?? "9999"));
  }, [ds.accounts, ds.invoices, asOf, window]);

  if (rows.length === 0) return null;

  const dueNow = rows.filter((r) => r.stage !== "not yet" && r.stage !== "no billing date");
  const missing = rows.filter((r) => r.stage === "no billing date").length;
  const shown = all ? rows : rows.slice(0, 12);

  return (
    <Card>
      <CardHeader
        title="When each tenant would be chased"
        hint={`Counted from each tenant's own billing date: first reminder after ${window.first} days, final notice after ${window.final}. Dates are judged against the report, ${asOf}.`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="warning" label="Not sending yet" />
            {rows.length > 12 ? (
              <button
                type="button"
                onClick={() => setAll((v) => !v)}
                className="rounded border border-line-hair px-2.5 py-1 text-xs text-ink-secondary hover:border-line-grid"
              >
                {all ? "Show fewer" : `Show all ${rows.length}`}
              </button>
            ) : null}
          </div>
        }
      />

      <div className="border-b border-line-hair bg-surface-alt px-5 py-3 text-[11px] leading-relaxed text-ink-secondary">
        {dueNow.length} of {rows.length} tenants would be due a letter as at{" "}
        {formatDate(asOf)}.{" "}
        {missing > 0
          ? `${missing} carry no billing date in this file, so the rule cannot place them.`
          : "Every tenant in this file carries a billing date."}{" "}
        Change the two numbers on the Settings screen and these dates move with
        them.
      </div>

      <ScrollPanel max={420}>
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b border-line-grid text-left text-xs font-medium text-ink-muted">
              <th className="px-5 py-2.5">Tenant</th>
              <th className="px-3 py-2.5">Billed</th>
              <th className="px-3 py-2.5">First reminder</th>
              <th className="px-3 py-2.5">Final notice</th>
              <th className="px-3 py-2.5 text-right">Owed</th>
              <th className="px-5 py-2.5">As at the report</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="border-b border-line-hair last:border-0">
                <td className="px-5 py-2.5">
                  <div className="text-ink">{r.name}</div>
                  <div className="mono text-[11px] text-ink-muted">{r.code}</div>
                </td>
                <td className="px-3 py-2.5 text-xs text-ink-secondary">
                  {r.billedOn ? formatDate(r.billedOn) : "—"}
                  {r.runs > 1 ? (
                    <span className="block text-[11px] text-ink-muted">
                      newest of {r.runs}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2.5 text-xs text-ink-secondary">
                  {r.first ? formatDate(r.first) : "—"}
                </td>
                <td className="px-3 py-2.5 text-xs text-ink-secondary">
                  {r.final ? formatDate(r.final) : "—"}
                </td>
                <td className="tabular px-3 py-2.5 text-right text-ink">
                  {formatSgd(r.owed)}
                </td>
                <td className="px-5 py-2.5">
                  <StatusBadge
                    kind={
                      r.stage === "final notice due"
                        ? "serious"
                        : r.stage === "first reminder due"
                          ? "warning"
                          : r.stage === "no billing date"
                            ? "critical"
                            : "neutral"
                    }
                    label={r.stage}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollPanel>
    </Card>
  );
}
