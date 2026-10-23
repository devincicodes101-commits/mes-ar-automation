"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ROLE_LABEL, canOpen, useSession } from "@/lib/session";
import { hydrateFromServer, useDataset, useDatasetState } from "@/lib/dataset";
import { hydrateActivity, useStore, useSync } from "@/lib/store";
import { PageSkeleton, Skeleton } from "@/components/ui";
import { formatMonth } from "@/lib/format";

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
    /*
     * In the cycle rather than in Review, because it is not a rehearsal. It is
     * the record of the six days actually firing, and before it existed the one
     * part of the system that runs on its own was the one part with no screen.
     */
    href: "/schedule",
    label: "The Schedule",
    group: "The cycle",
    when: "9am daily",
    note: "What the 9am run does, and what it has done.",
  },
  {
    // First in Review rather than in the cycle, because it is not part of the
    // month. It is how you look at a month without living through one, and
    // how a file gets tried against the whole flow before it is uploaded for
    // real.
    href: "/simulation",
    label: "Dry Run",
    /* Kept out of the menu at the client's request: a rehearsal, not
       part of the day. Still at /simulation. */
    hidden: true,
    group: "Review",
    when: "any time",
    note: "Walk a whole month against a file. Nothing is sent.",
  },
  {
    // Next to the Dry Run because it answers the question the Dry Run
    // provokes: the month on screen looks right, but how would anybody know?
    href: "/checks",
    label: "Checks",
    /* Kept out of the menu at the client's request. It proves the 338
       requirement cases in front of somebody, which is a demonstration
       rather than daily work. Still at /checks. */
    hidden: true,
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
    when: "by billing date",
    note: "First reminders and final notices.",
  },
  {
    // Directly under the reminders, because it is the other half of the same
    // job: the ones the bulk send could not reach. At Blue Stars that is 185
    // tenants of 190, so it is not a footnote to the send, it is most of it.
    href: "/no-email",
    label: "Send By Hand",
    group: "The cycle",
    when: "with each send",
    note: "Letters for tenants with no email address.",
    /* The By hand tab of Reminder Emails since 24 October. */
    hidden: true,
  },
  {
    href: "/calls",
    label: "Call List",
    group: "The cycle",
    when: "after each",
    note: "Who to phone, what they said, and what they promised.",
  },
  {
    href: "/promises",
    label: "Payment Promises",
    group: "Review",
    note: "Every promise to pay, and when it is due.",
    /* The Payment promises tab of Call List since 24 October. */
    hidden: true,
  },
  {
    href: "/late-fees",
    label: "Late Payment Fees",
    group: "The cycle",
    when: "16th",
    note: "The admin fee raised on the 16th.",
  },
  {
    href: "/outbox",
    label: "Sent Mail",
    /* The "Sent" tab on Reminder Emails. Same list, beside the letters it
       belongs with rather than a screen away. */
    hidden: true,
    group: "The cycle",
    when: "audit",
    note: "Every letter that went out.",
  },
  {
    href: "/defaulters",
    label: "Repeat Defaulters",
    /* Kept out of the menu at the client's request. Still at /defaulters. */
    hidden: true,
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
    /* Kept out of the menu at the client's request. Still at /chased. */
    hidden: true,
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
    /* Kept out of the menu at the client's request. Still at /movement. */
    hidden: true,
    group: "Review",
    note: "Who paid, who got worse, and who has been stuck for months.",
  },
  {
    href: "/reports",
    label: "Reports & Export",
    group: "Review",
    when: "on demand",
    note: "Reports, and the file for NetSuite.",
  },
  {
    href: "/settings",
    label: "Settings",
    group: "Admin",
    note: "Mailbox, reminder timing and recipients.",
  },
  {
    href: "/users",
    label: "User Management",
    group: "Admin",
    note: "Who can sign in, and what each role can do.",
  },
  {
    href: "/access",
    label: "Access Control",
    group: "Admin",
    note: "What each role is allowed to see and do.",
    /* The second tab of User Management since 24 October. */
    hidden: true,
  },
  {
    href: "/activity",
    label: "Activity Log",
    group: "Admin",
    note: "Every action, with who did it and when.",
  },
];

