import { ReactNode } from "react";

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
    <div className="flex items-start justify-between gap-4 border-b border-line-hair px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {hint ? (
          <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>
        ) : null}
      </div>
      {right}
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
    <Card className="p-5">
      <Skeleton className="h-3 w-28" />
      <Skeleton className="mt-3 h-8 w-36" />
      <Skeleton className="mt-3 h-3 w-20" />
    </Card>
  );
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="divide-y divide-line-grid" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-3.5">
          <Skeleton className="h-3.5 w-56" />
          <Skeleton className="h-3.5 w-16" />
          <div className="ml-auto flex gap-6">
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
    <Card className="p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </div>
      <div
        className={`mt-2 flex items-baseline gap-1.5 ${
          emphasis ? "text-ink" : "text-ink"
        }`}
      >
        {prefix ? (
          <span className="text-sm text-ink-secondary">{prefix}</span>
        ) : null}
        <span className="text-[28px] font-semibold leading-none">{value}</span>
      </div>
      {note ? (
        <div className="mt-2.5 text-xs text-ink-secondary">{note}</div>
      ) : null}
    </Card>
  );
}

/* ---------------------------------------------------------------- status */

type StatusKind = "good" | "warning" | "serious" | "critical" | "neutral";

const STATUS_ICON: Record<StatusKind, string> = {
  good: "✓", // check
  warning: "△", // triangle
  serious: "◆", // diamond
  critical: "✕", // cross
  neutral: "•", // dot
};

const STATUS_VAR: Record<StatusKind, string> = {
  good: "var(--status-good)",
  warning: "var(--status-warning)",
  serious: "var(--status-serious)",
  critical: "var(--status-critical)",
  neutral: "var(--text-muted)",
};

/**
 * Status is never colour alone. Every badge ships the reserved status hue as a
 * small mark plus a text label, so it survives colour blindness, print and
 * forced-colors.
 */
export function StatusBadge({
  kind,
  label,
}: {
  kind: StatusKind;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-line-hair bg-surface-alt px-2 py-0.5 text-xs text-ink-secondary">
      <span aria-hidden="true" style={{ color: STATUS_VAR[kind] }}>
        {STATUS_ICON[kind]}
      </span>
      {label}
    </span>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded border border-line-hair px-1.5 py-0.5 text-[11px] text-ink-muted">
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

export function EmptyState({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="px-5 py-14 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-ink-muted">{body}</p>
    </div>
  );
}
