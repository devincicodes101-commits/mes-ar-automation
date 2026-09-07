"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
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
} from "@/components/ui";

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

  const shown = useMemo(
    () =>
      filter === "all"
        ? store.emails
        : store.emails.filter((e) => e.templateName === filter),
    [store.emails, filter],
  );

  const open = store.emails.find((e) => e.id === openId) ?? shown[0] ?? null;
  const recipients = new Set(store.emails.flatMap((e) => e.to)).size;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Emails sent"
          value={String(store.emails.length)}
          note="This period"
          emphasis
        />
        <StatTile
          label="Distinct recipients"
          value={String(recipients)}
          note="Addresses reached"
        />
        <StatTile
          label="Could not be sent"
          value={String(unreachable.length)}
          note="No address on file"
        />
        <StatTile
          label="Wordings used"
          value={String(templates.length)}
          note="First reminder, final notice, etc."
        />
      </div>

      {/* ------------------------------------------------------- sent mail */}
      <Card>
        <CardHeader
          title="Sent mail"
          hint="The letter exactly as it went out, so a merge fault is visible before the next send."
          right={
            templates.length > 1 ? (
              <select
                aria-label="Filter by wording"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="rounded border border-line-hair bg-surface px-2.5 py-1.5 text-xs text-ink-secondary"
              >
                <option value="all">Every wording</option>
                {templates.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            ) : null
          }
        />

        {store.emails.length === 0 ? (
          <EmptyState
            title="Nothing has been sent yet"
            body="Send a reminder from the Reminder Emails screen and it will appear here, with the full letter."
          />
        ) : (
          <div className="grid lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
            {/* the list */}
            <ScrollPanel max={460} className="border-r border-line-hair">
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
                        <p className="truncate text-[13px] font-medium text-ink">
                          {e.companyName}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-ink-muted">
                          {e.templateName} · {e.at.slice(0, 16).replace("T", " ")}
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
          title="Owed money, but no address"
          hint="These tenants cannot receive a reminder at all. They stay on the call list."
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
                      <span className="text-ink">{a.companyName}</span>
                      <span className="ml-2 text-[11px] text-ink-muted">
                        {a.customerCode}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-ink-secondary">
                      {a.property}
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
