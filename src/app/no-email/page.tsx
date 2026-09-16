"use client";

import { useMemo, useState } from "react";
import { formatSgd, overdueTotal } from "@/lib/data";
import { downloadCsv } from "@/lib/export";
import { Account } from "@/lib/types";
import { useSession, useToast } from "@/lib/session";
import { useDataset, withManualEmails } from "@/lib/dataset";
import { setManualEmails, useStore } from "@/lib/store";
import { renderLetter, type LetterId } from "@/lib/letters";
import {
  Card,
  CardHeader,
  EmptyState,
  Modal,
  ScrollPanel,
  StatTile,
  StatusBadge,
} from "@/components/ui";

/**
 * Tenants the system cannot email, and the letter each of them should get.
 *
 * Raman described the process on 14 September: "when they upload and bulk send
 * to all the client, those that don't have email, it will just generate an
 * exception report, Excel or CSV, which will list those clients. Then the user
 * will enter it and re-upload only that one for emailing. You can do a manual
 * email for exception list."
 *
 * Two halves, and the second is the one that was missing. Exporting a list of
 * names is easy and half useless: whoever gets it still has to find the right
 * wording, the right balance and the right deadline for each tenant, by hand,
 * which is exactly the work this system exists to remove. So the letter is
 * written here, per tenant, ready to copy into Outlook. Only the sending is
 * manual.
 *
 * He was picturing a handful. At Blue Stars it is 185 of 190, because the
 * contact list MES sent covers 49 companies and only 6 of them rent there.
 * The screen says the number out loud rather than presenting it as an edge
 * case.
 */
