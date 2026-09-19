"use client";

/**
 * What changed since the last report.
 *
 * The only screen that shows a direction rather than a moment. Every other one
 * answers "who owes what today". An officer on the 7th sees eighty one tenants
 * overdue and has no way to tell which of them paid on the 4th, which slid a
 * bucket, and which have been in 90+ since June. Today that comparison is
 * somebody putting two exports side by side.
 *
 * MES's rule for reading two reports is theirs and is not what anybody would
 * guess: a tenant absent from the newer one has paid in full, a smaller
 * balance is part paid, and you never subtract one file from another to work
 * out a payment. So nothing here reports an amount paid. A balance that fell
 * by two thousand does not mean two thousand arrived: they may have paid five
 * and been billed three in between.
 */

import { useCallback, useEffect, useState } from "react";

import { formatSgd } from "@/lib/data";
import { useSession } from "@/lib/session";
import { useDataset } from "@/lib/dataset";
import type { Chronic, Movement, MovementSummary } from "@/lib/movement";
import {
  Card,
  CardHeader,
  EmptyState,
  Loading,
  ScrollPanel,
  StatTile,
  StatusBadge,
  Tag,
  TenantLink,
} from "@/components/ui";

interface Answer {
  ok: boolean;
  from?: string;
  to?: string;
  dates?: string[];
  movements?: Movement[] | null;
  summary?: MovementSummary;
  chronic?: Chronic[];
  chronicAcross?: number;
  reason?: string;
  error?: string;
}

const DIRECTION: Record<
  Movement["direction"],
  { label: string; kind: "good" | "warning" | "serious" | "critical" | "neutral" }
> = {
  settled: { label: "Paid in full", kind: "good" },
  down: { label: "Part paid", kind: "good" },
  same: { label: "No change", kind: "neutral" },
  up: { label: "Owes more", kind: "critical" },
  new: { label: "New", kind: "warning" },
};

const when = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-SG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

