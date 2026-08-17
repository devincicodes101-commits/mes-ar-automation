"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";


import { MANAGERS, ROLES, Role, useSession } from "@/lib/session";
import { useDataset } from "@/lib/dataset";

/**
 * Names are written for the CSD officer who uses this daily, not for the spec.
 * Each one says what the officer does on that screen. `note` is the plain
 * English explanation shown under the page title.
 */
export const NAV: {
  href: string;
  label: string;
  group: string;
  note: string;
}[] = [
  {
    href: "/upload",
    label: "Upload Reports",
    group: "Prepare",
    note: "Bring in this month's AR report and the bank's failed GIRO list.",
  },
  {
    href: "/",
    label: "Outstanding Balances",
    group: "Prepare",
    note: "Who owes what, and how overdue it is.",
  },
  {
    href: "/failed-payments",
    label: "Failed Payments",
    group: "Prepare",
    note: "Which bank payments bounced, and where each one goes next.",
  },
  {
    href: "/collections",
    label: "Action List",
    group: "Prepare",
    note: "Who to chase today, most urgent first.",
  },
  {
    href: "/reminders",
    label: "Reminder Emails",
    group: "Chase",
    note: "Write and send the 7th reminder and the 21st final notice.",
  },
  {
    href: "/calls",
    label: "Call List",
    group: "Chase",
    note: "Who to phone on the 14th and 15th, and what they said.",
  },
  {
    href: "/promises",
    label: "Payment Promises",
    group: "Chase",
    note: "Every promise to pay, with the date it was promised for.",
  },
  {
    href: "/late-fees",
    label: "Late Payment Fees",
    group: "Chase",
    note: "Work out and raise the admin fee on the 16th of the month.",
  },
  {
    href: "/defaulters",
    label: "Repeat Defaulters",
    group: "Review",
    note: "Tenants whose payment fails month after month.",
  },
  {
    href: "/reports",
    label: "Reports & Export",
    group: "Review",
    note: "Weekly and monthly reports, plus the file to load into NetSuite.",
  },
  {
    href: "/settings",
    label: "Settings & Activity Log",
    group: "Admin",
    note: "Email templates, users, and a record of every action taken.",
  },
];

export function navFor(pathname: string) {
  return NAV.find((n) => n.href === pathname);
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stamped = document.documentElement.getAttribute("data-theme");
    if (stamped) {
      setDark(stamped === "dark");
      return;
    }
    setDark(window.matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.setAttribute(
      "data-theme",
      next ? "dark" : "light",
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded border border-line-hair px-2.5 py-1.5 text-xs text-ink-secondary hover:border-line-strong hover:text-ink"
    >
      {dark ? "Light mode" : "Dark mode"}
    </button>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { role, setRole, rmKey, setRmKey, scopeNote } = useSession();
  const ds = useDataset();
  const current = navFor(pathname);
  const groups = Array.from(new Set(NAV.map((n) => n.group)));

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-64 shrink-0 flex-col border-r border-line-hair bg-surface">
        <div className="border-b border-line-hair px-5 py-4">
          <Image
            src="/mes-logo.png"
            alt="MES Group"
            width={438}
            height={127}
            priority
            className="logo-mark h-7 w-auto"
          />
          <p className="mt-2 text-[11px] uppercase tracking-wider text-ink-muted">
            AR Automation
          </p>
          {/* Which data every screen is currently showing. */}
          <p className="mt-1.5 text-[10px] leading-tight text-ink-muted">
            {ds.source === "uploaded"
              ? `Your file, ${ds.period}`
              : "Sample data"}
          </p>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {groups.map((group) => (
            <div key={group} className="mb-5">
              <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
                {group}
              </p>
              {NAV.filter((n) => n.group === group).map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={item.note}
                    aria-current={active ? "page" : undefined}
                    className={`block rounded px-2 py-1.5 text-[13px] ${
                      active
                        ? "bg-accent-wash font-medium text-ink"
                        : "text-ink-secondary hover:bg-surface-alt hover:text-ink"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="border-t border-line-hair px-5 py-3">
          <p className="text-[10px] leading-relaxed text-ink-muted">
            {ds.source === "uploaded"
              ? `Prototype build. Showing ${ds.accounts.length} tenants from the file you uploaded, as at ${ds.asOf}.`
              : "Prototype build. Figures parsed from the sample workbooks supplied by MES."}
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-4 border-b border-line-hair bg-surface px-6 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">
              {current?.label ?? "AR Automation"}
            </p>
            {current ? (
              <p className="truncate text-[11px] text-ink-muted">
                {current.note}
              </p>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-2.5">
            <label className="sr-only" htmlFor="role">
              Active role
            </label>
            <select
              id="role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="rounded border border-line-hair bg-surface px-2.5 py-1.5 text-xs text-ink-secondary"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>

            {/* Which manager is signed in, only relevant for the RM role. */}
            {role === "Relationship Manager" && MANAGERS.length > 0 ? (
              <select
                aria-label="Relationship manager"
                value={rmKey}
                onChange={(e) => setRmKey(e.target.value)}
                className="rounded border border-line-hair bg-surface px-2.5 py-1.5 text-xs text-ink-secondary"
              >
                {MANAGERS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : null}

            <ThemeToggle />
          </div>
        </header>

        {/* Says plainly what this role can see, so the demo never leaves anyone
            guessing why a number changed. */}
        {role !== "CSD Officer" ? (
          <div className="border-b border-line-hair bg-surface-alt px-6 py-2">
            <p className="text-[11px] text-ink-muted">
              <span className="font-medium text-ink-secondary">
                Signed in as {role}.
              </span>{" "}
              {scopeNote} In production this is enforced by the database, not by
              the screen.
            </p>
          </div>
        ) : null}

        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