export default function NoEmailPage() {
  const { scope, canAct } = useSession();
  const store = useStore();
  const ds = withManualEmails(useDataset(), store.manualEmails);
  const { notify } = useToast();
  const [letter, setLetter] = useState<LetterId>("first-reminder");
  const [open, setOpen] = useState<Account | null>(null);
  const [query, setQuery] = useState("");

  const missing = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scope(ds.accounts)
      .filter((a) => !a.hasContact)
      .filter((a) => a.status === "Live")
      .filter((a) => overdueTotal(a) > 0 || a.total > 0)
      .filter((a) =>
        q === ""
          ? true
          : a.companyName.toLowerCase().includes(q) ||
            a.customerCode.toLowerCase().includes(q),
      )
      .sort((x, y) => overdueTotal(y) - overdueTotal(x));
  }, [ds, scope, query]);

  const reachable = useMemo(
    () => scope(ds.accounts).filter((a) => a.hasContact && a.status === "Live").length,
    [ds, scope],
  );
  const owed = missing.reduce((s, a) => s + overdueTotal(a), 0);
  const total = missing.length + reachable;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Cannot be emailed"
          value={String(missing.length)}
          note={total > 0 ? `of ${total} tenants` : "no tenants loaded"}
          emphasis
        />
        <StatTile
          label="Overdue we cannot chase"
          prefix="SGD"
          value={formatSgd(owed)}
          note="These letters have to go by hand"
        />
        <StatTile
          label="We can email"
          value={String(reachable)}
          note="These go out on the 7th and the 21st"
        />
        <StatTile
          label="Share of tenants"
          value={total > 0 ? `${Math.round((missing.length / total) * 100)}%` : "0%"}
          note="Needing a manual send"
        />
      </div>

      <Card>
        <CardHeader
          title="Tenants with no email address"
          hint="The letter is written for each of them. Open one, copy it, and send it from Outlook. Adding an address here removes the tenant from this list and puts them back into the automatic send."
          right={
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={missing.length === 0}
                onClick={() => {
                  // The shape the contact list parser reads back, so the file
                  // that comes out can be filled in and uploaded straight
                  // back. Raman, 14 September: "it will just generate an
                  // exception report, Excel or CSV, which will list those
                  // clients. Then the user will enter it and re-upload only
                  // that one for emailing."
                  //
                  // Column A is "DORM-x COMPANY" because that is what the
                  // parser splits on, and the header must read Company Name
                  // and Email Address or it will not be recognised.
                  downloadCsv(
                    `exceptions-no-email-${ds.asOf ?? "latest"}.csv`,
                    ["Company Name", "Status", "Dormitory", "Outstanding", "Email Address"],
                    missing.map((a) => [
                      `${a.customerCode} ${a.companyName}`,
                      a.status,
                      a.propertyName,
                      overdueTotal(a).toFixed(2),
                      "",
                    ]),
                  );
                  notify(
                    "Exception list downloaded",
                    `${missing.length} tenants. Fill in the Email Address column and upload it as a contact list.`,
                  );
                }}
                className="rounded border border-line-hair px-2.5 py-1.5 text-xs text-ink-secondary hover:border-line-grid disabled:cursor-not-allowed disabled:opacity-40"
              >
                Download the list
              </button>
              <select
                value={letter}
                onChange={(e) => setLetter(e.target.value as LetterId)}
                className="rounded border border-line-hair bg-surface px-2.5 py-1.5 text-xs text-ink"
              >
                <option value="first-reminder">First reminder, the 7th</option>
                <option value="final-notice">Final notice, the 21st</option>
              </select>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a tenant"
                className="w-44 rounded border border-line-hair bg-surface px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-muted"
              />
            </div>
          }
        />

        {missing.length === 0 ? (
          <EmptyState
            title="Every tenant has an address"
            body="Nothing needs sending by hand. Reminders go out on their own on the 7th and the 21st."
          />
        ) : (
          <ScrollPanel>
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line-grid text-left">
                  <th className="px-5 py-2.5 text-xs font-medium text-ink-muted">Tenant</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-ink-muted">Dormitory</th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-ink-muted">Owed</th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-ink-muted">Overdue</th>
                  <th className="px-5 py-2.5 text-right text-xs font-medium text-ink-muted">Letter</th>
                </tr>
              </thead>
              <tbody>
                {missing.map((a) => (
                  <tr key={a.id} className="border-b border-line-hair last:border-0">
                    <td className="px-5 py-2.5">
                      <div className="text-ink">{a.companyName}</div>
                      <div className="mono text-[11px] text-ink-muted">{a.customerCode}</div>
                    </td>
                    <td className="px-3 py-2.5 text-ink-secondary">{a.propertyName}</td>
                    <td className="tabular px-3 py-2.5 text-right text-ink-secondary">
                      {formatSgd(a.total)}
                    </td>
                    <td className="tabular px-3 py-2.5 text-right font-medium text-ink">
                      {formatSgd(overdueTotal(a))}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => setOpen(a)}
                        className="rounded border border-line-hair px-2.5 py-1 text-[11px] text-ink-secondary hover:border-line-grid"
                      >
                        Read and copy
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollPanel>
        )}

        <div className="border-t border-line-hair px-5 py-3 text-[11px] leading-relaxed text-ink-muted">
          MES&rsquo;s own process for these: send to everyone who has an
          address, list the rest, fill the addresses in, and re-upload only
          those. <b className="text-ink-secondary">Download the list</b> gives
          you that file with an empty Email Address column. Fill it in and
          upload it on the Upload screen as a contact list: it adds those
          addresses and leaves every other tenant alone. Until they arrive,
          each letter here is written and waiting and has to be sent by hand.
        </div>
      </Card>

      {open ? (
        <LetterModal
          account={open}
          letter={letter}
          asOf={ds.asOf}
          canAct={canAct}
          onClose={() => setOpen(null)}
          onSaved={(emails) => {
            setManualEmails(open.id, open.companyName, emails);
            notify(
              `${open.companyName} can now be emailed`,
              `${emails.length} address${emails.length === 1 ? "" : "es"} saved. They rejoin the automatic send.`,
            );
            setOpen(null);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The letter, written out, with the address box beside it.
 *
 * Both are on the same screen deliberately. Whoever is working through this
 * list is already looking the tenant up to send the letter, which is the
 * moment they are most likely to have found an address. Making them go
 * somewhere else to record it is how the list stays 185 long.
 */
function LetterModal({
  account,
  letter,
  asOf,
  canAct,
  onClose,
  onSaved,
}: {
  account: Account;
  letter: LetterId;
  asOf: string | null;
  canAct: boolean;
  onClose: () => void;
  onSaved: (emails: string[]) => void;
}) {
  const { notify } = useToast();
  const [typed, setTyped] = useState("");

  const rendered = useMemo(
    () =>
      renderLetter(letter, {
        companyName: account.companyName,
        grandTotal: account.total,
        sentOn: asOf ?? new Date().toISOString().slice(0, 10),
      }),
    [letter, account, asOf],
  );

  // A placeholder that never filled would otherwise go out reading
  // "{{Company_Name}}" to a real tenant. The outbox found one of these on a
  // record that had been sent, so it is checked before sending, not after.
  const leftovers = Array.from(
    new Set(rendered.body.match(/\{\{\w+\}\}/g) ?? []),
  );

  const addresses = typed
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(`${what} copied`, "Paste it into Outlook.");
    } catch {
      notify("Could not copy", "Select the text and copy it by hand.");
    }
  };

  return (
    <Modal title={account.companyName} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <StatusBadge kind="warning" label="No email address" />
          <span className="text-[11px] text-ink-muted">
            {account.propertyName} &middot; owes {formatSgd(account.total)},
            overdue {formatSgd(overdueTotal(account))}
          </span>
        </div>

        {leftovers.length > 0 ? (
          <div className="rounded border border-line-hair bg-surface-alt px-3 py-2">
            <StatusBadge kind="critical" label="Do not send yet" />
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-secondary">
              {leftovers.join(", ")} did not fill in. Sending this would show
              the tenant the placeholder.
            </p>
          </div>
        ) : null}

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium text-ink-secondary">Subject</span>
            <button
              type="button"
              onClick={() => copy(rendered.subject, "Subject")}
              className="rounded border border-line-hair px-2 py-0.5 text-[11px] text-ink-secondary hover:border-line-grid"
            >
              Copy
            </button>
          </div>
          <p className="rounded border border-line-hair bg-surface-alt px-3 py-2 text-sm text-ink">
            {rendered.subject}
          </p>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium text-ink-secondary">
              Letter &middot; deadline {rendered.deadline}
            </span>
            <button
              type="button"
              onClick={() => copy(rendered.body, "Letter")}
              className="rounded border border-line-hair px-2 py-0.5 text-[11px] text-ink-secondary hover:border-line-grid"
            >
              Copy
            </button>
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-line-hair bg-surface-alt px-3 py-2 text-[12px] leading-relaxed text-ink-secondary">
            {rendered.body}
          </pre>
        </div>

        <div className="border-t border-line-hair pt-3">
          <span className="mb-1.5 block text-xs font-medium text-ink-secondary">
            Found their address? Add it and they rejoin the automatic send.
          </span>
          <div className="flex flex-wrap gap-2">
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="name@company.com, second@company.com"
              disabled={!canAct}
              className="min-w-[260px] flex-1 rounded border border-line-hair bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted disabled:opacity-50"
            />
            <button
              type="button"
              disabled={!canAct || addresses.length === 0}
              onClick={() => onSaved(addresses)}
              className="rounded border border-accent bg-accent px-3 py-2 text-xs font-medium text-accent-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Save {addresses.length > 0 ? `${addresses.length} address${addresses.length === 1 ? "" : "es"}` : "address"}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-ink-muted">
            Several addresses can be separated by commas. MES send to all of
            them, not just the first.
          </p>
        </div>
      </div>
    </Modal>
  );
}
