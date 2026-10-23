"use client";

import {
  CAPABILITY_LABEL,
  ROLE_LABEL,
  ROLE_SUMMARY,
  can,
  type Capability,
  type Role,
} from "@/lib/auth";
import { Card, CardHeader } from "@/components/ui";

const ROLES: Role[] = ["super-admin", "admin", "CSD", "RM", "Management"];

/**
 * Access Control.
 *
 * Read straight from ROLE_CAPABILITIES, the table every screen and route asks.
 * It was a hand-written copy with three of the five roles, and it had drifted:
 * it said a relationship manager could not log a call long after they could.
 * This screen enforces nothing; the routes and the database do.
 */
export default function AccessPage() {
  const capabilities = Object.keys(CAPABILITY_LABEL) as Capability[];
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="What each role is allowed to do" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line-grid text-left">
                <th className="sticky left-0 bg-surface px-4 py-2.5 text-xs font-medium text-ink-muted sm:px-5">
                  Can they
                </th>
                {ROLES.map((r) => (
                  <th key={r} className="px-3 py-2.5 text-center text-xs font-medium text-ink-muted">
                    {ROLE_LABEL[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {capabilities.map((c) => (
                <tr key={c} className="border-b border-line-grid">
                  <td className="sticky left-0 bg-surface px-4 py-2.5 text-ink sm:px-5">{CAPABILITY_LABEL[c]}</td>
                  {ROLES.map((r) => (
                    <td key={r} className="px-3 py-2.5 text-center">
                      {can(r, c) ? (
                        <span className="text-xs font-medium text-good-ink">Yes</span>
                      ) : (
                        <span className="text-xs text-ink-muted">No</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {ROLES.map((r) => (
          <Card key={r} className="px-5 py-4">
            <h3 className="text-sm font-semibold text-ink">{ROLE_LABEL[r]}</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">{ROLE_SUMMARY[r]}</p>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="How the data is protected" />
        <ul className="divide-y divide-line-grid">
          {[
            "Every table refuses access by default, so a mistake fails closed rather than open.",
            "A relationship manager can only read their own tenants, checked on every query.",
            "Tenant email addresses are withheld from relationship managers, as personal data under the PDPA.",
            "Passwords are held by the sign-in service, never by this system.",
            "The activity log can be added to, never changed or deleted, by anyone.",
            "A login is switched off rather than deleted, so the record of who did what stays readable.",
            "Nothing is sent to NetSuite or the bank automatically.",
          ].map((line) => (
            <li key={line} className="px-5 py-2.5 text-xs leading-relaxed text-ink-secondary">
              {line}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
