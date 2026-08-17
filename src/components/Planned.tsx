import { Card, CardHeader, StatusBadge } from "./ui";

/**
 * Placeholder for a screen that is agreed but not built yet in this prototype
 * pass. It says plainly what the screen will do and what it is waiting for, so
 * a link never looks broken during the walkthrough with MES.
 */
export function Planned({
  purpose,
  contents,
  blockedOn,
}: {
  purpose: string;
  contents: string[];
  blockedOn?: string;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <StatusBadge kind="neutral" label="Not built yet" />
        <p className="text-xs text-ink-muted">
          Coming in the next prototype round.
        </p>
      </div>

      <Card>
        <CardHeader title="What this screen will do" hint={purpose} />
        <ul className="divide-y divide-line-grid">
          {contents.map((c) => (
            <li
              key={c}
              className="px-5 py-3 text-xs leading-relaxed text-ink-secondary"
            >
              {c}
            </li>
          ))}
        </ul>
        {blockedOn ? (
          <div className="border-t border-line-hair bg-surface-alt px-5 py-3.5">
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
              <div className="shrink-0 pt-0.5">
                <StatusBadge kind="warning" label="Waiting on MES" />
              </div>
              <p className="text-xs leading-relaxed text-ink-secondary">
                {blockedOn}
              </p>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
