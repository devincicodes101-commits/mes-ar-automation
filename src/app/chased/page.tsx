"use client";

/**
 * Clients who have been all the way round the cycle and still owe.
 *
 * MES's workflow ends at the final notice on the 21st, and their lifecycle
 * note says what happens after it: "Rolls into next month one bucket older,
 * and the cycle restarts with the September bill." So there is nothing to
 * escalate to. What there is instead is the question their own note asks and
 * their screens never answered:
 *
 *   "A tenant who pays late every month is a different conversation from one
 *    who forgot once."
 *
 * This screen is that distinction, made visible. The months are named rather
 * than counted, because January to July unbroken and four scattered across a
 * year are the same number and different problems.
 */

import { useMemo } from "react";
import { formatSgd } from "@/lib/data";
import { useSession } from "@/lib/session";
import { useDataset, withManualEmails } from "@/lib/dataset";
import { useStore } from "@/lib/store";
import {
  chasedToTheEnd,
  severity,
  shortMonth,
  type ChasedRow,
} from "@/lib/chased";
import {
  Card,
  CardHeader,
  ScrollPanel,
  StatTile,
  StatusBadge,
  TenantLink,
} from "@/components/ui";

const SEVERITY_LABEL = {
  chronic: "Every month",
  repeat: "More than once",
  once: "Once",
} as const;

export default function ChasedPage() {
  const { scope } = useSession();
  const store = useStore();
  const ds = withManualEmails(useDataset(), store.manualEmails);

  const rows = useMemo(
    () => chasedToTheEnd(ds.invoices, scope(ds.accounts), ds.asOf),
    [ds, scope],
  );

  const chronic = rows.filter((r) => severity(r) === "chronic");
  const owed = rows.reduce((s, r) => s + r.outstanding, 0);
  const worst = rows[0] ?? null;

  if (rows.length === 0) {
    return <Empty hasUpload={ds.accounts.length > 0} />;
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Been round the cycle"
          value={String(rows.length)}
          note="Charged the fee, still owing"
          emphasis
        />
        <StatTile
          label="Every month running"
          value={String(chronic.length)}
          note="Three or more consecutive"
        />
        <StatTile
          label="Owed by this group"
          value={formatSgd(owed)}
          note="Overdue portion only"
        />
        <StatTile
          label="Worst run"
          value={worst ? `${worst.inARow} months` : "—"}
          note={worst ? worst.account.companyName : "—"}
        />
      </div>

      <Card className="border-l-2 border-l-[var(--warning)] px-5 py-4">
        <p className="max-w-prose text-xs leading-relaxed text-ink-secondary">
          A client reaches this list when MES&rsquo;s $100 fee has been raised
          against them, which happens on the 16th and only to clients already
          more than fourteen days late. One fee is one cycle that ran to the
          end with the money still unpaid, so the months below are the months
          the sequence completed.
        </p>
        <p className="mt-2 max-w-prose text-xs leading-relaxed text-ink-muted">
          Read the run, not the count. MES&rsquo;s own note puts it this way: a
          tenant who pays late every month is a different conversation from one
          who forgot once. Nobody needs closing by hand &mdash; a client drops
          off this list the moment a report shows they have paid.
        </p>
      </Card>

      <Card>
        <CardHeader
          title="Chased to the end, still owing"
          hint="Worst unbroken run first. The months are when the cycle completed, taken from the date the fee was raised."
        />
        <ScrollPanel>
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="border-b border-line-grid text-left">
                <th className="px-5 py-2.5 text-xs font-medium text-ink-muted">Client</th>
                <th className="px-3 py-2.5 text-xs font-medium text-ink-muted">How often</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-ink-muted">Cycles</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-ink-muted">In a row</th>
                <th className="px-3 py-2.5 text-xs font-medium text-ink-muted">Months the cycle completed</th>
                <th className="px-3 py-2.5 text-xs font-medium text-ink-muted">Last one</th>
                <th className="px-5 py-2.5 text-right text-xs font-medium text-ink-muted">Still owed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row key={r.account.id} row={r} />
              ))}
            </tbody>
          </table>
        </ScrollPanel>

        <div className="border-t border-line-hair px-5 py-3 text-[11px] leading-relaxed text-ink-muted">
          MES&rsquo;s workflow has no step after the final notice: their own
          note says an unpaid account &ldquo;rolls into next month one bucket
          older, and the cycle restarts&rdquo;. So this is a list to decide
          about, not one the system can act on by itself.
        </div>
      </Card>
    </div>
  );
}

