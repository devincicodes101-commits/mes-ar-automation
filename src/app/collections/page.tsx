"use client";

import { useMemo, useState } from "react";
import {
  REASON_LABEL,
  allAccounts,
  buildQueue,
  formatSgd,
  revenueTypes,
  severeTotal,
} from "@/lib/data";
import { Account, QueueReason } from "@/lib/types";
import { useStore } from "@/lib/store";
import {
  Card,
  CardHeader,
  EmptyState,
  StatTile,
  StatusBadge,
  Tag,
} from "@/components/ui";

const PROPERTIES = ["All", "JPD1", "JPD2", "BSD", "LEO"] as const;
type StatusFilter = "All" | "Live" | "Terminated";

/** Proposal 4.4: filter by aging bucket. */
const AGE_FILTERS = [
  { key: "any", label: "Any overdue" },
  { key: "d30", label: "30 days or worse" },
  { key: "d60", label: "60 days or worse" },
  { key: "d90", label: "90 days or worse" },
  { key: "d90plus", label: "Over 90 days only" },
] as const;
type AgeFilter = (typeof AGE_FILTERS)[number]["key"];

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

function matchesAge(a: Account, f: AgeFilter): boolean {
  const b = a.buckets;
  switch (f) {
    case "d30":
      return b.d30 + b.d60 + b.d90 + b.d90plus > 0;
    case "d60":
      return b.d60 + b.d90 + b.d90plus > 0;
    case "d90":
      return b.d90 + b.d90plus > 0;
    case "d90plus":
      return b.d90plus > 0;
    default:
      return true;
  }
}

export default function ActionListPage() {
  const store = useStore();
  const [property, setProperty] = useState<(typeof PROPERTIES)[number]>("All");
  const [status, setStatus] = useState<StatusFilter>("All");
  const [age, setAge] = useState<AgeFilter>("any");
  const [charge, setCharge] = useState("All");
  const [oneFmOnly, setOneFmOnly] = useState(false);

  const types = useMemo(() => revenueTypes(), []);

  const queue = useMemo(() => {
    const accounts = allAccounts()
      .filter((a) => (property === "All" ? true : a.property === property))
      .filter((a) => (status === "All" ? true : a.status === status))
      .filter((a) => (oneFmOnly ? a.isOneFm : true))
      .filter((a) => (charge === "All" ? true : a.revenueTypes.includes(charge)))
      .filter((a) => matchesAge(a, age));
    return buildQueue(accounts);
  }, [property, status, age, charge, oneFmOnly]);

  const totalOverdue = queue.reduce((s, q) => s + q.overdue, 0);
  const noContact = queue.filter((q) => !q.account.hasContact).length;

  /**
   * Proposal 4.4: show where each account sits in the reminder sequence.
   * Derived from what has actually been sent, not from the calendar.
   */
  function sequenceFor(accountId: string) {
    const sent = store.emails.filter((e) => e.accountId === accountId);
    if (sent.some((e) => e.templateId === "final-21st")) {
      return { kind: "critical" as const, label: "Final notice sent" };
    }
    if (sent.some((e) => e.templateId === "reminder-7th")) {
      return { kind: "serious" as const, label: "First reminder sent" };
    }
    return { kind: "neutral" as const, label: "No reminder sent yet" };
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Tenants to chase"
          value={String(queue.length)}
          note="Matching the filters below"
        />
        <StatTile
          label="Money being chased"
          prefix="SGD"
          value={formatSgd(totalOverdue)}
          note="Everything past 30 days"
          emphasis
        />
        <StatTile
          label="Cannot email these"
          value={String(noContact)}
          note="No email address on file yet"
        />
        <StatTile
          label="Fail every month"
          value={String(
            queue.filter((q) => q.account.lateFeeCount >= 3).length,
          )}
          note="Charged three or more late fees"
        />
      </div>

      <Card>
        <CardHeader
          title="Work down this list from the top"
          hint="Ordered by a fixed rule, not by guesswork. The oldest money counts most, then repeat late fees. Tenants who have moved out rank lower, and anyone in credit is left out."
          right={
            <label className="flex items-center gap-2 text-xs text-ink-secondary">
              <input
                type="checkbox"
                checked={oneFmOnly}
                onChange={(e) => setOneFmOnly(e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--accent)]"
              />
              1FM only
            </label>
          }
        />

        {/* ------------------------------------------------------- filters */}
        <div className="flex flex-wrap gap-1 border-b border-line-hair px-5 py-2.5">
          {PROPERTIES.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setProperty(f)}
              aria-pressed={property === f}
              className={`rounded px-2.5 py-1 text-xs ${
                property === f
                  ? "bg-accent-wash font-medium text-ink"
                  : "text-ink-muted hover:bg-surface-alt hover:text-ink-secondary"
              }`}
            >
              {f === "All" ? "All properties" : f}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-4 border-b border-line-hair px-5 py-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-ink-muted">
              Still renting
            </span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              className="rounded border border-line-hair bg-surface px-2.5 py-1.5 text-xs text-ink"
            >
              <option value="All">Everyone</option>
              <option value="Live">Live only</option>
              <option value="Terminated">Moved out only</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-ink-muted">
              How overdue
            </span>
            <select
              value={age}
              onChange={(e) => setAge(e.target.value as AgeFilter)}
              className="rounded border border-line-hair bg-surface px-2.5 py-1.5 text-xs text-ink"
            >
              {AGE_FILTERS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-ink-muted">
              Type of charge
            </span>
            <select
              value={charge}
              onChange={(e) => setCharge(e.target.value)}
              className="rounded border border-line-hair bg-surface px-2.5 py-1.5 text-xs text-ink"
            >
              <option value="All">Any charge</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          {(status !== "All" ||
            age !== "any" ||
            charge !== "All" ||
            property !== "All" ||
            oneFmOnly) && (
            <button
              type="button"
              onClick={() => {
                setStatus("All");
                setAge("any");
                setCharge("All");
                setProperty("All");
                setOneFmOnly(false);
              }}
              className="mb-0.5 text-[11px] text-ink-muted underline hover:text-ink-secondary"
            >
              Clear filters
            </button>
          )}
        </div>

        {queue.length === 0 ? (
          <EmptyState
            title="Nothing matches these filters"
            body="Try widening the filters above, or clear them to see the whole list."
          />
        ) : (
          <ol className="divide-y divide-line-grid">
            {queue.map((item, idx) => {
              const seq = sequenceFor(item.account.id);
              return (
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
                        <Tag>Moved out</Tag>
                      ) : null}
                      {item.account.isOneFm ? <Tag>1FM</Tag> : null}
                    </div>

                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <StatusBadge kind={seq.kind} label={seq.label} />
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

                    {item.account.revenueTypes.length > 0 ? (
                      <p className="mt-1.5 text-[11px] text-ink-muted">
                        Charges: {item.account.revenueTypes.join(", ")}
                      </p>
                    ) : null}
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
              );
            })}
          </ol>
        )}
      </Card>
    </div>
  );
}