export default function MovementPage() {
  const { scope } = useSession();
  const ds = useDataset();
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [loading, setLoading] = useState(true);
  const [pair, setPair] = useState<{ from: string; to: string } | null>(null);

  const load = useCallback(async (choice: { from: string; to: string } | null) => {
    setLoading(true);
    try {
      const { supabase } = await import("@/lib/supabase");
      const token = (await supabase?.auth.getSession())?.data.session?.access_token;
      const query = choice ? `?from=${choice.from}&to=${choice.to}` : "";
      const r = await fetch(`/api/movement${query}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      setAnswer((await r.json()) as Answer);
    } catch {
      setAnswer({
        ok: false,
        error: "The comparison could not be loaded. The server may be unreachable.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(pair);
  }, [load, pair]);

  if (loading && !answer) {
    return (
      <Card className="p-10">
        <Loading label="Comparing the last two reports" />
      </Card>
    );
  }

  if (!answer?.ok) {
    return (
      <Card>
        <CardHeader title="What changed" />
        <EmptyState
          title="This could not be worked out"
          body={answer?.error ?? "Something went wrong reading the reports."}
        />
      </Card>
    );
  }

  // One report is not a fault. It is a system that has been used once, and it
  // says so rather than showing an empty table, which looks exactly like
  // everybody having paid.
  if (!answer.movements) {
    return (
      <Card>
        <CardHeader title="What changed" />
        <EmptyState title="Nothing to compare yet" body={answer.reason ?? ""} />
      </Card>
    );
  }

  /*
   * Scoped like every other screen, from the current report's accounts.
   *
   * One thing this cannot do: a tenant of theirs who settled is no longer in
   * the current report, so there is no row saying whose book they were in.
   * They are kept rather than dropped. Showing a manager somebody who paid,
   * who may not have been theirs, is a smaller error than hiding the fact
   * that one of their clients settled.
   */
  const mineNow = new Set(scope(ds.accounts).map((a) => a.id));
  const everyone = new Set(ds.accounts.map((a) => a.id));
  const mine = answer.movements.filter(
    (m) => mineNow.has(m.id) || !everyone.has(m.id),
  );

  const s = answer.summary!;
  const netted = s.totalAfter - s.totalBefore;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Paid in full"
          value={String(s.settled)}
          note="Gone from the newer report"
        />
        <StatTile label="Part paid" value={String(s.paidSomething)} note="Balance down" />
        {/* Separate counts, not a subset. Somebody already in the older report
            whose balance grew, and somebody who was not in it at all, are
            different problems: the first is a client going backwards, the
            second is a new debtor. "180 of them new" read as though the second
            were part of the first. */}
        <StatTile
          label="Owes more"
          value={String(s.worse)}
          note={`and ${s.newlyOwing} owing for the first time`}
          emphasis={s.worse > 0}
        />
        <StatTile
          label="The book"
          prefix="SGD"
          value={formatSgd(Math.abs(netted))}
          note={netted <= 0 ? "smaller than last report" : "larger than last report"}
          emphasis={netted > 0}
        />
      </div>

      <Card>
        <CardHeader
          title={`${when(answer.from!)} compared with ${when(answer.to!)}`}
          hint={
            `SGD ${formatSgd(s.balanceDown)} came off the book and ` +
            `SGD ${formatSgd(s.balanceUp)} went on. ${s.aged} tenants had money ` +
            "age into an older bucket."
          }
          right={
            answer.dates && answer.dates.length > 2 ? (
              <ReportPicker
                dates={answer.dates}
                from={answer.from!}
                to={answer.to!}
                onChange={setPair}
              />
            ) : null
          }
        />

        <ScrollPanel max={520}>
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-alt text-left text-xs text-ink-muted">
              <tr>
                <th className="px-5 py-2 font-medium">Client</th>
                <th className="px-5 py-2 font-medium">What happened</th>
                <th className="px-5 py-2 text-right font-medium">Was</th>
                <th className="px-5 py-2 text-right font-medium">Now</th>
                <th className="px-5 py-2 font-medium">Oldest money</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-grid">
              {mine.map((m) => (
                <tr key={m.id}>
                  <td className="px-5 py-2.5">
                    <div className="font-medium text-ink">
                      <TenantLink id={m.id} name={m.companyName} />
                    </div>
                    <div className="text-xs text-ink-muted">
                      {m.customerCode} · {m.property}
                      {m.hasContact ? "" : " · no email address"}
                    </div>
                  </td>
                  <td className="px-5 py-2.5">
                    <StatusBadge
                      kind={DIRECTION[m.direction].kind}
                      label={DIRECTION[m.direction].label}
                    />
                    {m.aged ? (
                      <span className="ml-2">
                        <Tag>aged a bucket</Tag>
                      </span>
                    ) : null}
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-ink-secondary">
                    {m.before === null ? "—" : formatSgd(m.before)}
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-ink">
                    {m.after === null ? "—" : formatSgd(m.after)}
                  </td>
                  <td className="px-5 py-2.5 text-xs text-ink-secondary">
                    {m.bucketAfter ?? m.bucketBefore ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollPanel>
      </Card>

      <ChronicPanel rows={answer.chronic ?? []} across={answer.chronicAcross ?? 0} />
    </div>
  );
}

/**
 * Who has been stuck, report after report.
 *
 * The question MES's whole collections process exists to answer, and the one
 * nobody can answer today. A tenant in 90+ since June is a different
 * conversation from one who slipped there last week, and until now the two
 * were indistinguishable on every screen.
 */
function ChronicPanel({ rows, across }: { rows: Chronic[]; across: number }) {
  /*
   * "Nobody is stuck" and "there is not enough history to tell" look identical
   * on screen and mean opposite things, so the count of reports is always
   * shown rather than only the answer.
   */
  if (across < 3) {
    return (
      <Card>
        <CardHeader title="Stuck for months" />
        <EmptyState
          title="Not enough history yet"
          body={
            `This needs at least three reports to say anything, and ${across} ` +
            (across === 1 ? "is stored." : "are stored.") +
            " It fills in as MES upload."
          }
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Stuck for months"
        hint={
          `Clients whose oldest money has sat at 60 days or worse across at ` +
          `least three reports running. Read from the last ${across}.`
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          title="Nobody is stuck"
          body={`Across the last ${across} reports, nobody has stayed at 60 days or worse throughout.`}
        />
      ) : (
        <ScrollPanel max={340}>
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-alt text-left text-xs text-ink-muted">
              <tr>
                <th className="px-5 py-2 font-medium">Client</th>
                <th className="px-5 py-2 font-medium">Since</th>
                <th className="px-5 py-2 font-medium">Oldest money</th>
                <th className="px-5 py-2 text-right font-medium">Owed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-grid">
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="px-5 py-2.5">
                    <div className="font-medium text-ink">
                      <TenantLink id={c.id} name={c.companyName} />
                    </div>
                    <div className="text-xs text-ink-muted">
                      {c.customerCode} · {c.property}
                      {c.hasContact ? "" : " · no email address"}
                    </div>
                  </td>
                  <td className="px-5 py-2.5 text-xs text-ink-secondary">
                    {/* The dates, not just the count. Three reports in one week
                        and three across three months are the same number and
                        very different problems. */}
                    {when(c.since[c.since.length - 1]!)}
                    <span className="text-ink-muted"> · {c.reports} reports</span>
                  </td>
                  <td className="px-5 py-2.5 text-xs text-ink-secondary">{c.bucket}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-ink">
                    {formatSgd(c.owed)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollPanel>
      )}
    </Card>
  );
}

/** Two report dates, for looking further back than the last one. */
function ReportPicker({
  dates,
  from,
  to,
  onChange,
}: {
  dates: string[];
  from: string;
  to: string;
  onChange: (p: { from: string; to: string }) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <select
        aria-label="Earlier report"
        className="rounded border border-line-hair bg-surface px-2 py-1 text-xs"
        value={from}
        onChange={(e) => onChange({ from: e.target.value, to })}
      >
        {dates.map((d) => (
          <option key={d} value={d} disabled={d >= to}>
            {when(d)}
          </option>
        ))}
      </select>
      <span className="text-ink-muted">to</span>
      <select
        aria-label="Later report"
        className="rounded border border-line-hair bg-surface px-2 py-1 text-xs"
        value={to}
        onChange={(e) => onChange({ from, to: e.target.value })}
      >
        {dates.map((d) => (
          <option key={d} value={d} disabled={d <= from}>
            {when(d)}
          </option>
        ))}
      </select>
    </div>
  );
}
