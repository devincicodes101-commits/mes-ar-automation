"use client";

import { useEffect, useMemo, useState } from "react";
import { CALL_OUTCOMES, deliveredOnly, useStore } from "@/lib/store";
import { useDataset } from "@/lib/dataset";
import { formatSgd } from "@/lib/data";
import { formatDate, formatDateTime } from "@/lib/format";
import { Card, CardHeader, EmptyState, Loading, Pagination, StatusBadge } from "@/components/ui";
import { usePaged } from "@/lib/use-paged";
import { authHeader } from "@/lib/use-letter-edits";
import { letterDelivery, runNeedsAttention, type RunLetterSummary } from "@/lib/schedule";

/**
 * Activity Log.
 *
 * MES SOP 2.2 requires every call, email and commitment to leave a verifiable
 * trace for audits and disputes. Append only: the database has no policy
 * permitting an update or a delete, for any role including CSD.
 *
 * Built from what the server holds - letters sent, calls logged, promises,
 * fees raised, each morning's 9am run, and the admin trail in audit_log -
 * rather than from this
 * browser's own notes. The browser copy was a different log on every machine
 * and empty on a new one, under a heading that called it permanent.
 */
type Kind = "reminder" | "call" | "promise" | "fee" | "schedule" | "admin";

/** One morning of the 9am run, as /api/schedule returns it. */
interface RunRow {
  ran_for: string;
  status: string;
  error: string | null;
  finished_at: string;
  summary: (RunLetterSummary & { title?: string; feesRaised?: number; heldBack?: unknown[] }) | null;
}

interface Line {
  id: string;
  at: string;
  kind: Kind;
  actor: string | null;
  text: string;
  subject: string;
}

const KINDS: { key: Kind | "all"; label: string }[] = [
  { key: "all", label: "Everything" },
  { key: "reminder", label: "Emails" },
  { key: "call", label: "Calls" },
  { key: "promise", label: "Promises" },
  { key: "fee", label: "Late fees" },
  { key: "schedule", label: "9am run" },
  { key: "admin", label: "Admin" },
];

const KIND_LABEL: Record<Kind, string> = {
  reminder: "Email",
  call: "Call",
  promise: "Promise",
  fee: "Late fee",
  schedule: "9am run",
  admin: "Admin",
};

/** What a morning did, in one line: the letters, the fees, who was held back. */
function describeRun(r: RunRow): string {
  const s = r.summary;
  const d = letterDelivery(s);
  const parts: string[] = [];
  if (d) parts.push(`${d.sent + d.sentEarlier} of ${d.written} letters sent`);
  if (s?.feesRaised) parts.push(`${s.feesRaised} late fees raised`);
  if (s?.heldBack?.length) parts.push(`${s.heldBack.length} held back`);
  const did = parts.length > 0 ? parts.join(", ") : s?.title ?? "Nothing was due";
  if (runNeedsAttention(r)) return r.error ? `${did}. ${r.error}` : `${did}. Needs attention`;
  return did;
}

const OUTCOME = Object.fromEntries(CALL_OUTCOMES.map((o) => [o.value, o.label]));

/** Lines per page. The log only grows. */
const PAGE = 50;

