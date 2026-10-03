"use client";

import { useState } from "react";
import {
  Template,
  saveTemplate,
  updateSettings,
  useStore,
} from "@/lib/store";
import { useSession, useToast } from "@/lib/session";
import { REVENUE_RULES } from "@/lib/revenue-rules";
import { RECIPIENT_KIND_LABEL } from "@/lib/dispatch";
import { reminderDatesFor, sane } from "@/lib/reminder-timing";
import { useReminderWindow } from "@/lib/use-reminder-window";
import {
  Card,
  CardHeader,
  Modal,
  StatusBadge,
  Tag,
} from "@/components/ui";
import { MailAccounts } from "@/components/MailAccounts";
import { GoogleClient } from "@/components/GoogleClient";

export default function SettingsPage() {
  const store = useStore();
  const { canAct } = useSession();
  const [editing, setEditing] = useState<Template | null>(null);

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------ sending behaviour */}
      {/*
        * There was a switch here, "Send reminders without asking", and it
        * never governed the scheduled run. It controlled a sender inside the
        * Reminders screen that fired on the 7th and the 21st whenever somebody
        * happened to open that page; the nine o'clock run never read it. So
        * turning it off stopped nothing that was scheduled, and the card said
        * "this switch decides which one is running", which was not so.
        *
        * That browser sender was retired on 4 October, when reminders moved
        * to each tenant's billing date: left in place it would have chased
        * people on the 7th as well as on their own date. With it gone the
        * switch controlled nothing at all, so it went too. The card now says
        * what actually decides a send.
        */}
      <Card>
        <CardHeader
          title="How reminders go out"
          hint="Who presses send."
          right={<StatusBadge kind="neutral" label="Sent by the 9am run" />}
        />

        <div className="space-y-2 px-5 py-4 text-xs leading-relaxed text-ink-secondary">
          <p>
            Every morning at nine, Singapore time, the schedule works out which
            tenants have reached their reminder date - counted from each
            tenant&rsquo;s own billing date, using the numbers below - and
            sends them the letter. Nobody needs to open a screen for it to
            happen.
          </p>
          <p>
            Officers can still send any reminder early, by hand, from the
            Reminder Emails screen. The schedule sees those letters and does
            not send the same one again for that bill.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-line-hair bg-surface-alt px-5 py-3">
          <StatusBadge kind="neutral" label="Changed at MES's request" />
          <p className="text-[11px] text-ink-muted">
            Proposal 4.5 asked for an officer to approve each email. MES asked
            for automatic sending instead. Whether letters actually leave is
            decided on the server by MAIL_MODE, which is off unless set.
          </p>
        </div>
      </Card>

      {/* --------------------------------------------- when reminders fall due */}
      <ReminderTiming />

      {/* ------------------------------------------------ classification */}
      <Card>
        <CardHeader
          title="How a charge is classified"
          hint="Read from the description on each invoice line. The first rule that matches wins."
          right={<StatusBadge kind="neutral" label="Read only" />}
        />
        <ol className="divide-y divide-line-grid">
          {REVENUE_RULES.map((rule) => (
            <li key={rule.order} className="flex gap-4 px-5 py-3">
              <span className="tabular w-6 shrink-0 pt-0.5 text-xs text-ink-muted">
                {rule.order}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink">
                    {rule.type}
                  </span>
                  {rule.exact ? <Tag>is exactly &ldquo;{rule.exact}&rdquo;</Tag> : null}
                  {rule.startsWith && !rule.keywords.length ? (
                    <Tag>or starts with &ldquo;{rule.startsWith}&rdquo;</Tag>
                  ) : null}
                  {rule.keywords.map((k) => (
                    <Tag key={k}>contains &ldquo;{k}&rdquo;</Tag>
                  ))}
                </div>
                <p className="mt-1 text-xs text-ink-secondary">{rule.means}</p>
                {rule.ordering ? (
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                    {rule.ordering}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
          <li className="flex gap-4 px-5 py-3">
            <span className="tabular w-6 shrink-0 pt-0.5 text-xs text-ink-muted">
              {REVENUE_RULES.length + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink">
                  Other Charges
                </span>
                <Tag>anything else</Tag>
              </div>
              <p className="mt-1 text-xs text-ink-secondary">
                Nothing above matched. These are listed by description after
                every upload, so a wording we have not seen before shows up
                straight away.
              </p>
            </div>
          </li>
        </ol>
        <div className="border-t border-line-hair px-5 py-3">
          <p className="text-[11px] leading-relaxed text-ink-muted">
            The order is deliberate and some rules only work because of where
            they sit. Occupancy Fee alone is most of the money owed, so these
            are changed in code and checked against every description MES has
            sent before they can be released, rather than being editable here.
          </p>
        </div>
      </Card>

      {/* ------------------------------------------------ internal recipients */}
      <Card>
        <CardHeader
          title="Who reports can be emailed to"
          hint="The people the Reports screen offers in its dropdown. MES have never sent an address for anybody internal, so these start empty rather than guessed."
        />
        <ul className="divide-y divide-line-grid">
          {store.settings.recipients.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink">{r.name}</p>
                <p className="text-xs text-ink-muted">
                  {RECIPIENT_KIND_LABEL[r.kind]}
                </p>
              </div>
              <label className="min-w-0 flex-1">
                <span className="sr-only">Email address for {r.name}</span>
                <input
                  type="email"
                  value={r.email ?? ""}
                  placeholder="no address yet"
                  disabled={!canAct}
                  onChange={(e) => {
                    const email = e.target.value.trim() || null;
                    updateSettings({
                      recipients: store.settings.recipients.map((x) =>
                        x.id === r.id ? { ...x, email } : x,
                      ),
                    });
                  }}
                  className="w-full rounded border border-line-hair bg-surface px-3 py-1.5 text-sm text-ink disabled:opacity-50"
                />
              </label>
              <StatusBadge
                kind={r.email ? "good" : "warning"}
                label={r.email ? "Can be sent to" : "Cannot be sent to"}
              />
            </li>
          ))}
        </ul>
      </Card>

      {/* Above the mailbox panel, because nobody can connect one until this
          is done, and a screen that offers a button that cannot work reads as
          broken rather than unfinished. */}
      <GoogleClient />

      {/* --------------------------------------------------------- mailbox */}
      {/* Placed above the wording on purpose. Which mailbox a letter comes
          from decides whether it arrives at all; the words in it only matter
          once it does. */}
      <MailAccounts />

      {/* ---------------------------------------------------------- wording */}
      <Card>
        <CardHeader
          title="Standard email wording"
          hint="Words in double braces are filled in for each tenant."
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
      </Card>

      {editing ? (
        <TemplateEditor template={editing} onClose={() => setEditing(null)} />
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
              "{{today}}",
              "{{dueBy}}",
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

/**
 * How many days after a tenant's own billing date each reminder goes.
 *
 * Reminders used to go on the 7th and the 21st, which quietly assumed every
 * tenant was billed on the same day of the month. MES's August export carries
 * twenty-eight different billing dates, so for most tenants those two days
 * meant nothing in particular.
 *
 * Saved to the database, and read from there by the nine o'clock run. The
 * first version of this card kept the numbers in the browser: changing them
 * moved the dates on screen, on one machine, and changed nothing that was
 * sent. A Save button rather than saving as you type, because every save is
 * an audit entry and typing 37 should not record a 3 on the way.
 *
 * The worked example does the arithmetic out loud so the 27-or-37 question is
 * settled by looking: against MES billing on the 15th, +23 lands on the 7th
 * and +37 on the 21st, the two days they send on today.
 */
function ReminderTiming() {
  const { notify } = useToast();
  const { can } = useSession();
  const mayEdit = can("edit-settings");
  const held = useReminderWindow();

  const [first, setFirst] = useState("");
  const [final, setFinal] = useState("");
  const [saving, setSaving] = useState(false);

  /* The inputs start from whatever the server holds, once it has answered. */
  const loaded = held.source !== "loading";
  const shownFirst = first === "" && loaded ? String(held.window.first) : first;
  const shownFinal = final === "" && loaded ? String(held.window.final) : final;

  const draft = { first: Number(shownFirst), final: Number(shownFinal) };
  const valid =
    Number.isFinite(draft.first) && Number.isFinite(draft.final) &&
    draft.first >= 0 && draft.final >= 0 && shownFirst !== "" && shownFinal !== "";
  const backwards = valid && draft.final < draft.first;
  const changed =
    valid && (draft.first !== held.window.first || draft.final !== held.window.final);

  /* The example follows what is typed, so the effect is visible before saving. */
  const example = valid ? reminderDatesFor("2026-08-15", sane(draft)) : null;
  const nice = (iso: string) =>
    new Date(iso).toLocaleDateString("en-SG", { day: "numeric", month: "long" });

  async function save() {
    setSaving(true);
    const r = await held.save(draft);
    setSaving(false);
    if (!r.ok) {
      notify("Not saved", r.error);
      return;
    }
    setFirst("");
    setFinal("");
    notify(
      "Reminder timing saved",
      `First reminder ${draft.first} days after billing, final notice ${draft.final}. The next nine o'clock run uses these.`,
    );
  }

  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
  ) => (
    <label className="block">
      <span className="block text-xs font-medium text-ink-secondary">{label}</span>
      <span className="mt-1 flex items-center gap-2">
        <input
          type="number"
          min={0}
          value={value}
          disabled={!mayEdit || !loaded}
          onChange={(e) => set(e.target.value)}
          className="w-20 rounded border border-line-hair bg-surface px-2.5 py-1.5 text-sm text-ink disabled:opacity-50"
        />
        <span className="text-xs text-ink-muted">days after billing</span>
      </span>
    </label>
  );

  return (
    <Card>
      <CardHeader
        title="When reminders go out"
        hint="Counted from each tenant's own billing date, the Date column of the uploaded report."
        right={
          <StatusBadge
            kind={held.source === "database" ? "good" : "warning"}
            label={
              held.source === "loading"
                ? "Reading"
                : held.source === "database"
                  ? "Used by the 9am run"
                  : "Built-in default"
            }
          />
        }
      />

      <div className="flex flex-wrap items-end gap-6 px-5 py-4">
        {field("First reminder", shownFirst, setFirst)}
        {field("Final notice", shownFinal, setFinal)}
        {mayEdit ? (
          <button
            type="button"
            disabled={!changed || backwards || saving}
            onClick={() => void save()}
            className="rounded border border-accent bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Saving" : "Save"}
          </button>
        ) : (
          <span className="text-[11px] text-ink-muted">Only an admin can change these.</span>
        )}
      </div>

      {backwards ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-line-hair px-5 py-3">
          <StatusBadge kind="critical" label="Cannot save" />
          <p className="text-[11px] text-ink-muted">
            The final notice is set before the first reminder. It has to come
            after it.
          </p>
        </div>
      ) : null}

      {example ? (
        <div className="border-t border-line-hair bg-surface-alt px-5 py-3">
          <p className="text-[11px] leading-relaxed text-ink-secondary">
            A tenant billed on <b className="text-ink">15 August</b> would be
            sent the first reminder on{" "}
            <b className="text-ink">{nice(example.first)}</b> and the final
            notice on <b className="text-ink">{nice(example.final)}</b>.
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
            MES send on the 7th and the 21st today, which from a 15th billing
            date is 23 and 37 days. 27 days would be the 11th.
          </p>
        </div>
      ) : null}

      {held.source === "default" && loaded ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-line-hair px-5 py-3">
          <StatusBadge kind="warning" label="Not stored yet" />
          <p className="text-[11px] text-ink-muted">
            {held.error
              ? `Could not read the setting: ${held.error}`
              : "The database holds no setting, so the run uses 23 and 27. If saving fails, 0022_reminder_window.sql has not been applied."}
          </p>
        </div>
      ) : null}
    </Card>
  );
}
