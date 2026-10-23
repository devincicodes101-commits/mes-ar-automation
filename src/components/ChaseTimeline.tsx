"use client";

import { useMemo, useState } from "react";

import { useSession } from "@/lib/session";
import { useStore } from "@/lib/store";
import { inSingapore } from "@/lib/schedule";
import { useDataset, useDatasetState } from "@/lib/dataset";
import { formatDate, formatSgd, invoicesForAccount, overdueTotal } from "@/lib/data";
import {
  billRuns,
  letterPosition,
  reminderDatesFor,
  sentReminders,
  type BillRun,
  type LetterPosition,
  type SentLetter,
} from "@/lib/reminder-timing";
import { useReminderWindow } from "@/lib/use-reminder-window";
import { Card, CardHeader, EmptyState, Pagination, Skeleton, StatusBadge, TableSkeleton, TenantLink } from "@/components/ui";
import { LetterEditor } from "@/components/LetterEditor";
import { savedKey, useLetterEdits } from "@/lib/use-letter-edits";

/**
 * Every bill's own two reminder dates, worked out from its billing date.
 *
 * One row per tenant per billing date, because that is what the 9am run
 * chases: a tenant billed on the 15th and the 24th has two first reminders,
 * on two days. Tenants who owe nothing are one row each, saying so.
 *
 * The reminder clock moved off the calendar and onto each tenant's billing
 * date, and nothing showed the result. The settings screen does the sum for
 * one made-up tenant billed on the 15th; this does it for the ones actually in
 * the uploaded report, which is the only way to tell whether the rule behaves
 * on real data - MES's export carries 28 different billing dates and some of
 * them are years old.
 *
 * Read only. Since 4 October this is what the nine o'clock run acts on: the
 * same window, read from the same place, judged against the same day. It
 * shows the rule's timing; whether a letter has already gone for a bill is
 * the run's to decide, from what was really sent, and is in its diary.
 */
/** Rows per page on the chased card. */
const CHASED_PAGE = 25;

/** Where a tenant stands, as the chips on the chased card filter it. */
type StandingFilter =
  | "all"
  | LetterPosition["kind"]
  | "promised"
  | "not-chased"
  | "no-date";

