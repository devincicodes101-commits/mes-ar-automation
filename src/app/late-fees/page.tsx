"use client";

import { useMemo, useState } from "react";
import {
  DEFAULT_FEE_RULE,
  FeeBasis,
  FeeRule,
  feesDue,
  formatSgd,
} from "@/lib/data";
import { hydrateActivity, recordExport, settledFees, useStore } from "@/lib/store";
import { raiseFees } from "@/lib/raise-fees";
import { useSession, useToast } from "@/lib/session";
import { useDataset, withManualEmails } from "@/lib/dataset";
import { giroEnrolled } from "@/lib/reports";
import {
  Card,
  CardHeader,
  EmptyState,
  Modal,
  StatTile,
  StatusBadge,
  Tag,
  ScrollPanel,
} from "@/components/ui";

/**
 * Late payment fees, proposal 4.8 and MES SOP section 2.3.
 *
 * Runs on the 16th. The rule itself is still unconfirmed by MES, so it is
 * editable here rather than buried in code. The default matches what the
 * sample data shows: the same flat charge repeating month after month.
 */
export default function LateFeesPage() {
  const store = useStore();
  const { scope, canAct } = useSession();
  const ds = withManualEmails(useDataset(), store.manualEmails);
  const { notify } = useToast();
  const [rule, setRule] = useState<FeeRule>(DEFAULT_FEE_RULE);
  const [preview, setPreview] = useState(false);
  /* Raising now goes over the network, so the button has to say so and refuse
     a second press while the first batch is still going. */
  const [raising, setRaising] = useState(false);

  /* The month being charged, as the first of it, which is how a fee is filed.
     The report date decides it, not today: a September report uploaded in
     October still charges September. */
  const period = ds.asOf ? `${ds.asOf.slice(0, 7)}-01` : null;

  const all = useMemo(
    () => feesDue(scope(ds.accounts), rule, ds.invoices, store.fees, period),
    [ds, rule, scope, store.fees, period],
  );

  /**
   * Tenants on GIRO, held back from the listing.
   *
   * Jacqueline's standing note to the AR team: "check if I might have included
   * the giro clients in the listing and remove accordingly." She does it by
   * hand every month.
   *
   * They are identifiable without the bank statement MES dropped, because a
   * bounced deduction raises its own invoice line. In their August export six
   * tenants carry a rejected-GIRO fee and six different ones carry the
   * ordinary late payment fee, and not one carries both.
   *
   * Held back and listed, never dropped: an exclusion nobody can see is an
   * exclusion nobody can check.
   */
  const onGiro = useMemo(() => giroEnrolled(ds.invoices), [ds.invoices]);
  const lines = useMemo(
    () => all.filter((l) => !onGiro.has(l.account.customerCode.toUpperCase())),
    [all, onGiro],
  );
  const excluded = useMemo(
    () => all.filter((l) => onGiro.has(l.account.customerCode.toUpperCase())),
    [all, onGiro],
  );
  // Where an upload carried no line detail the selection falls back to the
  // aging buckets, which cannot express "14 days past due". Said out loud
  // rather than left for somebody to discover from a figure that is slightly
  // off in a direction nobody can explain.
  const approximate = lines.filter((l) => l.approximate).length;

  /*
   * Charged already this month, so not chargeable again.
   *
   * Shown in the table with everybody else, because a month that quietly lost
   * three rows reads as a month where three tenants stopped owing anything.
   * Left out of the batch and out of the total, because the database would
   * refuse them anyway and a total that counts refusals is a total nobody can
   * reconcile.
   */
  /*
   * Fees raised against tenants who have since gone from the report.
   *
   * MES's rule: a company missing from a later file has paid. They already
   * drop off every screen, including this one, so the fee raised before they
   * paid had nowhere left to appear — it simply stopped being mentioned.
   * Shown here instead, because a charge that quietly evaporates is the kind
   * of thing a tenant asks about six weeks later.
   */
  const stillOwing = useMemo(() => new Set(ds.accounts.map((a) => a.id)), [ds.accounts]);
  const settled = useMemo(() => settledFees(store.fees, stillOwing), [store.fees, stillOwing]);

  const chargeable = lines.filter((l) => !l.raisedThisPeriod);
  const alreadyThisMonth = lines.length - chargeable.length;
  const totalFees = chargeable.reduce((s, l) => s + l.fee, 0);
  const repeat = lines.filter((l) => l.raisedByUs + l.billedByMes > 0).length;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Accounts to be charged"
          value={String(lines.length)}
          note={`Unpaid ${rule.minimumAgeDays} days past due`}
          emphasis
        />
        <StatTile
          label="Fees to raise"
          prefix="SGD"
          value={formatSgd(totalFees)}
          note="Added to each tenant's balance"
        />
        <StatTile
          label="Charged before"
          value={String(repeat)}
          note="Already carrying earlier late fees"
        />
        <StatTile
          label="Fee per account"
          prefix={rule.basis === "flat" ? "SGD" : undefined}
          value={
            rule.basis === "flat"
              ? formatSgd(rule.value)
              : `${rule.value}%`
          }
          note="Change the rule below"
        />
      </div>

      {/* ------------------------------------------------------------- rule */}
      <Card>
        <CardHeader
          title="How the fee is worked out"
          hint="Change the rule and the list below updates."
          right={
            <StatusBadge
              kind="good"
              label="Confirmed by MES's reminder letter"
            />
          }
        />

        {approximate > 0 ? (
          <div className="flex flex-wrap items-center gap-3 border-b border-line-hair bg-surface-alt px-5 py-2.5">
            <StatusBadge kind="warning" label={`${approximate} approximate`} />
            <p className="text-[11px] leading-relaxed text-ink-muted">
              These uploads carried no invoice dates, so the aging columns were
              used instead. Those cannot express &ldquo;
              {rule.minimumAgeDays} days past due&rdquo;, so a tenant who has
              just crossed the line may be missing. Amounts on the AR detail
              export would settle it.
            </p>
          </div>
        ) : null}

        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-secondary">
              Charge a
            </span>
            <select
              value={rule.basis}
              onChange={(e) =>
                setRule({ ...rule, basis: e.target.value as FeeBasis })
              }
              className="w-full rounded border border-line-hair bg-surface px-3 py-2 text-sm text-ink"
            >
              <option value="flat">Fixed amount</option>
              <option value="percent">Percentage of what is overdue</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-secondary">
              {rule.basis === "flat" ? "Amount in SGD" : "Percentage"}
            </span>
            <input
              type="number"
              step="0.01"
              value={rule.value}
              onChange={(e) =>
                setRule({ ...rule, value: Number(e.target.value) || 0 })
              }
              className="tabular w-full rounded border border-line-hair bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-secondary">
              Only if they owe more than
            </span>
            <input
              type="number"
              step="1"
              value={rule.minimumBalance}
              onChange={(e) =>
                setRule({
                  ...rule,
                  minimumBalance: Number(e.target.value) || 0,
                })
              }
              className="tabular w-full rounded border border-line-hair bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>

          <label className="flex items-end gap-2 pb-2">
            <input
              type="checkbox"
              checked={rule.skipTerminated}
              onChange={(e) =>
                setRule({ ...rule, skipTerminated: e.target.checked })
              }
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            <span className="text-xs text-ink-secondary">
              Skip tenants who have moved out
            </span>
          </label>
        </div>

      </Card>

      {/* ------------------------------------------------------------ lines */}
      <Card>
        <CardHeader
          title="Fees that would be raised this month"
          hint={
            alreadyThisMonth > 0
              ? `Nothing is charged until you approve it. ${alreadyThisMonth} of ` +
                `these ${alreadyThisMonth === 1 ? "has" : "have"} already been ` +
                "charged this month and will be left out."
              : "Nothing is charged until you approve it."
          }
          right={
            <button
              type="button"
              onClick={() => setPreview(true)}
              disabled={chargeable.length === 0 || !canAct}
              className="rounded border border-accent bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Review and raise
            </button>
          }
        />

        {lines.length === 0 ? (
          <EmptyState
            title="No fees would be charged"
            body="No tenant meets the rule above."
          />
        ) : (
          <ScrollPanel max={440}>
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="border-b border-line-grid text-left">
                  <th className="px-5 py-2.5 text-xs font-medium text-ink-muted">
                    Tenant
                  </th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-ink-muted">
                    Overdue
                  </th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-ink-muted">
                    Fees already charged
                  </th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-ink-muted">
                    Fee this month
                  </th>
                  <th className="px-5 py-2.5 text-right text-xs font-medium text-ink-muted">
                    New balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr
                    key={l.account.id}
                    className="border-b border-line-grid hover:bg-surface-alt"
                  >
                    <td className="px-5 py-3">
                      <div className="font-medium text-ink">
                        {l.account.companyName}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] text-ink-muted">
                          {l.account.customerCode} · {l.account.property}
                        </span>
                        {l.account.status === "Terminated" ? (
                          <Tag>Moved out</Tag>
                        ) : null}
                      </div>
                    </td>
                    <td className="tabular px-3 py-3 text-right text-ink-secondary">
                      {formatSgd(l.overdue)}
                    </td>
                    {/* Both answers, side by side, because they are different
                        facts. "MES have billed this" comes from the uploaded
                        report; "we raised this" comes from what the system
                        itself did on the 16th. A fee waits in the second until
                        somebody at MES enters it into the first, and showing
                        only NetSuite made every tenant read as "first time"
                        however many months running we had charged them. */}
                    <td className="px-3 py-3 text-right">
                      {l.raisedByUs > 0 || l.billedByMes > 0 ? (
                        <div className="flex flex-col items-end gap-1">
                          {l.raisedByUs > 0 ? (
                            <StatusBadge
                              kind={l.raisedByUs + l.billedByMes >= 3 ? "critical" : "warning"}
                              label={
                                l.raisedThisPeriod
                                  ? "raised this month"
                                  : `${l.raisedByUs} raised by us`
                              }
                            />
                          ) : null}
                          {l.billedByMes > 0 ? (
                            <span className="text-[11px] text-ink-muted">
                              {l.billedByMes} billed in NetSuite
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-xs text-ink-muted">first time</span>
                      )}
                    </td>
                    <td className="tabular px-3 py-3 text-right font-medium text-ink">
                      {formatSgd(l.fee)}
                    </td>
                    <td className="tabular px-5 py-3 text-right text-ink-secondary">
                      {formatSgd(l.account.total + l.fee)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line-base font-medium">
                  <td className="px-5 py-3 text-xs text-ink-secondary">
                    {chargeable.length} accounts
                  </td>
                  <td className="tabular px-3 py-3 text-right text-xs text-ink" />
                  <td />
                  <td className="tabular px-3 py-3 text-right text-xs text-ink">
                    {formatSgd(totalFees)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </ScrollPanel>
        )}
      </Card>

      {settled.length > 0 ? (
        <Card>
          <CardHeader
            title="No longer chargeable — these tenants have paid"
            hint="They are gone from the latest report, which MES read as paid in full. The fee is not pursued, and the record of having raised it is kept."
            right={<StatusBadge kind="good" label={`${settled.length} settled`} />}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line-hair text-left text-xs text-ink-muted">
                  <th className="px-5 py-2 font-medium">Tenant</th>
                  <th className="px-3 py-2 font-medium">Month it was raised for</th>
                  <th className="px-5 py-2 text-right font-medium">Fee</th>
                </tr>
              </thead>
              <tbody>
                {settled.map((f) => (
                  <tr key={f.id} className="border-b border-line-hair last:border-0">
                    <td className="px-5 py-3 text-ink-secondary">{f.tenantId}</td>
                    <td className="tabular px-3 py-3 text-ink-secondary">{f.period.slice(0, 7)}</td>
                    <td className="tabular px-5 py-3 text-right text-ink-secondary">
                      {formatSgd(f.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* The exclusion, shown rather than silently applied. */}
      {excluded.length > 0 ? (
        <Card>
          <CardHeader
            title="Held back because they are on GIRO"
            hint="Jacqueline removes these by hand each month. They are identified by carrying a rejected-GIRO fee, so no bank statement is needed."
            right={
              <StatusBadge
                kind="warning"
                label={`${excluded.length} excluded`}
              />
            }
          />
          <ScrollPanel max={280}>
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="border-b border-line-grid text-left">
                  <th className="px-5 py-2.5 text-xs font-medium text-ink-muted">
                    Tenant
                  </th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-ink-muted">
                    Overdue
                  </th>
                  <th className="px-5 py-2.5 text-xs font-medium text-ink-muted">
                    Why
                  </th>
                </tr>
              </thead>
              <tbody>
                {excluded.map((l) => (
                  <tr key={l.account.id} className="border-b border-line-grid">
                    <td className="px-5 py-2.5">
                      <span className="text-ink">{l.account.companyName}</span>
                      <span className="ml-2 text-[11px] text-ink-muted">
                        {l.account.customerCode}
                      </span>
                    </td>
                    <td className="tabular px-3 py-2.5 text-right text-ink-secondary">
                      {formatSgd(l.overdue)}
                    </td>
                    <td className="px-5 py-2.5 text-[11px] text-ink-muted">
                      Carries a rejected-GIRO fee
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollPanel>
        </Card>
      ) : null}

      {preview ? (
        <Modal
          wide
          title="Raise late payment fees"
          onClose={() => setPreview(false)}
        >
          <p className="text-xs leading-relaxed text-ink-secondary">
            This raises {chargeable.length} fee notices totalling{" "}
            <span className="tabular font-medium text-ink">
              SGD {formatSgd(totalFees)}
            </span>
            . Each one is added to the tenant&apos;s statement and included in
            the file you load back into NetSuite.
          </p>

          <div className="mt-4 rounded border border-line-hair bg-surface-alt px-4 py-3">
            <p className="text-[11px] font-medium text-ink-secondary">
              Rule being applied
            </p>
            <p className="mt-1 text-xs text-ink">
              {rule.basis === "flat"
                ? `SGD ${formatSgd(rule.value)} per account`
                : `${rule.value}% of the overdue balance`}
              {rule.minimumBalance > 0
                ? `, only where more than SGD ${formatSgd(rule.minimumBalance)} is overdue`
                : ""}
              {rule.skipTerminated ? ", excluding tenants who have moved out" : ""}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line-hair pt-4">
            <button
              type="button"
              disabled={raising}
              onClick={async () => {
                /*
                 * Raised, then reported. This used to call recordExport(),
                 * which writes one line into the browser's own activity log
                 * and charges nobody: the toast said three fees had been
                 * raised and the database was untouched. The schedule on the
                 * 16th was the only thing that ever charged a tenant.
                 */
                setRaising(true);
                const outcome = await raiseFees(
                  chargeable.map((l) => ({
                    tenantId: l.account.id,
                    companyName: l.account.companyName,
                    period: period as string,
                    amount: l.fee,
                  })),
                );
                setRaising(false);

                if (outcome.raised > 0) {
                  recordExport(`Late payment fees, ${outcome.raised} notices`);
                }
                notify(outcome.title, outcome.detail);
                await hydrateActivity(true);
                if (outcome.failed === 0) setPreview(false);
              }}
              className="rounded border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90"
            >
              {raising ? "Raising..." : "Raise the fees"}
            </button>
            <button
              type="button"
              onClick={() => setPreview(false)}
              className="rounded border border-line-hair px-4 py-2 text-sm text-ink-secondary hover:border-line-strong hover:text-ink"
            >
              Cancel
            </button>
            <StatusBadge kind="good" label="$100 flat, before GST" />
          </div>
        </Modal>
      ) : null}

      {store.audit.some((a) => a.subject.startsWith("Late payment fees")) ? (
        <Card>
          <CardHeader title="Raised this session" />
          <ul className="divide-y divide-line-grid">
            {store.audit
              .filter((a) => a.subject.startsWith("Late payment fees"))
              .map((a) => (
                <li key={a.id} className="flex gap-4 px-5 py-2.5 text-xs">
                  <span className="w-40 shrink-0 text-ink-muted">
                    {new Date(a.at).toLocaleString("en-SG")}
                  </span>
                  <span className="text-ink-secondary">{a.subject}</span>
                </li>
              ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
