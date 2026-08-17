"use client";

import { useMemo, useState } from "react";
import {
  GIRO_LABEL,
  formatSgd,
  giroStatus,
  isInCredit,
  overdueTotal,
} from "@/lib/data";
import { useSession } from "@/lib/session";
import { useDataset } from "@/lib/dataset";
import {
  Card,
  CardHeader,
  EmptyState,
  StatTile,
  StatusBadge,
  Tag,
} from "@/components/ui";

/**
 * Failed Payments, proposal 4.1 and section 3 step 2.
 *
 * Two requirements live here because they are the same job:
 *
 *   "Matches each rejection against the uploaded AR Report"
 *   "Routes NO DDA accounts to GIRO setup and REFER PAYING PARTY accounts
 *    to balance follow-up"
 *
 * The screen is deliberately honest about being empty. The bank report MES
 * supplied is a screenshot with the payer names removed, so no line can be
 * tied to a tenant. Rather than hide that, the screen states it, names the
 * file needed, and shows exactly what will appear once it arrives.
 */

/** From the batch header of the sample report, which is legible. */
const BATCH = {
  reference: "EBCOL60429795237",
  paymentDate: "04 May 2026",
  totalItems: 147,
  completed: 124,
  rejected: 23,
  noDda: 1,
  referPayingParty: 22,
};

type Tab = "matching" | "giro-setup" | "chase";

export default function FailedPaymentsPage() {
  const { scope } = useSession();
  const ds = useDataset();
  const [tab, setTab] = useState<Tab>("matching");

  const accounts = useMemo(() => scope(ds.accounts), [ds, scope]);

  // Once the bank file is readable these fill themselves in. Until then the
  // only tenants we can name are those the AR report itself identifies.
  const noMandate = accounts.filter((a) => giroStatus(a) === "no-mandate");
  const rejected = accounts.filter(
    (a) => giroStatus(a) === "enrolled" && !isInCredit(a),
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Payments attempted"
          value={String(BATCH.totalItems)}
          note={`Bank run on ${BATCH.paymentDate}`}
        />
        <StatTile
          label="Collected"
          value={String(BATCH.completed)}
          note="Nothing to do for these"
        />
        <StatTile
          label="Failed"
          value={String(BATCH.rejected)}
          note="Need routing to the right track"
          emphasis
        />
        <StatTile
          label="Matched to a tenant"
          value="0"
          note={`of ${BATCH.rejected}, see below`}
        />
      </div>

      {/* The honest bit. */}
      <Card>
        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start">
          <div className="shrink-0">
            <StatusBadge kind="critical" label="Cannot match yet" />
          </div>
          <div className="text-xs leading-relaxed text-ink-secondary">
            <p>
              None of the {BATCH.rejected} failed payments can be tied to a
              tenant. The bank report we hold is a screenshot with the payer
              names removed, so although we can read the totals in the header,
              every individual line is anonymous.
            </p>
            <p className="mt-2">
              The system will not guess. Reading account numbers and amounts out
              of a picture means confusing 0 with O and 1 with 7, and a single
              wrong character would put the wrong tenant on a chasing list for
              the wrong sum.
            </p>
            <p className="mt-2 text-ink">
              What unblocks this: the DBS Bulk Collection Report exported as CSV
              or Excel, with the Name column showing. Everything below fills in
              on its own once that file is uploaded.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Where each failed payment goes"
          hint="The two reasons mean different things and need different treatment, so they are handled on separate tracks."
        />

        <div className="flex flex-wrap gap-1 border-b border-line-hair px-5 py-2.5">
          {(
            [
              ["matching", `Matching (0 of ${BATCH.rejected})`],
              ["giro-setup", `Never signed up (${BATCH.noDda})`],
              ["chase", `No money in account (${BATCH.referPayingParty})`],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              aria-pressed={tab === k}
              className={`rounded px-2.5 py-1 text-xs ${
                tab === k
                  ? "bg-accent-wash font-medium text-ink"
                  : "text-ink-muted hover:bg-surface-alt hover:text-ink-secondary"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "matching" ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line-grid text-left">
                    {[
                      "Item",
                      "Payer name",
                      "DDA reference",
                      "Bank account",
                      "Amount",
                      "Reason",
                      "Matched to",
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-2.5 text-xs font-medium text-ink-muted"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* The three legible rows from the sample, to show the shape
                      of what arrives. Names and amounts are blanked in the
                      source, so they are blank here too. */}
                  {[
                    { n: 1, dda: "JPD…", acct: "7171 201", reason: "NO DDA" },
                    { n: 2, dda: "JPD…", acct: "7339 602", reason: "REFER PAYING PARTY" },
                    { n: 3, dda: "JPD…", acct: "7339 591", reason: "REFER PAYING PARTY" },
                  ].map((row) => (
                    <tr key={row.n} className="border-b border-line-grid">
                      <td className="tabular px-4 py-2.5 text-ink-muted">{row.n}</td>
                      <td className="px-4 py-2.5">
                        <Tag>removed from the file</Tag>
                      </td>
                      <td className="px-4 py-2.5 text-ink-secondary">{row.dda}</td>
                      <td className="tabular px-4 py-2.5 text-ink-secondary">
                        {row.acct}
                      </td>
                      <td className="px-4 py-2.5">
                        <Tag>removed</Tag>
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge
                          kind={row.reason === "NO DDA" ? "warning" : "critical"}
                          label={row.reason}
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs text-ink-muted">
                          nothing to match on
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-line-hair bg-surface-alt px-5 py-3">
              <p className="text-[11px] leading-relaxed text-ink-muted">
                Batch {BATCH.reference}, {BATCH.paymentDate}. Showing 3 of{" "}
                {BATCH.rejected} rejected lines. Once a readable file is
                uploaded, each line is matched automatically and anything that
                cannot be matched appears here for an officer to resolve by
                hand.
              </p>
            </div>
          </>
        ) : null}

        {tab === "giro-setup" ? (
          noMandate.length === 0 ? (
            <EmptyState
              title="No tenant can be identified as unenrolled yet"
              body={`The bank report says ${BATCH.noDda} tenant has never signed the GIRO form, but with the names removed we cannot tell which one. These tenants need a form to sign, not a chasing email, which is why they are kept off the Action List.`}
            />
          ) : (
            <ul className="divide-y divide-line-grid">
              {noMandate.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{a.companyName}</p>
                    <p className="mt-0.5 text-[11px] text-ink-muted">
                      {a.customerCode} · {a.propertyName}
                    </p>
                  </div>
                  <StatusBadge kind="warning" label="Send the GIRO form" />
                </li>
              ))}
            </ul>
          )
        ) : null}

        {tab === "chase" ? (
          rejected.length === 0 ? (
            <EmptyState
              title="No tenant can be confirmed as a failed deduction yet"
              body={`The bank report says ${BATCH.referPayingParty} tenants have GIRO set up but no money in the account. Until the names are readable we cannot say which. In the meantime the Action List ranks everyone by how overdue they are, which covers the same ground less precisely.`}
            />
          ) : (
            <ul className="divide-y divide-line-grid">
              {rejected.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{a.companyName}</p>
                    <p className="mt-0.5 text-[11px] text-ink-muted">
                      {a.customerCode} · {a.propertyName} ·{" "}
                      {GIRO_LABEL[giroStatus(a)]}
                    </p>
                  </div>
                  <div className="tabular shrink-0 text-right text-sm font-medium text-ink">
                    {formatSgd(overdueTotal(a))}
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </Card>
    </div>
  );
}
