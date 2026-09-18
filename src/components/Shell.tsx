"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";


import { useRouter } from "next/navigation";
import { ROLE_LABEL, canOpen, useSession } from "@/lib/session";
import { hydrateFromServer, useDataset } from "@/lib/dataset";
import { hydrateActivity, useSync } from "@/lib/store";
import { Loading } from "@/components/ui";

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
  /** Where this sits in MES's month, shown beside the label. */
  when?: string;
  /**
   * Hidden from the sidebar but still reachable by URL. Nothing is deleted:
   * these are screens the client has parked rather than dropped, so restoring
   * one is a single line here.
   */
  hidden?: boolean;
}[] = [
  {
    href: "/upload",
    label: "Upload Reports",
    group: "The cycle",
    when: "any day",
    note: "Bring in this month's AR report.",
  },
  {
    // First in Review rather than in the cycle, because it is not part of the
    // month. It is how you look at a month without living through one, and
    // how a file gets tried against the whole flow before it is uploaded for
    // real.
    href: "/simulation",
    label: "Dry Run",
    group: "Review",
    when: "any time",
    note: "Walk a whole month against a file. Nothing is sent.",
  },
  {
    // Next to the Dry Run because it answers the question the Dry Run
    // provokes: the month on screen looks right, but how would anybody know?
    href: "/checks",
    label: "Checks",
    group: "Review",
    when: "any time",
    note: "Every requirement MES wrote down, checked in front of you.",
  },
  {
    href: "/",
    label: "Outstanding Balances",
    group: "The cycle",
    when: "after upload",
    note: "Who owes what, and how overdue it is.",
  },
  {
    href: "/collections",
    label: "Action List",
    group: "The cycle",
    note: "Who to chase today, most urgent first.",
    // Hidden at the client's request, on the basis that this becomes the
    // priority list the automation works from rather than a screen an officer
    // reads. Note this is proposal 4.4, Collections Queue, which is a required
    // feature and a named module in 4.9. Unhide by deleting this line.
    hidden: true,
  },
  {
    href: "/reminders",
    label: "Reminder Emails",
    group: "The cycle",
    when: "7th & 21st",
    note: "Write and send the 7th reminder and the 21st final notice.",
  },
  {
    // Directly under the reminders, because it is the other half of the same
    // job: the ones the bulk send could not reach. At Blue Stars that is 185
    // tenants of 190, so it is not a footnote to the send, it is most of it.
    href: "/no-email",
    label: "Send By Hand",
    group: "The cycle",
    when: "with each send",
    note: "Tenants with no address. The letter is written, you send it.",
  },
  {
    href: "/calls",
    label: "Call List",
    group: "The cycle",
    when: "after each",
    note: "Who to phone after each reminder goes out, and what they said.",
  },
  {
    href: "/promises",
    label: "Payment Promises",
    group: "Review",
    note: "Every promise to pay, with the date it was promised for.",
  },
  {
    href: "/late-fees",
    label: "Late Payment Fees",
    group: "The cycle",
    when: "16th",
    note: "Work out and raise the admin fee on the 16th of the month.",
  },
  {
    href: "/outbox",
    label: "Sent Mail",
    group: "The cycle",
    when: "audit",
    note: "Every reminder that went out, with the letter exactly as it was sent.",
  },
  {
    href: "/defaulters",
    label: "Repeat Defaulters",
    group: "Review",
    note: "Tenants whose payment fails month after month.",
  },
  {
    // Directly after Repeat Defaulters, because the two answer neighbouring
    // questions: that one is whose payment keeps failing, this one is who has
    // been taken all the way through MES's cycle and still owes at the end of
    // it. Reading them in that order is how somebody decides what to do.
    href: "/chased",
    label: "Chased to the End",
    group: "Review",
    note: "Tenants who completed the whole cycle and still owe.",
  },
  {
    // Placed before Chased to the End on purpose. This says what moved since
    // the last report; that one says who has been round the whole cycle. An
    // officer wants the change first, because it is the part that decides
    // which of yesterday's names are still worth a call this morning.
    href: "/movement",
    label: "What Changed",
    group: "Review",
    note: "Who paid, who got worse, and who has been stuck for months.",
  },
  {
    href: "/reports",
    label: "Reports & Export",
    group: "Review",
    when: "on demand",
    note: "Weekly and monthly reports, plus the file to load into NetSuite.",
  },
  {
    href: "/settings",
    label: "Settings",
    group: "Admin",
    note: "Email wording and how the system behaves.",
  },
  {
    href: "/users",
    label: "User Management",
    group: "Admin",
    note: "Add people, remove them, and set what each one is.",
  },
  {
    href: "/access",
    label: "Access Control",
    group: "Admin",
    note: "What each role is allowed to see and do.",
  },
  {
    href: "/activity",
    label: "Activity Log",
    group: "Admin",
    note: "A permanent record of every action, with who did it and when.",
  },
];

export function navFor(pathname: string) {
  return NAV.find((n) => n.href === pathname);
}

