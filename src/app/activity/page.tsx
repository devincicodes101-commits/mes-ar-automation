"use client";

import { useMemo, useState } from "react";
import { resetStore, useStore } from "@/lib/store";
import { useSession } from "@/lib/session";
import { Card, CardHeader, EmptyState, StatusBadge } from "@/components/ui";

/**
 * Activity Log.
 *
 * MES SOP 2.2 requires every call, email and commitment to leave a verifiable
 * trace for audits and disputes. Append only: the database has no policy
 * permitting an update or a delete, for any role including CSD.
 */
/**
 * What a line in the log is about.
 *
 * The action is free text, written where the thing happened, so this reads it
 * back rather than consulting a column that does not exist. Order matters: a
 * promise recorded from an email reply says both "promise" and "email", and
 * it is a promise.
 */
type Kind = "reminder" | "call" | "promise" | "fee" | "admin";

function kindOf(action: string): Kind {
  const a = action.toLowerCase();
  if (a.includes("promise")) return "promise";
  if (a.includes("call")) return "call";
  if (a.includes("fee")) return "fee";
  if (a.startsWith("sent the")) return "reminder";
  return "admin";
}

const KINDS: { key: Kind | "all"; label: string }[] = [
  { key: "all", label: "Everything" },
  { key: "reminder", label: "Reminders sent" },
  { key: "call", label: "Calls" },
  { key: "promise", label: "Promises" },
  { key: "fee", label: "Late fees" },
  { key: "admin", label: "Admin" },
];

export default function ActivityPage() {
  const store = useStore();
  const { canAct } = useSession();
  /*
   * The log is append-only and grows for ever, and it was presented as one
   * undivided scroll. Answering "when did we last chase Tuas Precision" meant
   * reading every line since. A box and six buttons over the same list.
   */
  const [kind, setKind] = useState<Kind | "all">("all");
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return store.audit
      .filter((a) => (kind === "all" ? true : kindOf(a.action) === kind))
      .filter((a) =>
        q === ""
          ? true
          : a.subject.toLowerCase().includes(q) ||
            a.action.toLowerCase().includes(q) ||
            a.actor.toLowerCase().includes(q),
      );
  }, [store.audit, kind, query]);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Everything that has been done"
          hint={
            store.audit.length === shown.length
              ? "Every email, call, promise, fee and export, with who and when."
              : `Showing ${shown.length} of ${store.audit.length} entries.`
          }
          right={
            store.audit.length > 0 && canAct ? (
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      "Clear all demo activity? This only affects this browser.",
                    )
                  ) {
                    resetStore();
                  }
                }}
                className="rounded border border-line-hair px-3 py-1.5 text-xs text-ink-secondary hover:border-line-strong hover:text-ink"
              >
                Clear demo data
              </button>
            ) : undefined
          }
        />

        {store.audit.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-line-hair px-5 py-2.5">
            <div className="flex flex-wrap gap-1" role="group" aria-label="Kind of entry">
              {KINDS.map((k) => (
                <button
                  key={k.key}
                  type="button"
                  onClick={() => setKind(k.key)}
                  aria-pressed={kind === k.key}
                  className={`rounded px-2.5 py-1 text-xs ${
                    kind === k.key
                      ? "bg-accent-wash font-medium text-ink"
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
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a tenant, a person or an action"
              aria-label="Find an entry"
              className="ml-auto w-60 rounded border border-line-hair bg-surface px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-muted"
            />
          </div>
        ) : null}

        {store.audit.length === 0 ? (
          <EmptyState
            title="Nothing recorded yet"
            body="Send a reminder or log a call, and it will appear here immediately."
          />
        ) : shown.length === 0 ? (
          <EmptyState
            title="Nothing matches"
            body="Try another search, or choose Everything to drop the filter."
          />
        ) : (
          <ul className="divide-y divide-line-grid">
            {shown.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-4 px-5 py-2.5">
                <span className="w-44 shrink-0 text-[11px] text-ink-muted">
                  {new Date(a.at).toLocaleString("en-SG")}
                </span>
                <span className="min-w-0 flex-1 text-xs text-ink-secondary">
                  <span className="font-medium text-ink">{a.actor}</span>{" "}
                  {a.action.toLowerCase()} for{" "}
                  <span className="text-ink">{a.subject}</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-line-hair bg-surface-alt px-5 py-3">
          <StatusBadge kind="good" label="Cannot be edited" />
          <p className="text-[11px] text-ink-muted">
            Entries are added, never changed or removed, by anyone.
          </p>
        </div>
      </Card>
    </div>
  );
}
