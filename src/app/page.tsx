"use client";

import { useMemo, useState } from "react";
import {
  bucketTotals,
  formatSgd,
  invoicesForAccount,
  isInCredit,
  kpis,
  overdueTotal,
  revenueBreakdown,
  worstBucket,
} from "@/lib/data";
import { Account, BUCKETS, BucketKey, type Invoice, PropertyCode } from "@/lib/types";
import { useSession, useToast } from "@/lib/session";
import { useDataset, withManualEmails } from "@/lib/dataset";
import { setManualEmails, useStore } from "@/lib/store";
import { BillingCycles } from "@/components/BillingCycles";
import {
  BucketSwatch,
  Card,
  CardHeader,
  EmptyState,
  StatTile,
  StatusBadge,
  Tag,
  ScrollPanel,
  TenantLink,
  Pagination,
} from "@/components/ui";
import { usePaged } from "@/lib/use-paged";
import { formatDate } from "@/lib/format";
import { sumExact } from "@/lib/money";

const PROPERTIES: (PropertyCode | "ALL")[] = ["ALL", "JPD1", "JPD2", "BSD", "LEO"];

const PROPERTY_LABEL: Record<string, string> = {
  ALL: "All properties",
  JPD1: "Jurong Penjuru 1",
  JPD2: "Jurong Penjuru 2",
  BSD: "Blue Stars",
  LEO: "The Leo",
};

type SortKey = "name" | "total" | "overdue" | BucketKey;

