"use client";

import { useMemo, useState } from "react";
import { deliveredOnly, useStore } from "@/lib/store";
import { useSession } from "@/lib/session";
import { useDataset, withManualEmails } from "@/lib/dataset";
import { formatSgd, isInCredit } from "@/lib/data";
import { LetterView } from "@/components/LetterView";
import {
  Card,
  CardHeader,
  EmptyState,
  Loading,
  ScrollPanel,
  StatTile,
  StatusBadge,
  TenantLink,
} from "@/components/ui";
import { MailboxStrip } from "@/components/MailAccounts";
import { formatDateTime } from "@/lib/format";

/**
 * Sent Mail.
 *
 * Every reminder that has gone out, with the letter exactly as it was sent.
 *
 * This exists because a template fault is invisible everywhere else. The
 * subject line and the recipient tell you a send happened; they do not tell
 * you that the amount merged in as `$&#123;&#123;amount&#125;&#125;`, or that the pay-by date came
 * out a day short, or that the company name arrived empty. All of those are
 * decided at send time from inputs that have moved on by the time anybody
 * looks, so the rendered body is kept and shown here.
 *
 * The second half of the screen is the tenants who got nothing. A send that
 * reached five of a hundred and ninety is not a successful send, and a screen
 * that only lists what went out would report it as one.
 */
export default function OutboxPage() {
  const store = useStore();
  const { scope } = useSession();
  const ds = withManualEmails(useDataset(), store.manualEmails);

  const [openId, setOpenId] = useState<string | null>(
    store.emails[0]?.id ?? null,
  );
  const [filter, setFilter] = useState<string>("all");
  /*
   * Sent or not sent. The count above has always left out letters that never
   * left - sending switched off, a failed send - but the list did not, so a
   * morning with three failures and three retries read as six letters sent.
   */
  const [which, setWhich] = useState<"sent" | "unsent">("sent");
  const delivered = useMemo(() => deliveredOnly(store.emails), [store.emails]);
  const unsent = useMemo(
    () => store.emails.filter((e) => e.simulated),
    [store.emails],
  );

  const accounts = useMemo(() => scope(ds.accounts), [ds, scope]);

  /** Tenants who owe money but have no address, so nothing could be sent. */
  const unreachable = useMemo(
    () =>
      accounts
        .filter((a) => !isInCredit(a) && a.total > 0 && a.emails.length === 0)
        .sort((x, y) => y.total - x.total),
    [accounts],
  );

  const templates = useMemo(
    () => Array.from(new Set(store.emails.map((e) => e.templateName))).sort(),
    [store.emails],
  );

  const shown = useMemo(() => {
    const list = which === "sent" ? delivered : unsent;
    return filter === "all" ? list : list.filter((e) => e.templateName === filter);
  }, [delivered, unsent, which, filter]);

  const open = shown.find((e) => e.id === openId) ?? shown[0] ?? null;
  const recipients = new Set(delivered.flatMap((e) => e.to)).size;

  return (
    <div className="space-y-5">
      {/* Where somebody first notices nothing has gone out, so the answer
          and the button are here rather than a screen away. */}
      <MailboxStrip />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile
          label="Emails sent"
          value={String(delivered.length)}
          emphasis
        />
        <StatTile
          label="Recipients"
          value={String(recipients)}
        />
        <StatTile
          label="Not sent"
          value={String(unsent.length)}
        />
        <StatTile
          label="No address"
          value={String(unreachable.length)}
        />
      </div>

      {/* ------------------------------------------------------- sent mail */}
      <Card>
        <CardHeader
          title="Letters"
          right={
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-1 rounded-md bg-surface-alt p-1" role="group" aria-label="Sent or not sent">
                {(
                  [
                    ["sent", "Sent", delivered.length],
                    ["unsent", "Not sent", unsent.length],
                  ] as const
                ).map(([key, label, count]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setWhich(key)}
                    aria-pressed={which === key}
                    className={`whitespace-nowrap rounded px-3 py-1 text-xs ${
                      which === key
                        ? "bg-surface font-medium text-accent-text shadow-sm"
                        : "text-ink-muted hover:text-ink-secondary"
                    }`}
                  >
                    {label} <span className="tabular opacity-70">{count}</span>
                  </button>
                ))}
              </div>
            {templates.length > 1 ? (
              <select
                aria-label="Filter by wording"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="rounded-md border bg-surface px-2.5 py-1.5 text-xs text-ink-secondary"
              >
                <option value="all">Every wording</option>
                {templates.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            ) : null}
            </div>
          }
        />

        {shown.length === 0 ? (
          <EmptyState
            title={which === "sent" ? "Nothing has been sent yet" : "Every letter went out"}
            body={
              which === "sent"
                ? "Reminders appear here with the full letter once they go out."
                : "No letter has failed or been held back."
            }
          />
        ) : (
          <div className="grid lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
            {/* the list */}
            <ScrollPanel max={460} className="border-b border-line-hair lg:border-b-0 lg:border-r">
              <ul className="divide-y divide-line-grid">
                {shown.map((e) => {
                  const active = open?.id === e.id;
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => setOpenId(e.id)}
                        aria-current={active ? "true" : undefined}
                        className={`w-full px-4 py-2.5 text-left hover:bg-surface-alt ${
                          active ? "bg-surface-alt" : ""
                        }`}
                      >
                        <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
                          <span className="min-w-0 truncate">{e.companyName}</span>
                          {e.simulated ? (
                            <span className="ml-auto shrink-0">
                              <StatusBadge kind="critical" label="Not sent" />
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-ink-muted">
                          {e.templateName} · {formatDateTime(e.at)}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-ink-muted">
                          {e.to.length === 0 ? "no recipients" : e.to.join(", ")}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </ScrollPanel>

            {/* the letter */}
            {open ? <LetterView email={open} /> : <Loading label="Opening" />}
          </div>
        )}
      </Card>

      {/* ------------------------------------------------------ not reached */}
      <Card>
        <CardHeader
          title="Owe money, no email address"
          right={
            <StatusBadge
              kind={unreachable.length === 0 ? "good" : "warning"}
              label={`${unreachable.length} unreachable`}
            />
          }
        />
        {unreachable.length === 0 ? (
          <EmptyState
            title="Everyone can be reached"
            body="Every tenant with a balance has at least one email address."
          />
        ) : (
          <ScrollPanel max={320}>
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="border-b border-line-grid text-left">
                  <th className="px-5 py-2.5 text-xs font-medium text-ink-muted">
                    Tenant
                  </th>
                  <th className="px-3 py-2.5 text-xs font-medium text-ink-muted">
                    Dormitory
                  </th>
                  <th className="px-5 py-2.5 text-right text-xs font-medium text-ink-muted">
                    Owed
                  </th>
                </tr>
              </thead>
              <tbody>
                {unreachable.map((a) => (
                  <tr key={a.id} className="border-b border-line-grid">
                    <td className="px-5 py-2.5">
                      <TenantLink id={a.id} name={a.companyName} className="text-ink" />
                      <span className="ml-2 text-[11px] text-ink-muted">
                        {a.customerCode}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-ink-secondary">
                      {a.propertyName}
                    </td>
                    <td className="tabular px-5 py-2.5 text-right text-ink">
                      {formatSgd(a.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollPanel>
        )}
      </Card>
    </div>
  );
}
