"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";

import type { Dataset } from "@/lib/dataset";
import { formatSgd } from "@/lib/data";
import { formatDate, formatMonth } from "@/lib/format";
import { downloadFile } from "@/lib/export";
import { BUCKETS } from "@/lib/types";
import { EmptyState, Modal, Pagination } from "@/components/ui";
import { usePaged } from "@/lib/use-paged";

/**
 * The report in use, as a sheet.
 *
 * What the system read from the uploaded file and stored: one row per tenant,
 * and one per invoice line. The original file is not kept, so this is the
 * stored reading of it - which is also what every screen works from, and so
 * the thing worth checking.
 */

type Sheet = "tenants" | "lines";

/** Rows per page. Thousands of lines are searchable, not scrollable. */
const PAGE = 50;

export function ReportViewer({ ds, onClose }: { ds: Dataset; onClose: () => void }) {
  const [sheet, setSheet] = useState<Sheet>("tenants");
  const [query, setQuery] = useState("");

  const codeByName = useMemo(
    () => new Map(ds.accounts.map((a) => [a.companyName.toUpperCase(), a.customerCode])),
    [ds.accounts],
  );

  const tenants = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ds.accounts
      .filter((a) =>
        q === ""
          ? true
          : a.companyName.toLowerCase().includes(q) || a.customerCode.toLowerCase().includes(q),
      )
      .sort((x, y) => y.total - x.total);
  }, [ds.accounts, query]);

  const lines = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ds.invoices.filter((i) =>
      q === ""
        ? true
        : i.companyName.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q) ||
          i.documentNumber.toLowerCase().includes(q),
    );
  }, [ds.invoices, query]);

  const shown = sheet === "tenants" ? tenants.length : lines.length;
  const tenantPage = usePaged(tenants, `${sheet}|${query}`, PAGE);
  const linePage = usePaged(lines, `${sheet}|${query}`, PAGE);
  const pager = sheet === "tenants" ? tenantPage.pager : linePage.pager;

  function download() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        ds.accounts.map((a) => ({
          Code: a.customerCode,
          Tenant: a.companyName,
          Dormitory: a.propertyName,
          Status: a.status,
          ...Object.fromEntries(BUCKETS.map((b) => [b.label, a.buckets[b.key]])),
          Total: a.total,
          Email: a.emails.join("; "),
        })),
      ),
      "Tenants",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        ds.invoices.map((i) => ({
          Tenant: i.companyName,
          Document: i.documentNumber,
          Billed: i.date ?? "",
          Due: i.dueDate ?? "",
          Description: i.description,
          "Charge type": i.revenueType,
          "Age (days)": i.age ?? "",
          Bucket: i.bucket,
          "Open balance": i.openBalance,
        })),
      ),
      "Invoice lines",
    );
    const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    downloadFile(`AR report ${ds.asOf || ds.period}.xlsx`, bytes);
  }

  return (
    <Modal full title={`Report in use · ${formatMonth(ds.period)}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="flex gap-1 rounded-lg bg-surface-alt p-1" role="tablist" aria-label="Sheet">
            {(
              [
                ["tenants", "Tenants", ds.accounts.length],
                ["lines", "Invoice lines", ds.invoices.length],
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={sheet === key}
                onClick={() => {
                  setSheet(key);
                }}
                className={`flex-1 whitespace-nowrap rounded-md px-3.5 py-1.5 text-[13px] lg:flex-none ${
                  sheet === key
                    ? "bg-surface font-medium text-accent-text shadow-sm"
                    : "text-ink-muted hover:text-ink-secondary"
                }`}
              >
                {label} <span className="tabular opacity-70">{count}</span>
              </button>
            ))}
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            placeholder={sheet === "tenants" ? "Find a tenant or code" : "Find a tenant, document or description"}
            aria-label="Search the report"
            className="w-full rounded-md border bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted lg:ml-auto lg:w-72"
          />
          <button
            type="button"
            onClick={download}
            className="shrink-0 rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium text-ink-secondary"
          >
            Download as Excel
          </button>
        </div>

        <p className="text-xs text-ink-muted">
          Report of {formatDate(ds.asOf)}
          {query ? ` · ${shown} match${shown === 1 ? "" : "es"}` : ""}
        </p>

        {shown === 0 ? (
          <EmptyState title="Nothing matches" body="Try another search." />
        ) : (
          <div className="max-h-[62vh] overflow-auto rounded-lg border border-line-hair">
            {sheet === "tenants" ? (
              <table className="w-full min-w-[960px] border-collapse text-[13px]">
                <thead className="sticky top-0 z-10 bg-surface-alt">
                  <tr className="text-left text-xs text-ink-muted">
                    <Th>Code</Th>
                    <Th>Tenant</Th>
                    <Th>Dormitory</Th>
                    {BUCKETS.map((b) => (
                      <Th key={b.key} right>
                        {b.label}
                      </Th>
                    ))}
                    <Th right>Total</Th>
                  </tr>
                </thead>
                <tbody>
                  {tenantPage.shown.map((a) => (
                    <tr key={a.id} className="border-t border-line-grid hover:bg-surface-alt">
                      <Td muted nowrap>
                        {a.customerCode}
                      </Td>
                      <Td>
                        {a.companyName}
                        {a.status === "Terminated" ? (
                          <span className="ml-1.5 text-[11px] text-ink-muted">moved out</span>
                        ) : null}
                      </Td>
                      <Td muted>{a.propertyName}</Td>
                      {BUCKETS.map((b) => (
                        <Td key={b.key} right muted={a.buckets[b.key] === 0}>
                          {a.buckets[b.key] === 0 ? "-" : formatSgd(a.buckets[b.key])}
                        </Td>
                      ))}
                      <Td right strong>
                        {formatSgd(a.total)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full min-w-[1100px] border-collapse text-[13px]">
                <thead className="sticky top-0 z-10 bg-surface-alt">
                  <tr className="text-left text-xs text-ink-muted">
                    <Th>Tenant</Th>
                    <Th>Document</Th>
                    <Th>Billed</Th>
                    <Th>Due</Th>
                    <Th>Description</Th>
                    <Th>Charge type</Th>
                    <Th right>Age</Th>
                    <Th right>Open balance</Th>
                  </tr>
                </thead>
                <tbody>
                  {linePage.shown.map((i) => (
                    <tr key={i.id} className="border-t border-line-grid hover:bg-surface-alt">
                      <Td>
                        {i.companyName}
                        <span className="ml-1.5 whitespace-nowrap text-[11px] text-ink-muted">
                          {codeByName.get(i.companyName.toUpperCase()) ?? ""}
                        </span>
                      </Td>
                      <Td muted nowrap>
                        {i.documentNumber}
                      </Td>
                      <Td muted nowrap>
                        {formatDate(i.date)}
                      </Td>
                      <Td muted nowrap>
                        {formatDate(i.dueDate)}
                      </Td>
                      <Td>{i.description}</Td>
                      <Td muted>{i.revenueType}</Td>
                      <Td right muted nowrap>
                        {i.age === null ? "-" : i.age > 0 ? `${i.age}d` : "Not due"}
                      </Td>
                      <Td right strong>
                        {formatSgd(i.openBalance)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        {shown > PAGE ? (
          <div className="overflow-hidden rounded-lg border border-line-hair [&>div]:border-t-0">
            <Pagination {...pager} />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`whitespace-nowrap px-3 py-2 font-medium ${right ? "text-right" : ""}`}>{children}</th>
  );
}

function Td({
  children,
  right = false,
  muted = false,
  strong = false,
  nowrap = false,
}: {
  children: React.ReactNode;
  right?: boolean;
  muted?: boolean;
  strong?: boolean;
  nowrap?: boolean;
}) {
  return (
    <td
      className={`px-3 py-2 align-top ${right ? "tabular text-right" : ""} ${
        nowrap ? "whitespace-nowrap" : ""
      } ${strong ? "font-medium text-ink" : muted ? "text-ink-muted" : "text-ink-secondary"}`}
    >
      {children}
    </td>
  );
}
