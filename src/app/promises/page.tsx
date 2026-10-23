"use client";

import { useMemo, useState } from "react";
import { formatSgd } from "@/lib/data";
import { useDataset } from "@/lib/dataset";
import {
  PROMISE_STATE_LABEL,
  PromiseRecord,
  PromiseState,
  promiseState,
  hydrateActivity,
  markPromiseConfirmed,
  recordPromise,
  useStore,
} from "@/lib/store";
import { describe, sendLetters } from "@/lib/send-letters";
import { currentPeriod, inSingapore } from "@/lib/schedule";
import { useSession, useToast } from "@/lib/session";
import {
  Card,
  CardHeader,
  EmptyState,
  Modal,
  StatTile,
  StatusBadge,
  Tag,
  TenantLink,
  Pagination,
} from "@/components/ui";
import { usePaged } from "@/lib/use-paged";
import { formatDate } from "@/lib/format";

/*
 * "paid": the tenant is no longer in the report, or owes nothing in it.
 * MES's rule for reading a new report - gone means paid in full - applied to
 * promises too. Without it a tenant who had paid read "Date passed, still
 * unpaid" and counted as money at risk (found 24 October).
 */
type Shown = PromiseState | "paid";

const ORDER: Shown[] = ["broken", "due-today", "upcoming", "paid"];

const KIND: Record<Shown, "good" | "warning" | "critical" | "neutral"> = {
  upcoming: "good",
  "due-today": "warning",
  broken: "critical",
  paid: "neutral",
};

const LABEL: Record<Shown, string> = { ...PROMISE_STATE_LABEL, paid: "Paid, no longer owing" };