export function ChaseTimeline() {
  const ds = useDataset();
  const dataset = useDatasetState();
  const store = useStore();
  const { canAct } = useSession();
  /* A month holds hundreds of tenants: found by name, narrowed by where they
     stand, and read a page at a time. */
  const [query, setQuery] = useState("");
  const [standing, setStanding] = useState<StandingFilter>("all");
  const [page, setPage] = useState(0);
  /* Letters somebody has edited by hand: the 9am run sends those as edited. */
  const { edits, loaded: editsLoaded, reload: reloadEdits } = useLetterEdits();
  const [editing, setEditing] = useState<string | null>(null);

  /* The window the nine o'clock run uses, read from the same place it reads
     it. This card once read the browser's copy and could disagree with the
     run about every date it showed. */
  const { window } = useReminderWindow();

  /*
   * Today in Singapore, not the report's date. This judged against the report
   * while it was only a preview; the run judges against the day it runs on,
   * because twenty-three days after a bill is a fact about the calendar, and a
   * preview that disagreed with the run about who is due would be no use.
   */
  const asOf = ds.asOf ? inSingapore().iso : null;

  /*
   * The letters that really left, by tenant - the same record the 9am run and
   * Reminder Emails read. A letter written while sending was off or blocked
   * is not here, so it does not count as sent.
   */
  const sentBy = useMemo(() => {
    const m = new Map<string, SentLetter[]>();
    for (const letter of sentReminders(store.emails)) {
      m.set(letter.tenantId, [...(m.get(letter.tenantId) ?? []), letter]);
    }
    return m;
  }, [store.emails]);

  /* A promise to pay that has not fallen due holds the letters, as in the run. */
  const promisedFor = useMemo(() => {
    const m = new Map<string, string>();
    for (const pr of store.promises) {
      if (asOf && pr.promisedFor >= asOf) m.set(pr.accountId, pr.promisedFor);
    }
    return m;
  }, [store.promises, asOf]);

  const rows = useMemo(() => {
    if (!asOf) return [];
    /*
     * Every tenant, not only those who owe. MES asked to see all of them:
     * a tenant in credit or owing nothing is not chased, and the card says so
     * against their name rather than leaving them off the list.
     */
    const row = (a: (typeof ds.accounts)[number], bill: BillRun | null) => {
      /* No reminder dates for a tenant who is not chased. */
      const dates = a.total > 0 && bill ? reminderDatesFor(bill.billedOn, window) : null;
      return {
        key: `${a.id}|${bill?.billedOn ?? ""}`,
        id: a.id,
        name: a.companyName,
        code: a.customerCode,
        /* This bill's invoices: what its letter asks for. */
        owed: bill ? bill.amount : overdueTotal(a) || a.total,
        total: a.total,
        billedOn: bill?.billedOn ?? null,
        invoices: bill?.invoices.length ?? 0,
        bill,
        first: dates?.first ?? null,
        final: dates?.final ?? null,
        /* Where it stands: the dates, and what has really been sent. */
        position:
          a.total > 0 && bill ? letterPosition(bill.billedOn, sentBy.get(a.id) ?? [], asOf, window) : null,
        promised: promisedFor.get(a.id) ?? null,
      };
    };
    return ds.accounts
      .flatMap((a) => {
        const bills = a.total > 0 ? billRuns(invoicesForAccount(a, ds.invoices)) : [];
        return bills.length > 0 ? bills.map((b) => row(a, b)) : [row(a, null)];
      })
      /* Newest bill first: this month's are the ones about to be chased. */
      .sort((x, y) => (y.billedOn ?? "").localeCompare(x.billedOn ?? "") || x.name.localeCompare(y.name));
  }, [ds.accounts, ds.invoices, asOf, window, sentBy, promisedFor]);

  /* This card is the report's, even though the page around it is not: until
     the stored report arrives, its shape rather than the bundled example. */
  if (dataset.loading && ds.source === "sample") {
    return (
      <Card>
        <div className="border-b border-line-hair px-4 py-4 sm:px-5">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="mt-2 h-3 w-32" />
        </div>
        <TableSkeleton rows={8} />
      </Card>
    );
  }
  if (rows.length === 0) return null;

  const isEdited = (r: (typeof rows)[number]) =>
    r.billedOn !== null &&
    (edits.has(savedKey(r.id, "first-reminder", r.billedOn)) ||
      edits.has(savedKey(r.id, "final-notice", r.billedOn)));
  const editedCount = rows.filter((r) => r.total > 0 && isEdited(r)).length;
  const editingRow = editing ? rows.find((r) => r.key === editing) ?? null : null;

  const count = (kind: LetterPosition["kind"]) =>
    rows.filter((r) => r.total > 0 && !r.promised && r.position?.kind === kind).length;
  const missing = rows.filter((r) => r.total > 0 && r.position === null).length;
  const owingCount = new Set(rows.filter((r) => r.total > 0).map((r) => r.id)).size;
  const tenantCount = new Set(rows.map((r) => r.id)).size;
  const inCredit = rows.filter((r) => r.total < 0).length;
  const nothingOwed = rows.filter((r) => r.total === 0).length;
  const promisedCount = rows.filter((r) => r.promised).length;

  const matchesStanding = (r: (typeof rows)[number], f: StandingFilter) =>
    f === "all"
      ? true
      : f === "promised"
        ? r.promised !== null
        : f === "not-chased"
          ? r.total <= 0
          : f === "no-date"
            ? r.total > 0 && r.position === null
            : r.total > 0 && !r.promised && r.position?.kind === f;
  const q = query.trim().toLowerCase();
  const filtered = rows.filter(
    (r) =>
      matchesStanding(r, standing) &&
      (q === "" || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q)),
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / CHASED_PAGE));
  const onPage = Math.min(page, pageCount - 1);
  const shown = filtered.slice(onPage * CHASED_PAGE, (onPage + 1) * CHASED_PAGE);

  const chips: [StandingFilter, string, number][] = (
    [
      ["all", "All", rows.length],
      ["not-yet", "Not yet due", count("not-yet")],
      ["first-due", "First reminder due", count("first-due")],
      ["first-sent", "Waiting for final notice", count("first-sent")],
      ["final-due", "Final notice due", count("final-due")],
      ["final-sent", "Final notice sent", count("final-sent")],
      /* A day that went by without its letter: nothing is emailed late. */
      ["first-missed", "First reminder day passed", count("first-missed")],
      ["final-missed", "Final notice day passed", count("final-missed")],
      ["promised", "Promised to pay", promisedCount],
      ["not-chased", "Not chased", inCredit + nothingOwed],
      ["no-date", "No billing date", missing],
    ] as [StandingFilter, string, number][]
  ).filter(([key, , n]) => key === "all" || n > 0);

  return (
    <Card>
      <CardHeader
        title="When each bill is chased"
        hint={`As of today, ${formatDate(asOf)}`}
        right={
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Find a tenant by name or code"
            aria-label="Find a tenant"
            className="w-full rounded-md border bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted sm:w-64 sm:text-xs"
          />
        }
      />

      <div
        className="flex flex-wrap gap-1.5 border-b border-line-hair bg-surface-alt px-4 py-3 sm:px-5"
        role="group"
        aria-label="Where they stand"
      >
        {chips.map(([key, label, n]) => (
          <button
            key={key}
            type="button"
            aria-pressed={standing === key}
            onClick={() => {
              setStanding(key);
              setPage(0);
            }}
            className={`rounded-full border px-3 py-1 text-xs ${
              standing === key
                ? "border-accent bg-accent-wash font-medium text-accent-text"
                : "border-line-hair bg-surface text-ink-secondary hover:border-line-strong hover:text-ink"
            }`}
          >
            {label} <span className="tabular opacity-70">{n}</span>
          </button>
        ))}
        <span className="ml-auto self-center text-[11px] text-ink-muted">
          {owingCount} of {tenantCount} tenants owe, across {rows.filter((r) => r.bill).length} billing dates
        </span>
      </div>

      {editedCount > 0 ? (
        <div className="border-b border-line-hair bg-accent-wash px-4 py-2.5 text-xs leading-relaxed text-ink-secondary sm:px-5">
          <b className="text-ink">
            {editedCount} bill{editedCount === 1 ? " has" : "s have"} an edited letter.
          </b>{" "}
          The 9am run sends them the saved wording; everyone else gets the standard letter.
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState
          title="No tenants match"
          body="Try another search, or choose All."
        />
      ) : (
      <div className="table-wrap">
        <table className="w-full border-collapse text-sm md:min-w-[720px]">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b border-line-grid text-left text-xs font-medium text-ink-muted">
              <th className="px-4 py-2.5 sm:px-5 md:min-w-[13rem]">Tenant</th>
              <th className="hidden whitespace-nowrap px-3 py-2.5 md:table-cell">Billed</th>
              <th className="hidden px-3 py-2.5 md:table-cell">First reminder</th>
              <th className="hidden px-3 py-2.5 md:table-cell">Final notice</th>
              <th className="hidden px-3 py-2.5 text-right md:table-cell">Owed</th>
              <th className="px-3 py-2.5">Today</th>
              <th className="hidden px-5 py-2.5 sm:table-cell">Letter</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key} className="border-b border-line-hair last:border-0">
                <td className="px-4 py-2.5 sm:px-5">
                  <TenantLink id={r.id} name={r.name} className="text-ink" />
                  <div className="text-[11px] text-ink-muted">{r.code}</div>
                  {/* On a phone the dates and the balance fold in here. */}
                  <div className="mt-1 text-[11px] leading-relaxed text-ink-secondary md:hidden">
                    {r.billedOn ? `Billed ${formatDate(r.billedOn)}` : "No billing date"}
                    {r.first ? ` · first ${formatDate(r.first)}` : ""}
                    {r.final ? ` · final ${formatDate(r.final)}` : ""}
                    <span className="tabular block">Owes {formatSgd(r.owed)}</span>
                  </div>
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2.5 text-xs text-ink-secondary md:table-cell">
                  {r.billedOn ? formatDate(r.billedOn) : "-"}
                  {r.invoices > 0 ? (
                    <span className="block text-[11px] text-ink-muted">
                      {r.invoices} {r.invoices === 1 ? "invoice" : "invoices"}
                    </span>
                  ) : null}
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2.5 text-xs text-ink-secondary md:table-cell">
                  {r.first ? formatDate(r.first) : "-"}
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2.5 text-xs text-ink-secondary md:table-cell">
                  {r.final ? formatDate(r.final) : "-"}
                </td>
                <td className="tabular hidden px-3 py-2.5 text-right text-ink md:table-cell">
                  {formatSgd(r.owed)}
                </td>
                <td className="px-3 py-2.5">
                  <Standing position={r.position} promised={r.promised} total={r.total} />
                </td>
                <td className="hidden px-5 py-2.5 sm:table-cell">
                  {r.total > 0 && r.billedOn ? (
                    <div className="flex flex-col items-start gap-1">
                      {/* Said here, not only inside the editor: an edited letter
                          is sent as edited without anybody pressing send. */}
                      {isEdited(r) ? (
                        <StatusBadge kind="neutral" label="Edited" />
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setEditing(r.key)}
                        className="rounded-md border border-line-strong px-2.5 py-1 text-xs text-ink-secondary hover:border-accent hover:text-accent-text"
                      >
                        {canAct ? "Edit letter" : "View"}
                      </button>
                    </div>
                  ) : (
                    <span className="text-[11px] text-ink-muted">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      <Pagination page={onPage} pageSize={CHASED_PAGE} total={filtered.length} onPage={setPage} />

      {editingRow && editingRow.billedOn ? (
        <LetterEditor
          tenantId={editingRow.id}
          companyName={editingRow.name}
          billedOn={editingRow.billedOn}
          owed={editingRow.owed}
          sendOn={{ "first-reminder": editingRow.first, "final-notice": editingRow.final }}
          startAt={
            editingRow.position &&
            (editingRow.position.kind === "first-sent" ||
              editingRow.position.kind === "final-due" ||
              editingRow.position.kind === "final-sent")
              ? "final-notice"
              : "first-reminder"
          }
          edits={edits}
          editsLoaded={editsLoaded}
          canEdit={canAct}
          onSaved={reloadEdits}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Card>
  );
}

/**
 * One tenant's standing, said the way the 9am run will act on it.
 *
 * "Final notice due" against every tenant, when none had had a first
 * reminder, contradicted the run on the same screen. Now it says which letter
 * is next and which have really gone, with the date.
 */
function Standing({
  position,
  promised,
  total,
}: {
  position: LetterPosition | null;
  promised: string | null;
  /** What the tenant owes. In credit or owing nothing, they are not chased. */
  total: number;
}) {
  if (total < 0) return <StatusBadge kind="good" label="In credit, not chased" />;
  if (total === 0) return <StatusBadge kind="neutral" label="Nothing owed" />;
  if (promised) {
    return <StatusBadge kind="neutral" label={`Promised to pay by ${formatDate(promised)}`} />;
  }
  if (!position) return <StatusBadge kind="critical" label="No billing date" />;

  switch (position.kind) {
    case "not-yet":
      return <StatusBadge kind="neutral" label="Not yet due" />;
    case "first-due":
      return <StatusBadge kind="warning" label="First reminder due" />;
    case "first-sent":
      return (
        <div>
          <StatusBadge kind="good" label={`First reminder sent ${formatDate(position.firstSentOn)}`} />
          <div className="mt-1 text-[11px] text-ink-muted">
            final notice due {formatDate(position.finalDueOn)}
          </div>
        </div>
      );
    case "final-due":
      return (
        <div>
          <StatusBadge kind="serious" label="Final notice due" />
          <div className="mt-1 text-[11px] text-ink-muted">
            {position.firstSentOn
              ? `first reminder sent ${formatDate(position.firstSentOn)}`
              : "no first reminder from the system"}
          </div>
        </div>
      );
    case "final-sent":
      return <StatusBadge kind="good" label={`Final notice sent ${formatDate(position.finalSentOn)}`} />;
    case "first-missed":
      return (
        <div>
          <StatusBadge
            kind="neutral"
            label={position.finalComing ? `Final notice ${formatDate(position.finalOn)}` : "No email for this bill"}
          />
          <div className="mt-1 text-[11px] text-ink-muted">
            no first reminder: its day, {formatDate(position.firstOn)}, had passed
          </div>
        </div>
      );
    case "final-missed":
      return (
        <div>
          <StatusBadge kind="neutral" label="No more emails for this bill" />
          <div className="mt-1 text-[11px] text-ink-muted">
            final notice day, {formatDate(position.finalOn)}, passed without it
            {position.firstSentOn ? `; first reminder sent ${formatDate(position.firstSentOn)}` : ""}
          </div>
        </div>
      );
  }
}
