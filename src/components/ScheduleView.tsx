"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useSession, useToast } from "@/lib/session";
import { hydrateActivity } from "@/lib/store";
import {
  inSingapore,
  letterDelivery,
  needsAttention,
  runNeedsLookingAt,
  type AttentionItem,
  type RunLetterSummary,
} from "@/lib/schedule";
import { formatDate } from "@/lib/data";
import { usePaged } from "@/lib/use-paged";
import { Card, CardHeader, EmptyState, Modal, Pagination, Skeleton, StatusBadge, TableSkeleton, Tag } from "@/components/ui";
import { formatMonth, formatTime } from "@/lib/format";

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

/**
 * The 9am run: when it last ran, what needs a hand, and what each morning
 * did. Since 24 October the "9am runs" tab of the Activity Log, which already
 * listed the same mornings; /schedule still opens it on its own.
 *
 * part "attention" is the Needs attention box alone, which the Activity Log
 * shows above its other tab, so a missed 16th or letters that did not go are
 * not hidden behind a tab nobody opens.
 */
export function ScheduleView({ part = "all" }: { part?: "all" | "attention" }) {
  const { canAct } = useSession();
  const { notify } = useToast();

  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  /* The item whose button was pressed, waiting for "are you sure". */
  const [asking, setAsking] = useState<AttentionItem | null>(null);

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

  async function runDay(when: string) {
    setRunning(true);
    try {
      const r = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ for: when }),
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
          `Ran the 9am job for ${formatDate(body.ranFor ?? null)}`,
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
    setAsking(null);
    await load();
    /* The run may have written fees and letters, so the shared log is stale. */
    await hydrateActivity(true);
  }

  const runs = history?.runs ?? [];
  /* The run history only grows; two weeks at a time. */
  const runPage = usePaged(runs, null, 14);
  /* The newest 16th the run has done, for the status line. Runs come newest
     first. */
  const lastFeeDay = runs.find((r) => r.cycle_day === 16)?.ran_for ?? null;
  /* What needs a hand, worked out from the history rather than asked for. */
  const attention = history?.ok ? needsAttention(runs, inSingapore()) : [];
  const mayRun = Boolean(history?.canRun && canAct);
  const onlyAttention = part === "attention";
  if (onlyAttention && (loading || attention.length === 0)) return null;

  return (
    <div className="space-y-5">
      {onlyAttention ? null : (
      <>
      {/* When each of the run's two jobs last happened. What they do is in
          the user manual; the day counts are in Settings, Reminder timing. */}
      <Card className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6 sm:px-5">
        {loading ? (
          <>
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-56" />
          </>
        ) : (
          <>
            <LastRan label="Reminder emails" on={history?.lastRun ?? null} />
            <LastRan label="Late fees (16th)" on={lastFeeDay} />
          </>
        )}
      </Card>
      </>
      )}

      {/* Only when something is wrong, and only what is. Replaces a date
          picker that asked the officer to know which morning had failed. */}
      {!loading && attention.length > 0 ? (
        <Card>
          <CardHeader title="Needs attention" />
          <ul className="divide-y divide-line-grid">
            {attention.map((item) => (
              <AttentionRow
                key={item.kind + ("date" in item ? item.date : item.dates.join())}
                item={item}
                mayRun={mayRun}
                running={running}
                onRun={() => setAsking(item)}
              />
            ))}
          </ul>
        </Card>
      ) : null}

      {asking && "date" in asking ? (
        <Modal title={confirmTitle(asking)} onClose={() => (running ? null : setAsking(null))}>
          <p className="text-sm leading-relaxed text-ink-secondary">{confirmBody(asking)}</p>
          {asking.kind === "fee-day" ? (
            <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
              To see who that is first, open{" "}
              <Link href="/late-fees" className="font-medium text-accent-text underline underline-offset-4">
                Late Payment Fees
              </Link>
              .
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line-hair pt-4">
            <button
              type="button"
              disabled={running}
              onClick={() => runDay(asking.date)}
              className="rounded-md border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
            >
              {running ? "Running..." : actionLabel(asking)}
            </button>
            <button
              type="button"
              disabled={running}
              onClick={() => setAsking(null)}
              className="rounded border border-line-hair px-4 py-2 text-sm text-ink-secondary"
            >
              Cancel
            </button>
          </div>
        </Modal>
      ) : null}

      {onlyAttention ? null : (
      <Card>
        <CardHeader
          title="What it has done"
        />
        {loading ? (
          <TableSkeleton rows={6} />
        ) : history && !history.ok ? (
          <EmptyState
            title="Could not read the schedule's history"
            body={`${history.error ?? ""} ${history.hint ?? ""}`.trim()}
          />
        ) : runs.length === 0 ? (
          <EmptyState
            title="The schedule has not run yet"
            body="It runs at 9am each morning, Singapore time."
          />
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm md:min-w-[640px]">
              <thead>
                <tr className="border-b border-line-hair text-left text-xs text-ink-muted">
                  <th className="px-4 py-2 font-medium sm:px-5">Ran for</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell">Day</th>
                  <th className="px-3 py-2 font-medium">What it did</th>
                  <th className="hidden px-3 py-2 text-right font-medium md:table-cell">Fees</th>
                  <th className="hidden px-3 py-2 text-right font-medium md:table-cell">Letters</th>
                  <th className="hidden px-5 py-2 font-medium md:table-cell">Finished</th>
                </tr>
              </thead>
              <tbody>
                {runPage.shown.map((r) => (
                  <tr key={r.ran_for} className="border-b border-line-hair align-top last:border-0">
                    <td className="px-4 py-3 text-ink sm:whitespace-nowrap sm:px-5">
                      {formatDate(r.ran_for)}
                      {/* On a phone the counts fold in here. */}
                      <span className="mt-1 block text-[11px] text-ink-muted md:hidden">
                        {r.cycle_day === 16 ? "16th · " : ""}
                        {r.summary?.lettersSent ?? 0} sent
                        {r.summary?.feesRaised ? ` · ${r.summary.feesRaised} fees` : ""}
                      </span>
                    </td>
                    <td className="hidden px-3 py-3 md:table-cell">
                      {r.cycle_day === 16 ? (
                        <StatusBadge kind="neutral" label="16th · fees" />
                      ) : (
                        <span className="text-xs text-ink-muted">daily</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-ink-secondary">
                      <div>{r.summary?.title ?? (r.cycle_day ? "-" : "Nothing to do")}</div>
                      {r.missed && r.missed.length > 0 ? (
                        <Tag>
                          {r.missed.length} {r.missed.length === 1 ? "morning" : "mornings"} missed before this
                        </Tag>
                      ) : null}
                      {runNeedsLookingAt(r.status) ? (
                        <p className="mt-1 max-w-[70ch] text-xs leading-relaxed text-crit-ink">
                          {r.error ?? r.status}
                        </p>
                      ) : null}
                      <Delivery summary={r.summary} />

                      {/* Named, because a number is not checkable. Somebody
                          holding an inbox open wants to know whether these
                          are the four they received. */}
                      {/* Named, but folded: a morning can write to two hundred
                          tenants, and the list is for checking, not reading. */}
                      {(r.summary?.wrote ?? []).length > 0 ? (
                        <Names label="Written to" names={r.summary!.wrote!.map((t) => t.name)} />
                      ) : null}
                      {(r.summary?.chargedTo ?? []).length > 0 ? (
                        <Names label="Charged" names={r.summary!.chargedTo!.map((t) => t.name)} />
                      ) : null}
                      {/* The more useful half. A tenant the schedule chose not
                          to write to, and the reason, is what turns "it sent
                          four" into something anybody can agree with. */}
                      {(r.summary?.heldBack ?? []).length > 0 ? (
                        <HeldBack held={r.summary!.heldBack!} />
                      ) : null}
                    </td>
                    <td className="tabular hidden px-3 py-3 text-right text-ink-secondary md:table-cell">
                      {r.summary?.feesRaised ?? 0}
                    </td>
                    <td className="tabular hidden px-3 py-3 text-right text-ink-secondary md:table-cell">
                      {r.summary?.lettersSent ?? 0}
                    </td>
                    <td className="hidden whitespace-nowrap px-5 py-3 text-xs text-ink-muted md:table-cell">
                      {formatTime(r.finished_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination {...runPage.pager} />
          </>
        )}
      </Card>
      )}
    </div>
  );
}

/** One thing that needs a hand: what happened, and the button, if one helps. */
function AttentionRow({
  item,
  mayRun,
  running,
  onRun,
}: {
  item: AttentionItem;
  mayRun: boolean;
  running: boolean;
  onRun: () => void;
}) {
  const router = useRouter();
  const [title, detail] = describeItem(item);
  const action = item.kind === "gap" ? null : actionLabel(item);
  /* Stopped for the report: the fix is an upload, then the run is offered. */
  if ((item.kind === "failed" || item.kind === "fee-day") && item.needsUpload) {
    return (
      <li className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
        <span aria-hidden="true" className="hidden h-2 w-2 shrink-0 rounded-full bg-warn-ink sm:block" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{title}</p>
          {detail ? <p className="mt-0.5 text-xs leading-relaxed text-ink-secondary">{detail}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => router.push("/upload")}
          className="w-full shrink-0 rounded-md border border-accent bg-accent px-3.5 py-1.5 text-xs font-medium text-accent-ink sm:w-auto"
        >
          Upload the current report
        </button>
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
      <span
        aria-hidden="true"
        className={`hidden h-2 w-2 shrink-0 rounded-full sm:block ${item.kind === "gap" ? "bg-line-strong" : "bg-warn-ink"}`}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{title}</p>
        {detail ? <p className="mt-0.5 text-xs leading-relaxed text-ink-secondary">{detail}</p> : null}
      </div>
      {action ? (
        mayRun ? (
          <button
            type="button"
            disabled={running}
            onClick={onRun}
            className="w-full shrink-0 rounded-md border border-accent bg-accent px-3.5 py-1.5 text-xs font-medium text-accent-ink sm:w-auto"
          >
            {action}
          </button>
        ) : (
          <span className="shrink-0 text-[11px] text-ink-muted">An administrator can fix this</span>
        )
      ) : null}
    </li>
  );
}

function listDates(dates: string[]): string {
  const said = dates.map((d) => formatDate(d));
  if (said.length > 3) return `${said.length} mornings between ${said[0]} and ${said[said.length - 1]}`;
  return said.length <= 2 ? said.join(" and ") : `${said.slice(0, -1).join(", ")} and ${said[said.length - 1]}`;
}

function describeItem(item: AttentionItem): [string, string | null] {
  switch (item.kind) {
    case "fee-day":
      return [
        `Late fees for ${formatMonth(item.date)} were not raised`,
        item.error
          ? `The run on ${formatDate(item.date)} stopped: ${item.error}`
          : `The 9am run did not run on ${formatDate(item.date)}, and later mornings do not raise the 16th's fees.`,
      ];
    case "unfinished":
      return [
        `${item.notSent} of ${item.written} reminders on ${formatDate(item.date)} were not sent`,
        item.why ?? "The run ran out of time before it reached them.",
      ];
    case "failed":
      return [`The run on ${formatDate(item.date)} stopped`, item.error];
    case "not-today":
      return [
        "The 9am run has not run today",
        `It last ran on ${formatDate(item.lastRan)}. Today's reminders have not gone out.`,
      ];
    case "gap":
      return [
        `No run on ${listDates(item.dates)}`,
        "Reminders due on those mornings were not sent, and a later morning does not send them. Run a morning again to send its reminders.",
      ];
  }
}

function actionLabel(item: AttentionItem): string {
  switch (item.kind) {
    case "fee-day":
      return `Raise ${formatMonth(item.date)}'s late fees`;
    case "unfinished":
      return `Send the remaining ${item.notSent}`;
    case "failed":
      return `Run ${formatDate(item.date)} again`;
    case "not-today":
      return "Run this morning now";
    case "gap":
      return "";
  }
}

function confirmTitle(item: AttentionItem): string {
  switch (item.kind) {
    case "fee-day":
      return `Raise the late fees for ${formatMonth(item.date)}?`;
    case "unfinished":
      return `Send the remaining ${item.notSent} reminders?`;
    case "failed":
      return `Run ${formatDate(item.date)} again?`;
    default:
      return "Run this morning now?";
  }
}

function confirmBody(item: AttentionItem): string {
  const real = "This sends for real, to tenants.";
  switch (item.kind) {
    case "fee-day":
      return (
        `This raises the S$100 late payment fee for ${formatMonth(item.date)} on every ` +
        "tenant the rule catches, as the 16th would have, and sends any reminders due " +
        `that day. A tenant already charged for ${formatMonth(item.date)} is not charged again. ${real}`
      );
    case "unfinished":
      return (
        `This sends the reminders from ${formatDate(item.date)} that did not go. ` +
        `Tenants who already had their letter are skipped. ${real}`
      );
    case "failed":
      return (
        `This runs the 9am job for ${formatDate(item.date)} again. Nothing already sent ` +
        `or charged is repeated. ${real}`
      );
    default:
      return `This does this morning's 9am job now: the reminders due today. ${real}`;
  }
}

/** One of the run's jobs, and the morning it last ran. */
function LastRan({ label, on }: { label: string; on: string | null }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ${on ? "bg-good-ink" : "bg-warn-ink"}`}
      />
      <span className="font-medium text-ink">{label}</span>
      <span className="text-ink-muted">·</span>
      <span className="text-ink-secondary">{on ? `last ran ${formatDate(on)}` : "not run yet"}</span>
    </div>
  );
}

/** Who a morning held back and why, drawn only once it is opened. */
function HeldBack({ held }: { held: { code: string; name: string; why: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="mt-1 text-[11px] leading-relaxed text-ink-muted"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer text-accent-text">
        {held.length} held back, and why
      </summary>
      {open ? (
        <ul className="mt-1 space-y-0.5">
          {held.map((t) => (
            <li key={t.code}>
              <span className="text-ink-secondary">{t.name}</span>: {t.why}
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}

/** A list of tenant names, folded behind its count. */
function Names({ label, names }: { label: string; names: string[] }) {
  if (names.length <= 3) {
    return (
      <div className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">
        <span className="text-ink-secondary">{label}: </span>
        {names.join(", ")}
      </div>
    );
  }
  return (
    <details className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">
      <summary className="cursor-pointer text-accent-text">
        {label} {names.length} tenants
      </summary>
      <p className="mt-1">{names.join(", ")}</p>
    </details>
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
