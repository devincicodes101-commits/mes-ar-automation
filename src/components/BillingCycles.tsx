"use client";

import { useMemo } from "react";
import { billingCycles, type BillingLine } from "@/lib/billing-cycles";
import { formatSgd } from "@/lib/data";
import { Card, CardHeader, Pagination } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { usePaged } from "@/lib/use-paged";
import { reminderDatesFor } from "@/lib/reminder-timing";
import { useReminderWindow } from "@/lib/use-reminder-window";

/* ------------------------------------------------------- billing cycles ---
 * Raman asked for this outright on 14 September: "in one report you may have
 * several billing dates, so under that is what's aging. If you can visually
 * show it in a way that's quite intuitive, that'd be great."
 *
 * The aging was already worked out per line. What was missing was any way to
 * see it: MES's August export carries 28 billing dates and every screen added
 * them together, so this month's rent and a bill from March nobody has paid
 * were one number.
 *
 * Collapsed to the six most recent, because 28 rows above the tenant table
 * would bury it. The rest are still counted in the summary line.
 *
 * Lives here rather than on the board because the dry run needs the same
 * table. MES's cycle diagram puts the billing date at the top and says
 * "everything below pivots off the latest AR report ... tagged to that
 * report's billing date", so a walkthrough of the month that never shows the
 * billing runs is a walkthrough missing its first step. Two copies would
 * drift, and the thing they would drift on is the credit period.
 */
/*
 * Simplified on 25 October: billed on, how many tenants, what is still owed,
 * and the two days the 9am run writes to them about it. The due date, the
 * credit clock, the names and the charge count were all on the row, and the
 * question somebody brings to this table is "what is left of each bill, and
 * when is it chased". The reminder days come from Settings, so they move when
 * MES change them there.
 */
export function BillingCycles({
  invoices,
  asOf,
}: {
  invoices: readonly BillingLine[];
  asOf: string | null;
}) {
  const { cycles, undated, undatedTotal } = useMemo(
    () => billingCycles(invoices, asOf),
    [invoices, asOf],
  );
  const { window: days } = useReminderWindow();
  /* Newest first, ten at a time: a report can carry hundreds of runs. */
  const { shown, pager } = usePaged(cycles, null, 10);
  if (cycles.length === 0) return null;

  const owed = cycles.reduce((s, c) => s + c.total, 0);

  return (
    <Card>
      <CardHeader
        title="What each billing run is still owed"
        hint={`${cycles.length} billing ${cycles.length === 1 ? "run" : "runs"} in this report`}
      />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line-grid text-left">
              <th className="px-5 py-2.5 text-xs font-medium text-ink-muted">Billed on</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-ink-muted">Tenants</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-ink-muted">Still owed</th>
              <th className="px-3 py-2.5 text-xs font-medium text-ink-muted">First reminder</th>
              <th className="px-5 py-2.5 text-xs font-medium text-ink-muted">Final notice</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => {
              const on = reminderDatesFor(c.billedOn, days);
              return (
                <tr key={c.billedOn} className="border-b border-line-hair last:border-0">
                  <td className="tabular whitespace-nowrap px-5 py-2.5 text-ink">{formatDate(c.billedOn)}</td>
                  <td className="tabular px-3 py-2.5 text-right text-ink-secondary" title={c.who.map((w) => w.name).join(", ")}>
                    {c.tenants}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right text-ink">{formatSgd(c.total)}</td>
                  <td className="tabular whitespace-nowrap px-3 py-2.5 text-ink-secondary">{on ? formatDate(on.first) : "-"}</td>
                  <td className="tabular whitespace-nowrap px-5 py-2.5 text-ink-secondary">{on ? formatDate(on.final) : "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination {...pager} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line-hair px-5 py-3 text-[11px] text-ink-muted">
        <span>
          <b className="text-ink-secondary">SGD {formatSgd(owed)}</b> still owed across all {cycles.length} runs.
        </span>
        {undated > 0 ? (
          <span>
            {undated} charge{undated === 1 ? "" : "s"} carry no billing date
            {undatedTotal !== 0 ? ` (${formatSgd(undatedTotal)})` : ""} and are
            not counted above.
          </span>
        ) : null}
      </div>
    </Card>
  );
}
