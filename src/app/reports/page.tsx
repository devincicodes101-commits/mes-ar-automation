"use client";

import { useMemo, useState } from "react";
import { allAccounts, data, formatSgd, isInCredit } from "@/lib/data";
import { recordExport, useStore } from "@/lib/store";
import {
  Card,
  CardHeader,
  EmptyState,
  Modal,
  StatTile,
  StatusBadge,
  Tag,
} from "@/components/ui";

interface ReportDef {
  id: string;
  name: string;
  goesTo: string;
  when: string;
  what: string;
  confirmed: boolean;
}

const REPORTS: ReportDef[] = [
  {
    id: "deposit",
    name: "Security deposit report",
    goesTo: "CSD",
    when: "Every Monday",
    what: "Deposits held, and any being used to offset an outstanding balance.",
    confirmed: false,
  },
  {
    id: "industry",
    name: "Industry breakdown",
    goesTo: "Management",
    when: "First working day of the month",
    what: "Outstanding balances grouped by the tenant's line of business, to show which sectors are slipping.",
    confirmed: true,
  },
  {
    id: "rm",
    name: "Relationship manager balances",
    goesTo: "Each RM",
    when: "Ongoing",
    what: "One list per manager covering only their own tenants.",
    confirmed: false,
  },
];

export default function ReportsPage() {
  const store = useStore();
  const [preview, setPreview] = useState<"netsuite" | null>(null);

  const accounts = allAccounts();

  const industry = useMemo(() => {
    const m = new Map<string, { total: number; count: number }>();
    for (const a of accounts) {
      if (isInCredit(a)) continue;
      const key = a.industry ?? "Not categorised";
      const row = m.get(key) ?? { total: 0, count: 0 };
      row.total += a.total;
      row.count += 1;
      m.set(key, row);
    }
    return Array.from(m.entries()).sort((x, y) => y[1].total - x[1].total);
  }, [accounts]);

  const activityRows =
    store.emails.length + store.calls.length + store.promises.length;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Rows ready to export"
          value={String(activityRows)}
          note="Emails, calls and promises"
          emphasis
        />
        <StatTile
          label="Scheduled reports"
          value={String(REPORTS.length)}
          note="Two still need confirming"
        />
        <StatTile
          label="Exports done"
          value={String(
            store.audit.filter((a) => a.action === "Exported a report").length,
          )}
          note="Recorded in the activity log"
        />
        <StatTile
          label="Business types"
          value={String(industry.length)}
          note="Used for the management report"
        />
      </div>

      {/* --------------------------------------------------- NetSuite export */}
      <Card>
        <CardHeader
          title="File to load back into NetSuite"
          hint="One file covering everything the team has done this period. NetSuite is never connected directly, so this is how the record gets back in."
          right={
            <button
              type="button"
              onClick={() => setPreview("netsuite")}
              disabled={activityRows === 0}
              className="rounded border border-accent bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Preview the export
            </button>
          }
        />
        {activityRows === 0 ? (
          <EmptyState
            title="Nothing to export yet"
            body="Log a call or send a reminder first, then the file will have rows in it."
          />
        ) : (
          <dl className="grid gap-px bg-line-grid sm:grid-cols-3">
            <Cell label="Emails sent" value={String(store.emails.length)} />
            <Cell label="Calls logged" value={String(store.calls.length)} />
            <Cell
              label="Promises recorded"
              value={String(store.promises.length)}
            />
          </dl>
        )}
      </Card>

      {/* ------------------------------------------------ scheduled reports */}
      <Card>
        <CardHeader
          title="Reports that go out on a schedule"
          hint="These run on their own once MES confirms where the figures come from."
        />
        <ul className="divide-y divide-line-grid">
          {REPORTS.map((r) => (
            <li key={r.id} className="flex flex-wrap gap-4 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{r.name}</span>
                  <Tag>to {r.goesTo}</Tag>
                  <Tag>{r.when}</Tag>
                </div>
                <p className="mt-1 text-xs text-ink-secondary">{r.what}</p>
                {!r.confirmed ? (
                  <div className="mt-1.5">
                    <StatusBadge
                      kind="warning"
                      label="MES to confirm the source"
                    />
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => recordExport(r.name)}
                className="shrink-0 self-start rounded border border-line-hair px-3 py-1.5 text-xs text-ink hover:border-line-strong"
              >
                Generate now
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {/* ----------------------------------------------- industry breakdown */}
      <Card>
        <CardHeader
          title="Outstanding by business type"
          hint="The management report. Built straight from the AR report, so this one needs nothing further from MES."
        />
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line-grid text-left">
              <th className="px-5 py-2.5 text-xs font-medium text-ink-muted">
                Business type
              </th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-ink-muted">
                Tenants
              </th>
              <th className="px-5 py-2.5 text-right text-xs font-medium text-ink-muted">
                Outstanding
              </th>
            </tr>
          </thead>
          <tbody>
            {industry.map(([name, row]) => (
              <tr key={name} className="border-b border-line-grid">
                <td className="px-5 py-2.5 text-ink-secondary">{name}</td>
                <td className="tabular px-3 py-2.5 text-right text-ink-muted">
                  {row.count}
                </td>
                <td className="tabular px-5 py-2.5 text-right font-medium text-ink">
                  {formatSgd(row.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-line-hair bg-surface-alt px-5 py-2.5">
          <p className="text-[11px] text-ink-muted">
            Most tenants in the sample have no business type recorded, so they
            fall into Not categorised. The full AR export should carry it for
            everyone.
          </p>
        </div>
      </Card>

      {preview === "netsuite" ? (
        <ExportPreview onClose={() => setPreview(null)} />
      ) : null}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-5 py-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </dt>
      <dd className="mt-1.5 text-xl font-semibold text-ink">{value}</dd>
    </div>
  );
}

function ExportPreview({ onClose }: { onClose: () => void }) {
  const store = useStore();

  const rows = [
    ...store.emails.map((e) => ({
      date: e.at,
      company: e.companyName,
      type: "Email",
      detail: e.subject,
      amount: "",
    })),
    ...store.calls.map((c) => ({
      date: c.at,
      company: c.companyName,
      type: "Call",
      detail: `${c.outcome.replaceAll("-", " ")}, spoke to ${c.reached || "nobody"}`,
      amount: c.promisedAmount ? formatSgd(c.promisedAmount) : "",
    })),
    ...store.promises.map((p) => ({
      date: p.createdAt,
      company: p.companyName,
      type: "Promise to pay",
      detail: `due ${p.promisedFor}`,
      amount: formatSgd(p.amount),
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <Modal wide title="NetSuite export preview" onClose={onClose}>
      <p className="mb-3 text-xs text-ink-secondary">
        One row per action, ready to attach to the customer record in NetSuite.
        The exact column names are agreed with MES before go live.
      </p>
      <div className="max-h-[50vh] overflow-auto rounded border border-line-hair">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-surface-alt">
            <tr className="text-left">
              {["Date", "Customer", "Activity", "Detail", "Amount"].map((h) => (
                <th
                  key={h}
                  className="border-b border-line-grid px-3 py-2 font-medium text-ink-muted"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-line-grid">
                <td className="whitespace-nowrap px-3 py-1.5 text-ink-muted">
                  {new Date(r.date).toLocaleDateString("en-SG")}
                </td>
                <td className="px-3 py-1.5 text-ink">{r.company}</td>
                <td className="px-3 py-1.5 text-ink-secondary">{r.type}</td>
                <td className="px-3 py-1.5 text-ink-secondary">{r.detail}</td>
                <td className="tabular px-3 py-1.5 text-right text-ink">
                  {r.amount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex items-center gap-2 border-t border-line-hair pt-4">
        <button
          type="button"
          onClick={() => {
            recordExport("NetSuite activity export");
            onClose();
          }}
          className="rounded border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90"
        >
          Download as CSV
        </button>
        <p className="text-[11px] text-ink-muted">
          {rows.length} rows · from the {data.asOfSummary} period
        </p>
      </div>
    </Modal>
  );
}
