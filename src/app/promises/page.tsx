"use client";

import { useMemo } from "react";
import { accountById, formatSgd } from "@/lib/data";
import {
  PROMISE_STATE_LABEL,
  PromiseRecord,
  PromiseState,
  promiseState,
  markPromiseConfirmed,
  recordEmail,
  useStore,
} from "@/lib/store";
import { useSession, useToast } from "@/lib/session";
import {
  Card,
  CardHeader,
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
          hint="Confirmed paid when the tenant drops off next month's failed payment report."
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
    </div>
  );
}
