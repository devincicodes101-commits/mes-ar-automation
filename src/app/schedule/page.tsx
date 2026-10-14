"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useSession, useToast } from "@/lib/session";
import { hydrateActivity, useStore } from "@/lib/store";
import { inSingapore, letterDelivery, runNeedsAttention, runNeedsLookingAt, type RunLetterSummary } from "@/lib/schedule";
import { useDataset } from "@/lib/dataset";
import { formatDate, formatSgd, invoicesForAccount, overdueTotal } from "@/lib/data";
import { billingForTenant } from "@/lib/billing-cycles";
import { letterPosition, reminderDatesFor, type LetterPosition, type SentLetter } from "@/lib/reminder-timing";
import { useReminderWindow } from "@/lib/use-reminder-window";
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

interface Run {
  ran_for: string;
  cycle_day: number | null;
  status: string;
  summary: (RunLetterSummary & {
    title?: string;
    feesRaised?: number;
    affected?: number;
    value?: number;
    /* Who was written to, charged, and left alone. A count is not something
       anybody can check against an inbox. */
    wrote?: { code: string; name: string }[];
    chargedTo?: { code: string; name: string }[];
    heldBack?: { code: string; name: string; why: string }[];
  }) | null;
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
      } else {
        const s = body.summary ?? {};
        notify(
          `Ran the 9am job for ${body.ranFor}`,
          [
            s.title ?? null,
            s.feesRaised ? `${s.feesRaised} fees raised` : null,
            `${s.lettersSent ?? 0} letters sent`,
          ].filter(Boolean).join(" · "),
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
  /* The newest 16th the run has done, for the late-fee row below. Runs come
     newest first. */
  const lastFeeDay = runs.find((r) => r.cycle_day === 16)?.ran_for ?? null;
  const { window: reminderWindow } = useReminderWindow();
  const totalFees = runs.reduce((n, r) => n + (r.summary?.feesRaised ?? 0), 0);
  /* A morning in several parts records once, carrying the earlier parts'
     letters in sentEarlier - so both are counted. */
  const totalLetters = runs.reduce(
    (n, r) => n + (r.summary?.lettersSent ?? 0) + (r.summary?.sentEarlier ?? 0),
    0,
  );
  // A quiet day is not a failure, and neither is a letter test mode held
  // back. A letter that failed to send is. See runNeedsAttention.
  const failures = runs.filter(runNeedsAttention).length;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Runs recorded"
          value={String(runs.length)}
          note="Every wake-up, whether it acted or not"
        />
        <StatTile label="Fees raised" value={String(totalFees)} note="By the schedule, on the 16th" />
        <StatTile label="Letters sent" value={String(totalLetters)} note="Reminders, from each tenant's billing date" />
        <StatTile
          label="Runs that need looking at"
          value={String(failures)}
          note={failures === 0 ? "None so far" : "Failed, or letters did not send"}
          emphasis={failures > 0}
        />
      </div>

      <WhenEachTenantIsChased />

      {/*
        * What the run does, as it does it now.
        *
        * This was "The six days" - the 1st, 4th, 7th, 15th, 16th and 21st,
        * MES's original calendar. Reminders left that calendar on 4 October
        * and follow each tenant's billing date on any morning, so four of the
        * six said "was the reminder day" or described work the run does not
        * do. What is left is two things: the reminders, every morning, and
        * the late fee, on the 16th.
        */}
      <Card>
        <CardHeader
          title="What the 9am run does"
          hint="Every morning at nine, Singapore time, the schedule reads the newest uploaded report and does the work below on its own."
        />
        <div className="grid gap-px bg-line-hair sm:grid-cols-2">
          <div className="bg-surface px-5 py-3.5">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <div className="text-sm font-medium text-ink">Every morning: reminder emails</div>
                <p className="mt-0.5 text-xs text-ink-secondary">
                  Counted from each tenant&rsquo;s billing date: the first reminder{" "}
                  {reminderWindow.first} days after, the final notice{" "}
                  {reminderWindow.final} days after.
                </p>
              </div>
              {history?.lastRun ? (
                <StatusBadge kind="good" label={`last ran for ${history.lastRun}`} />
              ) : (
                <StatusBadge kind="warning" label="never run" />
              )}
            </div>
          </div>
          <div className="bg-surface px-5 py-3.5">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <div className="text-sm font-medium text-ink">The 16th: late payment fees</div>
                <p className="mt-0.5 text-xs text-ink-secondary">
                  The S$100 fee on anything unpaid 14 days past its due date.
                  Tenants on GIRO are held back.
                </p>
              </div>
              {lastFeeDay ? (
                <StatusBadge kind="good" label={`last ran ${lastFeeDay}`} />
              ) : (
                <span className="text-[11px] text-ink-muted">not yet</span>
              )}
            </div>
          </div>
        </div>
      </Card>

      {history?.canRun && canAct ? (
        <Card className="px-5 py-4">
          <div className="flex flex-wrap items-end gap-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-ink-secondary">
                Run a missed morning
              </span>
              {/*
                * A date, and nothing chosen for you.
                *
                * There were shortcut buttons for "the 1st", "the 4th" and "the
                * 7th", which read as filters and belonged to the old calendar,
                * and an empty date ran today - which is how a 2am press on 13
                * October replaced that day's record. Now nothing runs until a
                * day is picked, and only a day that has already begun.
                */}
              <input
                id="schedule-run-date"
                type="date"
                value={when}
                max={history.today || undefined}
                onChange={(e) => setWhen(e.target.value)}
                className="rounded border border-line-hair bg-surface px-3 py-2 text-sm text-ink"
              />
            </label>
            <button
              type="button"
              onClick={runDay}
              disabled={running || !when}
              className="rounded border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? "Running..." : when ? `Run ${when}` : "Choose a date"}
            </button>
            <p className="max-w-[52ch] text-[11px] leading-relaxed text-ink-muted">
              Only for a morning the 9am run missed. This is the real run, not a
              rehearsal: it sends whatever the mail settings allow and, on the
              16th, raises the late fees. It replaces that day&rsquo;s line
              below. Running a day twice cannot charge a tenant twice.
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
                      {r.cycle_day === 16 ? (
                        <span className="text-xs font-medium text-ink">16th · fees</span>
                      ) : (
                        <span className="text-xs text-ink-muted">daily</span>
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
                      <Delivery summary={r.summary} />

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
 * What became of the run's letters, said beside the names.
 *
 * "Written to" followed by four names, beside a Letters column of 0, read as
 * four letters sent. Nine mornings in October it meant four letters that
 * failed because the Google connection had lapsed, and nothing on the screen
 * said so. Only shown when not every letter went: a run that sent all it
 * wrote needs no explaining.
 */
function Delivery({ summary }: { summary: Run["summary"] }) {
  const d = letterDelivery(summary);
  if (!d || (d.sent === d.written && d.parts === 1)) return null;
  return (
    <div className="mt-1.5 space-y-0.5 text-[11px] leading-relaxed">
      <div className="text-ink-secondary">
        {d.parts > 1 ? (
          <span className="font-medium text-ink-secondary">
            In {d.parts} parts: <span className="tabular">{d.sentEarlier}</span> sent
            by the earlier parts, then{" "}
          </span>
        ) : null}
        <span className="tabular">{d.written}</span> written ·{" "}
        <span className="tabular">{d.sent}</span> sent
        {d.blocked > 0 ? (
          <>
            {" "}· <span className="tabular">{d.blocked}</span> held back
          </>
        ) : null}
        {d.failed > 0 ? (
          <>
            {" "}· <span className="tabular font-medium text-status-critical">{d.failed} failed</span>
          </>
        ) : null}
        {d.deferred > 0 ? (
          <>
            {" "}· <span className="tabular font-medium text-status-critical">{d.deferred} not tried</span>
          </>
        ) : null}
      </div>
      {d.deferred > 0 ? (
        <div className="text-status-critical">
          <span className="font-medium">Not tried: </span>
          the run&rsquo;s time ran out. A follow-up run carries on with them
          straight away.
        </div>
      ) : null}
      {d.blocked > 0 && d.blockedBecause ? (
        <div className="text-ink-muted">
          <span className="text-ink-secondary">Held back: </span>
          {d.blockedBecause}
        </div>
      ) : null}
      {d.failed > 0 && d.failedBecause ? (
        <div className="text-status-critical">
          <span className="font-medium">Not sent: </span>
          {d.failedBecause}
        </div>
      ) : null}
    </div>
  );
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
 * Read only. Since 4 October this is what the nine o'clock run acts on: the
 * same window, read from the same place, judged against the same day. It
 * shows the rule's timing; whether a letter has already gone for a bill is
 * the run's to decide, from what was really sent, and is in its diary.
 */
function WhenEachTenantIsChased() {
  const ds = useDataset();
  const store = useStore();
  const [all, setAll] = useState(false);

  /* The window the nine o'clock run uses, read from the same place it reads
     it. This card once read the browser's copy and could disagree with the
     run about every date it showed. */
  const { window } = useReminderWindow();

  /*
   * Today in Singapore, not the report's date. This judged against the report
   * while it was only a preview; the run judges against the day it runs on,
   * because twenty-three days after a bill is a fact about the calendar, and a
   * preview that disagreed with the run about who is due would be no use.
   */
  const asOf = ds.asOf ? inSingapore().iso : null;

  /*
   * The letters that really left, by tenant - the same record the 9am run and
   * Reminder Emails read. A letter written while sending was off or blocked
   * is not here, so it does not count as sent.
   */
  const sentBy = useMemo(() => {
    const m = new Map<string, SentLetter[]>();
    for (const e of store.emails) {
      if (e.simulated || (e.templateId !== "reminder-7th" && e.templateId !== "final-21st")) continue;
      const letter: SentLetter = {
        tenantId: e.accountId,
        stage: e.templateId === "final-21st" ? "final-notice" : "first-reminder",
        sentAt: e.at,
      };
      m.set(e.accountId, [...(m.get(e.accountId) ?? []), letter]);
    }
    return m;
  }, [store.emails]);

  /* A promise to pay that has not fallen due holds the letters, as in the run. */
  const promisedFor = useMemo(() => {
    const m = new Map<string, string>();
    for (const pr of store.promises) {
      if (asOf && pr.promisedFor >= asOf) m.set(pr.accountId, pr.promisedFor);
    }
    return m;
  }, [store.promises, asOf]);

  const rows = useMemo(() => {
    if (!asOf) return [];
    /*
     * Every tenant, not only those who owe. MES asked to see all of them:
     * a tenant in credit or owing nothing is not chased, and the card says so
     * against their name rather than leaving them off the list.
     */
    return ds.accounts
      .map((a) => {
        const billing = billingForTenant(invoicesForAccount(a, ds.invoices), asOf);
        /* No reminder dates for a tenant who is not chased. */
        const dates = a.total > 0 && billing.billedOn ? reminderDatesFor(billing.billedOn, window) : null;
        return {
          id: a.id,
          name: a.companyName,
          code: a.customerCode,
          owed: overdueTotal(a) || a.total,
          total: a.total,
          billedOn: billing.billedOn,
          runs: billing.runs,
          first: dates?.first ?? null,
          final: dates?.final ?? null,
          /* Where they stand: the dates, and what has really been sent. */
          position:
            a.total > 0 && billing.billedOn
              ? letterPosition(billing.billedOn, sentBy.get(a.id) ?? [], asOf, window)
              : null,
          promised: promisedFor.get(a.id) ?? null,
        };
      })
      .sort((x, y) => (x.first ?? "9999").localeCompare(y.first ?? "9999"));
  }, [ds.accounts, ds.invoices, asOf, window, sentBy, promisedFor]);

  if (rows.length === 0) return null;

  const count = (kind: LetterPosition["kind"]) =>
    rows.filter((r) => r.total > 0 && !r.promised && r.position?.kind === kind).length;
  const missing = rows.filter((r) => r.total > 0 && r.position === null).length;
  const owingCount = rows.filter((r) => r.total > 0).length;
  const inCredit = rows.filter((r) => r.total < 0).length;
  const nothingOwed = rows.filter((r) => r.total === 0).length;
  const promisedCount = rows.filter((r) => r.promised).length;
  const shown = all ? rows : rows.slice(0, 12);

  return (
    <Card>
      <CardHeader
        title="When each tenant would be chased"
        hint={`Counted from each tenant's own billing date: first reminder after ${window.first} days, final notice after ${window.final}. Judged against today, ${asOf}, as the 9am run does.`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="good" label="What the 9am run follows" />
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
        All {rows.length} tenants. Of the {owingCount} who owe: {count("first-due")} due their first
        reminder, {count("first-sent")} sent it and waiting for the final
        notice, {count("final-due")} due the final notice, {count("final-sent")}{" "}
        sent the final notice, {count("not-yet")} not yet due
        {promisedCount > 0 ? `, ${promisedCount} holding a promise to pay` : ""}.
        {inCredit + nothingOwed > 0
          ? ` The other ${inCredit + nothingOwed} are not chased: ${inCredit} in credit, ${nothingOwed} owing nothing.`
          : ""}{" "}
        Only letters that really left count as sent.{" "}
        {missing > 0
          ? `${missing} carry no billing date in this file, so the rule cannot place them.`
          : "Every tenant who owes carries a billing date."}{" "}
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
              <th className="px-5 py-2.5">Today</th>
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
                  <Standing position={r.position} promised={r.promised} total={r.total} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollPanel>
    </Card>
  );
}

/**
 * One tenant's standing, said the way the 9am run will act on it.
 *
 * "Final notice due" against every tenant, when none had had a first
 * reminder, contradicted the run on the same screen. Now it says which letter
 * is next and which have really gone, with the date.
 */
function Standing({
  position,
  promised,
  total,
}: {
  position: LetterPosition | null;
  promised: string | null;
  /** What the tenant owes. In credit or owing nothing, they are not chased. */
  total: number;
}) {
  if (total < 0) return <StatusBadge kind="good" label="in credit, not chased" />;
  if (total === 0) return <StatusBadge kind="neutral" label="nothing owed" />;
  if (promised) {
    return <StatusBadge kind="neutral" label={`promised to pay by ${formatDate(promised)}`} />;
  }
  if (!position) return <StatusBadge kind="critical" label="no billing date" />;

  switch (position.kind) {
    case "not-yet":
      return <StatusBadge kind="neutral" label="not yet" />;
    case "first-due":
      return <StatusBadge kind="warning" label="first reminder due" />;
    case "first-sent":
      return (
        <div>
          <StatusBadge kind="good" label={`first reminder sent ${formatDate(position.firstSentOn)}`} />
          <div className="mt-1 text-[11px] text-ink-muted">
            final notice due {formatDate(position.finalDueOn)}
          </div>
        </div>
      );
    case "final-due":
      return (
        <div>
          <StatusBadge kind="serious" label="final notice due" />
          <div className="mt-1 text-[11px] text-ink-muted">
            first reminder sent {formatDate(position.firstSentOn)}
          </div>
        </div>
      );
    case "final-sent":
      return <StatusBadge kind="good" label={`final notice sent ${formatDate(position.finalSentOn)}`} />;
  }
}
