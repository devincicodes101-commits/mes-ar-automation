"use client";

import { useState } from "react";
import {
  Template,
  saveTemplate,
  updateSettings,
  useStore,
} from "@/lib/store";
import { useSession, useToast } from "@/lib/session";
import {
  Card,
  CardHeader,
  Modal,
  StatusBadge,
  Tag,
} from "@/components/ui";

export default function SettingsPage() {
  const store = useStore();
  const { canAct } = useSession();
  const { notify } = useToast();
  const [editing, setEditing] = useState<Template | null>(null);
  const [confirming, setConfirming] = useState(false);

  const auto = store.settings.autoSendReminders;

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------ sending behaviour */}
      <Card>
        <CardHeader
          title="How reminders go out"
          hint="Whether an officer approves each email before it is sent, or the system sends them on the trigger date without asking."
          right={
            <StatusBadge
              kind={auto ? "critical" : "good"}
              label={auto ? "Sending automatically" : "Officer approves each one"}
            />
          }
        />

        <div className="flex flex-wrap items-start gap-4 px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">
              Send reminders without asking
            </p>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-secondary">
              When this is off, the officer reads every email and presses send.
              When it is on, the system sends them on the 7th and the 21st on
              its own, and the officer only sees them afterwards in the activity
              log.
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={auto}
            disabled={!canAct}
            onClick={() => {
              if (!auto) {
                setConfirming(true);
                return;
              }
              updateSettings({ autoSendReminders: false });
              notify("Automatic sending turned off", "Officers approve each email again.");
            }}
            className={`shrink-0 rounded border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
              auto
                ? "border-line-strong text-ink hover:bg-surface-alt"
                : "border-accent bg-accent text-accent-ink hover:opacity-90"
            }`}
          >
            {auto ? "Turn off automatic sending" : "Turn on automatic sending"}
          </button>
        </div>

        {/*
          The proposal is explicit about this, in two places, and one of them is
          a highlighted callout in the deck MES was sent. Anyone switching it on
          should see that rather than discover it later.
        */}
        <div className="border-t border-line-hair bg-surface-alt px-5 py-3.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
            <div className="shrink-0">
              <StatusBadge kind="warning" label="Check this with MES" />
            </div>
            <div className="text-[11px] leading-relaxed text-ink-muted">
              <p>
                The proposal says the opposite. Section 4.5 requires a review
                step before anything goes out, and the requirement deck states
                it as a rule of its own: every reminder is drafted, previewed
                and approved by the CSD officer before anything is sent.
              </p>
              <p className="mt-1.5">
                Turning this on overrides what MES agreed to. It is worth
                confirming with them before it is used on real tenants, since
                the point of the review step is that nobody is chased in error.
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* ---------------------------------------------------------- wording */}
      <Card>
        <CardHeader
          title="Standard email wording"
          hint="Change any of these yourself and save. You do not need a developer. The words in double braces are filled in automatically for each tenant."
        />
        <ul className="divide-y divide-line-grid">
          {store.templates.map((t) => (
            <li key={t.id} className="flex flex-wrap gap-4 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{t.name}</span>
                  <Tag>{t.trigger}</Tag>
                </div>
                <p className="mt-1 truncate text-xs text-ink-secondary">
                  {t.subject}
                </p>
              </div>
              <button
                type="button"
                disabled={!canAct}
                onClick={() => setEditing(t)}
                className="shrink-0 self-start rounded border border-line-hair px-3 py-1.5 text-xs text-ink hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-40"
              >
                Edit wording
              </button>
            </li>
          ))}
        </ul>
        <div className="border-t border-line-hair bg-surface-alt px-5 py-3">
          <p className="text-[11px] leading-relaxed text-ink-muted">
            These are our drafts. MES has been asked for the wording the team
            uses today, and we will replace them once it arrives.
          </p>
        </div>
      </Card>

      {editing ? (
        <TemplateEditor template={editing} onClose={() => setEditing(null)} />
      ) : null}

      {confirming ? (
        <Modal title="Turn on automatic sending?" onClose={() => setConfirming(false)}>
          <p className="text-xs leading-relaxed text-ink-secondary">
            Reminders will go out on the 7th and the 21st without anyone reading
            them first. Any tenant with an email address on file and a balance
            past 30 days will be emailed.
          </p>
          <p className="mt-3 text-xs leading-relaxed text-ink-secondary">
            This overrides the review step in section 4.5 of the proposal, and
            the human in the loop rule MES was shown. Worth confirming with them
            first.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line-hair pt-4">
            <button
              type="button"
              onClick={() => {
                updateSettings({ autoSendReminders: true });
                notify(
                  "Automatic sending turned on",
                  "Reminders will go out without approval.",
                );
                setConfirming(false);
              }}
              className="rounded border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90"
            >
              Turn it on
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded border border-line-hair px-4 py-2 text-sm text-ink-secondary hover:border-line-strong hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function TemplateEditor({
  template,
  onClose,
}: {
  template: Template;
  onClose: () => void;
}) {
  const { notify } = useToast();
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);

  return (
    <Modal wide title={`Edit: ${template.name}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded border border-line-hair bg-surface-alt px-3 py-2.5">
          <p className="text-[11px] font-medium text-ink-secondary">
            These get replaced automatically for each tenant
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {[
              "{{company}}",
              "{{code}}",
              "{{property}}",
              "{{amount}}",
              "{{overdue}}",
            ].map((v) => (
              <Tag key={v}>{v}</Tag>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-secondary">
            Subject line
          </span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded border border-line-hair bg-surface px-3 py-2 text-sm text-ink"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-secondary">
            Message
          </span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={14}
            className="w-full rounded border border-line-hair bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-ink"
          />
        </label>

        <div className="flex items-center gap-2 border-t border-line-hair pt-4">
          <button
            type="button"
            onClick={() => {
              saveTemplate({ ...template, subject, body });
              notify(`${template.name} saved`);
              onClose();
            }}
            className="rounded border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90"
          >
            Save wording
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
