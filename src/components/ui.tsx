import Link from "next/link";
import { ReactNode } from "react";

/**
 * A tenant's name, as the way into their history.
 *
 * Here rather than written out on each screen, because it was added to two of
 * them and the client clicked a name on a third. A name that is a link on the
 * call list and plain text on What Changed teaches people it is not clickable,
 * which is worse than never having linked it.
 *
 * Falls back to plain text where there is no id to link to — a row read from
 * an older record, or one that never carried one.
 */
export function TenantLink({
  id,
  name,
  className = "",
}: {
  id: string | null | undefined;
  name: string;
  className?: string;
}) {
  if (!id) return <span className={className}>{name}</span>;
  return (
    <Link
      href={`/tenant/${encodeURIComponent(id)}`}
      className={`underline decoration-line-strong underline-offset-4 hover:text-accent-text hover:decoration-accent ${className}`}
    >
      {name}
    </Link>
  );
}

/* ------------------------------------------------------------------ card */

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-line-hair bg-surface ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  hint,
  right,
}: {
  title: string;
  hint?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-line-hair px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-5">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {hint ? (
          <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>
        ) : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------- skeleton */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function SkeletonText({ w = "w-24" }: { w?: string }) {
  return <Skeleton className={`h-3.5 ${w}`} />;
}

/** Placeholder for a KPI row while the batch summary loads. */
export function StatTileSkeleton() {
  return (
    <Card className="p-4 sm:p-5">
      <Skeleton className="h-3 w-20 sm:w-28" />
      <Skeleton className="mt-3 h-7 w-24 sm:w-36" />
      <Skeleton className="mt-3 h-3 w-16 sm:w-20" />
    </Card>
  );
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="divide-y divide-line-grid" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5 sm:px-5">
          <Skeleton className="h-3.5 w-40 sm:w-56" />
          <Skeleton className="h-3.5 w-16" />
          <div className="ml-auto hidden gap-6 sm:flex">
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="h-3.5 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The shape of a page - a row of figures, then a list - for while its data
 * is on the way. Shown in place of the page rather than over it, so nothing
 * on screen is a number that is about to change.
 */
export function PageSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTileSkeleton />
        <StatTileSkeleton />
        <StatTileSkeleton />
        <StatTileSkeleton />
      </div>
      <Card>
        <div className="flex items-center justify-between border-b border-line-hair px-4 py-4 sm:px-5">
          <div>
            <Skeleton className="h-4 w-40 sm:w-48" />
            <Skeleton className="mt-2 h-3 w-56 sm:w-72" />
          </div>
          <Skeleton className="hidden h-8 w-32 rounded-lg sm:block" />
        </div>
        <div className="flex gap-2 border-b border-line-hair px-4 py-3 sm:px-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-20 rounded-md" />
          ))}
        </div>
        <TableSkeleton rows={8} />
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------- stat tile */

export function StatTile({
  label,
  value,
  prefix,
  note,
  emphasis = false,
}: {
  label: string;
  value: string;
  prefix?: string;
  note?: string;
  emphasis?: boolean;
}) {
  return (
    <Card
      className="p-4 sm:p-5"
    >
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </div>
      <div
        className={`mt-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-1 ${
          emphasis ? "text-accent-text" : "text-ink"
        }`}
      >
        {prefix ? (
          <span className="text-sm text-ink-secondary">{prefix}</span>
        ) : null}
        {/* Millions do not fit a phone's half-width tile at full size. */}
        <span
          className={`tabular font-semibold leading-none sm:text-[28px] ${
            value.length > 9 ? "text-xl" : "text-2xl"
          }`}
        >
          {value}
        </span>
      </div>
      {note ? (
        <div className="mt-2.5 text-xs text-ink-secondary">{note}</div>
      ) : null}
    </Card>
  );
}

/* ---------------------------------------------------------------- status */

type StatusKind = "good" | "warning" | "serious" | "critical" | "neutral";

const STATUS_PILL: Record<StatusKind, string> = {
  good: "bg-good-wash text-good-ink",
  warning: "bg-warn-wash text-warn-ink",
  serious: "bg-warn-wash text-warn-ink",
  critical: "bg-crit-wash text-crit-ink",
  neutral: "bg-surface-sunk text-ink-secondary",
};

const STATUS_DOT: Record<StatusKind, string> = {
  good: "var(--status-good)",
  warning: "var(--status-warning)",
  serious: "var(--status-serious)",
  critical: "var(--status-critical)",
  neutral: "var(--text-muted)",
};

/**
 * Status is never colour alone: a soft tinted pill, a dot in the status hue
 * and a text label, so it survives colour blindness, print and forced-colors.
 * No border - the tint is the edge - so a row of them reads quietly.
 */
