"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Template,
  saveTemplate,
  useStore,
} from "@/lib/store";
import { useSession, useToast } from "@/lib/session";
import { REVENUE_RULES } from "@/lib/revenue-rules";
import { RECIPIENT_KIND_LABEL, type Recipient } from "@/lib/dispatch";
import { useRecipients } from "@/lib/use-recipients";
import { useDataset } from "@/lib/dataset";
import { reminderDatesFor, sane } from "@/lib/reminder-timing";
import { useReminderWindow } from "@/lib/use-reminder-window";
import { useRules } from "@/lib/use-rules";
import type { BusinessRules } from "@/lib/rules";
import {
  Card,
  CardHeader,
  Modal,
  Skeleton,
  StatusBadge,
  TableSkeleton,
  Tag,
} from "@/components/ui";
import { MailAccounts } from "@/components/MailAccounts";

type Tab = "mailbox" | "timing" | "fees" | "wording" | "recipients" | "charges";

export default function SettingsPage() {
  const store = useStore();
  const { window: reminderDays, source: timingSource } = useReminderWindow();
  const { canAct } = useSession();
  const [editing, setEditing] = useState<Template | null>(null);
  const [tab, setTab] = useState<Tab>("mailbox");
  /* The managers are the ones in the report, not a fixed pair. */
  const ds = useDataset();
  const { recipients, loading: recipientsLoading, setEmail } = useRecipients(
    ds.accounts.map((a) => (a as { rm?: string }).rm),
  );

  /* Google's sign-in client is set up once, by whoever runs the system. */
  const tabs: { key: Tab; label: string }[] = [
    { key: "mailbox", label: "Mailbox" },
    { key: "timing", label: "Reminder timing" },
    { key: "fees", label: "Fees and reports" },
    { key: "recipients", label: "Report recipients" },
    { key: "charges", label: "Charge types" },
  ];

  return (
    <div className="space-y-5">
      <div
        className="-mx-4 flex gap-1 overflow-x-auto px-4 shadow-[inset_0_-1px_0_var(--border)] sm:mx-0 sm:px-0"
        role="tablist"
        aria-label="Settings"
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm ${
              tab === t.key
                ? "border-accent font-medium text-accent-text"
                : "border-transparent text-ink-muted hover:text-ink-secondary"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "mailbox" ? (
        <>
          <MailAccounts />
        </>
      ) : null}


      {/* --------------------------------------------- when reminders fall due */}
      {tab === "timing" ? <ReminderTiming /> : null}
      {tab === "fees" ? <FeesAndReports /> : null}

      {/* ------------------------------------------------ classification */}
      {tab === "charges" ? (
      <Card>
        <CardHeader
          title="How a charge is classified"
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
          <p className="text-xs leading-relaxed text-ink-muted">
            To change a rule, contact the system administrator. Each change is
            checked against every charge description MES has sent before it goes
            live.
          </p>
        </div>
      </Card>
      ) : null}

      {/* ------------------------------------------------ internal recipients */}
      {tab === "recipients" ? (
      <Card>
        <CardHeader
          title="Who reports can be emailed to"
        />
        {recipientsLoading ? (
          <TableSkeleton rows={5} />
        ) : (
          <ul className="divide-y divide-line-grid">
            {recipients.map((r) => (
              <RecipientRow key={r.id} recipient={r} canEdit={canAct} onSave={setEmail} />
            ))}
          </ul>
        )}
      </Card>
      ) : null}

      {/* ---------------------------------------------------------- wording */}
      {tab === "wording" ? (
      <Card>
        <CardHeader
          title="Email wording"
          hint="The wording used when an officer sends a letter from Reminder Emails."
        />
        {/* The browser keeps this wording and the 9am run does not read it,
            so the way to change an automatic letter is said here. */}
        <div className="border-b border-line-hair bg-accent-wash px-4 py-3 text-xs leading-relaxed text-ink-secondary sm:px-5">
          The 9am run sends MES&apos;s standard letters. To change what one
          tenant&apos;s automatic letter says, press <b>Edit letter</b> beside
          them on{" "}
          <Link href="/schedule" className="font-medium text-accent-text underline underline-offset-2">
            The Schedule
          </Link>{" "}
          or Reminder Emails.
        </div>
        <ul className="divide-y divide-line-grid">
          {store.templates.map((t) => (
            <li key={t.id} className="flex flex-wrap gap-4 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{t.name}</span>
                  {/* The two reminders go out by billing date now, so their tag
                      says when in those terms. A saved template can still carry
                      "7th of the month" from before; that text is no longer true. */}
                  {timingSource === "loading" && (t.id === "reminder-7th" || t.id === "final-21st") ? (
                    <Skeleton className="h-5 w-32 rounded-md" />
                  ) : (
                    <Tag>
                      {t.id === "reminder-7th"
                        ? `${reminderDays.first} days after billing`
                        : t.id === "final-21st"
                          ? `${reminderDays.final} days after billing`
                          : t.trigger}
                    </Tag>
                  )}
                </div>
                <p className="mt-1 truncate text-xs text-ink-secondary">
                  {t.subject}
                </p>
              </div>
              <button
                type="button"
                disabled={!canAct}
                onClick={() => setEditing(t)}
                className="shrink-0 self-start rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium text-ink hover:border-accent hover:text-accent-text disabled:cursor-not-allowed disabled:opacity-40"
              >
                Edit wording
              </button>
            </li>
          ))}
        </ul>
      </Card>
      ) : null}

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
            Type these anywhere and they are filled in for each tenant
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {[
              ["{{company}}", "company name"],
              ["{{code}}", "customer code"],
              ["{{property}}", "dormitory"],
              ["{{amount}}", "amount owed"],
              ["{{overdue}}", "overdue amount"],
              ["{{today}}", "today's date"],
              ["{{dueBy}}", "pay-by date"],
            ].map(([v, means]) => (
              <span key={v} className="inline-flex items-center gap-1 rounded-full border border-line-hair bg-surface px-2 py-0.5 text-[11px]">
                <code className="text-accent-text">{v}</code>
                <span className="text-ink-muted">{means}</span>
              </span>
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
            className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
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
            className="w-full rounded-md border bg-surface px-3 py-2 text-sm leading-relaxed text-ink"
          />
        </label>

        <div className="flex items-center justify-end gap-2 border-t border-line-hair pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line-hair px-4 py-2 text-sm text-ink-secondary hover:border-line-strong hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              saveTemplate({ ...template, subject, body });
              notify(`${template.name} saved`);
              onClose();
            }}
            className="rounded-md border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
          >
            Save wording
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
  /* The three choices made on 23 October. Null or "": as stored. */
  const [countFrom, setCountFrom] = useState<"each" | "newest" | null>(null);
  const [lateDays, setLateDays] = useState("");
  const [finalWithoutFirst, setFinalWithoutFirst] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  /* The inputs start from whatever the server holds, once it has answered. */
  const loaded = held.source !== "loading";
  const shownFirst = first === "" && loaded ? String(held.window.first) : first;
  const shownFinal = final === "" && loaded ? String(held.window.final) : final;

  const shownLate = lateDays === "" && loaded ? String(held.window.lateDays) : lateDays;
  const draft = {
    first: Number(shownFirst),
    final: Number(shownFinal),
    countFrom: countFrom ?? held.window.countFrom,
    lateDays: Number(shownLate),
    finalWithoutFirst: finalWithoutFirst ?? held.window.finalWithoutFirst,
  };
  const valid =
    Number.isFinite(draft.first) && Number.isFinite(draft.final) &&
    draft.first >= 0 && draft.final >= 0 && shownFirst !== "" && shownFinal !== "" &&
    Number.isFinite(draft.lateDays) && draft.lateDays >= 0 && draft.lateDays <= 30 && shownLate !== "";
  const backwards = valid && draft.final < draft.first;
  const changed =
    valid &&
    (draft.first !== held.window.first ||
      draft.final !== held.window.final ||
      draft.countFrom !== held.window.countFrom ||
      draft.lateDays !== held.window.lateDays ||
      draft.finalWithoutFirst !== held.window.finalWithoutFirst);

  /* The example follows what is typed, so the effect is visible before saving. */
  const example = valid ? reminderDatesFor(`${new Date().getFullYear()}-08-15`, sane(draft)) : null;
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
    setCountFrom(null);
    setLateDays("");
    setFinalWithoutFirst(null);
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
          className="w-20 rounded-md border bg-surface px-2.5 py-1.5 text-sm text-ink disabled:opacity-50"
        />
        <span className="text-xs text-ink-muted">days after billing</span>
      </span>
    </label>
  );

  return (
    <Card>
      <CardHeader
        title="When reminders go out"
        right={
          loaded ? (
            <StatusBadge
              kind={held.source === "database" ? "good" : "warning"}
              label={held.source === "database" ? "Used by the 9am run" : "Built-in default"}
            />
          ) : (
            <Skeleton className="h-6 w-32 rounded-full" />
          )
        }
      />

      {/* Not blank boxes while the stored numbers are on their way: blank
          reads as "nothing is set", which is not what is happening. */}
      {!loaded ? (
        <div className="flex flex-wrap items-end gap-4 px-4 py-4 sm:gap-6 sm:px-5" role="status" aria-label="Loading">
          {[0, 1].map((i) => (
            <div key={i}>
              <Skeleton className="h-3 w-24" />
              <div className="mt-2 flex items-center gap-2">
                <Skeleton className="h-[34px] w-20 rounded-lg" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))}
          {mayEdit ? <Skeleton className="h-[38px] w-20 rounded-lg" /> : null}
        </div>
      ) : (
      <div className="flex flex-wrap items-end gap-4 px-4 py-4 sm:gap-6 sm:px-5">
        {field("First reminder", shownFirst, setFirst)}
        {field("Final notice", shownFinal, setFinal)}
        {mayEdit ? (
          <button
            type="button"
            disabled={!changed || backwards || saving}
            onClick={() => void save()}
            className="rounded-md border border-accent bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink"
          >
            {saving ? "Saving" : "Save"}
          </button>
        ) : (
          <span className="text-[11px] text-ink-muted">Only an admin can change these.</span>
        )}
      </div>
      )}

      {loaded ? (
        <div className="space-y-3 border-t border-line-hair px-4 py-4 text-xs text-ink-secondary sm:px-5">
          <label className="flex flex-wrap items-center gap-2">
            <span className="w-full font-medium sm:w-60">Count each reminder from</span>
            <select
              value={draft.countFrom}
              disabled={!mayEdit}
              onChange={(e) => setCountFrom(e.target.value as "each" | "newest")}
              className="rounded-md border bg-surface px-2.5 py-1.5 text-sm text-ink disabled:opacity-50"
            >
              <option value="each">Each billing date, for that date&apos;s total</option>
              <option value="newest">The newest bill only, for the whole balance</option>
            </select>
          </label>
          <label className="flex flex-wrap items-center gap-2">
            <span className="w-full font-medium sm:w-60">If a morning is missed, still send for</span>
            <input
              type="number"
              min={0}
              max={30}
              value={shownLate}
              disabled={!mayEdit}
              onChange={(e) => setLateDays(e.target.value)}
              className="w-20 rounded-md border bg-surface px-2.5 py-1.5 text-sm text-ink disabled:opacity-50"
            />
            <span className="text-ink-muted">days after (0: each letter on its day only)</span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={draft.finalWithoutFirst}
              disabled={!mayEdit}
              onChange={(e) => setFinalWithoutFirst(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Send the final notice even if the first reminder was not sent</span>
              <span className="block text-[11px] text-ink-muted">
                For example, a bill first seen after its first reminder day had passed.
              </span>
            </span>
          </label>
        </div>
      ) : null}

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

        </div>
      ) : null}

      {held.source === "default" && loaded ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-line-hair px-5 py-3">
          <StatusBadge kind="warning" label="Not stored yet" />
          <p className="text-[11px] text-ink-muted">
            {held.error
              ? `Could not read the setting: ${held.error}`
              : "No timing has been saved yet, so the 9am run uses the built-in default. Save to set it."}
          </p>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * The late fee, ad hoc and report-age rules, each settled with MES in October
 * and kept here so they can change them without a release. Read by the nine
 * o'clock run and the screens; saved together with one Save.
 */
function FeesAndReports() {
  const { notify } = useToast();
  const { can } = useSession();
  const mayEdit = can("edit-settings");
  const held = useRules();
  const [edit, setEdit] = useState<Partial<Record<keyof BusinessRules, string>>>({});
  const [saving, setSaving] = useState(false);

  const shown = (k: keyof BusinessRules) =>
    edit[k] ?? (held.rules[k] === null ? "" : String(held.rules[k]));
  const stopOn = (edit.stopReportAfter ?? (held.rules.stopReportAfter === null ? "" : "on")) !== "";
  const draft: BusinessRules = {
    feeDays: Number(shown("feeDays")),
    feeFrom: shown("feeFrom") === "billing" ? "billing" : "due",
    regularBillingDay: Number(shown("regularBillingDay")),
    warnReportAfter: Number(shown("warnReportAfter")),
    stopReportAfter: stopOn ? Number(shown("stopReportAfter")) : null,
  };
  const whole = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
  const valid =
    whole(draft.feeDays, 0, 365) &&
    whole(draft.regularBillingDay, 1, 31) &&
    whole(draft.warnReportAfter, 0, 365) &&
    (draft.stopReportAfter === null || whole(draft.stopReportAfter, 1, 365));
  const changed = valid && JSON.stringify(draft) !== JSON.stringify(held.rules);

  async function save() {
    setSaving(true);
    const r = await held.save(draft);
    setSaving(false);
    if (!r.ok) {
      notify("Not saved", r.error);
      return;
    }
    setEdit({});
    notify("Rules saved", "The next nine o'clock run and every screen use them.");
  }

  const num = (k: keyof BusinessRules, after: string, min = 0, max = 365) => (
    <span className="flex items-center gap-2">
      <input
        type="number"
        min={min}
        max={max}
        value={shown(k)}
        disabled={!mayEdit}
        onChange={(e) => setEdit({ ...edit, [k]: e.target.value })}
        className="w-20 rounded-md border bg-surface px-2.5 py-1.5 text-sm text-ink disabled:opacity-50"
      />
      <span className="text-ink-muted">{after}</span>
    </span>
  );
  const row = (label: string, control: React.ReactNode) => (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-full font-medium sm:w-60">{label}</span>
      {control}
    </div>
  );

  return (
    <Card>
      <CardHeader
        title="Late fees and reports"
        right={
          held.loading ? (
            <Skeleton className="h-6 w-32 rounded-full" />
          ) : (
            <StatusBadge kind="good" label="Used by the 9am run" />
          )
        }
      />
      {held.loading ? (
        <div className="space-y-3 px-5 py-4" role="status" aria-label="Loading">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[34px] w-full max-w-md rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="space-y-3 px-4 py-4 text-xs text-ink-secondary sm:px-5">
          {row(
            "Charge the $100 on bills more than",
            <span className="flex flex-wrap items-center gap-2">
              {num("feeDays", "days past their")}
              <select
                value={draft.feeFrom}
                disabled={!mayEdit}
                onChange={(e) => setEdit({ ...edit, feeFrom: e.target.value })}
                className="rounded-md border bg-surface px-2.5 py-1.5 text-sm text-ink disabled:opacity-50"
              >
                <option value="due">due date</option>
                <option value="billing">billing date</option>
              </select>
            </span>,
          )}
          {row("Regular billing day of the month", num("regularBillingDay", "other days are marked Ad hoc", 1, 31))}
          {row("Warn when the report is older than", num("warnReportAfter", "days"))}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex w-full items-center gap-2 font-medium sm:w-60">
              <input
                type="checkbox"
                checked={stopOn}
                disabled={!mayEdit}
                onChange={(e) => setEdit({ ...edit, stopReportAfter: e.target.checked ? "25" : "" })}
              />
              Stop sending when older than
            </label>
            {stopOn ? (
              num("stopReportAfter", "days: no letters and no fees until a newer report", 1)
            ) : (
              <span className="text-ink-muted">Off: the run always uses the newest report</span>
            )}
          </div>
          <div className="flex items-center gap-3 pt-1">
            {mayEdit ? (
              <button
                type="button"
                disabled={!changed || saving}
                onClick={() => void save()}
                className="rounded-md border border-accent bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink"
              >
                {saving ? "Saving" : "Save"}
              </button>
            ) : (
              <span className="text-[11px] text-ink-muted">Only an admin can change these.</span>
            )}
            {held.error ? <span className="text-[11px] text-crit-ink">{held.error}</span> : null}
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * One report recipient. The address is saved to the server when the box is
 * left, so every officer and the scheduled run see the same one.
 */
function RecipientRow({
  recipient: r,
  canEdit,
  onSave,
}: {
  recipient: Recipient;
  canEdit: boolean;
  onSave: (id: string, email: string | null) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const { notify } = useToast();
  const [draft, setDraft] = useState(r.email ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function commit() {
    const email = draft.trim() || null;
    if (email === (r.email ?? null)) return;
    if (email && !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email)) {
      setProblem("That is not an email address.");
      return;
    }
    setSaving(true);
    const done = await onSave(r.id, email);
    setSaving(false);
    if (done.ok) {
      setProblem(null);
      notify(email ? `Saved the address for ${r.name}` : `Removed the address for ${r.name}`);
    } else {
      setProblem(done.error);
      notify("Not saved", done.error);
    }
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3 sm:px-5">
      <div className="min-w-0 sm:w-56">
        <p className="text-sm text-ink">{r.name}</p>
        <p className="text-xs text-ink-muted">{RECIPIENT_KIND_LABEL[r.kind]}</p>
      </div>
      <label className="min-w-0 flex-1">
        <span className="sr-only">Email address for {r.name}</span>
        <input
          type="email"
          value={draft}
          placeholder="name@mes.com.sg"
          disabled={!canEdit || saving}
          onChange={(e) => {
            setDraft(e.target.value);
            setProblem(null);
          }}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="w-full rounded-md border bg-surface px-3 py-1.5 text-sm text-ink disabled:opacity-50"
        />
        {problem ? <span className="mt-1 block text-[11px] text-crit-ink">{problem}</span> : null}
      </label>
      <span className="self-start sm:self-auto">
        <StatusBadge kind={r.email ? "good" : "neutral"} label={saving ? "Saving" : r.email ? "Ready" : "No address"} />
      </span>
    </li>
  );
}
