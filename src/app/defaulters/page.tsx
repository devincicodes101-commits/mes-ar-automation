"use client";

import { useMemo } from "react";
import {
  allAccounts,
  formatSgd,
  isInCredit,
  overdueTotal,
  severeTotal,
} from "@/lib/data";
import { BUCKETS } from "@/lib/types";
import {
  BucketSwatch,
  Card,
  CardHeader,
  EmptyState,
  StatTile,
  StatusBadge,
  Tag,
} from "@/components/ui";

/**
 * A tenant is treated as a repeat defaulter when the same admin fee for late
 * payment has been raised in more than one billing period, or when a large
 * balance has aged past 90 days. Both come straight from the AR report.
 */
export default function DefaultersPage() {
  const rows = useMemo(() => {
    return allAccounts()
      .filter((a) => !isInCredit(a))
      .map((a) => ({
        account: a,
        months: a.lateFeeCount,
        severe: severeTotal(a),
        overdue: overdueTotal(a),
      }))
      .filter((r) => r.months >= 2 || r.severe > 0)
      .sort(
        (x, y) => y.months - x.months || y.severe - x.severe,
      );
  }, []);

  const chronic = rows.filter((r) => r.months >= 3);
  const atRisk = rows.filter((r) => r.months < 3);
  const totalSevere = rows.reduce((s, r) => s + r.severe, 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Fail nearly every month"
          value={String(chronic.length)}
          note="Three or more late fees charged"
          emphasis
        />
        <StatTile
          label="Starting to slip"
          value={String(atRisk.length)}
          note="Old balance or a second late fee"
        />
        <StatTile
          label="Stuck over 90 days"
          prefix="SGD"
          value={formatSgd(totalSevere)}
          note="The hardest money to recover"
        />
        <StatTile
          label="Worst single tenant"
          prefix="SGD"
          value={formatSgd(rows[0]?.severe ?? 0)}
          note={rows[0]?.account.companyName ?? "None"}
        />
      </div>

      <Card>
        <CardHeader
          title="Tenants who keep failing to pay"
          hint="Someone late once needs a reminder. Someone late every month needs a different conversation. This screen separates the two."
        />

        {rows.length === 0 ? (
          <EmptyState
            title="No repeat defaulters found"
            body="Nobody in the current data has repeated late fees or a balance over 90 days."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line-grid text-left">
                  <th className="px-5 py-2.5 text-xs font-medium text-ink-muted">
                    Tenant
                  </th>
                  <th className="px-3 py-2.5 text-xs font-medium text-ink-muted">
                    How bad
                  </th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-ink-muted">
                    Late fees
                  </th>
                  <th className="px-3 py-2.5 text-xs font-medium text-ink-muted">
                    Where the money sits
                  </th>
                  <th className="px-5 py-2.5 text-right text-xs font-medium text-ink-muted">
                    Over 90 days
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.account.id}
                    className="border-b border-line-grid hover:bg-surface-alt"
                  >
                    <td className="px-5 py-3">
                      <div className="font-medium text-ink">
                        {r.account.companyName}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] text-ink-muted">
                          {r.account.customerCode} · {r.account.property}
                        </span>
                        {r.account.industry ? (
                          <Tag>{r.account.industry}</Tag>
                        ) : null}
                        {r.account.status === "Terminated" ? (
                          <Tag>Moved out</Tag>
                        ) : null}
                      </div>
                    </td>

                    <td className="px-3 py-3">
                      <StatusBadge
                        kind={r.months >= 3 ? "critical" : "warning"}
                        label={
                          r.months >= 3
                            ? "Fails every month"
                            : "Starting to slip"
                        }
                      />
                    </td>

                    <td className="tabular px-3 py-3 text-right text-ink-secondary">
                      {r.months > 0 ? r.months : "-"}
                    </td>

                    {/* Where the balance sits, drawn with the same ordinal ramp
                        as the balances screen so the two read consistently. */}
                    <td className="px-3 py-3">
                      <AgeBar account={r.account} />
                    </td>

                    <td className="tabular px-5 py-3 text-right font-medium text-ink">
                      {r.severe > 0 ? formatSgd(r.severe) : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line-hair bg-surface-alt px-5 py-2.5">
          {BUCKETS.map((b) => (
            <span
              key={b.key}
              className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted"
            >
              <BucketSwatch ramp={b.ramp} />
              {b.label}
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}

/**
 * A single stacked bar per tenant showing which age band their balance sits in.
 * Same one hue ramp as the balances table, so darker always means older.
 */
function AgeBar({ account }: { account: ReturnType<typeof allAccounts>[0] }) {
  const values = BUCKETS.map((b) => Math.max(0, account.buckets[b.key]));
  const total = values.reduce((s, v) => s + v, 0);
  if (total === 0) {
    return <span className="text-[11px] text-ink-muted">nothing outstanding</span>;
  }

  return (
    <div className="flex h-2.5 w-full min-w-[140px] max-w-[220px] gap-[2px]">
      {BUCKETS.map((b, i) => {
        const pct = (values[i] / total) * 100;
        if (pct === 0) return null;
        return (
          <span
            key={b.key}
            title={`${b.label}: SGD ${formatSgd(values[i])}`}
            style={{
              width: `${pct}%`,
              background: `var(--age-${b.ramp})`,
            }}
            className="rounded-[1px]"
          />
        );
      })}
    </div>
  );
}
