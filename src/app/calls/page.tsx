"use client";

import { useMemo, useState } from "react";
import {
  GIRO_LABEL,
  LAST_BANK_RUN,
  buildQueue,
  formatSgd,
  giroStatus,
  overdueTotal,
  severeTotal,
  worstBucket,
} from "@/lib/data";
import { Account } from "@/lib/types";
import {
  CALL_OUTCOMES,
  CallOutcome,
  recordCall,
  useStore,
} from "@/lib/store";
import { useSession, useToast } from "@/lib/session";
import { useDataset, withManualEmails } from "@/lib/dataset";
import {
  Card,
  CardHeader,
  EmptyState,
  Modal,
  StatTile,
  StatusBadge,
  Tag,
} from "@/components/ui";

export default function CallListPage() {
  const store = useStore();
  const { scope, canAct } = useSession();
  const ds = withManualEmails(useDataset(), store.manualEmails);
  const [active, setActive] = useState<Account | null>(null);

  const queue = useMemo(() => buildQueue(scope(ds.accounts)), [ds, scope]);
  const calledIds = new Set(store.calls.map((c) => c.accountId));

  const todo = queue.filter((q) => !calledIds.has(q.account.id));
  const done = queue.filter((q) => calledIds.has(q.account.id));

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Still to call"
          value={String(todo.length)}
          note="Work down from the top"
          emphasis
        />
        <StatTile
          label="Called today"
          value={String(done.length)}
          note="Logged and saved"
        />
        <StatTile
          label="Agreed to pay"
          value={String(
            store.calls.filter((c) => c.outcome === "promised-to-pay").length,
          )}
          note="Now on the promises screen"
        />
        <StatTile
          label="Could not reach"
          value={String(
            store.calls.filter(
              (c) => c.outcome === "no-answer" || c.outcome === "wrong-number",
            ).length,
          )}
          note="Try again or check the number"
        />
      </div>

      <Card>
        <CardHeader
          title="Who to phone on the 14th and 15th"
          hint="Call from your normal line, then log what was agreed."
        />

        {todo.length === 0 ? (
          <EmptyState
            title="Every tenant on the list has been called"
            body="Anything logged today is shown below."
          />
        ) : (
          <ol className="divide-y divide-line-grid">
            {todo.map((item, idx) => (
              <li
                key={item.account.id}
                className="flex flex-wrap items-start gap-4 px-5 py-3.5 hover:bg-surface-alt"
              >
                <span className="tabular mt-0.5 w-6 shrink-0 text-xs text-ink-muted">
                  {idx + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">
                      {item.account.companyName}
                    </span>
                    <span className="text-[11px] text-ink-muted">
                      {item.account.customerCode} · {item.account.propertyName}
                    </span>
                    {item.account.isOneFm ? <Tag>1FM</Tag> : null}
                    {item.account.status === "Terminated" ? (
                      <Tag>Moved out</Tag>
                    ) : null}
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
                  </div>
                </div>

                {canAct ? (
                  <button
                    type="button"
                    onClick={() => setActive(item.account)}
                    className="shrink-0 rounded border border-accent bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink hover:opacity-90"
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
      </Card>

      {done.length > 0 ? (
        <Card>
          <CardHeader
            title="Calls logged"
            hint="Saved with the date and time."
          />
          <ul className="divide-y divide-line-grid">
            {store.calls.map((c) => (
              <li key={c.id} className="flex flex-wrap gap-4 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-ink">
                      {c.companyName}
                    </span>
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
                  <p className="mt-1 text-[11px] text-ink-muted">
                    Spoke to {c.reached || "nobody"} ·{" "}
                    {new Date(c.at).toLocaleString("en-SG")}
                  </p>
                  {c.notes ? (
                    <p className="mt-1 text-xs text-ink-secondary">{c.notes}</p>
                  ) : null}
                </div>
                {c.promisedDate ? (
                  <div className="shrink-0 text-right text-[11px] text-ink-secondary">
                    <div className="tabular font-medium text-ink">
                      SGD {formatSgd(c.promisedAmount ?? 0)}
                    </div>
                    <div>promised for {c.promisedDate}</div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {active ? (
        <CallForm account={active} onClose={() => setActive(null)} />
      ) : null}
    </div>
  );
}

function CallForm({
  account,
  onClose,
}: {
  account: Account;
  onClose: () => void;
}) {
  const { notify } = useToast();
  const [reached, setReached] = useState("");
  const [outcome, setOutcome] = useState<CallOutcome>("promised-to-pay");
  const [amount, setAmount] = useState(String(overdueTotal(account).toFixed(2)));
  const [date, setDate] = useState("");
  const [next, setNext] = useState("");
  const [notes, setNotes] = useState("");
  const [failDate, setFailDate] = useState(LAST_BANK_RUN);

  const promised = outcome === "promised-to-pay";
  const bucket = worstBucket(account);

  function submit(e: React.FormEvent) {
    e.preventDefault();
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
      deductionFailDate: failDate || null,
    });
    notify(
      `Call with ${account.companyName} saved`,
      promised && date
        ? `Promise to pay SGD ${amount} by ${date} added to Payment Promises`
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
        <Fact label="GIRO" value={GIRO_LABEL[giroStatus(account)]} />
      </dl>

      <form onSubmit={submit} className="space-y-4 pt-4">
        <Field label="Date their payment bounced">
          <input
            type="date"
            value={failDate}
            onChange={(e) => setFailDate(e.target.value)}
            className="w-full rounded border border-line-hair bg-surface px-3 py-2 text-sm text-ink"
          />
          <span className="mt-1 block text-[11px] text-ink-muted">
            From the bank run on {LAST_BANK_RUN}. Correct it if you know better.
          </span>
        </Field>

        <Field label="Who did you speak to">
          <input
            value={reached}
            onChange={(e) => setReached(e.target.value)}
            placeholder="Name and role, for example Serene, accounts"
            className="w-full rounded border border-line-hair bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted"
          />
        </Field>

        <Field label="What happened">
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as CallOutcome)}
            className="w-full rounded border border-line-hair bg-surface px-3 py-2 text-sm text-ink"
          >
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
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="tabular w-full rounded border border-line-hair bg-surface px-3 py-2 text-sm text-ink"
              />
            </Field>
            <Field label="Date they said they would pay">
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded border border-line-hair bg-surface px-3 py-2 text-sm text-ink"
              />
            </Field>
          </div>
        ) : null}

        <Field label="When to check back">
          <input
            type="date"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className="w-full rounded border border-line-hair bg-surface px-3 py-2 text-sm text-ink"
          />
        </Field>

        <Field label="Anything else worth recording">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="For example, they are disputing the parking charge"
            className="w-full rounded border border-line-hair bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted"
          />
        </Field>

        <div className="flex items-center gap-2 border-t border-line-hair pt-4">
          <button
            type="submit"
            className="rounded border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90"
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
