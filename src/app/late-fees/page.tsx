"use client";

import { useMemo, useState } from "react";
import {
  DEFAULT_FEE_RULE,
  FeeBasis,
  FeeRule,
  feesDue,
  formatDate,
  formatSgd,
} from "@/lib/data";
import { isAdHoc, type FeeBill } from "@/lib/billing-cycles";
import { useRules } from "@/lib/use-rules";
import { hydrateActivity, recordExport, settledFees, useStore } from "@/lib/store";
import { raiseFees } from "@/lib/raise-fees";
import { useSession, useToast } from "@/lib/session";
import { useDataset, withManualEmails } from "@/lib/dataset";
import { buildLateFeeListing, giroEnrolled } from "@/lib/reports";
import { lateFeeName, lateFeeXlsx } from "@/lib/workbook";
import { downloadFile } from "@/lib/export";
import { managerDisplayName } from "@/lib/dispatch";
import { currentPeriod } from "@/lib/schedule";
import { formatDateTime, formatMonth } from "@/lib/format";
import {
  Card,
  CardHeader,
  EmptyState,
  Modal,
  StatTile,
  StatusBadge,
  Tag,
  TenantLink,
  Pagination,
} from "@/components/ui";
import { usePaged } from "@/lib/use-paged";

/**
 * Late payment fees, proposal 4.8 and MES SOP section 2.3.
 *
 * Runs on the 16th. The rule itself is still unconfirmed by MES, so it is
 * editable here rather than buried in code. The default matches what the
 * sample data shows: the same flat charge repeating month after month.
 */