/**
 * Light and dark.
 *
 * The palette is defined once as tokens and the dark values are declared under
 * both the prefers-color-scheme media query and the data-theme attribute, so
 * this toggle wins in both directions: it can override an OS set to dark, and
 * an OS set to light.
 */
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
  const router = useRouter();
  const { session, ready, role, scopeNote, signOut } = useSession();
  const ds = useDataset();
  const sync = useSync();
  const current = navFor(pathname);

  // The nav only offers what this role may actually open, so nobody is invited
  // to click into a screen that will refuse them.
  const visible = NAV.filter((n) => !n.hidden && canOpen(role, n.href));
  const groups = Array.from(new Set(visible.map((n) => n.group)));

  // The gate. Anyone without a live session goes to the login page, including
  // on the landing page, and a signed in person who types a URL they are not
  // entitled to is sent back to the board rather than shown an empty screen.
  useEffect(() => {
    if (!ready) return;
    if (!session) {
      if (pathname !== "/login") router.replace("/login");
      return;
    }
    if (!canOpen(role, pathname)) router.replace("/");
  }, [ready, session, role, pathname, router]);

  /*
   * Load the stored report once somebody is signed in.
   *
   * Deliberately after the session gate, not before: the request goes to an
   * API route that reads every tenant, and there is no reason for a signed out
   * browser to have asked for it.
   *
   * Whatever is in local storage is already on screen by the time this runs,
   * so a slow or failed request costs nothing. Only a good answer replaces it,
   * and a failure is recorded rather than swallowed, because two people each
   * working from their own browser copy is the situation this replaces.
   */
  useEffect(() => {
    if (!ready || !session) return;
    void hydrateFromServer();
    /*
     * And the activity log, which is the half of this that cannot be
     * re-uploaded. Same rule: what is in this browser is already on screen, a
     * failure leaves it there, and only a good answer replaces it with
     * everybody's calls rather than just this browser's.
     */
    void hydrateActivity();
  }, [ready, session]);

  // The login page brings its own layout, and nothing renders until the stored
  // session has been read, so a locked screen never flashes up first.
  if (pathname === "/login") return <>{children}</>;
  // Restoring the session reads local storage, which is a tick. Showing the
  // spinner rather than nothing means a slow machine does not flash a blank
  // page before the app appears.
  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loading label="Signing you in" />
      </div>
    );
  }
  if (!session) return null;

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
          <p className="mt-1.5 text-[10px] leading-tight text-ink-muted">
            {ds.period}
          </p>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {groups.map((group) => (
            <div key={group} className="mb-5">
              <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
                {group}
              </p>
              {visible.filter((n) => n.group === group).map((item) => {
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
                    <span className="flex items-baseline gap-1.5">
                      <span className="truncate">{item.label}</span>
                      {item.when ? (
                        <span className="ml-auto shrink-0 text-[9.5px] uppercase tracking-wide text-ink-muted">
                          {item.when}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

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
            <div className="hidden text-right sm:block">
              <p className="text-[11px] font-medium leading-tight text-ink">
                {session.name}
              </p>
              <p className="text-[10px] leading-tight text-ink-muted">
                {ROLE_LABEL[session.role]}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                signOut();
                router.replace("/login");
              }}
              className="rounded border border-line-hair px-2.5 py-1.5 text-xs text-ink-secondary hover:border-line-strong hover:text-ink"
            >
              Sign out
            </button>

            <ThemeToggle />
          </div>
        </header>

        {/* Says plainly what this role can see, so the demo never leaves anyone
            guessing why a number changed. */}
        {role !== "CSD" && role !== "admin" && role !== "super-admin" ? (
          <div className="border-b border-line-hair bg-surface-alt px-6 py-2">
            <p className="text-[11px] text-ink-muted">
              <span className="font-medium text-ink-secondary">
                Signed in as {ROLE_LABEL[session.role]}.
              </span>{" "}
              {scopeNote} In production this is enforced by the database, not by
              the screen.
            </p>
          </div>
        ) : null}

        {/*
          * Records that exist in this browser and nowhere else.
          *
          * Shown on every screen rather than on the one that created them,
          * because the officer will have moved on by the time it matters and
          * their own screen shows the call either way. A history that looks
          * complete while missing the calls made during an outage is the worst
          * thing this system could quietly do.
          */}
        {sync.unsaved > 0 || sync.lastError ? (
          <div
            className={`border-b px-6 py-3 text-sm ${
              sync.unsaved > 0
                ? "border-red-200 bg-red-50 text-red-900"
                : "border-amber-200 bg-amber-50 text-amber-900"
            }`}
            role="status"
          >
            {sync.unsaved > 0 ? (
              <span className="font-medium">
                {sync.unsaved === 1
                  ? "1 record is saved in this browser only."
                  : `${sync.unsaved} records are saved in this browser only.`}{" "}
              </span>
            ) : null}
            {sync.lastError}
          </div>
        ) : null}

        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