export default function PromisesPage() {
  const store = useStore();
  /*
   * The uploaded report, not the bundled example.
   *
   * This screen read allAccounts(), which returns the sample shipped with the
   * app and nothing else. So "Send confirmation" was decided by whether a
   * made-up company had an address, and the Record a promise list offered
   * sample companies rather than MES's tenants - on a screen that otherwise
   * shows real promises, which is the kind of mix nobody notices until a
   * promise is filed against a tenant who does not exist.
   */
  const ds = useDataset();
  const accountById = (id: string) => ds.accounts.find((a) => a.id === id);
  /*
   * Two different permissions on one screen, and they are genuinely
   * different. Recording a promise is writing down what a tenant said, which
   * is a manager's own work. Sending the confirmation writes to the tenant,
   * which is not. canAct is send-reminders and stays on the second.
   */
  const { canAct, can } = useSession();
  const mayRecord = can("record-promises");
  const { notify } = useToast();
  const [adding, setAdding] = useState(false);
  const [state, setState] = useState<Shown | "all">("all");
  const [query, setQuery] = useState("");

  const template = store.templates.find((t) => t.id === "promise-confirmation");

  /**
   * Proposal section 3: once a promise is recorded, a short confirmation goes
   * to the tenant. It is still approved rather than fired automatically, in
   * keeping with the human in the loop rule for everything else.
   */
  /*
   * Sent, not just written down.
   *
   * This recorded the email in the browser and marked the promise confirmed
   * without ever calling the mail server, so the button said "sent" and
   * nothing arrived. It also filled {{amount}} and {{dueBy}}, which the
   * template does not use: it says {{promiseAmount}}, {{promiseDate}} and
   * {{code}}. Now it goes through /api/send like every other letter, and the
   * promise is marked confirmed only when the server says it went.
   */
  const [sendingId, setSendingId] = useState<string | null>(null);
  async function sendConfirmation(p: (typeof store.promises)[number]) {
    const account = accountById(p.accountId);
    if (!template || !account) return;
    const fill = (text: string) =>
      text
        .replaceAll("{{company}}", p.companyName)
        .replaceAll("{{code}}", account.customerCode)
        .replaceAll("{{promiseAmount}}", formatSgd(p.amount))
        .replaceAll("{{amount}}", formatSgd(p.amount))
        .replaceAll("{{promiseDate}}", formatDate(p.promisedFor))
        .replaceAll("{{dueBy}}", formatDate(p.promisedFor))
        /* The wording assumes a call; a promise made by email was a reply. */
        .replace(
          "Thank you for speaking with us today.",
          p.source === "email" ? "Thank you for your reply." : "Thank you for speaking with us today.",
        );
    setSendingId(p.id);
    const report = await sendLetters([
      {
        tenantId: p.accountId,
        companyName: p.companyName,
        to: account.emails,
        subject: fill(template.subject),
        body: fill(template.body),
        templateId: template.id,
        templateName: template.name,
        period: currentPeriod(),
      },
    ]);
    setSendingId(null);
    if (report.sent > 0) {
      markPromiseConfirmed(p.id);
      notify(
        `Confirmation sent to ${p.companyName}`,
        `Confirming SGD ${formatSgd(p.amount)} by ${formatDate(p.promisedFor)}`,
      );
    } else {
      const said = describe(report, template.name);
      notify(said.title, said.detail);
    }
    await hydrateActivity(true);
  }

  const stateOf = (p: PromiseRecord): Shown => {
    const a = accountById(p.accountId);
    return !a || a.total <= 0 ? "paid" : promiseState(p);
  };
  const grouped = useMemo(() => {
    const g: Record<Shown, PromiseRecord[]> = {
      upcoming: [],
      "due-today": [],
      broken: [],
      paid: [],
    };
    for (const p of store.promises) g[stateOf(p)].push(p);
    for (const k of ORDER) {
      g[k].sort((a, b) => a.promisedFor.localeCompare(b.promisedFor));
    }
    return g;
    // stateOf reads the report, which ds.accounts carries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.promises, ds.accounts]);

  /*
   * One list with a filter over it, rather than three stacked sections.
   *
   * Stacked sections meant the answer to "is Tuas Precision on here" depended
   * on which section they had landed in, so the only reliable way to find a
   * tenant was to read all three. The state each promise is in is now a badge
   * on its own row, which is where somebody looking at that row wants it.
   */
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ORDER.flatMap((k) => (state === "all" || state === k ? grouped[k] : [])).filter(
      (p) => (q === "" ? true : p.companyName.toLowerCase().includes(q)),
    );
  }, [grouped, state, query]);

  /* Still owed: a promise from a tenant who has since paid is not money due. */
  const total = store.promises.filter((p) => stateOf(p) !== "paid").reduce((s, p) => s + p.amount, 0);
  const brokenValue = grouped.broken.reduce((s, p) => s + p.amount, 0);
  const promisePage = usePaged(shown, `${state}|${query}`);

  return (
    <div className="space-y-5">
      {/* The money only: how many, and how many are past their date, are the
          counts on the filter below. */}
      <div className="grid grid-cols-2 gap-3">
        <StatTile
          label="Value promised"
          prefix="SGD"
          value={formatSgd(total)}
        />
        <StatTile
          label="Value at risk"
          prefix="SGD"
          value={formatSgd(brokenValue)}
          note="Date passed, unpaid"
          emphasis={brokenValue > 0}
        />
      </div>

      <Card>
        <CardHeader
          title="Every promise to pay"
          right={
            <button
              type="button"
              onClick={() => setAdding(true)}
              disabled={!mayRecord}
              className="rounded border border-accent bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Record a promise
            </button>
          }
        />

        {store.promises.length > 0 ? (
          <div className="flex flex-col gap-2 border-b border-line-hair px-4 py-3 sm:px-5 lg:flex-row lg:items-center">
            <div className="flex gap-1 overflow-x-auto rounded-md bg-surface-alt p-1" role="group" aria-label="Which promises">
              {(
                [
                  ["all", "All", store.promises.length],
                  ...ORDER.map(
                    (k) => [k, LABEL[k], grouped[k].length] as const,
                  ),
                ] as [Shown | "all", string, number][]
              ).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setState(key)}
                  aria-pressed={state === key}
                  className={`flex-1 whitespace-nowrap rounded px-3 py-1.5 text-xs lg:flex-none ${
                    state === key
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
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a tenant"
              aria-label="Find a tenant"
              className="w-full rounded-md border bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted sm:text-xs lg:ml-auto lg:w-60"
            />
          </div>
        ) : null}

        {store.promises.length === 0 ? (
          <EmptyState
            title="No promises recorded yet"
            body="Log a call on the Call List and choose Agreed to pay."
          />
        ) : shown.length === 0 ? (
          <EmptyState
            title="Nothing matches"
            body="Try another search, or choose All to drop the filter."
          />
        ) : (
          <ul className="divide-y divide-line-grid">
            {promisePage.shown.map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-ink">
                          <TenantLink id={p.accountId} name={p.companyName} />
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
                          <StatusBadge
                            kind={KIND[stateOf(p)]}
                            label={LABEL[stateOf(p)]}
                          />
                          <span>
                            Promised on{" "}
                            {formatDate(p.createdAt)}{" "}
                            {p.source === "email" ? "in a reply to a reminder" : "during a phone call"}
                          </span>
                        </p>
                      </div>
                      <div className="shrink-0 sm:text-right">
                        <div className="tabular text-sm font-medium text-ink">
                          SGD {formatSgd(p.amount)}
                        </div>
                        <div className="mt-0.5 text-[11px] text-ink-muted">
                          due {formatDate(p.promisedFor)}
                        </div>
                      </div>

                      <div className="shrink-0 self-start sm:self-auto">
                        {p.confirmationSentAt ? (
                          <StatusBadge kind="good" label="Confirmed to tenant" />
                        ) : accountById(p.accountId)?.hasContact ? (
                          canAct ? (
                            <button
                              type="button"
                              disabled={sendingId !== null}
                              onClick={() => void sendConfirmation(p)}
                              className="rounded border border-line-hair px-3 py-1.5 text-xs text-ink hover:border-line-strong"
                            >
                              {sendingId === p.id ? "Sending..." : "Send confirmation"}
                            </button>
                          ) : (
                            <span className="text-[11px] text-ink-muted">View only</span>
                          )
                        ) : (
                          <Tag>No email on file</Tag>
                        )}
                      </div>
                    </li>
            ))}
          </ul>
        )}
        <Pagination {...promisePage.pager} />
      </Card>

      {/* Until now a promise could only exist as a by-product of the call
          form, so a tenant who replied to a reminder saying "paying on the
          29th" could not be recorded at all. MES's own letters invite exactly
          that: they ask for payment confirmation by email. The system does not
          read anybody's mailbox, so the officer types what she read, and the
          source records where it came from. */}
      {adding ? <RecordPromise onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

function RecordPromise({ onClose }: { onClose: () => void }) {
  const { notify } = useToast();
  /* The tenants in the uploaded report, and only the ones this role may see:
     useDataset is already narrowed, so a manager is offered their own book. */
  const all = useDataset().accounts;
  /* Those who owe, by name. Nothing is chosen for you: starting on the first
     tenant in the file meant a promise could be filed against the wrong one
     by somebody who never opened the list. */
  const accounts = useMemo(
    () => all.filter((a) => a.total > 0).sort((x, y) => x.companyName.localeCompare(y.companyName)),
    [all],
  );
  const [find, setFind] = useState("");
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [source, setSource] = useState<"email" | "call">("email");
  const today = inSingapore().iso;

  const q = find.trim().toLowerCase();
  const options = q
    ? accounts.filter(
        (a) => a.companyName.toLowerCase().includes(q) || a.customerCode.toLowerCase().includes(q),
      )
    : accounts;
  const account = accounts.find((a) => a.id === accountId);
  const ready = account && date !== "" && date >= today && Number(amount) > 0;

  return (
    <Modal title="Record a promise to pay" onClose={onClose}>
      <p className="text-xs leading-relaxed text-ink-secondary">
        For a commitment that did not come from a logged call, such as a reply
        to a reminder. The system does not read your mailbox, so type what the
        tenant said.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-xs font-medium text-ink-secondary">
            Tenant
          </span>
          <input
            type="search"
            value={find}
            onChange={(e) => {
              setFind(e.target.value);
              const q2 = e.target.value.trim().toLowerCase();
              const hits = accounts.filter(
                (a) => a.companyName.toLowerCase().includes(q2) || a.customerCode.toLowerCase().includes(q2),
              );
              /* An exact code, or the only match, is the tenant meant. */
              const exact = hits.find((a) => a.customerCode.toLowerCase() === q2);
              if (exact) setAccountId(exact.id);
              else if (q2 && hits.length === 1) setAccountId(hits[0].id);
            }}
            placeholder="Type a name or code to narrow the list"
            aria-label="Find a tenant"
            className="mb-2 w-full rounded-md border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted"
          />
          <select
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              const a = accounts.find((x) => x.id === e.target.value);
              if (a && amount === "") setAmount(String(a.total.toFixed(2)));
            }}
            className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
          >
            <option value="">
              {options.length === 0 ? "No tenant matches" : `Choose a tenant (${options.length})`}
            </option>
            {options.map((a) => (
              <option key={a.id} value={a.id}>
                {a.companyName} · {a.customerCode}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-secondary">
            Amount promised, SGD
          </span>
          <input
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={account ? formatSgd(account.total) : ""}
            className="tabular w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-secondary">
            Promised to pay by
          </span>
          <input
            type="date"
            min={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
          />
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-xs font-medium text-ink-secondary">
            Where it came from
          </span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as "email" | "call")}
            className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
          >
            <option value="email">A reply to a reminder</option>
            <option value="call">A phone call</option>
          </select>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line-hair pt-4">
        <button
          type="button"
          disabled={!ready}
          onClick={() => {
            if (!account) return;
            recordPromise({
              accountId: account.id,
              companyName: account.companyName,
              amount: Number(amount),
              promisedFor: date,
              source,
            });
            notify(
              `Promise recorded for ${account.companyName}`,
              `SGD ${formatSgd(Number(amount))} by ${formatDate(date)}`,
            );
            onClose();
          }}
          className="rounded border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Record it
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-line-hair px-4 py-2 text-sm text-ink-secondary hover:border-line-strong hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}
