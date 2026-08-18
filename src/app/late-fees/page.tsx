"use client";

import { useMemo, useState } from "react";
import {
  DEFAULT_FEE_RULE,
  FeeBasis,
  FeeRule,
  feesDue,
  formatSgd,
} from "@/lib/data";
import { recordExport, useStore } from "@/lib/store";
import { useSession, useToast } from "@/lib/session";
import { useDataset, withManualEmails } from "@/lib/dataset";
import {
  Card,
  CardHeader,
  EmptyState,
  Modal,
  StatTile,
  StatusBadge,
  Tag,
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

  const lines = useMemo(
    () => feesDue(scope(ds.accounts), rule),
    [ds, rule, scope],
  );
  const totalFees = lines.reduce((s, l) => s + l.fee, 0);
  const repeat = lines.filter((l) => l.alreadyCharged > 0).length;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Accounts to be charged"
          value={String(lines.length)}
          note="Overdue on the 16th"
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
          right={<StatusBadge kind="warning" label="Rule not yet confirmed" />}
        />

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
          hint="Nothing is charged until you approve it."
          right={
            <button
              type="button"
              onClick={() => setPreview(true)}
              disabled={lines.length === 0 || !canAct}
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
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
                    <td className="px-3 py-3 text-right">
                      {l.alreadyCharged > 0 ? (
                        <StatusBadge
                          kind={l.alreadyCharged >= 3 ? "critical" : "warning"}
                          label={`${l.alreadyCharged} before`}
                        />
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
                    {lines.length} accounts
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
          </div>
        )}
      </Card>

      {preview ? (
        <Modal
          wide
          title="Raise late payment fees"
          onClose={() => setPreview(false)}
        >
          <p className="text-xs leading-relaxed text-ink-secondary">
            This raises {lines.length} fee notices totalling{" "}
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
              onClick={() => {
                recordExport(`Late payment fees, ${lines.length} notices`);
                notify(
                  `${lines.length} late payment fees raised`,
                  `SGD ${formatSgd(totalFees)} added across ${lines.length} accounts`,
                );
                setPreview(false);
              }}
              className="rounded border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90"
            >
              Raise the fees
            </button>
            <button
              type="button"
              onClick={() => setPreview(false)}
              className="rounded border border-line-hair px-4 py-2 text-sm text-ink-secondary hover:border-line-strong hover:text-ink"
            >
              Cancel
            </button>
            <StatusBadge kind="warning" label="Confirm the rule with MES first" />
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
