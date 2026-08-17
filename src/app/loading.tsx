import { Card, Skeleton, StatTileSkeleton, TableSkeleton } from "@/components/ui";

/**
 * Route-level skeleton. Next.js renders this while the segment loads, so the
 * officer sees the page shape immediately instead of a blank panel.
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      <div>
        <div className="mb-3 flex items-baseline justify-between">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTileSkeleton />
          <StatTileSkeleton />
          <StatTileSkeleton />
          <StatTileSkeleton />
        </div>
      </div>

      <Card>
        <div className="flex items-center justify-between border-b border-line-hair px-5 py-4">
          <div>
            <Skeleton className="h-3.5 w-48" />
            <Skeleton className="mt-2 h-3 w-72" />
          </div>
          <Skeleton className="h-7 w-40" />
        </div>
        <div className="flex gap-2 border-b border-line-hair px-5 py-2.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-24" />
          ))}
        </div>
        <TableSkeleton rows={10} />
      </Card>
    </div>
  );
}
