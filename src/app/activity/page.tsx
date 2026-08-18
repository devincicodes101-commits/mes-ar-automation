"use client";

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
export default function ActivityPage() {
  const store = useStore();
  const { canAct } = useSession();

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Everything that has been done"
          hint="Every email, call, promise, fee and export, with who and when."
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

        {store.audit.length === 0 ? (
          <EmptyState
            title="Nothing recorded yet"
            body="Send a reminder or log a call, and it will appear here immediately."
          />
        ) : (
          <ul className="divide-y divide-line-grid">
            {store.audit.map((a) => (
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
