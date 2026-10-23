"use client";

import { useMemo, useState } from "react";
import {
  formatDate,
  formatSgd,
  invoicesForAccount,
  overdueTotal,
  severeTotal,
  worstBucket,
} from "@/lib/data";
import {
  billingForTenant,
  NO_BILLING,
  type TenantBilling,
} from "@/lib/billing-cycles";
import { Account } from "@/lib/types";
import { callListOn, calledThisRound, type CallRound } from "@/lib/call-list";
import { linesByAccount, sentReminders } from "@/lib/reminder-timing";
import { inSingapore } from "@/lib/schedule";
import { useReminderWindow } from "@/lib/use-reminder-window";
import {
  CALL_OUTCOMES,
  CALL_STAGES,
  CallOutcome,
  CallStage,
  type CallLog,
  recordCall,
  feeCountsByTenant,
  useStore,
} from "@/lib/store";
import { useSession, useToast } from "@/lib/session";
import { formatDateTime } from "@/lib/format";
import { useDataset, withManualEmails } from "@/lib/dataset";
import {
  Card,
  CardHeader,
  EmptyState,
  Modal,
  StatusBadge,
  Tag,
  TenantLink,
  PageSkeleton,
  Pagination,
} from "@/components/ui";
import { usePaged } from "@/lib/use-paged";

