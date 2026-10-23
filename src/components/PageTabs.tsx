"use client";

import { useEffect, useState } from "react";

/**
 * Tabs that join two screens doing one job into one menu entry.
 *
 * The menu had thirteen entries and three pairs did the same job twice over:
 * the reminders and the same letters for tenants with no address, the calls
 * and the promises taken on them, the logins and what each role may do. Each
 * pair is now one entry with a tab each (24 October). The old addresses still
 * open their screen on its own, so a bookmark does not break.
 *
 * The tab is in the address (?tab=...) so a link can open the right one; read
 * after the first render rather than with useSearchParams, which would make
 * every page using this render on the client only.
 */
export function usePageTab<T extends string>(keys: readonly T[], fallback: T): [T, (t: T) => void] {
  const [tab, setTab] = useState<T>(fallback);
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("tab");
    if (asked && (keys as readonly string[]).includes(asked)) setTab(asked as T);
    // Read once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const choose = (t: T) => {
    setTab(t);
    const url = new URL(window.location.href);
    if (t === fallback) url.searchParams.delete("tab");
    else url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url);
  };
  return [tab, choose];
}

export function PageTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: readonly { key: T; label: string; count?: number | null }[];
  value: T;
  onChange: (t: T) => void;
  /** What the tabs choose between, for a screen reader. */
  label: string;
}) {
  return (
    <div className="inline-flex max-w-full gap-1 overflow-x-auto rounded-lg bg-surface-alt p-1" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={`flex-1 whitespace-nowrap rounded-md px-3.5 py-1.5 text-[13px] sm:flex-none ${
            value === t.key ? "bg-surface font-medium text-accent-text shadow-sm" : "text-ink-muted hover:text-ink-secondary"
          }`}
        >
          {t.label}
          {t.count !== undefined && t.count !== null ? <span className="ml-1.5 tabular opacity-70">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