function Row({ row }: { row: ChasedRow }) {
  const kind = severity(row);

  return (
    <tr className="border-b border-line-hair last:border-0">
      <td className="px-5 py-3">
        <span className="block text-ink">
          <TenantLink id={row.account.id} name={row.account.companyName} />
        </span>
        <span className="mt-0.5 block text-[11px] text-ink-muted">
          {row.account.customerCode} &middot; {row.account.propertyName}
          {row.giroFails > 0 ? (
            <> &middot; {row.giroFails} bounced GIRO</>
          ) : null}
        </span>
      </td>

      <td className="px-3 py-3">
        <StatusBadge
          kind={kind === "chronic" ? "critical" : kind === "repeat" ? "warning" : "neutral"}
          label={SEVERITY_LABEL[kind]}
        />
      </td>

      <td className="tabular px-3 py-3 text-right text-ink-secondary">{row.cycles}</td>

      <td className="tabular px-3 py-3 text-right">
        {row.inARow >= 3 ? (
          <b className="text-[var(--critical)]">{row.inARow}</b>
        ) : (
          <span className="text-ink-secondary">{row.inARow}</span>
        )}
      </td>

      {/*
        * Named, not counted. Seven months unbroken and four spread over a year
        * are the same number in the column to the left and completely
        * different conversations with the client.
        */}
      <td className="px-3 py-3">
        <span className="flex flex-wrap gap-1">
          {row.months.map((m) => (
            <span
              key={m}
              className="rounded border border-line-hair px-1.5 py-0.5 text-[10px] text-ink-secondary"
            >
              {shortMonth(m)}
            </span>
          ))}
        </span>
      </td>

      <td className="px-3 py-3">
        <span className="text-ink-secondary">
          {row.lastMonth ? shortMonth(row.lastMonth) : "—"}
        </span>
        {row.monthsSince !== null ? (
          <span className="mt-0.5 block text-[11px] text-ink-muted">
            {row.monthsSince === 0
              ? "this report's month"
              : row.monthsSince === 1
                ? "1 month ago"
                : `${row.monthsSince} months ago`}
          </span>
        ) : null}
      </td>

      <td className="tabular px-5 py-3 text-right">
        <span className="font-medium text-ink">{formatSgd(row.outstanding)}</span>
        {row.severe > 0 ? (
          <span className="mt-0.5 block text-[11px] text-ink-muted">
            {formatSgd(row.severe)} over 90 days
          </span>
        ) : null}
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------ nothing yet ---
 * An empty screen teaches nobody what it is for.
 *
 * So the empty state carries three worked rows rather than a sentence. They
 * are invented, and labelled as invented, because a collections tool showing
 * plausible client names and amounts that turn out to be decoration is worse
 * than showing nothing: somebody eventually acts on one.
 *
 * The three are chosen to show the distinction the screen exists to make.
 * Same total, same money, three different conversations.
 */
const EXAMPLES = [
  {
    name: "A client who has never paid on time",
    cycles: 7,
    inARow: 7,
    months: ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"],
    owed: 16018.85,
    kind: "chronic" as const,
  },
  {
    name: "A client who slipped, recovered, then slipped again",
    cycles: 5,
    inARow: 4,
    months: ["2026-02", "2026-03", "2026-04", "2026-05", "2026-07"],
    owed: 14439.36,
    kind: "chronic" as const,
  },
  {
    name: "A client who forgets occasionally",
    cycles: 4,
    inARow: 2,
    months: ["2026-01", "2026-04", "2026-06", "2026-07"],
    owed: 6572.01,
    kind: "repeat" as const,
  },
];

function Empty({ hasUpload }: { hasUpload: boolean }) {
  return (
    <div className="space-y-5">
      <Card className="border-l-2 border-l-[var(--accent)] px-5 py-4">
        <h2 className="text-sm font-medium text-ink">
          {hasUpload
            ? "Nobody in this report has been round the whole cycle and is still owing"
            : "Upload an AR report to fill this screen"}
        </h2>
        <p className="mt-2 max-w-prose text-xs leading-relaxed text-ink-secondary">
          A client appears here once MES&rsquo;s $100 late payment fee has been
          raised against them and they still owe money. The fee goes out on the
          16th, only to clients already more than fourteen days late, so one fee
          is one cycle that ran to the end unpaid.
          {hasUpload
            ? " Nothing in this report qualifies, which is the good outcome."
            : ""}
        </p>
      </Card>

      <Card>
        <CardHeader
          title="What it looks like when there is something to show"
          hint="Invented rows, to show what the screen is for. None of this is your data."
          right={<StatusBadge kind="neutral" label="example only" />}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm opacity-70">
            <thead>
              <tr className="border-b border-line-grid text-left">
                <th className="px-5 py-2.5 text-xs font-medium text-ink-muted">Client</th>
                <th className="px-3 py-2.5 text-xs font-medium text-ink-muted">How often</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-ink-muted">Cycles</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-ink-muted">In a row</th>
                <th className="px-3 py-2.5 text-xs font-medium text-ink-muted">Months the cycle completed</th>
                <th className="px-5 py-2.5 text-right text-xs font-medium text-ink-muted">Still owed</th>
              </tr>
            </thead>
            <tbody>
              {EXAMPLES.map((e) => (
                <tr key={e.name} className="border-b border-line-hair last:border-0">
                  <td className="px-5 py-3 italic text-ink-secondary">{e.name}</td>
                  <td className="px-3 py-3">
                    <StatusBadge
                      kind={e.kind === "chronic" ? "critical" : "warning"}
                      label={SEVERITY_LABEL[e.kind]}
                    />
                  </td>
                  <td className="tabular px-3 py-3 text-right text-ink-secondary">{e.cycles}</td>
                  <td className="tabular px-3 py-3 text-right">
                    {e.inARow >= 3 ? (
                      <b className="text-[var(--critical)]">{e.inARow}</b>
                    ) : (
                      <span className="text-ink-secondary">{e.inARow}</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span className="flex flex-wrap gap-1">
                      {e.months.map((m) => (
                        <span
                          key={m}
                          className="rounded border border-line-hair px-1.5 py-0.5 text-[10px] text-ink-secondary"
                        >
                          {shortMonth(m)}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="tabular px-5 py-3 text-right text-ink">
                    {formatSgd(e.owed)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-line-hair px-5 py-3 text-[11px] leading-relaxed text-ink-muted">
          The first two have been round the cycle a similar number of times and
          are not the same problem. Seven months unbroken is a client who has
          never paid on time this year. Four months scattered is one who
          forgets. That is the distinction this screen exists to make, and it is
          why the months are named rather than counted.
        </div>
      </Card>
    </div>
  );
}
