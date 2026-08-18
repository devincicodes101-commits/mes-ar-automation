"use client";

import { useMemo, useState } from "react";
import {
  buildQueue,
  formatSgd,
  overdueTotal,
} from "@/lib/data";
import { Account } from "@/lib/types";
import { Template, recordEmail, useStore } from "@/lib/store";
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

/** Fills the {{placeholders}} in a template from one account. */
function merge(text: string, a: Account): string {
  return text
    .replaceAll("{{company}}", a.companyName)
    .replaceAll("{{code}}", a.customerCode)
    .replaceAll("{{property}}", a.propertyName)
    .replaceAll("{{amount}}", formatSgd(a.total))
    .replaceAll("{{overdue}}", formatSgd(overdueTotal(a)));
}

export default function RemindersPage() {
  const store = useStore();
  const { scope, canAct } = useSession();
  const ds = withManualEmails(useDataset(), store.manualEmails);
  const [templateId, setTemplateId] = useState("reminder-7th");
  const [drafting, setDrafting] = useState<Account | null>(null);

  const template =
    store.templates.find((t) => t.id === templateId) ?? store.templates[0];

  const queue = useMemo(() => buildQueue(scope(ds.accounts)), [ds, scope]);
  const sentIds = new Set(
    store.emails.filter((e) => e.templateId === templateId).map((e) => e.accountId),
  );

  /**
   * Each wording goes to a different set of tenants. Without this the list was
   * identical for every template and the dropdown looked broken.
   *
   * MES SOP 2.1 asks for reminders grouped by GIRO status and portfolio, which
   * is what this is: the audience follows the tenant's profile.
   */
  const audience = useMemo(() => {
    const gotFirst = new Set(
      store.emails
        .filter((e) => e.templateId === "reminder-7th")
        .map((e) => e.accountId),
    );

    switch (templateId) {
      case "final-21st":
        return {
          list: queue.filter(
            (q) => q.account.hasContact && gotFirst.has(q.account.id),
          ),
          empty:
            "The final notice goes to tenants who already had a first reminder. Send some, and they appear here.",
        };

      case "giro-setup":
        return {
          list: [],
          empty:
            "For tenants who never signed the GIRO form. The bank report needs to be readable before we can tell who they are.",
        };

      case "onefm":
        return {
          list: queue.filter((q) => q.account.isOneFm && q.account.hasContact),
          empty:
            "Tenants with 1FM charges have no email address on file. Phone them instead.",
        };

      default:
        return {
          list: queue.filter((q) => q.account.hasContact),
          empty:
            "Everyone who can be emailed has had this one.",
        };
    }
  }, [templateId, queue, store.emails]);

  const cannotEmail = queue.filter((q) => !q.account.hasContact);
  const pending = audience.list.filter((q) => !sentIds.has(q.account.id));

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Ready to send"
          value={String(pending.length)}
          note="You approve each one first"
          emphasis
        />
        <StatTile
          label="Sent so far"
          value={String(store.emails.length)}
          note="All recorded in the activity log"
        />
        <StatTile
          label="Blocked, no email"
          value={String(cannotEmail.length)}
          note="Waiting on the contact list from MES"
        />
        <StatTile
          label="Wording templates"
          value={String(store.templates.length)}
          note="Editable in Settings"
        />
      </div>

      <Card>
        <CardHeader
          title="Choose the wording, then approve each email"
          hint={
            store.settings.autoSendReminders
              ? "Automatic sending is on. These go out on the trigger date. You can still send one early."
              : "Nothing is sent automatically. You read every email and press send yourself."
          }
          right={
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="rounded border border-line-hair bg-surface px-2.5 py-1.5 text-xs text-ink-secondary"
            >
              {store.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          }
        />

        {store.settings.autoSendReminders ? (
          <div className="flex flex-wrap items-center gap-3 border-b border-line-hair bg-surface-alt px-5 py-2.5">
            <StatusBadge kind="critical" label="Sending automatically" />
            <p className="text-[11px] text-ink-muted">
              Turned on in Settings.
            </p>
          </div>
        ) : null}

        <div className="border-b border-line-hair bg-surface-alt px-5 py-2.5">
          <p className="text-[11px] text-ink-muted">
            <span className="text-ink-secondary">{template.name}</span> · sent on
            the {template.trigger} · {pending.length}{" "}
            {pending.length === 1 ? "tenant" : "tenants"} in this group
          </p>
        </div>

        {pending.length === 0 ? (
          <EmptyState
            title={`No tenants for the ${template.name.toLowerCase()}`}
            body={audience.empty}
          />
        ) : (
          <ul className="divide-y divide-line-grid">
            {pending.map((item) => (
              <li
                key={item.account.id}
                className="flex flex-wrap items-center gap-4 px-5 py-3.5 hover:bg-surface-alt"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">
                      {item.account.companyName}
                    </span>
                    {item.account.isOneFm ? <Tag>1FM</Tag> : null}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-ink-muted">
                    {item.account.emails.join(", ")}
                  </p>
                </div>
                <div className="tabular shrink-0 text-right text-xs text-ink-secondary">
                  SGD {formatSgd(item.overdue)} overdue
                </div>
                {canAct ? (
                  <button
                    type="button"
                    onClick={() => setDrafting(item.account)}
                    className="shrink-0 rounded border border-line-hair px-3 py-1.5 text-xs text-ink hover:border-line-strong"
                  >
                    Read and send
                  </button>
                ) : (
                  <span className="shrink-0 text-[11px] text-ink-muted">
                    View only
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {cannotEmail.length > 0 ? (
        <Card>
          <CardHeader
            title="Cannot email these tenants yet"
            hint="No email address on file."
          />
          <div className="flex flex-wrap gap-2 px-5 py-4">
            {cannotEmail.slice(0, 24).map((q) => (
              <Tag key={q.account.id}>{q.account.companyName}</Tag>
            ))}
            {cannotEmail.length > 24 ? (
              <span className="text-[11px] text-ink-muted">
                and {cannotEmail.length - 24} more
              </span>
            ) : null}
          </div>
        </Card>
      ) : null}

      {store.emails.length > 0 ? (
        <Card>
          <CardHeader title="Sent" hint="Every one recorded with a timestamp." />
          <ul className="divide-y divide-line-grid">
            {store.emails.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-4 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">
                    {e.companyName}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-ink-muted">
                    {e.subject}
                  </p>
                </div>
                <div className="shrink-0 text-right text-[11px] text-ink-muted">
                  <StatusBadge kind="good" label={e.templateName} />
                  <div className="mt-1">
                    {new Date(e.at).toLocaleString("en-SG")}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {drafting ? (
        <Draft
          account={drafting}
          template={template}
          onClose={() => setDrafting(null)}
        />
      ) : null}
    </div>
  );
}

function Draft({
  account,
  template,
  onClose,
}: {
  account: Account;
  template: Template;
  onClose: () => void;
}) {
  const { notify } = useToast();
  const [subject, setSubject] = useState(merge(template.subject, account));
  const [body, setBody] = useState(merge(template.body, account));

  function send() {
    recordEmail({
      accountId: account.id,
      companyName: account.companyName,
      templateId: template.id,
      templateName: template.name,
      subject,
      to: account.emails,
    });
    notify(
      `${template.name} sent to ${account.companyName}`,
      `${account.emails.length} recipient${account.emails.length === 1 ? "" : "s"}, recorded in the activity log`,
    );
    onClose();
  }

  return (
    <Modal
      wide
      title={`${template.name} to ${account.companyName}`}
      onClose={onClose}
    >
      <div className="space-y-4">
        <div className="rounded border border-line-hair bg-surface-alt px-3 py-2">
          <p className="text-[11px] text-ink-muted">To</p>
          <p className="mt-0.5 break-all text-xs text-ink">
            {account.emails.join("; ")}
          </p>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-secondary">
            Subject
          </span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded border border-line-hair bg-surface px-3 py-2 text-sm text-ink"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-secondary">
            Message, edit anything you want before sending
          </span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={14}
            className="w-full rounded border border-line-hair bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-ink"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2 border-t border-line-hair pt-4">
          <button
            type="button"
            onClick={send}
            className="rounded border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90"
          >
            Send this email
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-line-hair px-4 py-2 text-sm text-ink-secondary hover:border-line-strong hover:text-ink"
          >
            Cancel
          </button>

        </div>
      </div>
    </Modal>
  );
}
