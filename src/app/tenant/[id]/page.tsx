"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { BUCKETS, type BucketKey } from "@/lib/types";
import { formatSgd, invoicesForAccount, overdueTotal, severeTotal } from "@/lib/data";
import { useStore } from "@/lib/store";
import { useDataset, withManualEmails } from "@/lib/dataset";
import { useSession } from "@/lib/session";
import { historyFor, summariseHistory, type HistoryKind } from "@/lib/tenant-history";
import { Card, CardHeader, EmptyState, StatTile, StatusBadge, Tag } from "@/components/ui";

/**
 * One tenant, and everything this system has done about them.
 *
 * The record was complete and scattered across four screens: the letter on
 * Sent Mail, the call that followed on the Call List, the promise on Payment
 * Promises, the $100 on Late Payment Fees. Each sorted by its own thing, none
 * of them answering what anybody actually asks — what have we done about this
 * company?
 *
 * It gets asked twice and both matter. An officer picking up the phone needs
 * to know what the tenant has already been told. And a tenant ringing up to
 * dispute a charge is the moment MES need the whole sequence with dates,
 * rather than four tabs and a good memory.
 */

const TINT: Record<HistoryKind, "good" | "warning" | "critical" | "neutral"> = {
  letter: "warning",
  call: "neutral",
  promise: "good",
  fee: "critical",
};

const WHAT: Record<HistoryKind, string> = {
  letter: "Letter",
  call: "Call",
  promise: "Promise",
  fee: "Fee",
};

export default function TenantPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params?.id ?? ""));

  const store = useStore();
  const { scope } = useSession();
  const ds = withManualEmails(useDataset(), store.manualEmails);

  /* Through scope(), so a relationship manager cannot reach another manager's
     tenant by typing the address. The page is a URL, and a URL is a door. */
  const account = useMemo(
    () => scope(ds.accounts).find((a) => a.id === id) ?? null,
    [ds.accounts, id, scope],
  );

  const events = useMemo(
    () => historyFor(id, store),
    [id, store],
  );

  /* Matched through invoicesForAccount, which joins on the company name, so
     this page groups charges exactly as every other screen does rather than
     inventing a second rule that could disagree with them. */
  const charges = useMemo(
    () => (account ? invoicesForAccount(account, ds.invoices) : []),
    [account, ds.invoices],
  );

  if (!account) {
    return (
      <div className="space-y-5">
        <Card>
          <EmptyState
            title="That tenant is not in the current report"
            body={
              events.length > 0
                ? "They have a history here, so they were in an earlier one. A tenant " +
                  "who is gone from the newest report has paid in full."
                : "Check the report on screen is the one you meant."
            }
          />
        </Card>
        {events.length > 0 ? <Timeline events={events} /> : null}
      </div>
    );
  }

  const overdue = overdueTotal(account);
  const severe = severeTotal(account);

  return (
    <div className="space-y-5">
      <Card className="px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-ink">{account.companyName}</h1>
            <p className="mt-1 text-xs text-ink-muted">
              {account.customerCode} · {account.property} · {account.status}
              {account.isOneFm ? " · 1FM" : ""}
            </p>
            <p className="mt-2 max-w-[70ch] text-sm text-ink-secondary">
              {summariseHistory(events)}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {account.emails.length > 0 ? (
              <p className="text-xs text-ink-secondary">{account.emails.join(", ")}</p>
            ) : (
              <StatusBadge kind="critical" label="No email address" />
            )}
            <Link
              href="/collections"
              className="rounded border border-line-hair px-3 py-1.5 text-xs text-ink-secondary hover:border-line-strong hover:text-ink"
            >
              Back to the list
            </Link>
          </div>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Owed" prefix="SGD" value={formatSgd(account.total)} note="Everything on the account" />
        <StatTile
          label="Overdue"
          prefix="SGD"
          value={formatSgd(overdue)}
          note="More than 15 days past due"
          emphasis
        />
        <StatTile label="Over 90 days" prefix="SGD" value={formatSgd(severe)} note="The hardest to recover" />
        <StatTile label="Oldest money" value={oldestBucket(account.buckets)} note="Where the debt sits" />
      </div>

      <Timeline events={events} />

      <Card>
        <CardHeader
          title="What they are being charged for"
          hint="Every line in the report on screen, oldest money first."
        />
        {charges.length === 0 ? (
          <EmptyState title="No charge lines" body="This upload carried no line detail for them." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line-hair text-left text-xs text-ink-muted">
                  <th className="px-5 py-2 font-medium">Billed</th>
                  <th className="px-3 py-2 font-medium">Due</th>
                  <th className="px-3 py-2 font-medium">What it is</th>
                  <th className="px-3 py-2 font-medium">How overdue</th>
                  <th className="px-5 py-2 text-right font-medium">Owed</th>
                </tr>
              </thead>
              <tbody>
                {[...charges]
                  .sort((a, b) => (b.age ?? 0) - (a.age ?? 0))
                  .map((c) => (
                    <tr key={c.id} className="border-b border-line-hair last:border-0">
                      <td className="tabular px-5 py-2.5 text-ink-secondary">{c.date ?? "—"}</td>
                      <td className="tabular px-3 py-2.5 text-ink-secondary">{c.dueDate ?? "—"}</td>
                      <td className="px-3 py-2.5 text-ink-secondary">{c.description}</td>
                      <td className="px-3 py-2.5">
                        <Tag>{c.bucket || "—"}</Tag>
                        {c.age !== null ? (
                          <span className="ml-2 text-xs text-ink-muted">{c.age}d</span>
                        ) : null}
                      </td>
                      <td className="tabular px-5 py-2.5 text-right font-medium text-ink">
                        {formatSgd(c.openBalance)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Timeline({ events }: { events: ReturnType<typeof historyFor> }) {
  return (
    <Card>
      <CardHeader
        title="Everything we have done"
        hint="Letters, calls, promises and fees in one order, newest first. A letter is something the tenant has too."
        right={<StatusBadge kind="neutral" label={`${events.length} events`} />}
      />
      {events.length === 0 ? (
        <EmptyState
          title="Nothing yet"
          body="No letter has been sent, no call logged and no fee raised against this tenant."
        />
      ) : (
        <ol className="divide-y divide-line-hair">
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
              <StatusBadge kind={TINT[e.kind]} label={WHAT[e.kind]} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{e.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-secondary">{e.detail}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="tabular text-xs text-ink-secondary">{e.at.slice(0, 10)}</p>
                <p className="text-[11px] text-ink-muted">
                  {e.reachedTheTenant ? "the tenant has this too" : "internal record"}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/** The oldest bucket carrying money, which is how MES describe an account. */
function oldestBucket(buckets: Record<BucketKey, number>): string {
  for (const b of [...BUCKETS].reverse()) {
    if (buckets[b.key] > 0) return b.label;
  }
  return "Nothing owed";
}