export default function CallListPage() {
  const store = useStore();
  /*
   * can("log-calls"), not canAct.
   *
   * canAct is roleCan(role, "send-reminders") — a reasonable shorthand on the
   * screens that send things, and the wrong question here. A relationship
   * manager may log a call and may not send a reminder, so gating this screen
   * on canAct showed them their own three tenants and a "View only" label
   * against each, which is the exact thing they had just been given
   * permission to do.
   */
  const { scope, can } = useSession();
  const mayLog = can("log-calls");
  const ds = withManualEmails(useDataset(), store.manualEmails);
  const [active, setActive] = useState<{ account: Account; round: CallRound } | null>(null);
  /*
   * Everyone stays on the call list by design, including tenants already rung,
   * which is right and made the list unreadable: on the 7th it is every
   * overdue tenant in one column with no way to see only the ones left. The
   * filter does not change who is on the list, only who is on screen.
   */
  const [who, setWho] = useState<"all" | "todo" | "done" | "promised">("all");
  /* How many times they have been rung, all calls counted. */
  const [timesCalled, setTimesCalled] = useState<"any" | "0" | "1" | "2" | "3+">("any");
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<CallOutcome | "all">("all");
  const [logQuery, setLogQuery] = useState("");
  /*
   * Which round of the month the log is being read for. The two calls are
   * different conversations - the one after the 7th asks when payment is
   * coming, the one after the 21st says what happens if it does not - and a
   * single undivided log could not be read as either.
   */
  const [stage, setStage] = useState<CallStage | "all">("all");

  /* The fees this system has raised count towards the repeat-defaulter rule
     as much as the ones MES have billed. A tenant charged three months running
     used to count as zero here, because only NetSuite's lines were read. */
  const stillOwing = useMemo(
    () => new Set(ds.accounts.map((a) => a.id)),
    [ds.accounts],
  );
  const raised = useMemo(
    () => feeCountsByTenant(store.fees, stillOwing),
    [store.fees, stillOwing],
  );
  /*
   * Who to ring: anyone who still owes and is past their first reminder date,
   * counted from their billing date exactly as the letters are. The call
   * follows the letter. See call-list.ts.
   */
  const { window, source: timingSource } = useReminderWindow();
  const todayIso = inSingapore().iso;
  /*
   * A promise that has not fallen due, by tenant.
   *
   * These tenants used to be dropped from the list. So an officer who logged
   * "Agreed to pay" watched the tenant vanish - not under "Already called",
   * not anywhere - and with them gone the call log below disappeared too. They
   * stay now, marked with the date they promised, under their own filter.
   */
  const promisedBy = useMemo(() => {
    const m = new Map<string, string>();
    for (const pr of store.promises) {
      if (pr.promisedFor < todayIso) continue;
      const was = m.get(pr.accountId);
      if (!was || pr.promisedFor > was) m.set(pr.accountId, pr.promisedFor);
    }
    return m;
  }, [store.promises, todayIso]);
  const noHold = useMemo(() => new Set<string>(), []);
  /* Letters that really left, so a second call never comes before the
     final notice it follows. */
  const sent = useMemo(() => sentReminders(store.emails), [store.emails]);
  /*
   * Which round each call was about.
   *
   * The database keeps no column for it, so a call read back after a reload
   * fell to stageOfCall's guess from the day of the month: anything on or
   * after the 21st was a final-notice call. Every call logged on 23 October
   * was therefore filed under the second round, while the tenants were due
   * their first, and none of them ever showed as called. Decided instead from
   * what really happened: a call after the tenant's final notice went is the
   * second call, before it the first. A tenant with no address has no
   * letters, so an earlier call to them makes this one the second.
   */
  const roundOf = useMemo(() => {
    return (c: CallLog): CallStage => {
      if (c.stage) return c.stage;
      const anyLetter = sent.some((l) => l.tenantId === c.accountId);
      if (anyLetter) {
        return sent.some((l) => l.tenantId === c.accountId && l.stage === "final-notice" && l.sentAt <= c.at)
          ? "final-notice"
          : "first-reminder";
      }
      return store.calls.some((o) => o.accountId === c.accountId && o.at < c.at)
        ? "final-notice"
        : "first-reminder";
    };
  }, [sent, store.calls]);
  /* Called this round: a call logged for the same round, about this bill. */
  const roundCalls = useMemo(
    () => store.calls.map((c) => ({ accountId: c.accountId, at: c.at, round: roundOf(c) })),
    [store.calls, roundOf],
  );
  const queue = useMemo(() => {
    const accounts = scope(ds.accounts);
    return callListOn(accounts, linesByAccount(accounts, ds.invoices), todayIso, window, raised, noHold, sent, roundCalls);
  }, [ds, scope, raised, todayIso, window, noHold, sent, roundCalls]);
  const calledIds = new Set(
    queue.filter((q) => calledThisRound(q, roundCalls)).map((q) => q.account.id),
  );

  /*
   * When each tenant was billed, and whether that bill has fallen due.
   *
   * Raman asked for the billing date against a call: the officer should be
   * able to say "your 15 August invoice fell due on the 29th" without opening
   * the spreadsheet, and a log read six weeks later should say which bill it
   * was about. Built once for every tenant rather than per row, because both
   * lists below want it and the queue can be the whole dormitory.
   */
  const billing = useMemo(() => {
    const m = new Map<string, TenantBilling>();
    for (const a of ds.accounts) {
      m.set(a.id, billingForTenant(invoicesForAccount(a, ds.invoices), ds.asOf));
    }
    return m;
  }, [ds.accounts, ds.invoices, ds.asOf]);

  /**
   * How many times each tenant has already been rung, from the call log.
   * MES allow repeat calls and want them counted: a tenant on their fourth
   * call who still has not paid needs a different approach from a first call.
   */
  const callCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of store.calls) {
      m.set(c.accountId, (m.get(c.accountId) ?? 0) + 1);
    }
    return m;
  }, [store.calls]);

  /**
   * Everyone stays on the list. MES are explicit that repeat calls are allowed
   * and counted, and a tenant who was rung once and did not pay still needs
   * ringing. Dropping them the moment a call was logged made a second call
   * impossible from this screen, which is the opposite of what was asked for.
   *
   * Those not yet called come first, then the rest by fewest calls, so the
   * officer works down a list that is still in a sensible order.
   */
  const todo = useMemo(() => {
    return [...queue].sort((a, b) => {
      const rank = (x: typeof a) =>
        calledThisRound(x, roundCalls) ? 2 : promisedBy.has(x.account.id) ? 1 : 0;
      const ca = rank(a);
      const cb = rank(b);
      if (ca !== cb) return ca - cb;
      return b.priority - a.priority;
    });
  }, [queue, roundCalls, promisedBy]);

  const notYetCalled = queue.filter((q) => !calledIds.has(q.account.id) && !promisedBy.has(q.account.id));
  const done = queue.filter((q) => calledIds.has(q.account.id));
  const promisedOnList = queue.filter((q) => promisedBy.has(q.account.id));
  const timesMatch = (id: string) => {
    const n = callCounts.get(id) ?? 0;
    return timesCalled === "any" ? true : timesCalled === "3+" ? n >= 3 : n === Number(timesCalled);
  };

  /* The rows the call list shows, once the filter and the search have run. */
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return todo
      .filter((item) =>
        who === "all"
          ? true
          : who === "promised"
            ? promisedBy.has(item.account.id)
            : who === "done"
              ? calledIds.has(item.account.id)
              : !calledIds.has(item.account.id) && !promisedBy.has(item.account.id),
      )
      .filter((item) => timesMatch(item.account.id))
      .filter((item) =>
        q === ""
          ? true
          : item.account.companyName.toLowerCase().includes(q) ||
            item.account.customerCode.toLowerCase().includes(q),
      );
    // calledIds and timesMatch are rebuilt on every render, so they are
    // listed through their sources rather than themselves.
  }, [todo, who, query, store.calls, promisedBy, timesCalled]); // eslint-disable-line react-hooks/exhaustive-deps

  /* The same, for the log of calls already made. */
  const loggedShown = useMemo(() => {
    const q = logQuery.trim().toLowerCase();
    return store.calls
      .filter((c) => (stage === "all" ? true : roundOf(c) === stage))
      .filter((c) => (outcome === "all" ? true : c.outcome === outcome))
      .filter((c) =>
        q === ""
          ? true
          : c.companyName.toLowerCase().includes(q) ||
            (c.reached ?? "").toLowerCase().includes(q) ||
            (c.notes ?? "").toLowerCase().includes(q),
      );
  }, [store.calls, outcome, logQuery, stage, roundOf]);

  const callPage = usePaged(shown, `${who}|${query}|${timesCalled}`);
  const logPage = usePaged(loggedShown, `${stage}|${outcome}|${logQuery}`);

  /* Until the reminder timing has arrived, the page's shape rather than a
     list worked out from the built-in default days. */
  if (timingSource === "loading") return <PageSkeleton />;

  return (
    <div className="space-y-5">
      {/* The first two count tenants on today's list; the last two count every
          call logged so far. Said on each, because side by side they read as
          one set and did not add up. */}
      {/* No tiles: "still to call" and "already called" are the counts on the
          filter below, and "agreed to pay" is Payment Promises. */}

      <Card>
        <CardHeader
          title="Who to phone"
        />

        {todo.length > 0 ? (
          <div className="flex flex-col gap-2 border-b border-line-hair px-4 py-3 sm:px-5 lg:flex-row lg:items-center">
            <div className="flex gap-1 overflow-x-auto rounded-md bg-surface-alt p-1" role="group" aria-label="Which tenants">
              {(
                [
                  ["all", "Everyone", todo.length],
                  ["todo", "Not called yet", notYetCalled.length],
                  ["done", "Already called", done.length],
                  ["promised", "Promised to pay", promisedOnList.length],
                ] as ["all" | "todo" | "done" | "promised", string, number][]
              ).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setWho(key)}
                  aria-pressed={who === key}
                  className={`flex-1 whitespace-nowrap rounded px-3 py-1.5 text-xs lg:flex-none ${
                    who === key
                      ? "bg-surface font-medium text-accent-text shadow-sm"
                      : "text-ink-muted hover:text-ink-secondary"
                  }`}
                >
                  {label} <span className="tabular opacity-70">{count}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row lg:ml-auto">
              <select
                value={timesCalled}
                onChange={(e) => setTimesCalled(e.target.value as typeof timesCalled)}
                aria-label="Calls made"
                className="w-full rounded-md border bg-surface px-2.5 py-2 text-sm text-ink sm:w-auto sm:py-1.5 sm:text-xs"
              >
                <option value="any">Any number of calls</option>
                <option value="0">Never called</option>
                <option value="1">Called once</option>
                <option value="2">Called twice</option>
                <option value="3+">Called 3 times or more</option>
              </select>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a tenant by name or code"
                aria-label="Find a tenant"
                className="w-full rounded-md border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted sm:py-1.5 sm:text-xs lg:w-60"
              />
            </div>
          </div>
        ) : null}

        {todo.length === 0 ? (
          <EmptyState
            title="Nobody needs chasing"
            body="Nobody who owes money is past their first reminder date yet."
          />
        ) : shown.length === 0 ? (
          <EmptyState
            title="Nothing matches"
            body="Try another search, or choose Everyone to drop the filter."
          />
        ) : (
          <ol className="divide-y divide-line-grid">
            {callPage.shown.map((item, idx) => (
              <li
                key={item.account.id}
                className="flex flex-wrap items-start gap-x-4 gap-y-3 px-4 py-3.5 hover:bg-surface-alt sm:px-5"
              >
                <span className="tabular mt-0.5 hidden w-6 shrink-0 text-xs text-ink-muted sm:block">
                  {callPage.pager.page * callPage.pager.pageSize + idx + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <TenantLink
                      id={item.account.id}
                      name={item.account.companyName}
                      className="font-medium text-ink"
                    />
                    <span className="text-[11px] text-ink-muted">
                      {item.account.customerCode} · {item.account.propertyName}
                    </span>
                    {item.account.isOneFm ? <Tag>1FM</Tag> : null}
                    {item.account.status === "Terminated" ? (
                      <Tag>Moved out</Tag>
                    ) : null}
                    {promisedBy.has(item.account.id) ? (
                      <StatusBadge
                        kind="good"
                        label={`Promised to pay by ${formatDate(promisedBy.get(item.account.id) ?? null)}`}
                      />
                    ) : null}
                  </div>

                  {/* Which call this is, and the letter it follows. */}
                  <div className="mt-1 text-[11px]">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 font-medium ${
                        item.round === "final-notice"
                          ? "bg-warn-wash text-warn-ink"
                          : "bg-accent-wash text-accent-text"
                      }`}
                    >
                      {item.round === "final-notice" ? "2nd call" : "1st call"}
                    </span>
                    <span className="text-ink-muted">
                      {" "}·{" "}
                      {item.round === "final-notice"
                        ? `final notice was due ${formatDate(item.finalOn)}`
                        : `first reminder was due ${formatDate(item.firstOn)}`}
                      {" "}· billed {formatDate(item.billedOn)}
                    </span>
                  </div>

                  <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-ink-secondary">
                    <span>
                      Owes{" "}
                      <span className="tabular font-medium text-ink">
                        SGD {formatSgd(item.account.total)}
                      </span>
                    </span>
                    <span>
                      Overdue{" "}
                      <span className="tabular">
                        SGD {formatSgd(item.overdue)}
                      </span>
                    </span>
                    {severeTotal(item.account) > 0 ? (
                      <span>
                        Over 90 days{" "}
                        <span className="tabular">
                          SGD {formatSgd(severeTotal(item.account))}
                        </span>
                      </span>
                    ) : null}
                    {item.account.lateFeeCount > 0 ? (
                      <span>{item.account.lateFeeCount} late fees charged</span>
                    ) : null}
                    <BillingNote billing={billing.get(item.account.id) ?? NO_BILLING} />
                    {/* MES's workflow: "Repeated calls allowed. Call status
                        count." Somebody rung four times without paying is a
                        different conversation from a first call, and without
                        this the officer has to remember. */}
                    {callCounts.get(item.account.id) ? (
                      <span className="font-medium text-ink">
                        Called {callCounts.get(item.account.id)}{" "}
                        {callCounts.get(item.account.id) === 1
                          ? "time"
                          : "times"}{" "}
                        already
                      </span>
                    ) : null}
                  </div>
                </div>

                {mayLog ? (
                  <button
                    type="button"
                    onClick={() => setActive({ account: item.account, round: item.round })}
                    className="w-full shrink-0 rounded-md border border-accent bg-accent px-3 py-2 text-xs font-medium text-accent-ink sm:w-auto sm:py-1.5"
                  >
                    Log this call
                  </button>
                ) : (
                  <span className="shrink-0 text-[11px] text-ink-muted">
                    View only
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
        <Pagination {...callPage.pager} />
      </Card>

      {store.calls.length > 0 ? (
        <Card>
          <CardHeader
            title="Calls logged"
            right={
              <div className="flex flex-wrap items-center gap-2">
                <div
                  className="flex overflow-x-auto rounded-md border border-line-hair p-0.5"
                  role="group"
                  aria-label="Which reminder"
                >
                  {(
                    [
                      ["all", "Both"],
                      ...CALL_STAGES.map((x) => [x.value, x.label] as const),
                    ] as [CallStage | "all", string][]
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setStage(key)}
                      aria-pressed={stage === key}
                      className={`whitespace-nowrap rounded px-2.5 py-1 text-xs ${
                        stage === key
                          ? "bg-accent-wash font-medium text-accent-text"
                          : "text-ink-muted hover:text-ink-secondary"
                      }`}
                    >
                      {label} (
                      {key === "all"
                        ? store.calls.length
                        : store.calls.filter((c) => roundOf(c) === key).length}
                      )
                    </button>
                  ))}
                </div>
                <select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value as CallOutcome | "all")}
                  aria-label="Outcome"
                  className="rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-xs text-ink"
                >
                  <option value="all">Every outcome</option>
                  {CALL_OUTCOMES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <input
                  type="search"
                  value={logQuery}
                  onChange={(e) => setLogQuery(e.target.value)}
                  placeholder="Find a tenant or a note"
                  aria-label="Find a logged call"
                  className="w-full rounded-md border bg-surface px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-muted sm:w-52"
                />
              </div>
            }
          />
          {loggedShown.length === 0 ? (
            <EmptyState
              title="No calls match"
              body="Try another search, or choose Every outcome to drop the filter."
            />
          ) : (
          <ul className="divide-y divide-line-grid">
            {logPage.shown.map((c) => (
              <li key={c.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:gap-4 sm:px-5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <TenantLink
                      id={c.accountId}
                      name={c.companyName}
                      className="text-sm font-medium text-ink"
                    />
                    <StatusBadge
                      kind={
                        c.outcome === "promised-to-pay"
                          ? "good"
                          : c.outcome === "no-answer" ||
                              c.outcome === "wrong-number"
                            ? "warning"
                            : "serious"
                      }
                      label={
                        CALL_OUTCOMES.find((o) => o.value === c.outcome)
                          ?.label ?? c.outcome
                      }
                    />
                  </div>
                  {/*
                    * The bill gets its own line.
                    *
                    * It was the tail of a sentence that began "Spoke to
                    * nobody", in the same grey as the timestamp, and it was
                    * asked for twice by somebody looking straight at it. Which
                    * bill the call was about is the point of the record, not a
                    * footnote to when it happened.
                    */}
                  <LoggedBilling billing={billing.get(c.accountId) ?? NO_BILLING} />
                  <p className="mt-0.5 text-[11px] text-ink-muted">
                    {CALL_STAGES.find((x) => x.value === roundOf(c))?.label} ·
                    spoke to {c.reached || "nobody"} ·{" "}
                    {formatDateTime(c.at)}
                  </p>
                  {c.notes ? (
                    <p className="mt-1 text-xs text-ink-secondary">{c.notes}</p>
                  ) : null}
                </div>
                {c.promisedDate ? (
                  <div className="shrink-0 text-[11px] text-ink-secondary sm:text-right">
                    <div className="tabular font-medium text-ink">
                      SGD {formatSgd(c.promisedAmount ?? 0)}
                    </div>
                    <div>promised for {formatDate(c.promisedDate)}</div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          )}
          <Pagination {...logPage.pager} />
        </Card>
      ) : null}

      {active ? (
        <CallForm
          account={active.account}
          round={active.round}
          billing={billing.get(active.account.id) ?? NO_BILLING}
          onClose={() => setActive(null)}
        />
      ) : null}
    </div>
  );
}

function CallForm({
  account,
  round,
  billing,
  onClose,
}: {
  account: Account;
  /** Which call this is, from the list. The officer can still change it. */
  round: CallRound;
  billing: TenantBilling;
  onClose: () => void;
}) {
  const { notify } = useToast();
  const [reached, setReached] = useState("");
  /* Nothing chosen: starting on "Agreed to pay" recorded a promise for any
     call whose outcome nobody changed. */
  const [outcome, setOutcome] = useState<CallOutcome | "">("");
  const [amount, setAmount] = useState(String(overdueTotal(account).toFixed(2)));
  const [date, setDate] = useState("");
  const [next, setNext] = useState("");
  const [notes, setNotes] = useState("");
  const [stage, setStage] = useState<CallStage>(round);

  const promised = outcome === "promised-to-pay";
  const bucket = worstBucket(account);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (outcome === "") return;
    recordCall({
      accountId: account.id,
      companyName: account.companyName,
      reached,
      outcome,
      promisedAmount: promised ? Number(amount) || 0 : null,
      promisedDate: promised && date ? date : null,
      nextActionDate: next || null,
      notes,
      agingBucket: bucket,
      deductionFailDate: null,
      stage,
    });
    notify(
      `Call with ${account.companyName} saved`,
      promised && date
        ? `Promise to pay SGD ${formatSgd(Number(amount))} by ${formatDate(date)} added to Payment Promises`
        : "Recorded in the activity log and the NetSuite export",
    );
    onClose();
  }

  return (
    <Modal title={`Call with ${account.companyName}`} onClose={onClose}>
      {/*
        Pre-filled context, proposal 5.1: client, amount owed, deduction fail
        date and aging bucket. The officer should not have to look anything up
        before dialling.
      */}
      <dl className="grid grid-cols-2 gap-x-5 gap-y-3 border-b border-line-hair pb-4 text-xs sm:grid-cols-3">
        <Fact label="Account" value={account.customerCode} />
        <Fact label="Property" value={account.propertyName} />
        <Fact label="How overdue" value={bucket} />
        <Fact label="Total owed" value={`SGD ${formatSgd(account.total)}`} />
        <Fact
          label="Overdue"
          value={`SGD ${formatSgd(overdueTotal(account))}`}
        />
        {/* An em dash rather than a blank: the report genuinely carries no
            billing date for some lines, and an empty box reads as a fault. */}
        <Fact label="Billed on" value={formatDate(billing.billedOn) || "-"} />
        <Fact
          label="Payment was due"
          value={
            billing.dueBy
              ? `${formatDate(billing.dueBy)}${
                  billing.daysPastDue !== null && billing.daysPastDue > 0
                    ? ` · ${billing.daysPastDue} days ago`
                    : ""
                }`
              : "-"
          }
        />
      </dl>

      <form onSubmit={submit} className="space-y-4 pt-4">
        {/* Defaulted from the date rather than asked cold: on the 22nd this is
            almost always the final reminder. Still a choice, because a call
            chasing the 7th can easily be made late. */}
        <Field label="Which reminder is this call about">
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value as CallStage)}
            className="w-full rounded-md border bg-surface px-3 py-2 text-sm text-ink"
          >
            {CALL_STAGES.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Who did you speak to">
          <input
            value={reached}
            onChange={(e) => setReached(e.target.value)}
            placeholder="Name and role, for example Serene, accounts"
            className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted"
          />
        </Field>

        <Field label="What happened">
          <select
            value={outcome}
            required
            onChange={(e) => setOutcome(e.target.value as CallOutcome)}
            className="w-full rounded-md border bg-surface px-3 py-2 text-sm text-ink"
          >
            <option value="" disabled>
              Choose what happened
            </option>
            {CALL_OUTCOMES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        {promised ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="How much they agreed to pay">
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="tabular w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
              />
            </Field>
            <Field label="Date they said they would pay">
              <input
                type="date"
                required
                min={inSingapore().iso}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-md border bg-surface px-3 py-2 text-sm text-ink"
              />
            </Field>
          </div>
        ) : null}

        <Field label="When to check back">
          <input
            type="date"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className="w-full rounded-md border bg-surface px-3 py-2 text-sm text-ink"
          />
        </Field>

        <Field label="Anything else worth recording">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="For example, they are disputing the parking charge"
            className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted"
          />
        </Field>

        <div className="flex items-center gap-2 border-t border-line-hair pt-4">
          <button
            type="submit"
            disabled={outcome === ""}
            className="rounded-md border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
          >
            Save this call
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-line-hair px-4 py-2 text-sm text-ink-secondary hover:border-line-strong hover:text-ink"
          >
            Cancel
          </button>
          {promised ? (
            <p className="ml-auto text-[11px] text-ink-muted">
              This will also create a payment promise.
            </p>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-ink-muted">
        {label}
      </dt>
      <dd className="tabular mt-0.5 font-medium text-ink">{value}</dd>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-secondary">
        {label}
      </span>
      {children}
    </label>
  );
}

/**
 * When this tenant was billed, and whether that bill has fallen due.
 *
 * The call list said how much was owed and how overdue it was in the
 * abstract. It never said which bill, so the officer picking up the phone had
 * no date to quote and the tenant could reasonably ask which one. The last
 * clause is the reason the tenant is on this list at all.
 */
function BillingNote({ billing }: { billing: TenantBilling }) {
  if (!billing.billedOn) return null;
  return (
    <span>
      Billed {formatDate(billing.billedOn)}
      {billing.runs > 1 ? ` (+${billing.runs - 1} earlier)` : ""}
      {billing.dueBy ? `, due ${formatDate(billing.dueBy)}` : ""}
      {billing.daysPastDue !== null && billing.daysPastDue > 0 ? (
        <span className="font-medium text-ink">
          {" "}
          {/* The oldest unpaid bill's age, which is not the newest bill's: next
              to "due 30 Sept 2026" a bare "due 896 days ago" read as the same
              bill and made no sense. */}
          · {billing.runs > 1 ? "oldest unpaid bill due" : "due"} {billing.daysPastDue} days ago
        </span>
      ) : null}
    </span>
  );
}

/**
 * Which bill a logged call was about, on a line of its own.
 *
 * Deliberately heavier than the timestamp beneath it. Reading a call back
 * weeks later, "which invoice was this" is the first question and "what time
 * did she ring" is the last, and the old layout had them the other way round.
 *
 * The figures are this tenant's current billing position, not a snapshot taken
 * when the call was made - the report moves on and nothing here is frozen - so
 * it says "billed", not "was billed".
 */
function LoggedBilling({ billing }: { billing: TenantBilling }) {
  if (!billing.billedOn) return null;
  return (
    <p className="mt-1 text-xs text-ink-secondary">
      Billed {formatDate(billing.billedOn)}
      {billing.dueBy ? ` · due ${formatDate(billing.dueBy)}` : ""}
      {billing.daysPastDue !== null && billing.daysPastDue > 0 ? (
        <span className="font-medium text-ink"> · {billing.daysPastDue} days overdue</span>
      ) : null}
      {billing.runs > 1 ? (
        <span className="text-ink-muted"> · {billing.runs - 1} earlier runs unpaid</span>
      ) : null}
    </p>
  );
}
