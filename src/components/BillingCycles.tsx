"use client";

import { useMemo, useState } from "react";
import {
  billingCycles,
  cycleStage,
  CREDIT_DAYS,
  type BillingCycle,
  type BillingLine,
} from "@/lib/billing-cycles";
import { formatSgd } from "@/lib/data";
import { Card, CardHeader, StatusBadge } from "@/components/ui";

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
export function BillingCycles({
  invoices,
  asOf,
}: {
  invoices: readonly BillingLine[];
  asOf: string | null;
}) {
  const [all, setAll] = useState(false);
  const { cycles, undated, undatedTotal } = useMemo(
    () => billingCycles(invoices, asOf),
    [invoices, asOf],
  );
  if (cycles.length === 0) return null;

  const shown = all ? cycles : cycles.slice(0, 6);
  const overdue = cycles.reduce((s, c) => s + c.overdue, 0);

  return (
    <Card>
      <CardHeader
        title="What each billing run is still owed"
        hint={`MES bill on the 15th, and adhoc runs happen on other dates too. Payment falls due ${CREDIT_DAYS} days after each one, so every run has its own clock. This upload contains ${cycles.length} of them.`}
        right={
          cycles.length > 6 ? (
            <button
              type="button"
              onClick={() => setAll((v) => !v)}
              className="rounded border border-line-hair px-2.5 py-1 text-[11px] text-ink-secondary hover:border-line-grid"
            >
              {all ? "Show recent only" : `Show all ${cycles.length}`}
            </button>
          ) : null
        }
      />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line-grid text-left">
              <th className="px-5 py-2.5 text-xs font-medium text-ink-muted">Billed on</th>
              <th className="px-3 py-2.5 text-xs font-medium text-ink-muted">Payment due</th>
              {/* Two different clocks run on this table and they must not read
                  as the same claim. This column counts from the billing date,
                  which is MES's 14 day credit rule and what the reminders are
                  timed off. The last column counts from the due date, which is
                  the file's own Age and decides whether money is chaseable. */}
              <th className="px-3 py-2.5 text-xs font-medium text-ink-muted">
                Credit clock, from billing
              </th>
              <th className="px-3 py-2.5 text-xs font-medium text-ink-muted">Who it covers</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-ink-muted">Tenants</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-ink-muted">Charges</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-ink-muted">Still owed</th>
              {/* Not "past due", which it said and which was wrong in the one
                  place it mattered. A run billed on the 11th falls due on the
                  26th and is five days past that by the 31st, yet MES bucket it
                  as Current and nothing may be chased: this column was printing
                  a dash two columns from a due date that had plainly passed.
                  What it counts is money old enough to act on. */}
              <th className="px-5 py-2.5 text-right text-xs font-medium text-ink-muted">
                Of that, chaseable
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => {
              const stage = cycleStage(c);
              return (
                <tr key={c.billedOn} className="border-b border-line-hair last:border-0">
                  <td className="tabular px-5 py-2.5 text-ink">{c.billedOn}</td>
                  <td className="tabular px-3 py-2.5 text-ink-secondary">{c.dueBy}</td>
                  <td className="px-3 py-2.5">
                    <StatusBadge
                      kind={
                        stage === "past 30 days"
                          ? "critical"
                          : stage === "past 14 days"
                            ? "warning"
                            : "good"
                      }
                      label={
                        c.ageDays === null
                          ? stage
                          : `${stage}${c.ageDays >= 0 ? ` · ${c.ageDays}d` : ""}`
                      }
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <Who cycle={c} />
                  </td>
                  <td className="tabular px-3 py-2.5 text-right text-ink-secondary">{c.tenants}</td>
                  <td className="tabular px-3 py-2.5 text-right text-ink-secondary">{c.lines}</td>
                  <td className="tabular px-3 py-2.5 text-right text-ink">{formatSgd(c.total)}</td>
                  <td className="tabular px-5 py-2.5 text-right font-medium text-ink">
                    {c.overdue === 0 ? (
                      <span className="text-ink-muted">&mdash;</span>
                    ) : (
                      formatSgd(c.overdue)
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line-hair px-5 py-3 text-[11px] text-ink-muted">
        <span>
          <b className="text-ink-secondary">{formatSgd(overdue)}</b> is old
          enough to chase across all {cycles.length} runs, which is the figure
          the tiles above count. That means more than fifteen days past the due
          date, which is where MES{"’"}s own aging stops calling a charge
          Current. A run can therefore be a few days past its due date and still
          hold nothing chaseable. The credit clock beside each run is a
          different measure again: it counts from the billing date, not the due
          date, so it always reads higher.
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

/* ----------------------------------------------------------------- who ---
 * A row reading "2 tenants · 7,400.00" cannot be checked against anything.
 * The names can: open the spreadsheet, filter column E on that billing date,
 * and the same companies should be there.
 *
 * Most runs are one company, so most rows simply name it. MES's August export
 * has 190 of its 315 runs that way. The largest has 166 companies in it, which
 * is why this summarises rather than listing: a cell that tall would push the
 * row it belongs to off the screen.
 */
function Who({ cycle }: { cycle: BillingCycle }) {
  const { who, properties } = cycle;
  if (who.length === 0) return <span className="text-ink-muted">&mdash;</span>;

  const names =
    who.length === 1
      ? who[0]!.name
      : who.length === 2
        ? `${who[0]!.name} and ${who[1]!.name}`
        : `${who[0]!.name} and ${who.length - 1} others`;

  const where =
    properties.length === 0
      ? null
      : properties.length === 1
        ? properties[0]
        : `${properties.length} dormitories`;

  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-ink-secondary" title={who.map((w) => w.name).join(", ")}>
        {names}
      </span>
      {where ? (
        <span className="text-[11px] uppercase tracking-wide text-ink-muted">
          {where}
        </span>
      ) : null}
    </span>
  );
}