/*
 * The last ordinary page somebody was on, so a page opened from it (a
 * tenant) can send them back to where they came from rather than to a fixed
 * list.
 */
let lastPage = "/";

/** Where "Back" on a tenant page goes, and what to call it. */
export function backTarget(): { href: string; label: string } {
  const item = NAV.find((n) => n.href === lastPage);
  return { href: lastPage, label: item?.label ?? "Outstanding Balances" };
}

export function navFor(pathname: string) {
  const found = NAV.find((n) => n.href === pathname);
  if (found) return found;
  /* Not in the menu, but still a page with a name. */
  if (pathname.startsWith("/tenant/")) {
    return {
      href: pathname,
      label: "Tenant",
      group: "",
      note: "One tenant's balance, charges and history.",
    };
  }
  return undefined;
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
    /* Remembered on this device; the layout applies it before the first paint. */
    try {
      window.localStorage.setItem("mes-theme", next ? "dark" : "light");
    } catch {
      /* Private windows refuse storage; the choice lasts for this page. */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line-hair text-ink-secondary hover:border-line-strong hover:text-ink"
    >
      {dark ? (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4" />
          <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M13.5 9.6A5.6 5.6 0 0 1 6.4 2.5a5.6 5.6 0 1 0 7.1 7.1z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

/**
 * The first screen while the session is restored: the brand and a moving
 * bar, not a sentence. It shows on every full page load, so it must not read
 * as though anybody is being signed in again.
 */
function AppSplash() {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-page px-6"
      role="status"
      aria-label="Loading"
    >
      <Image
        src="/mes-logo.png"
        alt="MES Group"
        width={438}
        height={127}
        priority
        className="logo-mark h-10 w-auto"
      />
      <div className="h-1 w-40 overflow-hidden rounded-full bg-surface-sunk">
        <div className="loader-bar h-full w-1/3 rounded-full bg-accent" />
      </div>
    </div>
  );
}

/** A thin bar across the top of the page while data is loading. */
function TopProgress() {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 -bottom-px z-30 h-0.5 overflow-hidden bg-accent-wash"
      role="progressbar"
      aria-label="Loading"
    >
      <div className="loader-bar h-full w-1/3 bg-accent" />
    </div>
  );
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M2.5 4.5h13M2.5 9h13M2.5 13.5h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Screens whose figures do not come from the uploaded report.
 *
 * The banners below warn that the numbers on screen are the bundled example
 * rather than MES's. On these pages that is not true of anything shown: The
 * Schedule counts what the nine o'clock run did, read straight from cron_runs,
 * and the Activity Log is the record of what people did. Admin screens show no
 * figures at all.
 *
 * A warning that is wrong half the time is one people learn to skim, and the
 * one occasion it matters - somebody about to show a client figures that are
 * not theirs - is exactly when it gets skimmed. So it is shown where it is
 * true and nowhere else.
 */
const NOT_FROM_THE_REPORT = ["/schedule", "/activity", "/users", "/access", "/settings"];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, ready, role, scopeNote, signOut } = useSession();
  const ds = useDataset();
  const sync = useSync();
  const store = useStore();
  /* Nothing from the activity record in this browser yet: a first visit,
     or cleared storage. Until the server answers, its counts would be zeros. */
  const noActivityHere =
    store.emails.length + store.calls.length + store.promises.length + store.fees.length + store.audit.length === 0;
  /* Whether the figures on screen came from a real upload or the bundled
     example. See the banner below. */
  const dataset = useDatasetState();
  const figuresAreFromTheReport = !NOT_FROM_THE_REPORT.includes(pathname);
  /* The stored report has not arrived and nothing better is in this browser. */
  const reportPending = dataset.loading && ds.source === "sample";
  const current = navFor(pathname);
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the drawer whenever the page changes, and remember the page.
  useEffect(() => {
    setMenuOpen(false);
    if (!pathname.startsWith("/tenant/") && pathname !== "/login") lastPage = pathname;
  }, [pathname]);

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
  if (!ready) return <AppSplash />;
  if (!session) return null;

  const initials = session.name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const sidebar = (
    <>
      <div className="flex items-start justify-between border-b border-line-hair px-5 py-4">
        <div>
          <Image
            src="/mes-logo.png"
            alt="MES Group"
            width={438}
            height={127}
            priority
            className="logo-mark h-7 w-auto"
          />
          <p className="mt-2 text-[11px] font-medium uppercase tracking-wider text-ink-muted">
            AR Automation
          </p>
        </div>
        <button
          type="button"
          onClick={() => setMenuOpen(false)}
          aria-label="Close menu"
          className="rounded-md p-1.5 text-ink-muted hover:bg-surface-alt hover:text-ink lg:hidden"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* The month is the stored report's, so it waits for it: before the
          server answers, ds holds the bundled example and its August. */}
      {reportPending ? (
        <div className="px-4 pt-4">
          <Skeleton className="h-[52px] w-full rounded-md" />
        </div>
      ) : ds.period ? (
        <div className="px-4 pt-4">
          <div className="rounded-md bg-accent-wash px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wider text-ink-muted">
              Report loaded
            </p>
            <p className="text-[13px] font-semibold text-accent-text">
              {formatMonth(ds.period)}
            </p>
          </div>
        </div>
      ) : null}

      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main">
        {groups.map((group) => (
          <div key={group} className="mb-5">
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
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
                  className={`relative block rounded-md px-3 py-2 text-[13.5px] lg:py-1.5 ${
                    active
                      ? "bg-accent-wash font-medium text-accent-text"
                      : "text-ink-secondary hover:bg-surface-alt hover:text-ink"
                  }`}
                >
                  {active ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-accent"
                    />
                  ) : null}
                  <span className="block truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="flex items-center gap-2 border-t border-line-hair px-4 py-3">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-ink"
        >
          {initials || "?"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-ink">{session.name}</p>
          <p className="truncate text-[11px] text-ink-muted">
            {ROLE_LABEL[session.role]}
          </p>
        </div>
        <ThemeToggle />
        <button
          type="button"
          onClick={() => {
            signOut();
            router.replace("/login");
          }}
          aria-label="Sign out"
          title="Sign out"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line-hair text-ink-secondary hover:border-line-strong hover:text-ink"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M6 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1H6M10.5 11l3-3-3-3M13.5 8H6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </>
  );

  return (
    /*
     * The shell is exactly one screen tall and the content scrolls inside it,
     * so the navigation never scrolls away. h-dvh rather than h-screen
     * because on a phone h-screen includes the address bar.
     */
    <div className="flex h-dvh overflow-hidden">
      {/* Desktop: a fixed sidebar. */}
      <aside className="hidden h-full w-64 shrink-0 flex-col border-r border-line-hair bg-surface lg:flex">
        {sidebar}
      </aside>

      {/* Phone and tablet: the same sidebar as a drawer. */}
      {menuOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />
          <aside className="absolute inset-y-0 left-0 flex w-[17rem] max-w-[85vw] flex-col bg-surface shadow-xl">
            {sidebar}
          </aside>
        </div>
      ) : null}

      {/* overflow-hidden so the column cannot grow past the screen: the
          scrolling belongs to <main> below, not to the window. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="relative flex items-center gap-3 border-b border-line-hair bg-surface px-4 py-3 sm:px-6">
          {/* Something is on its way from the server. */}
          {dataset.loading || sync.loading ? <TopProgress /> : null}
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            className="-ml-1 rounded-md p-1.5 text-ink-secondary hover:bg-surface-alt hover:text-ink lg:hidden"
          >
            <MenuIcon />
          </button>
          <div className="min-w-0">
            {pathname.startsWith("/tenant/") ? (
              <p className="truncate text-base font-semibold text-ink sm:text-lg">
                {current?.label}
              </p>
            ) : (
              <h1 className="truncate text-base font-semibold text-ink sm:text-lg">
                {current?.label ?? "AR Automation"}
              </h1>
            )}
            {current ? (
              <p className="hidden truncate text-xs text-ink-muted sm:block">
                {current.note}
              </p>
            ) : null}
          </div>
          {reportPending ? (
            <Skeleton className="ml-auto h-6 w-24 shrink-0 rounded-full lg:hidden" />
          ) : ds.period ? (
            <span className="ml-auto shrink-0 rounded-full bg-accent-wash px-2.5 py-1 text-[11px] font-medium text-accent-text lg:hidden">
              {formatMonth(ds.period)}
            </span>
          ) : null}
        </header>

        {/* Says plainly what this role can see, so nobody is left guessing
            why a number differs from a colleague's. */}
        {role !== "CSD" && role !== "admin" && role !== "super-admin" ? (
          <div className="border-b border-line-hair bg-surface-alt px-4 py-2 sm:px-6">
            <p className="text-xs text-ink-muted">
              <span className="font-medium text-ink-secondary">
                Signed in as {ROLE_LABEL[session.role]}.
              </span>{" "}
              {scopeNote}
            </p>
          </div>
        ) : null}

        {/*
          * Records that exist in this browser and nowhere else. On every
          * screen, because the officer will have moved on by the time it
          * matters.
          */}
        {sync.unsaved > 0 || sync.lastError ? (
          <div
            className={`border-b px-4 py-3 text-sm sm:px-6 ${
              sync.unsaved > 0
                ? "border-crit-line bg-crit-wash text-crit-ink"
                : "border-warn-line bg-warn-wash text-warn-ink"
            }`}
            role="status"
          >
            {sync.unsaved > 0 ? (
              <span className="font-medium">
                {sync.unsaved === 1
                  ? "1 record has not reached the server yet."
                  : `${sync.unsaved} records have not reached the server yet.`}{" "}
              </span>
            ) : null}
            {sync.lastError}
          </div>
        ) : null}

        {/*
          * Sample data, said out loud. When the database holds no report the
          * app falls back to a bundled sample, which reads exactly like the
          * real thing, so it is labelled on every screen with figures.
          */}
        {!figuresAreFromTheReport || dataset.loading ? null : dataset.origin === "empty" ? (
          <div
            className="border-b border-line-hair bg-accent-wash px-4 py-3 text-sm text-ink-secondary sm:px-6"
            role="status"
          >
            <span className="font-medium text-ink">No report loaded yet.</span>{" "}
            Upload this month&rsquo;s AR report to fill in the figures.{" "}
            {canOpen(role, "/upload") ? (
              <Link href="/upload" className="font-medium text-accent-text underline underline-offset-4">
                Upload a report
              </Link>
            ) : null}
          </div>
        ) : dataset.origin === "sample" ? (
          <div
            className="border-b border-warn-line bg-warn-wash px-4 py-3 text-sm text-warn-ink sm:px-6"
            role="status"
          >
            <span className="font-medium">Example figures.</span>{" "}
            The stored report has not loaded, so these are not MES&rsquo;s
            current balances.
          </div>
        ) : null}

        {/* The only thing that scrolls. min-h-0 is load bearing: without it a
            flex child refuses to shrink below its content and the overflow
            escapes to the window. */}
        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
          <div className="mx-auto w-full max-w-[1400px]">
            {/* Until the stored report arrives, the page's shape rather than
                the bundled example: figures that are about to change are
                worse than none. A report already in this browser shows at
                once. */}
            {/* A page this role may not open is never drawn, not even for the
                moment before the redirect above: typing /settings as CSD
                showed the settings for a second. */}
            {!canOpen(role, pathname) ||
            (figuresAreFromTheReport && reportPending) ||
            ((figuresAreFromTheReport || pathname === "/activity") && sync.loading && noActivityHere) ? (
              <PageSkeleton />
            ) : (
              children
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
