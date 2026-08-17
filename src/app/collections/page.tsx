"use client";

import { useMemo, useState } from "react";
import {
  REASON_LABEL,
  allAccounts,
  buildQueue,
  formatSgd,
  severeTotal,
} from "@/lib/data";
import { QueueReason } from "@/lib/types";
import {
  Card,
  CardHeader,
  EmptyState,
  StatTile,
  StatusBadge,
  Tag,
} from "@/components/ui";

const FILTERS = ["All", "JPD1", "JPD2", "BSD", "LEO"] as const;

/** Status kind is driven by how bad the reason is, never by hue alone. */
const REASON_KIND: Record<
  QueueReason,
  "good" | "warning" | "serious" | "critical" | "neutral"
> = {
  "giro-no-dda": "warning",
  "giro-refer-paying-party": "critical",
  "aging-30": "warning",
  "aging-90": "critical",
  "promise-broken": "serious",
  "no-contact": "warning",
};

export default function CollectionsQueuePage() {
  const [property, setProperty] = useState<(typeof FILTERS)[number]>("All");
  const [oneFmOnly, setOneFmOnly] = useState(false);

  const queue = useMemo(() => {
    const accounts = allAccounts()
      .filter((a) => (property === "All" ? true : a.property === property))
      .filter((a) => (oneFmOnly ? a.isOneFm : true));
    return buildQueue(accounts);
  }, [property, oneFmOnly]);

  const totalOverdue = queue.reduce((s, q) => s + q.overdue, 0);
  const noContact = queue.filter((q) => !q.account.hasContact).length;

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-3 flex items-baseline justify-between">
          <h1 className="text-base font-semibold text-ink">
            Collections Queue
          </h1>
          <p className="text-xs text-ink-muted">
            Ranked worst first. Accounts in credit are excluded automatically.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Accounts to action"
            value={String(queue.length)}
            note="Across the current filter"
          />
          <StatTile
            label="Value in the queue"
            prefix="SGD"
            value={formatSgd(totalOverdue)}
            note="Balance past the 30 day line"
            emphasis
          />
          <StatTile
            label="Cannot email yet"
            value={String(noContact)}
            note="No address on file for these tenants"
          />
          <StatTile
            label="Repeat GIRO failures"
            value={String(
              queue.filter((q) => q.account.lateFeeCount >= 3).length,
            )}
            note="Three or more late fees charged"
          />
        </div>
      </div>

      <Card>
        <CardHeader
          title="Prioritised action list"
          hint="Ranking is deterministic: 90+ balance weighted heaviest, then 60, then 30, plus repeat late fees. Terminated accounts are de-weighted."
          right={
            <label className="flex items-center gap-2 text-xs text-ink-secondary">
              <input
                type="checkbox"
                checked={oneFmOnly}
                onChange={(e) => setOneFmOnly(e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--brand)]"
              />
              1FM only
            </label>
          }
        />

        <div className="flex flex-wrap gap-1 border-b border-line-hair px-5 py-2.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setProperty(f)}
              aria-pressed={property === f}
              className={`rounded px-2.5 py-1 text-xs ${
                property === f
                  ? "bg-brand-wash font-medium text-ink"
                  : "text-ink-muted hover:bg-surface-alt hover:text-ink-secondary"
              }`}
            >
              {f === "All" ? "All properties" : f}
            </button>
          ))}
        </div>

        {queue.length === 0 ? (
          <EmptyState
            title="Nothing to chase in this view"
            body="No account in this filter has a balance past the 30 day trigger line."
          />
        ) : (
          <ol className="divide-y divide-line-grid">
            {queue.map((item, idx) => (
              <li
                key={item.account.id}
                className="flex items-start gap-4 px-5 py-3.5 hover:bg-surface-alt"
              >
                <span className="tabular mt-0.5 w-6 shrink-0 text-xs text-ink-muted">
                  {idx + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">
                      {item.account.companyName}
                    </span>
                    <span className="text-[11px] text-ink-muted">
                      {item.account.customerCode} · {item.account.property}
                    </span>
                    {item.account.status === "Terminated" ? (
                      <Tag>Terminated</Tag>
                    ) : null}
                    {item.account.isOneFm ? <Tag>1FM</Tag> : null}
                  </div>

                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {item.reasons.map((r) => (
                      <StatusBadge
                        key={r}
                        kind={REASON_KIND[r]}
                        label={
                          r === "promise-broken" && item.account.legacyNote
                            ? `Promise: ${item.account.legacyNote}`
                            : REASON_LABEL[r]
                        }
                      />
                    ))}
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <div className="tabular text-sm font-medium text-ink">
                    {formatSgd(item.overdue)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-ink-muted">
                    overdue
                  </div>
                  {severeTotal(item.account) > 0 ? (
                    <div className="tabular mt-1 text-[11px] text-ink-secondary">
                      {formatSgd(severeTotal(item.account))} over 90d
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
