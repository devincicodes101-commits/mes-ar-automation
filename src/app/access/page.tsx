"use client";

import { PERMISSIONS, ROLE_SEES } from "@/lib/users";
import { Card, CardHeader, StatusBadge } from "@/components/ui";

/**
 * Access Control.
 *
 * A plain reading of the row level security policies in
 * supabase/migrations/0002_security.sql. This screen enforces nothing. The
 * database does. It exists so MES can see the rules without reading SQL, and
 * so anyone changing them has a checklist to change them against.
 */
export default function AccessPage() {
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="What each role is allowed to do"
          hint="These rules live in the database. Nobody can get around them by editing the web address, calling the interface directly or opening the browser console, because the database itself refuses to return the rows."
        />

        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line-grid text-left">
                <th className="px-5 py-2.5 text-xs font-medium text-ink-muted">
                  Can they
                </th>
                {["CSD", "Relationship Manager", "Management"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2.5 text-center text-xs font-medium text-ink-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map((p) => (
                <tr key={p.label} className="border-b border-line-grid">
                  <td className="px-5 py-3">
                    <div className="text-ink">{p.label}</div>
                    {p.note ? (
                      <div className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">
                        {p.note}
                      </div>
                    ) : null}
                  </td>
                  {[p.csd, p.rm, p.management].map((allowed, i) => (
                    <td key={i} className="px-4 py-3 text-center">
                      <span
                        className="text-xs"
                        style={{
                          color: allowed
                            ? "var(--status-good)"
                            : "var(--text-muted)",
                        }}
                      >
                        {allowed ? "Yes" : "No"}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {(["CSD", "RM", "Management"] as const).map((r) => (
          <Card key={r} className="px-5 py-4">
            <h3 className="text-sm font-semibold text-ink">
              {r === "RM" ? "Relationship Manager" : r}
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">
              {ROLE_SEES[r]}
            </p>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="How the data is protected" />
        <ul className="divide-y divide-line-grid">
          {[
            "Every table refuses access by default. A table with no matching rule returns nothing rather than everything, so a mistake fails closed.",
            "A relationship manager can only read rows belonging to their own tenants, checked by the database on every single query.",
            "Tenant email addresses are personal data under the PDPA and are withheld from relationship managers.",
            "Passwords are never stored by us. Signing in is handled by Supabase.",
            "Sensitive fields are encrypted at rest.",
            "The activity log can be added to but never changed or deleted, by anyone, including CSD.",
            "Tenant data stays inside MES control. Nothing is sent to NetSuite or the bank automatically.",
          ].map((line) => (
            <li
              key={line}
              className="px-5 py-2.5 text-xs leading-relaxed text-ink-secondary"
            >
              {line}
            </li>
          ))}
        </ul>
        <div className="border-t border-line-hair bg-surface-alt px-5 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge kind="good" label="Verified" />
            <p className="text-[11px] leading-relaxed text-ink-muted">
              An automated test signs in as each role and confirms what the
              database actually hands back, rather than taking the screen at its
              word.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
