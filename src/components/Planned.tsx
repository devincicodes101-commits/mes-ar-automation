import { Card, CardHeader, StatusBadge } from "./ui";

/**
 * Placeholder for a module that is specified but not yet built in this
 * prototype pass. It states what the screen will do and what it is waiting on,
 * so a dead link never reads as an unfinished build during the sign-off demo.
 */
export function Planned({
  title,
  purpose,
  contents,
  blockedOn,
}: {
  title: string;
  purpose: string;
  contents: string[];
  blockedOn?: string;
}) {
  return (
    <div className="space-y-6">
      <div className="mb-1 flex items-baseline justify-between">
        <h1 className="text-base font-semibold text-ink">{title}</h1>
        <StatusBadge kind="neutral" label="Next prototype pass" />
      </div>

      <Card>
        <CardHeader title="What this screen does" hint={purpose} />
        <ul className="divide-y divide-line-grid">
          {contents.map((c) => (
            <li
              key={c}
              className="px-5 py-2.5 text-xs leading-relaxed text-ink-secondary"
            >
              {c}
            </li>
          ))}
        </ul>
        {blockedOn ? (
          <div className="border-t border-line-hair px-5 py-3.5">
            <div className="flex items-start gap-3">
              <StatusBadge kind="warning" label="Waiting on MES" />
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
