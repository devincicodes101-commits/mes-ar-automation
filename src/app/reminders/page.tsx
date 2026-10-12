"use client";

import { useReminderWindow } from "@/lib/use-reminder-window";
import { exactOverdue, sumExact } from "@/lib/money";
import { useMemo, useState } from "react";
import {
  formatSgd,
  overdueTotal,
} from "@/lib/data";
import { Account, type QueueItem } from "@/lib/types";
import {
  Template,
  deliveredOnly,
  hydrateActivity,
  useStore,
} from "@/lib/store";
import { sendLetters, describe, type Outgoing } from "@/lib/send-letters";
import { useSession, useToast } from "@/lib/session";
import { useDataset, withManualEmails } from "@/lib/dataset";
import { currentPeriod, inSingapore } from "@/lib/schedule";
import { linesByAccount, lettersToWrite, remindersDueOn, type SentLetter } from "@/lib/reminder-timing";
import { LetterView } from "@/components/LetterView";
import {
  DEADLINE_DAYS,
  LETTER_DATE_FORMAT,
  addDays,
  fillLetter,
  type LetterId,
} from "@/lib/letters";
import {
  Card,
  CardHeader,
  EmptyState,
  Modal,
  StatusBadge,
  Tag,
} from "@/components/ui";
import { MailboxStrip } from "@/components/MailAccounts";

/**
 * Fills the {{placeholders}} in a template from one account.
 *
 * Two things here used to be wrong, and both showed up in the letter a tenant
 * would actually receive.
 *
 * The date was `new Date()`. Every other figure on every other screen is keyed
 * off the date inside the uploaded AR report, because MES's Flow tab opens
 * with "Pivot: AR Report Date". A letter quoting a balance as at 17 August and
 * dating itself today is quoting a figure it does not carry the date for.
 *
 * The deadline was six days for both letters. MES's own samples give six on
 * the first reminder and seven on the final notice, and the wording sits next
 * to a threat to disrupt services, so a day short is not a rounding matter.
 *
 * Both now come from letters.ts, which is also where the wording itself lives,
 * so the preview on this screen and the letter a simulation renders cannot
 * drift apart again.
 */
function merge(
  text: string,
  a: Account,
  asOf: string,
  templateId: string,
): string {
  const id: LetterId | null =
    templateId === "reminder-7th"
      ? "first-reminder"
      : templateId === "final-21st"
        ? "final-notice"
        : null;

  // Templates that answer something rather than going out on a fixed day (the
  // promise confirmation, the 1FM note) have no sample from MES, so they take
  // the first reminder's spacing and its long date form.
  const fmt = LETTER_DATE_FORMAT[id ?? "first-reminder"];
  const days = DEADLINE_DAYS[id ?? "first-reminder"];

  return fillLetter(text, {
    company: a.companyName,
    code: a.customerCode,
    property: a.propertyName,
    amount: a.total,
    overdue: overdueTotal(a),
    today: fmt.today(asOf),
    dueBy: fmt.dueBy(addDays(asOf, days)),
  });
}

/**
 * One letter, built once.
 *
 * The three places that send used to each merge the wording themselves, which
 * is three chances for the automatic run on the 7th to say something slightly
 * different from the one an officer reads on screen before approving it.
 */
function letterFor(account: Account, template: Template, asOf: string): Outgoing {
  return {
    tenantId: account.id,
    companyName: account.companyName,
    to: account.emails,
    subject: merge(template.subject, account, asOf, template.id),
    body: merge(template.body, account, asOf, template.id),
    templateId: template.id,
    templateName: template.name,
    /* Which month's letter this is — from the calendar, not from asOf. The
       7th's reminder is November's reminder because it is November. */
    period: currentPeriod(),
  };
}