export default function LateFeesPage() {
  const store = useStore();
  const { scope, canAct, can } = useSession();
  const ds = withManualEmails(useDataset(), store.manualEmails);
  const { notify } = useToast();
  const [ruleDraft, setRule] = useState<FeeRule>(DEFAULT_FEE_RULE);
  /* How many days, and counted from which date, is Settings', as the 9am
     run reads it; the rest of the rule is this screen's to try out. */
  const { rules } = useRules();
  const rule = useMemo<FeeRule>(
    () => ({ ...ruleDraft, minimumAgeDays: rules.feeDays, from: rules.feeFrom }),
    [ruleDraft, rules.feeDays, rules.feeFrom],
  );
  const pastWhat = rule.from === "billing" ? "after billing" : "past due";
  const [preview, setPreview] = useState(false);
  /* The rule is right as it stands; changing it is a deliberate step. */
  const [editingRule, setEditingRule] = useState(false);
  const [showSettled, setShowSettled] = useState(false);
  /* Raising now goes over the network, so the button has to say so and refuse
     a second press while the first batch is still going. */
  const [raising, setRaising] = useState(false);

  /* The month being charged, as the first of it, which is how a fee is filed.
     From the calendar, not from the report. MES's rule is a calendar rule —
     the $100 applies "if payment is not received by the 15th day of each
     calendar month" — and the schedule that raises these on the 16th has
     always read it that way. Taking it off the uploaded sheet instead meant
     that opening a December report in November made this screen look up
     December, find no fees, and offer to charge everybody a second time. */
  const period = currentPeriod();

  /*
   * Whose tenants to issue the fee for.
   *
   * MES's Flow tab, under the 16th: "Send report to AR team (provide User the
   * option to select one or more RMs from drop down to send email)". The
   * report goes to the AR team, so the managers cannot be the recipients —
   * they are which book the AR team is being asked to issue against. One
   * manager at a time is how somebody works through a month without issuing
   * eight hundred fees in a single press.
   *
   * Empty means everybody, rather than nobody. A filter that starts by hiding
   * the whole list reads as a broken screen, and the common case is issuing
   * the lot.
   */
  /* From the report's own tenants rather than from whoever happens to be
     chargeable, so the list of managers does not change shape as fees are
     raised through the month. */
  const managers = useMemo(() => {
    const seen = new Set<string>();
    for (const a of scope(ds.accounts)) {
      const rm = (a as { rm?: string }).rm;
      if (rm) seen.add(rm);
    }
    return Array.from(seen).sort();
  }, [ds.accounts, scope]);
  const [onlyRms, setOnlyRms] = useState<string[]>([]);
  /* The Aging Detail export has no Status column, so nobody reads as moved
     out and the "skip moved-out tenants" choice would change nothing. */
  const anyMovedOut = useMemo(
    () => ds.accounts.some((a) => a.status === "Terminated"),
    [ds.accounts],
  );
  /*
   * The manager chips answer "whose tenants", which is the question MES's Flow
   * tab asked for. They do not answer "is this one tenant on the list", and on
   * the 16th that is the question somebody rings up with.
   */
  const [query, setQuery] = useState("");

  /*
   * The listing as MES attach it, built from the same accounts and the same
   * rule the table below shows. Built here rather than carried on the dataset
   * because the fee and the minimum age are settings on this screen: a file
   * built from anything else could disagree with what the officer is looking
   * at while they press the button.
   */
  const listing = useMemo(
    () =>
      buildLateFeeListing(
        /* The same narrowing the table shows. A file that disagreed with the
           screen it was downloaded from is worse than no file. */
        scope(ds.accounts).filter((a) => {
          if (onlyRms.length === 0) return true;
          const rm = (a as { rm?: string }).rm;
          return rm ? onlyRms.includes(rm) : false;
        }),
        ds.invoices, ds.asOf, null, {
        fee: rule.value,
        minimumAgeDays: rule.minimumAgeDays,
        from: rule.from,
        raised: store.fees,
        period,
      }),
    [ds, rule, scope, store.fees, period, onlyRms],
  );

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

  const byManager = useMemo(
    () =>
      onlyRms.length === 0
        ? all
        : all.filter((l) => {
            const rm = (l.account as { rm?: string }).rm;
            return rm ? onlyRms.includes(rm) : false;
          }),
    [all, onlyRms],
  );

  const lines = useMemo(
    () => byManager.filter((l) => !onGiro.has(l.account.customerCode.toUpperCase())),
    [byManager, onGiro],
  );
  const excluded = useMemo(
    () => byManager.filter((l) => onGiro.has(l.account.customerCode.toUpperCase())),
    [byManager, onGiro],
  );

  /*
   * What the table shows. Deliberately not what gets charged: the search is a
   * way of looking, and narrowing the view must never narrow the run. Review
   * and raise still works from `chargeable`, so a half-typed search cannot
   * quietly drop a tenant out of the month's fees.
   */
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return lines;
    return lines.filter(
      (l) =>
        l.account.companyName.toLowerCase().includes(q) ||
        l.account.customerCode.toLowerCase().includes(q),
    );
  }, [lines, query]);
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

  const feePage = usePaged(shown, `${query}|${onlyRms.join(",")}`);
  const settledPage = usePaged(settled);
  const excludedPage = usePaged(excluded);

  const chargeable = lines.filter((l) => !l.raisedThisPeriod);
  const alreadyThisMonth = lines.length - chargeable.length;
  const totalFees = chargeable.reduce((s, l) => s + l.fee, 0);
  const repeat = lines.filter((l) => l.raisedByUs + l.billedByMes > 0).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile
          label="Accounts to be charged"
          value={String(lines.length)}
          note={`Unpaid ${rule.minimumAgeDays} days ${pastWhat}`}
          emphasis
        />
        <StatTile
          label="Fees to raise"
          prefix="SGD"
          value={formatSgd(totalFees)}
        />
        <StatTile
          label="Charged before"
          value={String(repeat)}
        />
        <StatTile
          label="Fee per account"
          prefix={rule.basis === "flat" ? "SGD" : undefined}
          value={
            rule.basis === "flat"
              ? formatSgd(rule.value)
              : `${rule.value}%`
          }
        />
      </div>

      {/* ------------------------------------------------------------- rule */}
      <Card>
        <CardHeader
          title="How the fee is worked out"
          hint={
            `${rule.basis === "flat" ? `SGD ${formatSgd(rule.value)} per account` : `${rule.value}% of what is overdue`}` +
            `, for tenants unpaid ${rule.minimumAgeDays} days ${pastWhat}` +
            `${rule.minimumBalance > 0 ? ` who owe more than SGD ${formatSgd(rule.minimumBalance)}` : ""}` +
            `${rule.skipTerminated && anyMovedOut ? ". Moved-out tenants are skipped." : "."}`
          }
          right={
            <button
              type="button"
              onClick={() => setEditingRule(!editingRule)}
              aria-expanded={editingRule}
              className="rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium text-ink-secondary hover:border-accent hover:text-accent-text"
            >
              {editingRule ? "Done" : "Change for this run"}
            </button>
          }
        />

        {approximate > 0 ? (
          <div className="flex flex-wrap items-center gap-3 border-b border-line-hair bg-surface-alt px-5 py-2.5">
            <StatusBadge kind="warning" label={`${approximate} approximate`} />
            <p className="text-[11px] leading-relaxed text-ink-muted">
              The report has no invoice dates for these, so a tenant who has
              only just passed {rule.minimumAgeDays} days may be missing.
            </p>
          </div>
        ) : null}

        {editingRule ? (
        <div className="grid gap-4 px-4 py-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-secondary">
              Charge a
            </span>
            <select
              value={rule.basis}
              onChange={(e) =>
                setRule({ ...rule, basis: e.target.value as FeeBasis })
              }
              className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
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
              className="tabular w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
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
              className="tabular w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>

          {anyMovedOut ? (
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
          ) : null}
        </div>
        ) : null}
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
          /*
           * Two buttons: the listing MES attach when they ask the AR team to
           * issue the fee, and the approval that actually raises it.
           *
           * Jacqueline's email is two sentences and a spreadsheet, and until
           * now the spreadsheet had nowhere to come from — the listing was
           * built, shown on this screen, and could not leave it. The GIRO
           * exclusions are in the file too, named rather than dropped,
           * because her second sentence asks the AR team to check for them
           * and a listing that had already removed them gives nobody anything
           * to check.
           */
          right={
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!can("generate-reports")}
                onClick={() =>
                  downloadFile(
                    lateFeeName(period),
                    lateFeeXlsx(listing, period),
                  )
                }
                className="rounded-md border border-line-strong px-3 py-1.5 text-xs text-ink-secondary hover:border-accent hover:text-accent-text disabled:opacity-40"
              >
                Download the listing
              </button>
              <button
                type="button"
                onClick={() => setPreview(true)}
                disabled={chargeable.length === 0 || !canAct}
                className="rounded-md border border-accent bg-accent px-3.5 py-1.5 text-xs font-medium text-accent-ink"
              >
                {chargeable.length === 0 ? "Nothing to raise" : "Review and raise"}
              </button>
            </div>
          }
        />

        {/*
          * Whose tenants, and finding one. Their own row: in the header they
          * squeezed the title to a word a line and ran off the screen.
          *
          * MES's Flow tab, under the 16th: "provide User the option to select
          * one or more RMs from drop down". Chips rather than a select, because
          * "one or more" is the requirement. Hidden when the report names no
          * managers at all, which is what an export without the Primary Sales
          * Rep column looks like.
          */}
        <div className="flex flex-col gap-3 border-b border-line-hair bg-surface-alt px-4 py-3 sm:px-5 lg:flex-row lg:items-start">
          {managers.length > 0 ? (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" role="group" aria-label="Manager">
              <button
                type="button"
                aria-pressed={onlyRms.length === 0}
                onClick={() => setOnlyRms([])}
                className={`rounded-full border px-3 py-1 text-xs ${
                  onlyRms.length === 0
                    ? "border-accent bg-accent-wash font-medium text-accent-text"
                    : "border-line-hair bg-surface text-ink-secondary hover:border-line-strong hover:text-ink"
                }`}
              >
                Every manager
              </button>
              {managers.map((m) => (
                <button
                  key={m}
                  type="button"
                  title={m}
                  onClick={() =>
                    setOnlyRms((was) =>
                      was.includes(m) ? was.filter((x) => x !== m) : [...was, m],
                    )
                  }
                  aria-pressed={onlyRms.includes(m)}
                  className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs ${
                    onlyRms.includes(m)
                      ? "border-accent bg-accent-wash font-medium text-accent-text"
                      : "border-line-hair bg-surface text-ink-secondary hover:border-line-strong hover:text-ink"
                  }`}
                >
                  {managerLabel(m)}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex-1" />
          )}
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a tenant by name or code"
            aria-label="Find a tenant"
            className="w-full shrink-0 rounded-md border bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted sm:text-xs lg:w-64"
          />
        </div>

        {lines.length === 0 ? (
          <EmptyState
            title="No fees would be charged"
            body="No tenant meets the rule above."
          />
        ) : shown.length === 0 ? (
          <EmptyState
            title="No tenant matches that search"
            body="Clear the search to see everyone. Searching never changes what gets charged."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm sm:min-w-[760px]">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="border-b border-line-grid text-left">
                  <th className="px-4 py-2.5 text-xs font-medium text-ink-muted sm:px-5">
                    Tenant
                  </th>
                  <th className="hidden px-3 py-2.5 text-right text-xs font-medium text-ink-muted sm:table-cell">
                    Overdue
                  </th>
                  <th className="hidden px-3 py-2.5 text-right text-xs font-medium text-ink-muted sm:table-cell">
                    Fees already charged
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-ink-muted sm:px-3">
                    Fee this month
                  </th>
                  <th className="hidden px-5 py-2.5 text-right text-xs font-medium text-ink-muted sm:table-cell">
                    New balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {feePage.shown.map((l) => (
                  <tr
                    key={l.account.id}
                    className="border-b border-line-grid hover:bg-surface-alt"
                  >
                    <td className="px-4 py-3 sm:px-5">
                      <div className="font-medium text-ink">
                        <TenantLink id={l.account.id} name={l.account.companyName} />
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] text-ink-muted">
                          {l.account.customerCode} · {l.account.property}
                        </span>
                        {l.account.status === "Terminated" ? (
                          <Tag>Moved out</Tag>
                        ) : null}
                      </div>
                      <BilledOn bills={l.feeBills} regularDay={rules.regularBillingDay} />
                      {/* On a phone the other columns fold in here. */}
                      <div className="tabular mt-1 text-[11px] text-ink-secondary sm:hidden">
                        Overdue {formatSgd(l.overdue)} ·{" "}
                        {l.raisedByUs + l.billedByMes > 0
                          ? `${l.raisedByUs + l.billedByMes} charged before`
                          : "first time"}
                      </div>
                    </td>
                    <td className="tabular hidden px-3 py-3 text-right text-ink-secondary sm:table-cell">
                      {formatSgd(l.overdue)}
                    </td>
                    {/* Both answers, side by side, because they are different
                        facts. "MES have billed this" comes from the uploaded
                        report; "we raised this" comes from what the system
                        itself did on the 16th. A fee waits in the second until
                        somebody at MES enters it into the first, and showing
                        only NetSuite made every tenant read as "first time"
                        however many months running we had charged them. */}
                    <td className="hidden px-3 py-3 text-right sm:table-cell">
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
                          {/*
                            * The months, not only the count.
                            *
                            * "1 raised by us" is a number with no date on it,
                            * and everybody reads it as "last month". It can be
                            * any month at all, and the difference changes what
                            * an officer does next: a fee raised eleven months
                            * ago and one raised last month are different
                            * tenants with the same badge.
                            */}
                          {l.raisedIn.length > 0 ? (
                            <span className="text-[11px] text-ink-muted">
                              {l.raisedIn.join(", ")}
                            </span>
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
                    <td className="tabular px-4 py-3 text-right font-medium text-ink sm:px-3">
                      {formatSgd(l.fee)}
                    </td>
                    <td className="tabular hidden px-5 py-3 text-right text-ink-secondary sm:table-cell">
                      {formatSgd(l.account.total + l.fee)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line-base font-medium">
                  <td className="px-4 py-3 text-xs text-ink-secondary sm:px-5">
                    {chargeable.length} accounts
                  </td>
                  <td className="hidden sm:table-cell" />
                  <td className="hidden sm:table-cell" />
                  <td className="tabular px-4 py-3 text-right text-xs text-ink sm:px-3">
                    {formatSgd(totalFees)}
                  </td>
                  <td className="hidden sm:table-cell" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <Pagination {...feePage.pager} />
      </Card>

      {settled.length > 0 ? (
        <Card>
          <CardHeader
            title="Settled: these tenants have since paid"
            right={
              <div className="flex items-center gap-2">
                <StatusBadge kind="good" label={`${settled.length} settled`} />
                <button
                  type="button"
                  onClick={() => setShowSettled(!showSettled)}
                  aria-expanded={showSettled}
                  className="rounded-md border border-line-strong px-3 py-1.5 text-xs text-ink-secondary hover:border-accent hover:text-accent-text"
                >
                  {showSettled ? "Hide" : "Show"}
                </button>
              </div>
            }
          />
          {showSettled ? (
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
                {settledPage.shown.map((f) => (
                  <tr key={f.id} className="border-b border-line-hair last:border-0">
                    <td className="px-5 py-3 text-ink-secondary">
                      {f.companyName ?? "Former tenant"}
                    </td>
                    <td className="tabular px-3 py-3 text-ink-secondary">{formatMonth(f.period)}</td>
                    <td className="tabular px-5 py-3 text-right text-ink-secondary">
                      {formatSgd(f.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination {...settledPage.pager} />
          </div>
          ) : null}
        </Card>
      ) : null}

      {/* The exclusion, shown rather than silently applied. */}
      {excluded.length > 0 ? (
        <Card>
          <CardHeader
            title="Left out: on GIRO"
            hint="Each has a rejected-GIRO fee in the report, so the late fee is not raised for them."
            right={
              <StatusBadge
                kind="warning"
                label={`${excluded.length} excluded`}
              />
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="border-b border-line-grid text-left">
                  <th className="px-4 py-2.5 text-xs font-medium text-ink-muted sm:px-5">
                    Tenant
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-ink-muted sm:px-5">
                    Overdue
                  </th>
                </tr>
              </thead>
              <tbody>
                {excludedPage.shown.map((l) => (
                  <tr key={l.account.id} className="border-b border-line-grid">
                    <td className="px-4 py-2.5 sm:px-5">
                      <TenantLink id={l.account.id} name={l.account.companyName} className="text-ink" />
                      <div className="mt-0.5 text-[11px] text-ink-muted">{l.account.customerCode}</div>
                      <BilledOn bills={l.feeBills} regularDay={rules.regularBillingDay} />
                    </td>
                    <td className="tabular px-4 py-2.5 text-right align-top text-ink-secondary sm:px-5">
                      {formatSgd(l.overdue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination {...excludedPage.pager} />
        </Card>
      ) : null}

      {preview ? (
        <Modal
          wide
          title="Raise late payment fees"
          onClose={() => setPreview(false)}
        >
          <p className="text-xs leading-relaxed text-ink-secondary">
            This raises {chargeable.length} {chargeable.length === 1 ? "fee notice" : "fee notices"} totalling{" "}
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
                    period,
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
                    {formatDateTime(a.at)}
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

/**
 * Which bills a fee is for, for the late-fee tables.
 *
 * Raman, 18 October: the fee stays on the fixed 16th, but the officer should
 * see when the bill behind it was raised, and a bill raised off the normal
 * cycle is marked ad hoc. These are the billing dates more than 14 days past
 * due - the ones the fee is charged on - not the tenant's newest bill, which
 * may not be late at all. The newest three are named - they are the ones an
 * officer is asked about - and the rest are counted, back to the oldest.
 */
const SHOWN_BILLS = 3;

function BilledOn({ bills, regularDay }: { bills: readonly FeeBill[]; regularDay: number }) {
  if (bills.length === 0) {
    return <div className="mt-0.5 text-[11px] text-ink-muted">No billing date in this file</div>;
  }
  /* bills arrive oldest first; the newest are the ones worth naming. */
  const shown = bills.slice(-SHOWN_BILLS).reverse();
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-ink-muted">
      <span>{bills.length === 1 ? "For the bill of" : "For bills of"}</span>
      {shown.map((b, i) => (
        <span key={b.billedOn} className="inline-flex items-center gap-1">
          <span className="text-ink-secondary">{formatDate(b.billedOn)}</span>
          {isAdHoc(b.billedOn, regularDay) ? <Tag>Ad hoc</Tag> : null}
          {i < shown.length - 1 ? <span aria-hidden>·</span> : null}
        </span>
      ))}
      {bills.length > SHOWN_BILLS ? (
        <span>
          and {bills.length - SHOWN_BILLS} more, back to {formatDate(bills[0]!.billedOn)}
        </span>
      ) : null}
    </div>
  );
}

/** A manager as a person: "2611 Ray Ang" reads "Ray Ang", NetSuite's own account says so. */
function managerLabel(key: string): string {
  if (/do not delete/i.test(key)) return "NetSuite system account";
  return managerDisplayName(key);
}
