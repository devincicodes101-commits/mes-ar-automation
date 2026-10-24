"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { BUCKETS, type BucketKey } from "@/lib/types";
import { formatSgd, invoicesForAccount, overdueTotal, severeTotal } from "@/lib/data";
import { CALL_STAGES, useStore, type CallLog } from "@/lib/store";
import { billingForTenant, NO_BILLING } from "@/lib/billing-cycles";
import { roundOfCall } from "@/lib/call-list";
import { sentReminders } from "@/lib/reminder-timing";
import { CallView } from "@/components/CallView";
import { formatDate } from "@/lib/format";
import { useDataset, withManualEmails } from "@/lib/dataset";
import { useSession } from "@/lib/session";
import { historyFor, summariseHistory, type HistoryKind } from "@/lib/tenant-history";
import {
  Card,
  CardHeader,
  EmptyState,
  Pagination,
  SearchBox,
  StatTile,
  StatusBadge,
  Tag,
  matchesQuery,
} from "@/components/ui";
import { usePaged } from "@/lib/use-paged";
import { backTarget } from "@/components/Shell";

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
  letter: "neutral",
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
  /* Read once per visit: the page this tenant was opened from. */
  const [back] = useState(backTarget);

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

  /* A call in the history opens the form as it was filled in, as on the
     Call List (25 October). */
  const [viewing, setViewing] = useState<CallLog | null>(null);
  const sent = useMemo(() => sentReminders(store.emails), [store.emails]);
  const billing = useMemo(
    () => (account ? billingForTenant(invoicesForAccount(account, ds.invoices), ds.asOf) : NO_BILLING),
    [account, ds.invoices, ds.asOf],
  );
  const openCall = (eventId: string) => setViewing(store.calls.find((c) => c.id === eventId) ?? null);
  const callWindow = viewing ? (
    <CallView
      call={viewing}
      round={CALL_STAGES.find((x) => x.value === roundOfCall(viewing, sent, store.calls))?.label ?? "-"}
      billing={billing}
      onClose={() => setViewing(null)}
    />
  ) : null;

  /* Matched through invoicesForAccount, which joins on the company name, so
     this page groups charges exactly as every other screen does rather than
     inventing a second rule that could disagree with them. */
  const charges = useMemo(
    () =>
      account
        ? [...invoicesForAccount(account, ds.invoices)].sort((a, b) => (b.age ?? 0) - (a.age ?? 0))
        : [],
    [account, ds.invoices],
  );

  /* Some tenants carry a few hundred lines, so a search and a page at a time. */
  const [find, setFind] = useState("");
  const foundCharges = useMemo(
    () =>
      charges.filter((c) =>
        matchesQuery(find, [c.description, c.documentNumber, c.bucket, formatDate(c.date), formatDate(c.dueDate)]),
      ),
    [charges, find],
  );
  const chargePage = usePaged(foundCharges, find);

  if (!account) {
    return (
      <div className="space-y-5">
        <div>
          <Link
            href={back.href}
            className="rounded border border-line-hair px-3 py-1.5 text-xs text-ink-secondary"
          >
            Back to {back.label}
          </Link>
        </div>
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
        {events.length > 0 ? <Timeline events={events} onViewCall={openCall} /> : null}
        {callWindow}
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
              {account.customerCode} · {account.property}
              {account.status === "Terminated" ? " · moved out" : ""}
              {account.isOneFm ? " · 1FM" : ""}
            </p>
            <p className="mt-2 max-w-[70ch] text-sm text-ink-secondary">
              {summariseHistory(events)}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {/* A role that may not read addresses is sent "address hidden"
                in their place (see hideAddresses), so say how many there
                are rather than repeating the placeholder. */}
            {account.emails.length > 0 && account.emails.every((e) => e === "address hidden") ? (
              <p className="text-xs text-ink-muted">
                {account.emails.length} email address{account.emails.length === 1 ? "" : "es"} on
                file, not shown for your role
              </p>
            ) : account.emails.length > 0 ? (
              <p className="text-xs text-ink-secondary">{account.emails.join(", ")}</p>
            ) : (
              <StatusBadge kind="critical" label="No email address" />
            )}
            <Link
              href={back.href}
              className="rounded border border-line-hair px-3 py-1.5 text-xs text-ink-secondary hover:border-line-strong hover:text-ink"
            >
              Back to {back.label}
            </Link>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {/* A tenant in credit owes nothing: "Owed -365.83" and "Overdue
            -365.83" read as debts. Said as credit, and nothing is overdue. */}
        {account.total < 0 ? (
          <StatTile label="In credit" prefix="SGD" value={formatSgd(-account.total)} />
        ) : (
          <StatTile label="Owed" prefix="SGD" value={formatSgd(account.total)} />
        )}
        <StatTile
          label="Overdue"
          prefix="SGD"
          value={formatSgd(Math.max(0, overdue))}
          emphasis
        />
        <StatTile label="Over 90 days" prefix="SGD" value={formatSgd(Math.max(0, severe))} />
        <StatTile label="Oldest money" value={oldestBucket(account.buckets)} />
      </div>

      <Timeline events={events} onViewCall={openCall} />
      {callWindow}

      <Card>
        <CardHeader
          title="What they are being charged for"
          hint={`${charges.length} ${charges.length === 1 ? "line" : "lines"}`}
          right={
            charges.length > 10 ? (
              <SearchBox
                value={find}
                onChange={setFind}
                placeholder="Find a charge, document or date"
                label="Find a charge"
              />
            ) : null
          }
        />
        {charges.length === 0 ? (
          <EmptyState title="No charge lines" body="This upload carried no line detail for them." />
        ) : foundCharges.length === 0 ? (
          <EmptyState title="No charges match" body="Try a different word, or clear the search." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line-hair text-left text-xs text-ink-muted">
                  <th className="px-4 py-2 font-medium sm:px-5">Billed</th>
                  <th className="hidden px-3 py-2 font-medium sm:table-cell">Due</th>
                  <th className="px-3 py-2 font-medium">What it is</th>
                  <th className="hidden px-3 py-2 font-medium sm:table-cell">How overdue</th>
                  <th className="px-4 py-2 text-right font-medium sm:px-5">Owed</th>
                </tr>
              </thead>
              <tbody>
                {chargePage.shown.map((c) => (
                    <tr key={c.id} className="border-b border-line-hair last:border-0">
                      <td className="tabular whitespace-nowrap px-4 py-2.5 align-top text-ink-secondary sm:px-5">{formatDate(c.date)}</td>
                      <td className="tabular hidden whitespace-nowrap px-3 py-2.5 text-ink-secondary sm:table-cell">{formatDate(c.dueDate)}</td>
                      <td className="px-3 py-2.5 align-top text-ink-secondary">
                        {c.description}
                        <span className="mt-0.5 block text-[11px] text-ink-muted sm:hidden">
                          {c.bucket || "Not due"}
                          {c.age !== null && c.age > 0 ? ` · ${c.age} days` : ""}
                        </span>
                      </td>
                      <td className="hidden px-3 py-2.5 sm:table-cell">
                        <Tag>{c.bucket || "-"}</Tag>
                        {c.age !== null ? (
                          <span className="ml-2 text-xs text-ink-muted">{c.age} days</span>
                        ) : null}
                      </td>
                      <td className="tabular px-4 py-2.5 text-right align-top font-medium text-ink sm:px-5">
                        {formatSgd(c.openBalance)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination {...chargePage.pager} />
      </Card>
    </div>
  );
}

function Timeline({
  events,
  onViewCall,
}: {
  events: ReturnType<typeof historyFor>;
  onViewCall: (eventId: string) => void;
}) {
  const { shown, pager } = usePaged(events);
  return (
    <Card>
      <CardHeader
        title="Everything we have done"
        right={<StatusBadge kind="neutral" label={`${events.length} events`} />}
      />
      {events.length === 0 ? (
        <EmptyState
          title="Nothing yet"
          body="No letter has been sent, no call logged and no fee raised against this tenant."
        />
      ) : (
        <ol className="divide-y divide-line-hair">
          {shown.map((e) => (
            <li key={e.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
              <StatusBadge kind={TINT[e.kind]} label={WHAT[e.kind]} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{e.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-secondary">{e.detail}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="tabular text-xs text-ink-secondary">{formatDate(e.at)}</p>
                <p className="text-[11px] text-ink-muted">
                  {e.reachedTheTenant ? "Sent to the tenant" : "Internal record"}
                </p>
                {e.kind === "call" ? (
                  <button
                    type="button"
                    onClick={() => onViewCall(e.id)}
                    className="mt-1.5 rounded border border-line-hair px-2.5 py-1 text-[11px] text-ink-secondary hover:border-line-strong hover:text-ink"
                  >
                    View the call
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
      <Pagination {...pager} />
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