export function StatusBadge({
  kind,
  label,
}: {
  kind: StatusKind;
  label: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[5px] text-xs font-medium leading-none ${STATUS_PILL[kind]}`}
    >
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: STATUS_DOT[kind] }}
      />
      {label}
    </span>
  );
}

/** A plain label for facts about a row (a code, a type, a count). Square-ish,
    so it never reads as a status. */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-md bg-surface-alt px-2 py-[5px] text-[11px] font-medium leading-none text-ink-secondary">
      {children}
    </span>
  );
}

/* ------------------------------------------------------- aging bucket key */

/**
 * The five buckets are one hue stepped light to dark. Severity is read from
 * ramp position, not from separate colours.
 */
export function BucketSwatch({ ramp }: { ramp: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2.5 w-2.5 rounded-[2px] align-middle"
      style={{ background: `var(--age-${ramp})` }}
    />
  );
}

/* ----------------------------------------------------------------- modal */

export function Modal({
  title,
  onClose,
  children,
  wide = false,
  full = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** Nearly the whole screen, for a grid of data. */
  full?: boolean;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full rounded-lg border border-line-hair bg-surface shadow-xl ${
          full ? "max-w-[1400px]" : wide ? "max-w-3xl" : "max-w-xl"
        }`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line-hair px-5 py-3.5">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded px-1.5 text-ink-muted hover:text-ink"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="px-5 py-12 text-center">
      <span
        aria-hidden="true"
        className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-accent-wash text-accent-text"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M2.5 9.5h3l1 2h3l1-2h3M2.5 9.5l1.6-5.2a1 1 0 0 1 .95-.8h5.9a1 1 0 0 1 .95.8l1.6 5.2v3a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      </span>
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-ink-muted">{body}</p>
    </div>
  );
}

/* ---------------------------------------------------------------- loading */

/**
 * A spinner, for work that takes long enough to notice.
 *
 * Parsing three thousand invoice lines and hashing a password both take a
 * beat. Without a sign that something is happening, people click twice, which
 * on a send button is worse than a slow screen.
 */
export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent align-[-2px]"
      style={{ width: size, height: size, opacity: 0.55 }}
    />
  );
}

/** A spinner with a line of text, for a panel that is still filling. */
export function Loading({
  label = "Loading",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center justify-center gap-2.5 px-5 py-10 text-xs text-ink-muted ${className}`}
    >
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

/* -------------------------------------------------------------- pagination */

/**
 * Page through a long list: where you are, and previous / next.
 * `page` counts from 0. Renders nothing when everything fits on one page.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="flex flex-col items-center gap-2 border-t border-line-hair px-4 py-3 sm:flex-row sm:justify-between sm:px-5">
      <p className="tabular text-xs text-ink-muted">
        Showing {from}-{to} of {total}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page === 0}
          onClick={(e) => {
            onPage(page - 1);
            backToTop(e.currentTarget);
          }}
          className="rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium text-ink-secondary"
        >
          Previous
        </button>
        <span className="tabular px-1 text-xs text-ink-secondary">
          Page {page + 1} of {pages}
        </span>
        <button
          type="button"
          disabled={page >= pages - 1}
          onClick={(e) => {
            onPage(page + 1);
            backToTop(e.currentTarget);
          }}
          className="rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium text-ink-secondary"
        >
          Next
        </button>
      </div>
    </div>
  );
}

/** After a page turn, the top of the list rather than the pager at its foot. */
function backToTop(from: HTMLElement) {
  const list = from.closest("[data-paged]") ?? from.parentElement?.parentElement?.parentElement;
  if (list && list.getBoundingClientRect().top < 0) list.scrollIntoView({ block: "start" });
}

/** The search box that sits in a card's header, above a paged list. */
export function SearchBox({
  value,
  onChange,
  placeholder = "Find a tenant by name or code",
  label = "Find a tenant",
  className = "sm:w-64",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={label}
      className={`w-full rounded-md border bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted sm:text-xs ${className}`}
    />
  );
}

/** True when any of the given fields contains the search text. */
export function matchesQuery(query: string, fields: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return fields.some((f) => (f ?? "").toLowerCase().includes(q));
}

/* --------------------------------------------------------------- scrolling */

/**
 * A panel that scrolls inside itself instead of lengthening the page.
 *
 * The screens read a whole month of invoice lines, so a table left to grow
 * pushes the totals and the controls above it off the top of the window.
 * Capping the height keeps the heading, the figures and the first rows all
 * visible while the rows themselves move.
 *
 * `max-height` rather than `height`, so a short list does not leave a band of
 * empty space under it.
 */
export function ScrollPanel({
  children,
  max = 380,
  className = "",
}: {
  children: ReactNode;
  /** Pixels. Roughly ten table rows at the default row height. */
  max?: number;
  className?: string;
}) {
  return (
    <div
      className={`overflow-y-auto overflow-x-auto overscroll-contain ${className}`}
      style={{ maxHeight: max }}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
