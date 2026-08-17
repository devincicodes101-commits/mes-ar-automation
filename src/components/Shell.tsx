"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";

/**
 * Role-based access is a contracted requirement (CSD / RM / Management), and in
 * production it is enforced by Supabase row level security, not by this
 * switcher. The switcher exists so the prototype can demonstrate what each role
 * sees during the sign-off walkthrough.
 */
const ROLES = ["CSD Officer", "Relationship Manager", "Management"] as const;
export type Role = (typeof ROLES)[number];

const NAV: { href: string; label: string; group: string }[] = [
  { href: "/upload", label: "Upload Centre", group: "Reconcile" },
  { href: "/", label: "AR Aging Board", group: "Reconcile" },
  { href: "/collections", label: "Collections Queue", group: "Reconcile" },
  { href: "/reminders", label: "Reminder Drafting", group: "Collect" },
  { href: "/calls", label: "Calling List", group: "Collect" },
  { href: "/promises", label: "Promise to Pay", group: "Collect" },
  { href: "/defaulters", label: "Recurring Defaulters", group: "Insight" },
  { href: "/reports", label: "Reports & Export", group: "Insight" },
  { href: "/settings", label: "Settings & Audit", group: "Admin" },
];

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
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded border border-line-hair px-2.5 py-1.5 text-xs text-ink-secondary hover:bg-surface-alt"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {dark ? "Light" : "Dark"}
    </button>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [role, setRole] = useState<Role>("CSD Officer");

  const groups = Array.from(new Set(NAV.map((n) => n.group)));

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-line-hair bg-surface">
        <div className="border-b border-line-hair px-5 py-4">
          <Image
            src="/mes-logo.png"
            alt="MES Group"
            width={438}
            height={127}
            priority
            className="h-8 w-auto"
          />
          <p className="mt-2.5 text-[11px] leading-tight text-ink-muted">
            AR Automation
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
                    aria-current={active ? "page" : undefined}
                    className={`block rounded px-2 py-1.5 text-[13px] ${
                      active
                        ? "bg-brand-wash font-medium text-ink"
                        : "text-ink-secondary hover:bg-surface-alt"
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
          <p className="text-[10px] text-ink-muted">
            Prototype build. Data parsed from the MES sample workbooks.
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-4 border-b border-line-hair bg-surface px-6 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">
              {NAV.find((n) => n.href === pathname)?.label ?? "AR Automation"}
            </p>
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
            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
