"use client";

import { ScheduleView } from "@/components/ScheduleView";

/* The Schedule on its own. Since 24 October it is the 9am runs tab of the
   Activity Log; this address still opens it, so no bookmark breaks. */
export default function SchedulePage() {
  return <ScheduleView />;
}