export default function RemindersPage() {
  const store = useStore();
  const { scope, canAct } = useSession();
  const { notify } = useToast();
  /* When the 9am run sends each wording, for the text on this screen. */
  const timing = useReminderWindow();
  const ds = withManualEmails(useDataset(), store.manualEmails);
  const [templateId, setTemplateId] = useState("reminder-7th");
  const [drafting, setDrafting] = useState<Account | null>(null);
  // Which sent letter is open. The Sent list below is the only place an
  // officer can see what actually went out to a tenant.
  const [opened, setOpened] = useState<string | null>(null);

  const template =
    store.templates.find((t) => t.id === templateId) ?? store.templates[0];

  /*
   * Who is due which letter today - decided exactly as the 9am run decides it.
   *
   * This screen used to list everyone more than 15 days past due, which was
   * the right group while letters went out on the 7th and the 21st. The run
   * now counts from each tenant's own billing date, so on MES's September file
   * the screen said 150 first reminders while the run wrote 242: two rules for
   * one question. Same functions, same window, same "really sent since this
   * bill" memory, same promise hold as src/app/api/cron/route.ts.
   */
  const todayIso = inSingapore().iso;
  const plan = useMemo(() => {
    const owing = scope(ds.accounts).filter((a) => a.total > 0);
    const due = remindersDueOn(owing, linesByAccount(owing, ds.invoices), todayIso, timing.window);
    const sent: SentLetter[] = store.emails
      .filter((e) => !e.simulated && (e.templateId === "reminder-7th" || e.templateId === "final-21st"))
      .map((e) => ({
        tenantId: e.accountId,
        stage: e.templateId === "final-21st" ? ("final-notice" as const) : ("first-reminder" as const),
        sentAt: e.at,
      }));
    const decided = lettersToWrite(due, sent, todayIso, timing.window);
    const promised = new Set(
      store.promises.filter((pr) => pr.promisedFor >= todayIso).map((pr) => pr.accountId),
    );
    const byId = new Map(owing.map((a) => [a.id, a]));
    const item = (a: Account): QueueItem => ({ account: a, reasons: [], priority: 0, overdue: overdueTotal(a) });
    const first: QueueItem[] = [];
    const final: QueueItem[] = [];
    const noEmail: QueueItem[] = [];
    for (const l of decided.write) {
      const a = byId.get(l.accountId);
      if (!a || promised.has(a.id)) continue;
      if (!a.hasContact) noEmail.push(item(a));
      else (l.stage === "final-notice" ? final : first).push(item(a));
    }
    const byOverdue = (x: QueueItem, y: QueueItem) => y.overdue - x.overdue;
    return { first: first.sort(byOverdue), final: final.sort(byOverdue), noEmail: noEmail.sort(byOverdue) };
  }, [ds, scope, store.emails, store.promises, timing.window, todayIso]);


  /**
   * Automatic sending, which MES asked for and confirmed through DeVinci.
   *
   * On the 7th and the 21st the batch goes out on its own. Nobody reads it
   * first: that is the point of the request, and it overrides the review step
   * in proposal 4.5, so the screen states which mode it is in.
   *
   * Two guards that are not optional. It only ever fires for the wording due
   * today, and only for tenants who have not already had that wording, so a
   * page refresh cannot send a second copy. A tenant with no email address is
   * skipped and stays on the call list rather than being counted as chased.
   *
   * This runs in the browser because there is no scheduler yet. When the
   * backend exists this same decision moves there and the screen only reports
   * what it did. Nothing about the rules changes.
   */
  /*
   * Retired on 4 October.
   *
   * A sender lived here: on the 7th or the 21st, whenever anybody opened this
   * screen with automatic sending on, the browser sent the whole batch. It was
   * written "because there is no scheduler yet", and said that when one
   * existed the decision would move there. It exists - the nine o'clock run -
   * and reminders are now counted from each tenant's billing date. Left here,
   * this would have chased a tenant on the 7th as well as on their own date,
   * and how often depended on who happened to open which page.
   *
   * The screen still sends: an officer can send any group, or any one letter,
   * by hand. Those go through /api/send with the same template ids, and the
   * schedule counts them, so it does not send the same letter again for that
   * bill.
   */

  /*
   * One view at a time, instead of the whole month stacked down the page.
   *
   * This screen printed every stage at once - who is due a first reminder,
   * who cannot be emailed, and everything already sent - and the client read
   * that as the system explaining its own workflow at them rather than
   * showing them today's work. Same content, one part at a time, chosen here.
   *
   * "By hand" and "Sent" were also their own entries in the left menu, which
   * made three places for one job. They are tabs now and those entries are
   * hidden; the pages still answer on their own URLs.
   */
  const [view, setView] = useState<"first" | "final" | "byhand" | "sent">("first");

  /* Finding one tenant, which is how an officer actually uses this: somebody
     rings up asking whether their reminder went out. */
  const [find, setFind] = useState("");
  const matches = (hay: (string | null | undefined)[]) => {
    const q = find.trim().toLowerCase();
    if (q === "") return true;
    return hay.some((h) => (h ?? "").toLowerCase().includes(q));
  };

  const [bulk, setBulk] = useState(false);
  /* Sending now goes over the network, so the button has to be able to say so
     and to refuse a second press while the first batch is still going. */
  const [sending, setSending] = useState(false);
  const cannotEmail = plan.noEmail.filter((q) =>
    matches([q.account.companyName, q.account.customerCode]),
  );

  const pending = (view === "final" ? plan.final : plan.first).filter((q) =>
    matches([q.account.companyName, q.account.customerCode, ...q.account.emails]),
  );

  /* Tab counts, from the same plan the lists use, so a number on a tab and
     the list behind it can never disagree - and neither can disagree with
     what the 9am run will write. */
  const pendingFirst = plan.first.length;
  const pendingFinal = plan.final.length;

  const sentShown = store.emails.filter((e) =>
    matches([e.companyName, e.subject, e.templateName]),
  );

  return (
    <div className="space-y-5">
      {/* Where somebody first notices nothing has gone out, so the answer
          and the button are here rather than a screen away. */}
      <MailboxStrip />

      {/* The four tiles that were here said the same four numbers the tabs
          below now carry, one row apart - ready to send, sent so far, no email
          address, and a count of wordings nobody acts on. A figure stated
          twice on one screen is a figure somebody has to reconcile. */}

      {/* One row to pick the part of the job, and one box to find a tenant. */}
      <Card className="flex flex-wrap items-center gap-3 px-5 py-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Which reminders to show">
          {([
            ["first", "First reminder", pendingFirst],
            ["final", "Final notice", pendingFinal],
            ["byhand", "By hand", cannotEmail.length],
            /* Delivered only. The list below still shows the rest, marked
               "not delivered", so a letter that did not go is findable. */
            ["sent", "Sent", deliveredOnly(store.emails).length],
          ] as const).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => {
                setView(key);
                if (key === "first") setTemplateId("reminder-7th");
                if (key === "final") setTemplateId("final-21st");
              }}
              className={
                view === key
                  ? "rounded border border-accent bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink"
                  : "rounded border border-line-hair px-3 py-1.5 text-xs text-ink-secondary hover:border-line-strong"
              }
            >
              {label}
              <span className="ml-1.5 tabular opacity-70">{count}</span>
            </button>
          ))}
        </div>

        <label className="ml-auto flex items-center gap-2">
          <span className="sr-only">Find a tenant</span>
          <input
            id="reminder-find"
            type="search"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder="Find a tenant or email address"
            className="w-60 rounded border border-line-hair bg-surface px-3 py-1.5 text-xs text-ink placeholder:text-ink-muted"
          />
        </label>
      </Card>

      {view === "first" || view === "final" ? (
      <Card>
        <CardHeader
          title="Choose the wording, then approve the batch"
          hint={`The 9am run sends the first reminder ${timing.window.first} days after each tenant's billing date and the final notice ${timing.window.final} days after it. You can send any of these early from here.`}
          right={
            <div className="flex flex-wrap items-center gap-2">
              {/* The wording follows the tab. A dropdown here as well was a
                  second way to choose the same thing, which is what made this
                  screen read as two screens stacked. */}
              {/* MES send these as one batch, not one at a time. Their
                  workflow calls the 7th and the 21st a bulk email. */}
              <button
                type="button"
                onClick={() => setBulk(true)}
                disabled={pending.length === 0 || !canAct}
                className="rounded border border-accent bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Send all {pending.length}
              </button>
            </div>
          }
        />

        <div className="border-b border-line-hair bg-surface-alt px-5 py-2.5">
          <p className="text-[11px] text-ink-muted">
            <span className="text-ink-secondary">{template.name}</span> · goes{" "}
            {view === "final" ? timing.window.final : timing.window.first} days
            after each tenant&rsquo;s billing date · {pending.length}{" "}
            {pending.length === 1 ? "tenant" : "tenants"} in this group
          </p>
        </div>

        {pending.length === 0 ? (
          <EmptyState
            title={`No tenants for the ${template.name.toLowerCase()}`}
            body={
              view === "final"
                ? "Nobody is due a final notice today. It goes once a tenant's bill is past the final-notice date and their first reminder went out long enough ago."
                : "Nobody is due a first reminder today, counted from each tenant's billing date."
            }
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
      ) : null}

      {/* A tenant with no address is not simply skipped. They are still owed
          money and still need chasing, so they are named, their balance is
          shown, and they are pointed at the phone. Listing them as bare tags
          made them read as an inconvenience rather than as work. */}
      {view === "byhand" ? (
        <Card>
          <CardHeader
            title="No email address, so phone these instead"
            hint="They stay on the call list. Add an address on Outstanding Balances and they join the next send."
            right={
              <StatusBadge
                kind="warning"
                label={`SGD ${formatSgd(
                  sumExact(cannotEmail.map((q) => q.account), exactOverdue),
                )} unreachable`}
              />
            }
          />
          <ul className="divide-y divide-line-grid">
            {cannotEmail.map((q) => (
              <li
                key={q.account.id}
                className="flex flex-wrap items-center gap-4 px-5 py-3"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-ink">
                    {q.account.companyName}
                  </span>
                  <span className="ml-2 text-[11px] text-ink-muted">
                    {q.account.customerCode} · {q.account.propertyName}
                  </span>
                </div>
                <span className="tabular shrink-0 text-xs text-ink-secondary">
                  overdue SGD {formatSgd(q.overdue)}
                </span>
                <StatusBadge kind="warning" label="Phone only" />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {view === "sent" ? (
        <Card>
          <CardHeader
            title="Sent"
            hint={
              store.emails.length > deliveredOnly(store.emails).length
                ? `${deliveredOnly(store.emails).length} delivered. The other ${store.emails.length - deliveredOnly(store.emails).length} were written but not delivered, and are marked so below.`
                : "Every one recorded with a timestamp."
            }
          />
          <ul className="divide-y divide-line-grid">
            {sentShown.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => setOpened(e.id)}
                  className="flex w-full flex-wrap gap-4 px-5 py-3 text-left hover:bg-surface-alt"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">
                      {e.companyName}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-ink-muted">
                      {e.subject}
                    </p>
                    <p className="mt-0.5 text-[11px] text-accent">
                      {e.simulated ? "Read the letter (written, not delivered)" : "Read the letter that went out"}
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-[11px] text-ink-muted">
                    <StatusBadge
                      kind={e.simulated ? "warning" : "good"}
                      label={e.simulated ? `${e.templateName} · not delivered` : e.templateName}
                    />
                    <div className="mt-1">
                      {new Date(e.at).toLocaleString("en-SG")}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {opened ? (
        (() => {
          const e = store.emails.find((x) => x.id === opened);
          if (!e) return null;
          return (
            <Modal
              wide
              title={`Sent to ${e.companyName}`}
              onClose={() => setOpened(null)}
            >
              <LetterView email={e} compact />
            </Modal>
          );
        })()
      ) : null}

      {drafting ? (
        <Draft
          account={drafting}
          template={template}
          asOf={ds.asOf}
          onClose={() => setDrafting(null)}
        />
      ) : null}

      {bulk ? (
        <Modal
          wide
          title={`Send the ${template.name.toLowerCase()} to ${pending.length} tenants`}
          onClose={() => setBulk(false)}
        >
          <p className="text-xs leading-relaxed text-ink-secondary">
            The same wording goes to everyone below, with each tenant&apos;s own
            name and balance filled in. Nothing has been sent yet.
          </p>

          <div className="mt-3 max-h-[42vh] overflow-auto rounded border border-line-hair">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-surface-alt">
                <tr className="text-left">
                  <th className="border-b border-line-grid px-3 py-2 font-medium text-ink-muted">
                    Tenant
                  </th>
                  <th className="border-b border-line-grid px-3 py-2 font-medium text-ink-muted">
                    Going to
                  </th>
                  <th className="border-b border-line-grid px-3 py-2 text-right font-medium text-ink-muted">
                    Owes
                  </th>
                </tr>
              </thead>
              <tbody>
                {pending.map((q) => (
                  <tr key={q.account.id} className="border-b border-line-grid">
                    <td className="px-3 py-1.5 text-ink">
                      {q.account.companyName}
                    </td>
                    <td className="px-3 py-1.5 text-ink-muted">
                      {q.account.emails.join(", ")}
                    </td>
                    <td className="tabular px-3 py-1.5 text-right text-ink">
                      {formatSgd(q.account.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line-hair pt-4">
            <button
              type="button"
              disabled={sending}
              onClick={async () => {
                setSending(true);
                const report = await sendLetters(
                  pending.map((q) => letterFor(q.account, template, ds.asOf)),
                );
                setSending(false);
                const said = describe(report, template.name);
                notify(said.title, said.detail);
                await hydrateActivity(true);
                /* Kept open when any were refused, so the tenants that did not
                   go are still in front of the person who pressed it. */
                if (report.sent > 0 && report.blocked + report.failed === 0) setBulk(false);
              }}
              className="rounded border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90"
            >
              {sending ? "Sending..." : `Send all ${pending.length}`}
            </button>
            <button
              type="button"
              onClick={() => setBulk(false)}
              className="rounded border border-line-hair px-4 py-2 text-sm text-ink-secondary hover:border-line-strong hover:text-ink"
            >
              Cancel
            </button>
            <p className="text-[11px] text-ink-muted">
              {pending.reduce((n, q) => n + q.account.emails.length, 0)}{" "}
              recipients in total
            </p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function Draft({
  account,
  template,
  asOf,
  onClose,
}: {
  account: Account;
  template: Template;
  /** The uploaded report's date, which is what the letter dates itself by. */
  asOf: string;
  onClose: () => void;
}) {
  const { notify } = useToast();
  const [subject, setSubject] = useState(
    merge(template.subject, account, asOf, template.id),
  );
  const [body, setBody] = useState(
    merge(template.body, account, asOf, template.id),
  );

  const [sending, setSending] = useState(false);

  /*
   * The subject and body are the ones on screen, not the template's.
   *
   * This letter can be edited before it goes, and the point of reading it is
   * being able to change it. Sending the unedited template while showing the
   * edited one would make the review step a decoration.
   */
  async function send() {
    setSending(true);
    const report = await sendLetters([
      {
        tenantId: account.id,
        companyName: account.companyName,
        to: account.emails,
        subject,
        body,
        templateId: template.id,
        templateName: template.name,
        period: currentPeriod(),
      },
    ]);
    setSending(false);

    const said = describe(report, template.name);
    notify(
      report.sent > 0 ? `${template.name} sent to ${account.companyName}` : said.title,
      report.sent > 0
        ? `${account.emails.length} recipient${account.emails.length === 1 ? "" : "s"}, accepted by the mail server`
        : said.detail,
    );
    await hydrateActivity(true);

    /* Closed only when it went. A letter that was refused leaves the window
       open with the reason on screen, rather than vanishing as though it had
       been sent. */
    if (report.sent > 0) onClose();
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
            disabled={sending}
            className="rounded border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? "Sending..." : "Send this email"}
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
