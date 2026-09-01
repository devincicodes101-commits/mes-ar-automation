"use client";

import { useMemo, useState } from "react";
import { accountById, allAccounts, formatSgd } from "@/lib/data";
import {
  PROMISE_STATE_LABEL,
  PromiseRecord,
  PromiseState,
  promiseState,
  markPromiseConfirmed,
  recordEmail,
  recordPromise,
  useStore,
} from "@/lib/store";
import { useSession, useToast } from "@/lib/session";
import {
  Card,
  CardHeader,
  Modal,
  EmptyState,
  StatTile,
  StatusBadge,
  Tag,
} from "@/components/ui";

const ORDER: PromiseState[] = ["broken", "due-today", "upcoming"];

const KIND: Record<PromiseState, "good" | "warning" | "critical"> = {
  upcoming: "good",
  "due-today": "warning",
  broken: "critical",
};

export default function PromisesPage() {
  const store = useStore();
  const { canAct } = useSession();
  const { notify } = useToast();
  const [adding, setAdding] = useState(false);

  const template = store.templates.find((t) => t.id === "promise-confirmation");

  /**
   * Proposal section 3: once a promise is recorded, a short confirmation goes
   * to the tenant. It is still approved rather than fired automatically, in
   * keeping with the human in the loop rule for everything else.
   */
  function sendConfirmation(p: (typeof store.promises)[number]) {
    const account = accountById(p.accountId);
    if (!template) return;
    recordEmail({
      accountId: p.accountId,
      companyName: p.companyName,
      templateId: template.id,
      templateName: template.name,
      subject: template.subject.replaceAll("{{company}}", p.companyName),
      to: account?.emails ?? [],
    });
    markPromiseConfirmed(p.id);
    notify(
      `Confirmation sent to ${p.companyName}`,
      `Confirming SGD ${formatSgd(p.amount)} by ${p.promisedFor}`,
    );
  }

  const grouped = useMemo(() => {
    const g: Record<PromiseState, PromiseRecord[]> = {
      upcoming: [],
      "due-today": [],
      broken: [],
    };
    for (const p of store.promises) g[promiseState(p)].push(p);
    for (const k of ORDER) {
      g[k].sort((a, b) => a.promisedFor.localeCompare(b.promisedFor));
    }
    return g;
  }, [store.promises]);

  const total = store.promises.reduce((s, p) => s + p.amount, 0);
  const brokenValue = grouped.broken.reduce((s, p) => s + p.amount, 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Promises on record"
          value={String(store.promises.length)}
          note="Each one has a date attached"
        />
        <StatTile
          label="Value promised"
          prefix="SGD"
          value={formatSgd(total)}
          note="What tenants said they would pay"
        />
        <StatTile
          label="Date passed, unpaid"
          value={String(grouped.broken.length)}
          note="These need chasing again"
          emphasis
        />
        <StatTile
          label="Value at risk"
          prefix="SGD"
          value={formatSgd(brokenValue)}
          note="Promised but not honoured"
        />
      </div>

      <Card>
        <CardHeader
          title="Every promise to pay"
          hint="From a phone call, or from a reply the officer read in her inbox."
          right={
            <button
              type="button"
              onClick={() => setAdding(true)}
              disabled={!canAct}
              className="rounded border border-accent bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Record a promise
            </button>
          }
        />

        {store.promises.length === 0 ? (
          <EmptyState
            title="No promises recorded yet"
            body="Log a call on the Call List and choose Agreed to pay."
          />
        ) : (
          <div className="divide-y divide-line-grid">
            {ORDER.filter((k) => grouped[k].length > 0).map((k) => (
              <div key={k}>
                <div className="flex items-center gap-2 bg-surface-alt px-5 py-2">
                  <StatusBadge kind={KIND[k]} label={PROMISE_STATE_LABEL[k]} />
                  <span className="text-[11px] text-ink-muted">
                    {grouped[k].length}
                  </span>
                </div>
                <ul className="divide-y divide-line-grid">
                  {grouped[k].map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-center gap-4 px-5 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-ink">{p.companyName}</p>
                        <p className="mt-0.5 text-[11px] text-ink-muted">
                          Promised on{" "}
                          {new Date(p.createdAt).toLocaleDateString("en-SG")}{" "}
                          during a phone call
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="tabular text-sm font-medium text-ink">
                          SGD {formatSgd(p.amount)}
                        </div>
                        <div className="mt-0.5 text-[11px] text-ink-muted">
                          due {p.promisedFor}
                        </div>
                      </div>

                      <div className="shrink-0">
                        {p.confirmationSentAt ? (
                          <StatusBadge kind="good" label="Confirmed to tenant" />
                        ) : accountById(p.accountId)?.hasContact ? (
                          canAct ? (
                            <button
                              type="button"
                              onClick={() => sendConfirmation(p)}
                              className="rounded border border-line-hair px-3 py-1.5 text-xs text-ink hover:border-line-strong"
                            >
                              Send confirmation
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
              </div>
            ))}
          </div>
        )}

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
  const accounts = allAccounts();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [source, setSource] = useState<"email" | "call">("email");

  const account = accounts.find((a) => a.id === accountId);
  const ready = account && date !== "" && Number(amount) > 0;

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
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="w-full rounded border border-line-hair bg-surface px-3 py-2 text-sm text-ink"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.companyName} · {a.customerCode} · {a.property}
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
            className="tabular w-full rounded border border-line-hair bg-surface px-3 py-2 text-sm text-ink"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-secondary">
            Promised to pay by
          </span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded border border-line-hair bg-surface px-3 py-2 text-sm text-ink"
          />
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-xs font-medium text-ink-secondary">
            Where it came from
          </span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as "email" | "call")}
            className="w-full rounded border border-line-hair bg-surface px-3 py-2 text-sm text-ink"
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
              `SGD ${formatSgd(Number(amount))} by ${date}`,
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
