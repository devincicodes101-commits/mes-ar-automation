"use client";

import { useMemo, useState } from "react";
import {
  allAccounts,
  data,
  depositReport,
  formatSgd,
  isInCredit,
  overdueTotal,
  rmReports,
} from "@/lib/data";
import { recordExport, useStore } from "@/lib/store";
import { useSession, useToast } from "@/lib/session";
import { useDataset, withManualEmails } from "@/lib/dataset";
import { downloadCsv, exportName } from "@/lib/export";
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
  const { scope, canAct } = useSession();
  const ds = withManualEmails(useDataset(), store.manualEmails);
  const { notify } = useToast();
  const [preview, setPreview] = useState<"netsuite" | null>(null);

  const accounts = useMemo(() => scope(ds.accounts), [ds, scope]);

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

  const deposits = useMemo(
    () => depositReport(accounts, ds.invoices),
    [accounts, ds.invoices],
  );
  const managers = useMemo(
    () =>
      rmReports(accounts, ds.managers).filter((m) => m.accounts.length > 0),
    [accounts, ds.managers],
  );

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
          hint="Everything done this period, ready to upload into NetSuite."
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
            body="Log a call or send a reminder first."
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
          hint="Sent on a schedule."
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
                disabled={!canAct}
                onClick={() => {
                  const built = buildReport(r.id, accounts);
                  if (built.rows.length === 0) {
                    notify(
                      `${r.name} has no rows`,
                      built.emptyReason ?? "Nothing to report for this period.",
                    );
                    return;
                  }
                  downloadCsv(
                    exportName(r.id, data.asOfSummary),
                    built.headers,
                    built.rows,
                  );
                  recordExport(r.name);
                  notify(
                    `${r.name} downloaded`,
                    `${built.rows.length} rows, sent to ${r.goesTo}`,
                  );
                }}
                className="shrink-0 self-start rounded border border-line-hair px-3 py-1.5 text-xs text-ink hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-40"
              >
                Generate now
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {/* Proposal 4.7. Shown on screen, not only in a download, so the officer
          can see what is in each report before sending it. */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Security deposits"
            hint="To CSD every Monday."
            right={<StatusBadge kind="warning" label="MES to confirm the source" />}
          />
          {deposits.length === 0 ? (
            <EmptyState
              title="No deposit lines found"
              body="No security deposit lines in the invoice detail. Waiting on MES to confirm the source."
            />
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line-grid text-left">
                  <th className="px-5 py-2.5 text-xs font-medium text-ink-muted">Tenant</th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-ink-muted">Deposit held</th>
                  <th className="px-5 py-2.5 text-right text-xs font-medium text-ink-muted">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {deposits.map((d) => (
                  <tr key={d.account.id} className="border-b border-line-grid">
                    <td className="px-5 py-2.5">
                      <span className="text-ink">{d.account.companyName}</span>
                      <span className="ml-2 text-[11px] text-ink-muted">
                        {d.account.property}
                      </span>
                      {d.offsetting ? (
                        <span className="ml-2">
                          <StatusBadge kind="serious" label="Being offset" />
                        </span>
                      ) : null}
                    </td>
                    <td className="tabular px-3 py-2.5 text-right text-ink-secondary">
                      {formatSgd(d.deposits)}
                    </td>
                    <td className="tabular px-5 py-2.5 text-right font-medium text-ink">
                      {formatSgd(d.outstanding)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Relationship manager balances"
            hint="One list per manager."
          />
          <ul className="divide-y divide-line-grid">
            {managers.map((m) => (
              <li key={m.key} className="flex flex-wrap items-center gap-4 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{m.name}</p>
                  <p className="mt-0.5 text-[11px] text-ink-muted">
                    {m.accounts.length} tenants
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="tabular text-sm font-medium text-ink">
                    {formatSgd(m.outstanding)}
                  </div>
                  <div className="tabular mt-0.5 text-[11px] text-ink-muted">
                    {formatSgd(m.overdue)} overdue
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* ----------------------------------------------- industry breakdown */}
      <Card>
        <CardHeader
          title="Outstanding by business type"
          hint="Outstanding grouped by line of business."
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
      </Card>

      {preview === "netsuite" ? (
        <ExportPreview onClose={() => setPreview(null)} />
      ) : null}
    </div>
  );
}

/**
 * Builds one of the three scheduled reports. Each has its own columns, because
 * a security deposit report with no deposits in it and a manager's log
 * containing another manager's tenants are not reports, they are a file with
 * the right name.
 */
function buildReport(
  id: string,
  accounts: ReturnType<typeof allAccounts>,
): { headers: string[]; rows: unknown[][]; emptyReason?: string } {
  if (id === "deposit") {
    const rows = depositReport(accounts);
    return {
      headers: [
        "Customer Code",
        "Company Name",
        "Property",
        "Status",
        "Deposit Held SGD",
        "Being Offset",
        "Outstanding SGD",
      ],
      rows: rows.map((d) => [
        d.account.customerCode,
        d.account.companyName,
        d.account.property,
        d.account.status,
        d.deposits.toFixed(2),
        d.offsetting ? "Yes" : "No",
        d.outstanding.toFixed(2),
      ]),
      emptyReason: "No security deposit lines in the invoice detail.",
    };
  }

  if (id === "rm") {
    const reports = rmReports(accounts);
    return {
      headers: [
        "Relationship Manager",
        "Customer Code",
        "Company Name",
        "Property",
        "Status",
        "Overdue SGD",
        "Total Outstanding SGD",
      ],
      // One file covering every manager, each row tagged with whose it is, so
      // it can be split per manager when it is actually sent out.
      rows: reports.flatMap((rep) =>
        rep.accounts.map((a) => [
          rep.name,
          a.customerCode,
          a.companyName,
          a.property,
          a.status,
          overdueTotal(a).toFixed(2),
          a.total.toFixed(2),
        ]),
      ),
      emptyReason: "No tenants are assigned to a relationship manager.",
    };
  }

  // Industry breakdown, for management.
  const byIndustry = new Map<string, { count: number; total: number; overdue: number }>();
  for (const a of accounts) {
    if (isInCredit(a)) continue;
    const key = a.industry ?? "Not categorised";
    const row = byIndustry.get(key) ?? { count: 0, total: 0, overdue: 0 };
    row.count += 1;
    row.total += a.total;
    row.overdue += overdueTotal(a);
    byIndustry.set(key, row);
  }
  return {
    headers: [
      "Business Type",
      "Tenants",
      "Overdue SGD",
      "Total Outstanding SGD",
    ],
    rows: Array.from(byIndustry.entries())
      .sort((x, y) => y[1].total - x[1].total)
      .map(([name, v]) => [
        name,
        v.count,
        v.overdue.toFixed(2),
        v.total.toFixed(2),
      ]),
  };
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
  const { notify } = useToast();

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
            downloadCsv(
              exportName("NetSuite_Activity", data.asOfSummary),
              ["Date", "Customer", "Activity", "Detail", "Amount SGD"],
              rows.map((r) => [
                new Date(r.date).toISOString().slice(0, 10),
                r.company,
                r.type,
                r.detail,
                r.amount,
              ]),
            );
            recordExport("NetSuite activity export");
            notify(
              "NetSuite export downloaded",
              `${rows.length} rows ready to upload`,
            );
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
