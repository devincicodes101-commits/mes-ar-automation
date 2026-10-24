"use client";

import { CALL_OUTCOMES, type CallLog } from "@/lib/store";
import type { TenantBilling } from "@/lib/billing-cycles";
import { formatDate, formatSgd } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { Modal } from "@/components/ui";

/**
 * A logged call, as the form was filled in.
 *
 * The list showed the outcome, who was spoken to and the note, and left out
 * when to check back - so the one date an officer set to come back to the
 * tenant could not be read anywhere (24 October). Every field of the form,
 * read only, in the order the form asks them.
 */
export function CallView({
  call: c,
  round,
  billing,
  onClose,
}: {
  call: CallLog;
  round: string;
  billing: TenantBilling;
  onClose: () => void;
}) {
  const said = CALL_OUTCOMES.find((o) => o.value === c.outcome)?.label ?? c.outcome;
  const row = (label: string, value: string) => (
    <div className="grid gap-1 border-b border-line-hair py-2.5 last:border-0 sm:grid-cols-[14rem_1fr] sm:gap-4">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="text-sm text-ink">{value}</dd>
    </div>
  );
  return (
    <Modal title={`Call with ${c.companyName}`} onClose={onClose}>
      <p className="text-[11px] text-ink-muted">Logged {formatDateTime(c.at)}</p>
      <dl className="mt-3">
        {row("Which reminder this call was about", round)}
        {row("Who they spoke to", c.reached || "Nobody named")}
        {row("What happened", said)}
        {c.outcome === "promised-to-pay" || c.promisedAmount !== null ? (
          <>
            {row("How much they agreed to pay", c.promisedAmount !== null ? `SGD ${formatSgd(c.promisedAmount)}` : "-")}
            {row("Date they said they would pay", formatDate(c.promisedDate) || "-")}
          </>
        ) : null}
        {row("When to check back", formatDate(c.nextActionDate) || "Not set")}
        {row("Anything else worth recording", c.notes || "Nothing written")}
        {row("How overdue they were", c.agingBucket || "-")}
        {row("Their bill", billing.billedOn ? `Billed ${formatDate(billing.billedOn)}, due ${formatDate(billing.dueBy)}` : "-")}
      </dl>
    </Modal>
  );
}
