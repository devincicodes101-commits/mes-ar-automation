"use client";

import { useMemo, useState } from "react";
import { formatSgd, overdueTotal } from "@/lib/data";
import { downloadCsv } from "@/lib/export";
import { Account } from "@/lib/types";
import { useSession, useToast } from "@/lib/session";
import { useDataset, withManualEmails } from "@/lib/dataset";
import {
  recordEmail,
  setManualEmails,
  useStore,
  type SentEmail,
} from "@/lib/store";
import { currentPeriod } from "@/lib/schedule";
import { letterById, renderLetter, type LetterId } from "@/lib/letters";
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
  /*
   * The screen only ever showed tenants still waiting, so somebody working
   * down the list watched rows disappear as they went with no way to look
   * back at one - and no way to answer "did I already do this one" after a
   * tea break. Three views over the same list instead.
   */
  const [show, setShow] = useState<"todo" | "sent" | "all">("todo");

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

  /*
   * The letters already sent by hand, this billing month.
   *
   * A hand send is recorded like any other letter, with one difference that
   * makes it recognisable: the recipient list is empty, because there was no
   * address to send to. That is the whole marker - no new table, no new flag.
   *
   * Scoped to the current period, the same way the reminder screen decides
   * whether a tenant has had this month's wording. Last month's hand send is
   * not this month's.
   */
  const handSent = useMemo(() => {
    const period = currentPeriod();
    const byAccount = new Map<string, SentEmail>();
    for (const e of store.emails) {
      if (e.to.length > 0) continue;
      if (e.period && e.period !== period) continue;
      const prev = byAccount.get(e.accountId);
      if (!prev || e.at > prev.at) byAccount.set(e.accountId, e);
    }
    return byAccount;
  }, [store.emails]);

  /* The rows the table shows, once the three-way filter has had its say. */
  const rows = useMemo(() => {
    if (show === "all") return missing;
    const sent = show === "sent";
    return missing.filter((a) => handSent.has(a.id) === sent);
  }, [missing, show, handSent]);

  const doneCount = missing.filter((a) => handSent.has(a.id)).length;

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

        {/*
          * Which of the three, and how many are in each. The counts are on
          * the buttons because "Sent by hand" reading 0 answers the question
          * without anybody having to click it.
          */}
        <div
          className="flex flex-wrap items-center gap-1 border-b border-line-hair px-5 py-2.5"
          role="group"
          aria-label="Which tenants to show"
        >
          {(
            [
              ["todo", "Still to send", missing.length - doneCount],
              ["sent", "Sent by hand", doneCount],
              ["all", "All", missing.length],
            ] as ["todo" | "sent" | "all", string, number][]
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              onClick={() => setShow(key)}
              aria-pressed={show === key}
              className={`rounded px-2.5 py-1 text-xs ${
                show === key
                  ? "bg-accent-wash font-medium text-ink"
                  : "text-ink-muted hover:bg-surface-alt hover:text-ink-secondary"
              }`}
            >
              {label} ({count})
            </button>
          ))}
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title={
              missing.length === 0
                ? "Every tenant has an address"
                : show === "sent"
                  ? "None sent by hand yet this month"
                  : "All of them have been sent"
            }
            body={
              missing.length === 0
                ? "Nothing needs sending by hand. Reminders go out on their own on the 7th and the 21st."
                : show === "sent"
                  ? "Open a letter and mark it sent once you have posted it from Outlook."
                  : "Every tenant on this list has been marked as sent by hand this month."
            }
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
                  <th className="px-3 py-2.5 text-xs font-medium text-ink-muted">Sent by hand</th>
                  <th className="px-5 py-2.5 text-right text-xs font-medium text-ink-muted">Letter</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
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
                    <td className="px-3 py-2.5 text-[11px]">
                      {handSent.has(a.id) ? (
                        <span className="text-ink-secondary">
                          {handSent.get(a.id)!.templateName.replace(" (by hand)", "")}
                          <span className="block text-ink-muted">
                            {handSent.get(a.id)!.at.slice(0, 10)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-ink-muted">Not yet</span>
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      {/*
                        * The wording's name is on the button, not just in the
                        * dropdown above. The dropdown chose which letter gets
                        * written and changed nothing you could see until a
                        * modal opened, which reads exactly like a control that
                        * does not work.
                        */}
                      <button
                        type="button"
                        onClick={() => setOpen(a)}
                        className="rounded border border-line-hair px-2.5 py-1 text-[11px] text-ink-secondary hover:border-line-grid"
                      >
                        Read the {letterById(letter).name.toLowerCase()}
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
          alreadySent={handSent.get(open.id)?.at ?? null}
          onSent={() => {
            const spec = letterById(letter);
            const written = renderLetter(letter, {
              companyName: open.companyName,
              grandTotal: open.total,
              sentOn: ds.asOf ?? new Date().toISOString().slice(0, 10),
            });
            recordEmail({
              accountId: open.id,
              companyName: open.companyName,
              period: currentPeriod(),
              templateId: letter,
              templateName: `${spec.name} (by hand)`,
              subject: written.subject,
              body: written.body,
              /* Empty on purpose: this is the marker for a hand send. */
              to: [],
            });
            notify(
              `${open.companyName} marked as sent`,
              `${spec.name} recorded against this month. It moves to the Sent by hand list.`,
            );
            setOpen(null);
          }}
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
  alreadySent,
  onClose,
  onSent,
  onSaved,
}: {
  account: Account;
  letter: LetterId;
  asOf: string | null;
  canAct: boolean;
  alreadySent: string | null;
  onClose: () => void;
  onSent: () => void;
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

        {/*
          * Copying the letter was the end of the road: nothing recorded that
          * it went, so the tenant stayed on the list looking untouched and
          * the audit trail had a gap exactly where a chase had happened.
          */}
        <div className="border-t border-line-hair pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!canAct || leftovers.length > 0}
              onClick={onSent}
              className="rounded border border-line-hair px-3 py-2 text-xs text-ink-secondary hover:border-line-grid disabled:cursor-not-allowed disabled:opacity-40"
            >
              {alreadySent ? "Mark as sent again" : "I have sent this by hand"}
            </button>
            <span className="text-[11px] text-ink-muted">
              {alreadySent
                ? `Last marked sent on ${alreadySent.slice(0, 10)}.`
                : "Records the chase against this tenant and this month."}
            </span>
          </div>
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
