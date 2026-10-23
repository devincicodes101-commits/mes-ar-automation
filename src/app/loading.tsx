import { PageSkeleton } from "@/components/ui";

/**
 * Route-level skeleton. Next.js renders this while the segment loads, so the
 * officer sees the page shape immediately instead of a blank panel.
 */
export default function Loading() {
  return <PageSkeleton />;
}
