"use client";

import { useMemo, useState } from "react";
import {
  AS_OF,
  allAccounts,
  bucketTotals,
  formatSgd,
  invoicesForAccount,
  isInCredit,
  kpis,
  overdueTotal,
  revenueBreakdown,
  GIRO_LABEL,
  GiroStatus,
  giroStatus,
} from "@/lib/data";
import { Account, BUCKETS, BucketKey, PropertyCode } from "@/lib/types";
import { useSession } from "@/lib/session";
import {
  BucketSwatch,
  Card,
  CardHeader,
  EmptyState,
  StatTile,
  StatusBadge,
  Tag,
} from "@/components/ui";

type StatusFilter = "Live" | "Terminated";

const PROPERTIES: (PropertyCode | "ALL")[] = ["ALL", "JPD1", "JPD2", "BSD", "LEO"];

const PROPERTY_LABEL: Record<string, string> = {
  ALL: "All properties",
  JPD1: "Jurong Penjuru 1",
  JPD2: "Jurong Penjuru 2",
  BSD: "Blue Stars",
  LEO: "The Leo",
};

type ViewMode = "tenant" | "charge";
type SortKey = "name" | "total" | "overdue" | BucketKey;

export default function AgingBoardPage() {
  const { scope } = useSession();
  const [property, setProperty] = useState<PropertyCode | "ALL">("ALL");
  const [status, setStatus] = useState<StatusFilter>("Live");
  const [view, setView] = useState<ViewMode>("tenant");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [giro, setGiro] = useState<GiroStatus | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("overdue");
  const [desc, setDesc] = useState(true);

  const accounts = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = scope(allAccounts())
      .filter((a) => (property === "ALL" ? true : a.property === property))
      .filter((a) => a.status === status)
      .filter((a) => (giro === "ALL" ? true : giroStatus(a) === giro))
      .filter((a) =>
        q === ""
          ? true
          : a.companyName.toLowerCase().includes(q) ||
            a.customerCode.toLowerCase().includes(q),
      );

    const value = (a: (typeof list)[0]) => {
      if (sort === "name") return a.companyName;
      if (sort === "total") return a.total;
      if (sort === "overdue") return overdueTotal(a);
      return a.buckets[sort];
    };

    return list.sort((a, b) => {
      const x = value(a);
      const y = value(b);
      const cmp =
        typeof x === "string" && typeof y === "string"
          ? x.localeCompare(y)
          : Number(x) - Number(y);
      return desc ? -cmp : cmp;
    });
  }, [property, status, giro, query, sort, desc, scope]);

  function sortState(key: SortKey): "ascending" | "descending" | "none" {
    if (sort !== key) return "none";
    return desc ? "descending" : "ascending";
  }

  function sortBy(key: SortKey) {
    if (sort === key) {
      setDesc(!desc);
      return;
    }
    setSort(key);
    setDesc(key !== "name");
  }

  const k = useMemo(() => kpis(accounts), [accounts]);
  const totals = useMemo(() => bucketTotals(accounts), [accounts]);
  const charges = useMemo(() => revenueBreakdown(accounts), [accounts]);

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------- KPI row */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Total owed"
          prefix="SGD"
          value={formatSgd(k.outstanding)}
          note={`${k.accounts} tenants shown`}
        />
        <StatTile
          label="Overdue, needs chasing"
          prefix="SGD"
          value={formatSgd(k.overdue)}
          note={`${k.actionable} tenants past 30 days`}
          emphasis
        />
        <StatTile
          label="Owed for over 90 days"
          prefix="SGD"
          value={formatSgd(k.severe)}
          note="The hardest money to recover"
        />
        <StatTile
          label="In credit, do not chase"
          value={String(k.inCredit)}
          note="These tenants have overpaid"
        />
      </div>

      {/* ------------------------------------------------------------ table */}
      <Card>
        <CardHeader
          title="Every tenant, and how overdue they are"
          hint={`Figures as at ${AS_OF}. Anything to the right of the thick line is past 30 days and needs chasing. A tenant renting at two dormitories is listed once for each.`}
          right={
            <div className="flex flex-wrap items-center gap-2">
              {/* Proposal 4.3: see balances split by what they are actually for. */}
              <div
                className="flex rounded border border-line-hair p-0.5"
                role="group"
                aria-label="View"
              >
                {(
                  [
                    ["tenant", "By tenant"],
                    ["charge", "By charge type"],
                  ] as [ViewMode, string][]
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setView(v)}
                    aria-pressed={view === v}
                    className={`rounded px-2.5 py-1 text-xs ${
                      view === v
                        ? "bg-accent-wash font-medium text-ink"
                        : "text-ink-muted hover:text-ink-secondary"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div
                className="flex rounded border border-line-hair p-0.5"
                role="group"
                aria-label="Account status"
              >
                {(["Live", "Terminated"] as StatusFilter[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(s)}
                    aria-pressed={status === s}
                    className={`rounded px-2.5 py-1 text-xs ${
                      status === s
                        ? "bg-accent-wash font-medium text-ink"
                        : "text-ink-muted hover:text-ink-secondary"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          }
        />

        {/* property tabs and search */}
        <div className="flex flex-wrap items-center gap-3 border-b border-line-hair px-5 py-2.5">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Property">
            {PROPERTIES.map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={property === p}
                onClick={() => setProperty(p)}
                className={`rounded px-2.5 py-1 text-xs ${
                  property === p
                    ? "bg-accent-wash font-medium text-ink"
                    : "text-ink-muted hover:bg-surface-alt hover:text-ink-secondary"
                }`}
              >
                {PROPERTY_LABEL[p]}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* Objective bullet 2 lists GIRO status alongside property,
                revenue type and Live/Terminated as a way to group the board. */}
            <label className="sr-only" htmlFor="giro-filter">
              GIRO status
            </label>
            <select
              id="giro-filter"
              value={giro}
              onChange={(e) => setGiro(e.target.value as GiroStatus | "ALL")}
              className="rounded border border-line-hair bg-surface px-2.5 py-1.5 text-xs text-ink-secondary"
            >
              <option value="ALL">Any GIRO status</option>
              <option value="enrolled">On GIRO, payment rejected</option>
              <option value="no-mandate">No GIRO mandate</option>
              <option value="unknown">Not confirmed</option>
            </select>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a tenant by name or code"
              aria-label="Find a tenant"
              className="w-56 rounded border border-line-hair bg-surface px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-muted"
            />
            {query ? (
              <span className="text-[11px] text-ink-muted">
                {accounts.length} found
              </span>
            ) : null}
          </div>
        </div>

        {view === "charge" ? (
          <ChargeTypeTable rows={charges} />
        ) : accounts.length === 0 ? (
          <EmptyState
            title="No accounts in this view"
            body="Change the property or status filter to see accounts."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line-grid text-left">
                  <th
                    aria-sort={sortState("name")}
                    className="px-5 py-2.5 text-xs font-medium text-ink-muted"
                  >
                    <SortHeader
                      label="Account"
                      active={sort === "name"}
                      desc={desc}
                      onClick={() => sortBy("name")}
                    />
                  </th>
                  {BUCKETS.map((b) => (
                    <th
                      key={b.key}
                      aria-sort={sortState(b.key)}
                      className={`px-3 py-2.5 text-right text-xs font-medium text-ink-muted ${
                        // The 30 day trigger line. Everything right of this rule
                        // is what MES actively chases.
                        b.key === "d30"
                          ? "border-l-2 border-l-line-base"
                          : ""
                      }`}
                    >
                      <SortHeader
                        align="right"
                        active={sort === b.key}
                        desc={desc}
                        onClick={() => sortBy(b.key)}
                        label={
                          <span className="inline-flex items-center gap-1.5">
                            <BucketSwatch ramp={b.ramp} />
                            {b.label}
                          </span>
                        }
                      />
                    </th>
                  ))}
                  <th
                    aria-sort={sortState("total")}
                    className="px-5 py-2.5 text-right text-xs font-medium text-ink-muted"
                  >
                    <SortHeader
                      align="right"
                      label="Total"
                      active={sort === "total"}
                      desc={desc}
                      onClick={() => sortBy("total")}
                    />
                  </th>
                </tr>
              </thead>

              <tbody>
                {accounts.map((a) => (
                  <AccountRow
                    key={a.id}
                    account={a}
                    open={expanded === a.id}
                    onToggle={() =>
                      setExpanded(expanded === a.id ? null : a.id)
                    }
                  />
                ))}
              </tbody>

              <tfoot>
                <tr className="border-t-2 border-line-base font-medium">
                  <td className="px-5 py-3 text-xs text-ink-secondary">
                    {accounts.length} accounts
                  </td>
                  {BUCKETS.map((b) => (
                    <td
                      key={b.key}
                      className={`tabular px-3 py-3 text-right text-xs text-ink ${
                        b.key === "d30" ? "border-l-2 border-l-line-base" : ""
                      }`}
                    >
                      {formatSgd(totals[b.key])}
                    </td>
                  ))}
                  <td className="tabular px-5 py-3 text-right text-xs text-ink">
                    {formatSgd(k.outstanding)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Clickable column header. The arrow only shows on the active column. */
function SortHeader({
  label,
  active,
  desc,
  onClick,
  align = "left",
}: {
  label: React.ReactNode;
  active: boolean;
  desc: boolean;
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex w-full items-center gap-1 font-medium hover:text-ink ${
        active ? "text-ink" : ""
      } ${align === "right" ? "justify-end" : ""}`}
    >
      {label}
      <span aria-hidden="true" className="text-[9px]">
        {active ? (desc ? "▼" : "▲") : ""}
      </span>
    </button>
  );
}

/**
 * Proposal 4.3, revenue type segmentation. Shows what each balance is actually
 * for, rather than one lump per tenant. Built from the invoice level report.
 */
function ChargeTypeTable({
  rows,
}: {
  rows: ReturnType<typeof revenueBreakdown>;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No invoice detail for this selection"
        body="The detailed report in the sample covers fewer tenants than the summary. Change the property or status filter."
      />
    );
  }

  const grand = rows.reduce((s, r) => s + r.total, 0);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line-grid text-left">
              <th className="px-5 py-2.5 text-xs font-medium text-ink-muted">
                What the charge is for
              </th>
              {BUCKETS.map((b) => (
                <th
                  key={b.key}
                  className={`px-3 py-2.5 text-right text-xs font-medium text-ink-muted ${
                    b.key === "d30" ? "border-l-2 border-l-line-base" : ""
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <BucketSwatch ramp={b.ramp} />
                    {b.label}
                  </span>
                </th>
              ))}
              <th className="px-5 py-2.5 text-right text-xs font-medium text-ink-muted">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.type}
                className="border-b border-line-grid hover:bg-surface-alt"
              >
                <td className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{r.type}</span>
                    {r.isOneFm ? <Tag>1FM</Tag> : null}
                  </div>
                  <div className="mt-0.5 text-[11px] text-ink-muted">
                    {r.invoices} invoices across {r.companies} tenants
                  </div>
                </td>
                {BUCKETS.map((b) => {
                  const v = r.buckets[b.key];
                  return (
                    <td
                      key={b.key}
                      className={`tabular px-3 py-3 text-right ${
                        b.key === "d30" ? "border-l-2 border-l-line-base" : ""
                      } ${v === 0 ? "text-ink-muted" : "text-ink-secondary"}`}
                    >
                      {v === 0 ? "-" : formatSgd(v)}
                    </td>
                  );
                })}
                <td className="tabular px-5 py-3 text-right font-medium text-ink">
                  {formatSgd(r.total)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line-base font-medium">
              <td className="px-5 py-3 text-xs text-ink-secondary">
                {rows.length} charge types
              </td>
              <td colSpan={5} />
              <td className="tabular px-5 py-3 text-right text-xs text-ink">
                {formatSgd(grand)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="border-t border-line-hair bg-surface-alt px-5 py-2.5">
        <p className="text-[11px] leading-relaxed text-ink-muted">
          Taken from the invoice level report, which in this sample covers fewer
          tenants than the summary, so these totals are smaller than the by
          tenant view. The full export should cover everyone.
        </p>
      </div>
    </>
  );
}

function AccountRow({
  account,
  open,
  onToggle,
}: {
  account: Account;
  open: boolean;
  onToggle: () => void;
}) {
  const credit = isInCredit(account);
  const invoices = open ? invoicesForAccount(account) : [];

  return (
    <>
      <tr
        className="cursor-pointer border-b border-line-grid hover:bg-surface-alt"
        onClick={onToggle}
      >
        <td className="px-5 py-3">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="w-3 text-xs text-ink-muted"
            >
              {open ? "−" : "+"}
            </span>
            <div className="min-w-0">
              <div className="truncate font-medium text-ink">
                {account.companyName}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-ink-muted">
                  {account.customerCode} · {account.property}
                </span>
                {account.isOneFm ? <Tag>1FM</Tag> : null}
                {account.industry ? <Tag>{account.industry}</Tag> : null}
                <span className="text-[11px] text-ink-muted">
                  {GIRO_LABEL[giroStatus(account)]}
                </span>
                {credit ? (
                  <StatusBadge kind="good" label="In credit" />
                ) : null}
                {!account.hasContact && !credit ? (
                  <StatusBadge kind="warning" label="No email" />
                ) : null}
                {account.lateFeeCount >= 3 ? (
                  <StatusBadge
                    kind="critical"
                    label={`${account.lateFeeCount} late fees`}
                  />
                ) : null}
                {account.legacyNote ? (
                  <StatusBadge kind="serious" label={account.legacyNote} />
                ) : null}
              </div>
            </div>
          </div>
        </td>

        {BUCKETS.map((b) => {
          const v = account.buckets[b.key];
          return (
            <td
              key={b.key}
              className={`tabular px-3 py-3 text-right ${
                b.key === "d30" ? "border-l-2 border-l-line-base" : ""
              } ${v === 0 ? "text-ink-muted" : "text-ink-secondary"}`}
            >
              {v === 0 ? "-" : formatSgd(v)}
            </td>
          );
        })}

        <td
          className="tabular px-5 py-3 text-right font-medium"
          style={credit ? { color: "var(--credit)" } : undefined}
        >
          {formatSgd(account.total, { sign: credit })}
        </td>
      </tr>

      {open ? (
        <tr className="border-b border-line-grid bg-surface-alt">
          <td colSpan={7} className="px-5 py-4">
            <p className="mb-2 text-xs font-medium text-ink-secondary">
              Open invoices for {account.companyName}
            </p>
            {invoices.length === 0 ? (
              <p className="text-xs text-ink-muted">
                No invoice detail in the sample for this account. The detailed
                report covers a subset of tenants.
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-ink-muted">
                    <th className="py-1.5 pr-4 font-medium">Revenue type</th>
                    <th className="py-1.5 pr-4 font-medium">Document</th>
                    <th className="py-1.5 pr-4 font-medium">Due</th>
                    <th className="py-1.5 pr-4 text-right font-medium">Age</th>
                    <th className="py-1.5 text-right font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.id} className="border-t border-line-grid">
                      <td className="py-1.5 pr-4 text-ink-secondary">
                        <span className="inline-flex items-center gap-1.5">
                          {i.revenueType}
                          {i.isOneFm ? <Tag>1FM</Tag> : null}
                        </span>
                      </td>
                      <td className="py-1.5 pr-4 text-ink-muted">
                        {i.documentNumber}
                      </td>
                      <td className="py-1.5 pr-4 text-ink-muted">
                        {i.dueDate ?? ""}
                      </td>
                      <td className="tabular py-1.5 pr-4 text-right text-ink-muted">
                        {i.age !== null && i.age > 0 ? `${i.age}d` : "not due"}
                      </td>
                      <td className="tabular py-1.5 text-right text-ink-secondary">
                        {formatSgd(i.openBalance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}