export default function AgingBoardPage() {
  const { scope, canAct } = useSession();
  const store = useStore();
  const ds = withManualEmails(useDataset(), store.manualEmails);
  const [property, setProperty] = useState<PropertyCode | "ALL">("ALL");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("overdue");
  const [desc, setDesc] = useState(true);
  /* The aging columns are an analyst's tool: added to the one table on
     request, rather than drawn as a second table of the same tenants. */
  const [aging, setAging] = useState(false);
  /* Charge types and billing runs, which are not per tenant. */
  const [full, setFull] = useState(false);
  /*
   * Which tenants the list shows. It showed only the overdue - 160 of
   * MES's 263 in September - and MES asked to see every tenant: the ones not
   * late yet, the ones in credit and the ones who owe nothing are still
   * tenants, and a list that leaves them out reads as though they are missing.
   */
  const [show, setShow] = useState<"all" | "owing" | "overdue">("all");

  // Scoped, like everything else on this screen. Passing ds.invoices straight
  // in showed a relationship manager every billing run in the file, $2.3m of
  // it, on a page whose tiles above correctly read "0 tenants shown". The
  // tiles derive from scope(); this did not.
  const myInvoices = useMemo(() => {
    const mine = scope(ds.accounts);
    if (mine.length === ds.accounts.length) return ds.invoices;
    const codes = new Set(mine.map((a) => a.customerCode.toUpperCase()));
    return ds.invoices.filter((i) =>
      codes.has(String((i as { customerCode?: string }).customerCode ?? "").toUpperCase()),
    );
  }, [ds.accounts, ds.invoices, scope]);

  /* The dormitories the report covers. MES's export is one entity, one
     dormitory, so a picker offering four more was four empty lists. */
  const dorms = useMemo(
    () => Array.from(new Set(scope(ds.accounts).map((a) => a.property))),
    [ds.accounts, scope],
  );

  /*
   * The list's tenants: the dormitory and the search applied. Moved-out
   * tenants stay in, marked, because they still owe what they owe; a Live /
   * Terminated switch used to leave them off without saying so.
   */
  const plain = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scope(ds.accounts)
      .filter((a) => (property === "ALL" ? true : a.property === property))
      .filter((a) =>
        q === ""
          ? true
          : a.companyName.toLowerCase().includes(q) ||
            a.customerCode.toLowerCase().includes(q),
      );
  }, [ds, property, query, scope]);
  const overdueOnly = plain.filter((a) => !isInCredit(a) && overdueTotal(a) > 0);
  const whoOwe = plain.filter((a) => a.total > 0);

  /* Late money first, then what is owed but not late, then nothing owed,
     then credit - so the list still opens on who to chase. With the aging
     columns open, a column header sorts instead. */
  const owing = useMemo(() => {
    const list = show === "overdue" ? overdueOnly : show === "owing" ? whoOwe : plain;
    if (!aging) {
      return [...list].sort(
        (x, y) =>
          Math.max(overdueTotal(y), 0) - Math.max(overdueTotal(x), 0) || y.total - x.total,
      );
    }
    const value = (a: Account) => {
      if (sort === "name") return a.companyName;
      if (sort === "total") return a.total;
      if (sort === "overdue") return overdueTotal(a);
      return a.buckets[sort];
    };
    return [...list].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      const cmp =
        typeof x === "string" && typeof y === "string"
          ? x.localeCompare(y)
          : Number(x) - Number(y);
      return desc ? -cmp : cmp;
    });
    // overdueOnly and whoOwe are derived from plain on every render.
  }, [plain, show, aging, sort, desc]); // eslint-disable-line react-hooks/exhaustive-deps

  /* A page at a time, so a full report does not render every row at once. */
  const plainPage = usePaged(owing, `${show}|${property}|${query}|${aging}|${sort}|${desc}`);

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

  /* The tiles count every tenant the dormitory and search leave, moved out
     or not, so they add up to the report's own total. */
  const k = useMemo(() => kpis(plain), [plain]);
  const totals = useMemo(() => bucketTotals(owing), [owing]);
  const charges = useMemo(
    () => revenueBreakdown(plain, ds.invoices),
    [plain, ds.invoices],
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile
          label="Overdue"
          prefix="SGD"
          value={formatSgd(k.overdue)}
          note={`${k.actionable} ${k.actionable === 1 ? "tenant" : "tenants"} to chase`}
          emphasis
        />
        <StatTile
          label="Total owed"
          prefix="SGD"
          value={formatSgd(k.outstanding)}
          note={`${whoOwe.length} ${whoOwe.length === 1 ? "tenant owes" : "tenants owe"}`}
        />
        <StatTile
          label="Over 90 days"
          prefix="SGD"
          value={formatSgd(k.severe)}
        />
        <StatTile
          label="In credit"
          value={String(k.inCredit)}
        />
      </div>

      <Card>
        <CardHeader
          title="Tenants"
          hint={`Report of ${formatDate(ds.asOf)} · ${aging ? "click a column to sort" : "most overdue first"}`}
          right={
            <button
              type="button"
              onClick={() => setAging(!aging)}
              aria-pressed={aging}
              className={`rounded-full border px-3 py-1 text-xs ${
                aging
                  ? "border-accent bg-accent-wash font-medium text-accent-text"
                  : "border-line-hair bg-surface text-ink-secondary hover:border-line-strong hover:text-ink"
              }`}
            >
              Aging columns
            </button>
          }
        />

        <div className="flex flex-col gap-2 border-b border-line-hair px-4 py-3 sm:px-5 lg:flex-row lg:items-center">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a tenant by name or code"
              aria-label="Find a tenant"
              className="w-full rounded-md border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted sm:w-64 sm:py-1.5 sm:text-xs"
            />
            {dorms.length > 1 ? (
            <select
              value={property}
              onChange={(e) => setProperty(e.target.value as PropertyCode | "ALL")}
              aria-label="Dormitory"
              className="w-full rounded-md border bg-surface px-2.5 py-2 text-sm text-ink sm:w-auto sm:py-1.5 sm:text-xs"
            >
              {PROPERTIES.filter((pc) => pc === "ALL" || dorms.includes(pc)).map((pc) => (
                <option key={pc} value={pc}>
                  {PROPERTY_LABEL[pc]}
                </option>
              ))}
            </select>
            ) : null}
          </div>
          <div
            className="flex gap-1 overflow-x-auto rounded-md bg-surface-alt p-1 lg:ml-auto"
            role="group"
            aria-label="Which tenants"
          >
            {(
              [
                ["all", "All", plain.length],
                ["owing", "Owing", whoOwe.length],
                ["overdue", "Overdue", overdueOnly.length],
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                onClick={() => setShow(key)}
                aria-pressed={show === key}
                className={`flex-1 whitespace-nowrap rounded px-3 py-1.5 text-xs lg:flex-none ${
                  show === key
                    ? "bg-surface font-medium text-accent-text shadow-sm"
                    : "text-ink-muted hover:text-ink-secondary"
                }`}
              >
                {label} <span className="tabular opacity-70">{count}</span>
              </button>
            ))}
          </div>
        </div>

        {owing.length === 0 ? (
          <EmptyState
            title={show === "overdue" && !query.trim() ? "Nobody here is overdue" : "No tenants match"}
            body="Try another search or dormitory, or choose All."
          />
        ) : aging ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-surface">
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
                {plainPage.shown.map((a) => (
                  <AccountRow
                    key={a.id}
                    account={a}
                    invoices={myInvoices}
                    canAct={canAct}
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
                    {owing.length} accounts
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
                    {formatSgd(sumExact(owing, (x) => x.total))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="border-b border-line-grid text-left text-xs font-medium text-ink-muted">
                  <th className="px-4 py-2.5 sm:px-5">Tenant</th>
                  {dorms.length > 1 ? <th className="hidden px-5 py-2.5 md:table-cell">Dormitory</th> : null}
                  <th className="hidden px-5 py-2.5 text-right sm:table-cell">Owed</th>
                  <th className="px-4 py-2.5 text-right sm:px-5">Overdue</th>
                  <th className="hidden px-5 py-2.5 sm:table-cell">How late</th>
                </tr>
              </thead>
              <tbody>
                {plainPage.shown.map((a) => (
                  <tr key={a.id} className="border-b border-line-hair hover:bg-surface-alt">
                    <td className="px-4 py-3 sm:px-5">
                      <TenantLink id={a.id} name={a.companyName} className="font-medium text-ink" />
                      <div className="mt-0.5 text-[11px] text-ink-muted">
                        {a.customerCode}
                        {dorms.length > 1 ? <span className="md:hidden"> · {a.propertyName}</span> : null}
                        {a.status === "Terminated" ? " · moved out" : ""}
                      </div>
                      <div className="mt-1.5 sm:hidden">
                        <Lateness account={a} />
                      </div>
                    </td>
                    {dorms.length > 1 ? (
                      <td className="hidden px-5 py-3 text-xs text-ink-secondary md:table-cell">
                        {a.propertyName}
                      </td>
                    ) : null}
                    <td className="tabular hidden px-5 py-3 text-right text-ink-secondary sm:table-cell">
                      {formatSgd(a.total)}
                    </td>
                    <td className="tabular px-4 py-3 text-right font-medium text-ink sm:px-5">
                      {overdueTotal(a) > 0 ? formatSgd(overdueTotal(a)) : "-"}
                      <div className="text-[11px] font-normal text-ink-muted sm:hidden">
                        of {formatSgd(a.total)}
                      </div>
                    </td>
                    <td className="hidden px-5 py-3 sm:table-cell">
                      <Lateness account={a} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination {...plainPage.pager} />
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setFull(!full)}
          aria-expanded={full}
          className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink-secondary hover:border-accent hover:text-accent-text"
        >
          <span aria-hidden="true">{full ? "−" : "+"}</span>
          {full ? "Hide charge types and billing runs" : "Show charge types and billing runs"}
        </button>
      </div>

      {full ? (
        <>
          <Card>
            <CardHeader title="By charge type" hint={`As at ${formatDate(ds.asOf)}`} />
            <ChargeTypeTable rows={charges} />
          </Card>
          <BillingCycles invoices={myInvoices} asOf={ds.asOf} />
        </>
      ) : null}
    </div>
  );
}

/**
 * How late the worst of a tenant's money is, in MES's own group names.
 *
 * This said "Up to 30 days late", "Up to 60 days late" and so on, which was
 * written for the Age column - days past the due date. Since 14 October the
 * groups count from the billing date, and the "30 days" group holds bills 31
 * to 60 days old: "up to 30 days late" no longer said what it held. MES asked
 * for their own names, the ones on their formula and in the age columns.
 */
function lateness(a: Account): string {
  return worstBucket(a);
}

/** The worst of a tenant's money, as a pill whose colour steps with age. */
function Lateness({ account: a }: { account: Account }) {
  if (isInCredit(a)) return <StatusBadge kind="good" label="In credit" />;
  if (a.total === 0) return <StatusBadge kind="neutral" label="Nothing owed" />;
  const kind =
    a.buckets.d90plus > 0 || a.buckets.d90 > 0
      ? "critical"
      : a.buckets.d60 > 0 || a.buckets.d30 > 0
        ? "warning"
        : "neutral";
  return <StatusBadge kind={kind} label={lateness(a)} />;
}

/**
 * Lets the officer type in an address for a tenant the AR export has none for.
 *
 * The export carries an email for 8 tenants out of 53, and the reminder screen
 * cannot reach the rest. Rather than waiting for MES to send a full contact
 * list, the officer can fill them in as they go, and what they type reaches
 * every other screen straight away.
 */
function AddEmail({ account, canAct }: { account: Account; canAct: boolean }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const { notify } = useToast();

  if (!canAct) return <StatusBadge kind="warning" label="No email" />;

  if (!open) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-line-hair bg-surface-alt px-2 py-0.5 text-xs text-ink-secondary hover:border-line-strong hover:text-ink"
      >
        <span aria-hidden="true" style={{ color: "var(--status-warning)" }}>
          △
        </span>
        No email, add one
      </button>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        autoFocus
        type="email"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key !== "Enter") return;
          const emails = value
            .split(/[;,]/)
            .map((x) => x.trim())
            .filter((x) => x.includes("@"));
          if (emails.length === 0) return;
          setManualEmails(account.id, account.companyName, emails);
          notify(
            `Email saved for ${account.companyName}`,
            "They can now be sent reminders.",
          );
          setOpen(false);
          setValue("");
        }}
        placeholder="name@company.com, press Enter"
        className="w-56 rounded-md border border-line-strong bg-surface px-2 py-0.5 text-xs text-ink placeholder:text-ink-muted"
      />
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Cancel"
        className="text-xs text-ink-muted hover:text-ink"
      >
        ✕
      </button>
    </span>
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
        body="Change the property or status filter."
      />
    );
  }

  const grand = rows.reduce((s, r) => s + r.total, 0);

  return (
    <>
      <ScrollPanel max={440}>
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-surface">
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
      </ScrollPanel>
    </>
  );
}

function AccountRow({
  account,
  invoices: allInvoices,
  canAct,
  open,
  onToggle,
}: {
  account: Account;
  /* The uploaded report's lines. Left out, this read the built-in sample
     data, so an expanded row showed nothing - or a sample company's bills. */
  invoices: Invoice[];
  canAct: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const credit = isInCredit(account);
  const invoices = open ? invoicesForAccount(account, allInvoices) : [];
  const linePage = usePaged(invoices, account.id, 15);

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
                <TenantLink id={account.id} name={account.companyName} />
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-ink-muted">
                  {account.customerCode} · {account.property}
                </span>
                {account.isOneFm ? <Tag>1FM</Tag> : null}
                {account.industry ? <Tag>{account.industry}</Tag> : null}
                {credit ? (
                  <StatusBadge kind="good" label="In credit" />
                ) : null}
                {!account.hasContact && !credit ? (
                  <AddEmail account={account} canAct={canAct} />
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
          {formatSgd(account.total)}
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
                No invoice lines for this tenant in the uploaded report.
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-surface">
                  <tr className="text-left text-ink-muted">
                    <th className="py-1.5 pr-4 font-medium">Revenue type</th>
                    <th className="py-1.5 pr-4 font-medium">Document</th>
                    <th className="py-1.5 pr-4 font-medium">Due</th>
                    <th className="py-1.5 pr-4 text-right font-medium">Age</th>
                    <th className="py-1.5 text-right font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {linePage.shown.map((i) => (
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
                        {formatDate(i.dueDate ?? null)}
                      </td>
                      <td className="tabular py-1.5 pr-4 text-right text-ink-muted">
                        {i.age !== null && i.age > 0 ? `${i.age} days` : "Not due"}
                      </td>
                      <td className="tabular py-1.5 text-right text-ink-secondary">
                        {formatSgd(i.openBalance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="-mx-5 -mb-4 mt-2">
              <Pagination {...linePage.pager} />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