export default function ActivityPage() {
  const store = useStore();
  const ds = useDataset();
  const [kind, setKind] = useState<Kind | "all">("all");
  const [query, setQuery] = useState("");

  /* The 9am run's own record: one line per morning, beside what it sent. */
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await fetch("/api/schedule", { cache: "no-store", headers: await authHeader() });
        const body = (await r.json()) as { ok?: boolean; runs?: RunRow[] };
        if (live && body.ok) setRuns(body.runs ?? []);
      } catch {
        /* The rest of the log stands without it. */
      }
      if (live) setRunsLoading(false);
    })();
    return () => {
      live = false;
    };
  }, []);

  const lines = useMemo<Line[]>(() => {
    const names = new Map(ds.accounts.map((a) => [a.id, a.companyName]));
    const out: Line[] = [];
    for (const e of deliveredOnly(store.emails)) {
      out.push({
        id: `e-${e.id}`,
        at: e.at,
        kind: "reminder",
        actor: null,
        text: `${e.templateName} sent`,
        subject: e.companyName,
      });
    }
    for (const c of store.calls) {
      out.push({
        id: `c-${c.id}`,
        at: c.at,
        kind: "call",
        actor: null,
        text: `Call logged: ${OUTCOME[c.outcome] ?? c.outcome}`,
        subject: c.companyName,
      });
    }
    for (const p of store.promises) {
      out.push({
        id: `p-${p.id}`,
        at: p.createdAt,
        kind: "promise",
        actor: null,
        text: `Promised SGD ${formatSgd(p.amount)} by ${formatDate(p.promisedFor)}`,
        subject: p.companyName,
      });
    }
    for (const f of store.fees) {
      out.push({
        id: `f-${f.id}`,
        at: f.raisedAt,
        kind: "fee",
        actor: null,
        text: `Late payment fee of SGD ${formatSgd(f.amount)} raised`,
        subject: names.get(f.tenantId) ?? f.companyName ?? "Former tenant",
      });
    }
    for (const r of runs) {
      out.push({
        id: `run-${r.ran_for}`,
        at: r.finished_at,
        kind: "schedule",
        actor: null,
        text: describeRun(r),
        subject: `Morning of ${formatDate(r.ran_for)}`,
      });
    }
    /* Only the server's trail. Lines this browser wrote for itself are
       already covered by the records above, or were never saved anywhere. */
    for (const a of store.audit) {
      if (!a.id.startsWith("audit-")) continue;
      out.push({
        id: a.id,
        at: a.at,
        kind: "admin",
        actor: a.actor,
        ...plainAudit(a.action, a.subject, names),
      });
    }
    return out.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
  }, [store.emails, store.calls, store.promises, store.fees, store.audit, ds.accounts, runs]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lines
      .filter((l) => (kind === "all" ? true : l.kind === kind))
      .filter((l) =>
        q === ""
          ? true
          : l.subject.toLowerCase().includes(q) ||
            l.text.toLowerCase().includes(q) ||
            (l.actor ?? "").toLowerCase().includes(q),
      );
  }, [lines, kind, query]);
  const { shown: onPage, pager } = usePaged(shown, `${kind}|${query}`, PAGE);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Everything that has been done"
          hint={
            lines.length === shown.length
              ? `${lines.length} entries · newest first`
              : `Showing ${shown.length} of ${lines.length} entries`
          }
          right={<StatusBadge kind="good" label="Cannot be edited" />}
        />

        {lines.length > 0 ? (
          <div className="flex flex-col gap-2 border-b border-line-hair px-4 py-3 sm:px-5 lg:flex-row lg:items-center">
            <div className="flex gap-1 overflow-x-auto" role="group" aria-label="Kind of entry">
              {KINDS.map((k) => (
                <button
                  key={k.key}
                  type="button"
                  onClick={() => {
                    setKind(k.key);
                  }}
                  aria-pressed={kind === k.key}
                  className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs ${
                    kind === k.key
                      ? "bg-accent-wash font-medium text-accent-text"
                      : "text-ink-muted hover:bg-surface-alt hover:text-ink-secondary"
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
              placeholder="Find a tenant, a person or an action"
              aria-label="Find an entry"
              className="w-full rounded-md border bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted sm:text-xs lg:ml-auto lg:w-64"
            />
          </div>
        ) : null}

        {kind === "schedule" && runsLoading ? (
          <Loading label="Loading the 9am runs" />
        ) : lines.length === 0 ? (
          <EmptyState
            title="Nothing recorded yet"
            body="Emails, calls, promises and admin changes appear here as they happen."
          />
        ) : shown.length === 0 ? (
          <EmptyState
            title="Nothing matches"
            body="Try another search, or choose Everything."
          />
        ) : (
          <>
            <ul className="divide-y divide-line-grid">
              {onPage.map((l) => (
                <li
                  key={l.id}
                  className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4 sm:px-5"
                >
                  <span className="tabular shrink-0 text-[11px] text-ink-muted sm:w-44">
                    {formatDateTime(l.at)}
                  </span>
                  <span className="shrink-0 sm:w-20">
                    <span className="inline-flex rounded-full bg-surface-alt px-2 py-0.5 text-[11px] text-ink-secondary">
                      {KIND_LABEL[l.kind]}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1 text-[13px] text-ink-secondary">
                    <span className="font-medium text-ink">{l.subject}</span>
                    {" · "}
                    {l.text}
                    {l.actor ? (
                      <span className="text-ink-muted"> · by {l.actor}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            <Pagination {...pager} />
          </>
        )}
      </Card>
    </div>
  );
}

const STAGE: Record<string, string> = { "first-reminder": "first reminder", "final-notice": "final notice" };

/**
 * An admin entry in words.
 *
 * The server records actions by code ("letter.edit", "settings.reminder_window")
 * and tenants by id, which is right for a record and wrong for a screen. Said
 * here the way somebody would say it. Entries written before report names lost
 * their dashes keep them, because the log is never edited; shown with a colon.
 */
function plainAudit(action: string, subject: string, names: Map<string, string>): { text: string; subject: string } {
  const tidy = (x: string) => x.replace(/\s+—\s+/g, ": ");
  const letter = /^(first-reminder|final-notice) for (.+)$/.exec(subject);
  const who = letter ? names.get(letter[2]) ?? letter[2] : subject;
  switch (action) {
    case "letter.edit":
      return { text: `Edited the ${letter ? STAGE[letter[1]] : "letter"}`, subject: who };
    case "letter.edit.reset":
      return { text: `Put the ${letter ? STAGE[letter[1]] : "letter"} back to the standard wording`, subject: who };
    case "settings.reminder_window": {
      const m = /first (\d+) days, final (\d+) days after billing(.*)$/.exec(subject);
      return {
        /* The later choices, where the entry has them: "; each billing date; ...". */
        text: m
          ? `First reminder ${m[1]} days and final notice ${m[2]} days after billing${m[3] ? m[3].replace(/;/g, ",") : ""}`
          : tidy(subject),
        subject: "Changed the reminder timing",
      };
    }
    case "settings.report_recipients":
      return { text: `Report recipients saved, ${subject}`, subject: "Changed the report recipients" };
    case "contacts.upload":
      return { text: "Uploaded a contact list", subject: tidy(subject) };
    case "upload.override":
      return { text: "Marked an upload usable despite its checks", subject: tidy(subject) };
    case "user.create":
      return { text: "Added a login", subject: tidy(subject) };
    case "user.change":
      return { text: "Changed a login", subject: tidy(subject) };
    case "user.off":
      return { text: "Switched a login off", subject: tidy(subject) };
    case "user.on":
      return { text: "Switched a login back on", subject: tidy(subject) };
    default:
      return { text: tidy(action), subject: tidy(subject) };
  }
}
