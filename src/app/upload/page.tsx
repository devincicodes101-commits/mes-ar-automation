"use client";

import { useState } from "react";
import { allAccounts, data, formatSgd, kpis } from "@/lib/data";
import { Card, CardHeader, Skeleton, StatusBadge, Tag } from "@/components/ui";

type Phase = "idle" | "parsing" | "done";

/**
 * Upload Centre.
 *
 * The prototype simulates the parse so the sign-off walkthrough can start here.
 * The real parse runs server side in FastAPI; this screen only ever shows the
 * batch summary it returns.
 */
export default function UploadPage() {
  const [phase, setPhase] = useState<Phase>("idle");

  const accounts = allAccounts();
  const k = kpis(accounts);
  const withEmail = accounts.filter((a) => a.hasContact).length;

  function runParse() {
    setPhase("parsing");
    window.setTimeout(() => setPhase("done"), 1400);
  }

  return (
    <div className="space-y-6">
      <div className="mb-1 flex items-baseline justify-between">
        <h1 className="text-base font-semibold text-ink">Upload Centre</h1>
        <p className="text-xs text-ink-muted">
          Two files in, one clean export out. No connection to NetSuite or the bank.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DropZone
          title="AR Report"
          hint="AR reports-Final.xlsx, the multi worksheet export from NetSuite"
          sheets={[
            "Detailed Full Report",
            "Stamp Duty",
            "Park Fee",
            "Late Fee",
            "Industry",
            "RM - User1",
            "RM - User2",
            "Contact Details",
          ]}
        />
        <DropZone
          title="DBS Bulk Collection Report"
          hint="The unsuccessful GIRO statement for the billing period"
          sheets={["NO DDA rejections", "REFER PAYING PARTY rejections"]}
        />
      </div>

      <div>
        <button
          type="button"
          onClick={runParse}
          disabled={phase === "parsing"}
          className="rounded bg-brand px-4 py-2 text-sm font-medium text-brand-ink disabled:opacity-60"
        >
          {phase === "parsing" ? "Parsing…" : "Parse and match"}
        </button>
      </div>

      {phase === "parsing" ? <ParseSkeleton /> : null}

      {phase === "done" ? (
        <Card>
          <CardHeader
            title="Batch summary"
            hint={`AR report as of ${data.asOfSummary}. Review anything flagged before working the queue.`}
          />

          <dl className="grid gap-px bg-line-grid sm:grid-cols-2 lg:grid-cols-4">
            <Figure label="Accounts parsed" value={String(k.accounts)} />
            <Figure
              label="Total outstanding"
              value={`SGD ${formatSgd(k.outstanding)}`}
            />
            <Figure label="DBS items" value="147" />
            <Figure label="Rejected" value="23" />
          </dl>

          <div className="space-y-2.5 border-t border-line-hair px-5 py-4">
            <Line
              kind="good"
              label="GIRO rejections split"
              detail="1 NO DDA routed to GIRO setup, 22 REFER PAYING PARTY routed to collections."
            />
            <Line
              kind="good"
              label="Revenue types segmented"
              detail={`${
                new Set(data.invoices.map((i) => i.revenueType)).size
              } types detected, including 1FM maintenance found in the invoice description text.`}
            />
            <Line
              kind="warning"
              label="Contact coverage"
              detail={`${withEmail} of ${k.accounts} accounts have an email address. Reminders cannot be drafted for the rest until MES supplies the master contact list.`}
            />
            <Line
              kind="warning"
              label="Unmatched GIRO lines"
              detail="5 rejections could not be matched to an AR account. The DBS report carries a DDA reference and bank account; the AR report carries neither, so these need manual matching."
            />
            <Line
              kind="good"
              label="Accounts in credit excluded"
              detail={`${k.inCredit} accounts carry a negative balance and were removed from all chasing.`}
            />
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function DropZone({
  title,
  hint,
  sheets,
}: {
  title: string;
  hint: string;
  sheets: string[];
}) {
  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>

      <div className="mt-3 rounded border border-dashed border-line-base px-4 py-8 text-center">
        <p className="text-xs text-ink-secondary">
          Drop the file here, or click to browse
        </p>
        <p className="mt-1 text-[11px] text-ink-muted">xlsx, xls, csv or pdf</p>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {sheets.map((s) => (
          <Tag key={s}>{s}</Tag>
        ))}
      </div>
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-5 py-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </dt>
      <dd className="mt-1.5 text-xl font-semibold text-ink">{value}</dd>
    </div>
  );
}

function Line({
  kind,
  label,
  detail,
}: {
  kind: "good" | "warning" | "serious" | "critical";
  label: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="pt-0.5">
        <StatusBadge kind={kind} label={label} />
      </div>
      <p className="text-xs leading-relaxed text-ink-secondary">{detail}</p>
    </div>
  );
}

function ParseSkeleton() {
  return (
    <Card>
      <div className="border-b border-line-hair px-5 py-4">
        <Skeleton className="h-3.5 w-36" />
        <Skeleton className="mt-2 h-3 w-80" />
      </div>
      <div className="grid gap-px bg-line-grid sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-surface px-5 py-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2.5 h-6 w-20" />
          </div>
        ))}
      </div>
      <div className="space-y-3 border-t border-line-hair px-5 py-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-5 flex-1" />
          </div>
        ))}
      </div>
    </Card>
  );
}
