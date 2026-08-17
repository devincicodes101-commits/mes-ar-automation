"use client";

import { useRef, useState } from "react";
import { allAccounts, data, formatSgd, kpis } from "@/lib/data";
import { Card, CardHeader, Skeleton, StatusBadge, Tag } from "@/components/ui";
import { useSession, useToast } from "@/lib/session";

type Phase = "idle" | "parsing" | "done";

/**
 * Upload Reports.
 *
 * The prototype simulates the parse so the sign off walkthrough can start here.
 * In production the parse runs server side in FastAPI and this screen only
 * displays the batch summary it returns.
 */
export default function UploadPage() {
  const { canAct } = useSession();
  const { notify } = useToast();
  const [phase, setPhase] = useState<Phase>("idle");
  const [arFile, setArFile] = useState<string | null>(null);
  const [dbsFile, setDbsFile] = useState<string | null>(null);
  const [period, setPeriod] = useState(data.asOfSummary.slice(0, 7));
  const [error, setError] = useState<string | null>(null);

  const accounts = allAccounts();
  const k = kpis(accounts);
  const withEmail = accounts.filter((a) => a.hasContact).length;

  /** Rejects anything we could not read, rather than failing silently later. */
  function validate(name: string | null, label: string): string | null {
    if (!name) return null;
    const ok = /\.(xlsx|xls|csv|pdf|png|jpg|jpeg)$/i.test(name);
    if (!ok) {
      return `${label}: we cannot read "${name}". Use Excel, CSV, PDF or an image.`;
    }
    if (/\.(png|jpe?g)$/i.test(name) && label.startsWith("Bank")) {
      return null; // images are accepted, but flagged in the summary
    }
    return null;
  }

  function runParse() {
    const problem =
      validate(arFile, "AR Report") ?? validate(dbsFile, "Bank report");
    if (problem) {
      setError(problem);
      setPhase("idle");
      return;
    }
    setError(null);
    setPhase("parsing");
    window.setTimeout(() => {
      setPhase("done");
      notify("Files read", `Billing period ${period}, 23 failed payments found`);
    }, 1400);
  }

  function reset() {
    setPhase("idle");
    setArFile(null);
    setDbsFile(null);
    setError(null);
  }

  return (
    <div className="space-y-5">
      {/* Which month this upload belongs to. The deck says the AR report is
          pulled on or after the 15th, and may be uploaded later than that, so
          the period cannot be inferred from the upload date. */}
      <Card className="flex flex-wrap items-end gap-5 px-5 py-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-secondary">
            Which billing period is this?
          </span>
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="rounded border border-line-hair bg-surface px-3 py-2 text-sm text-ink"
          />
        </label>
        <p className="mb-2 max-w-lg text-[11px] leading-relaxed text-ink-muted">
          Billing runs from the 15th with 30 day credit terms. You can upload on
          any date after that, so the period is set here rather than guessed
          from the date you upload. Everything on the other screens, and every
          export filename, is stamped with it.
        </p>
      </Card>

      {error ? (
        <Card className="border-l-2 px-5 py-3.5" >
          <div className="flex items-start gap-3">
            <StatusBadge kind="critical" label="Cannot read that file" />
            <p className="text-xs leading-relaxed text-ink-secondary">{error}</p>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <DropZone
          title="AR Report"
          hint="The multi worksheet export from NetSuite, usually named AR reports-Final.xlsx"
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
          fileName={arFile}
          onFile={setArFile}
        />
        <DropZone
          title="Bank Report, failed GIRO"
          hint="The DBS Bulk Collection Report showing which deductions did not go through"
          sheets={["NO DDA rejections", "REFER PAYING PARTY rejections"]}
          fileName={dbsFile}
          onFile={setDbsFile}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={runParse}
          disabled={phase === "parsing" || !canAct}
          className="rounded border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {phase === "parsing" ? "Reading files" : "Read the files"}
        </button>

        {phase === "done" ? (
          <button
            type="button"
            onClick={reset}
            className="rounded border border-line-hair px-4 py-2 text-sm text-ink-secondary hover:border-line-strong hover:text-ink"
          >
            Start again
          </button>
        ) : null}

        {phase === "idle" ? (
          <p className="text-xs text-ink-muted">
            {arFile || dbsFile
              ? "Ready. Nothing is sent anywhere, the files stay on this machine."
              : "You can try it without picking a file. The prototype reads the MES sample data."}
          </p>
        ) : null}
      </div>

      {phase === "parsing" ? <ParseSkeleton /> : null}

      {phase === "done" ? (
        <Card>
          <CardHeader
            title="What we found"
            hint={`Billing period ${period}. AR figures as at ${data.asOfSummary}. Check anything marked below before you start chasing.`}
          />

          <dl className="grid gap-px bg-line-grid sm:grid-cols-2 lg:grid-cols-4">
            <Figure label="Tenant accounts" value={String(k.accounts)} />
            <Figure
              label="Total owed"
              value={`SGD ${formatSgd(k.outstanding)}`}
            />
            <Figure label="Bank items checked" value="147" />
            <Figure label="Payments that failed" value="23" />
          </dl>

          {/* Proposal 4.1: the two failure reasons go to different places. */}
          <div className="grid gap-px border-t border-line-hair bg-line-grid sm:grid-cols-2">
            <Route
              count={1}
              reason="NO DDA"
              means="Never signed the GIRO form"
              goesTo="GIRO setup request, not a chasing email"
              kind="warning"
            />
            <Route
              count={22}
              reason="REFER PAYING PARTY"
              means="Signed up, but no money in the account"
              goesTo="Action List, for chasing"
              kind="critical"
            />
          </div>

          <div className="space-y-3 border-t border-line-hair px-5 py-4">
            <Line
              kind="good"
              label="Charges separated"
              detail={`${
                new Set(data.invoices.map((i) => i.revenueType)).size
              } charge types found, including maintenance charges raised through 1FM.`}
            />
            <Line
              kind="warning"
              label="Missing email addresses"
              detail={`Only ${withEmail} of ${k.accounts} accounts have an email on file. Reminder emails cannot go out to the rest until MES sends the full contact list.`}
            />
            <Line
              kind="warning"
              label="Could not match 5 failed payments"
              detail="The bank report identifies tenants by DDA reference and bank account. The AR report has neither, so these five need matching by hand until MES confirms how the two link up."
            />
            <Line
              kind="good"
              label="Accounts in credit left alone"
              detail={`${k.inCredit} accounts have paid more than they owe. They have been kept out of every chasing list so nobody sends them a demand.`}
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
  fileName,
  onFile,
}: {
  title: string;
  hint: string;
  sheets: string[];
  fileName: string | null;
  onFile: (name: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{hint}</p>

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv,.pdf,.png,.jpg"
        className="sr-only"
        onChange={(e) => onFile(e.target.files?.[0]?.name ?? null)}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          onFile(e.dataTransfer.files?.[0]?.name ?? null);
        }}
        className={`mt-3 w-full rounded border border-dashed px-4 py-8 text-center transition-colors ${
          over
            ? "border-accent bg-surface-sunk"
            : "border-line-base hover:border-line-strong hover:bg-surface-alt"
        }`}
      >
        {fileName ? (
          <>
            <p className="break-all text-xs font-medium text-ink">{fileName}</p>
            <p className="mt-1 text-[11px] text-ink-muted">
              Click to choose a different file
            </p>
          </>
        ) : (
          <>
            <p className="text-xs text-ink-secondary">
              Click here to choose a file, or drag one onto this box
            </p>
            <p className="mt-1 text-[11px] text-ink-muted">
              Excel, CSV, PDF or an image
            </p>
          </>
        )}
      </button>

      {fileName ? (
        <button
          type="button"
          onClick={() => onFile(null)}
          className="mt-2 text-[11px] text-ink-muted underline hover:text-ink-secondary"
        >
          Remove file
        </button>
      ) : null}

      <p className="mt-3 text-[11px] text-ink-muted">Worksheets expected</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {sheets.map((s) => (
          <Tag key={s}>{s}</Tag>
        ))}
      </div>
    </Card>
  );
}

/**
 * One of the two routes a failed payment can take. Proposal 4.1 requires NO DDA
 * and REFER PAYING PARTY to be handled differently, so the split is shown here
 * rather than buried in a sentence.
 */
function Route({
  count,
  reason,
  means,
  goesTo,
  kind,
}: {
  count: number;
  reason: string;
  means: string;
  goesTo: string;
  kind: "warning" | "critical";
}) {
  return (
    <div className="bg-surface px-5 py-4">
      <div className="flex items-baseline gap-2.5">
        <span className="text-2xl font-semibold text-ink">{count}</span>
        <StatusBadge kind={kind} label={reason} />
      </div>
      <p className="mt-2 text-xs text-ink-secondary">{means}</p>
      <p className="mt-1.5 text-[11px] text-ink-muted">Sent to: {goesTo}</p>
    </div>
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
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
      <div className="shrink-0 pt-0.5">
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
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-5 flex-1" />
          </div>
        ))}
      </div>
    </Card>
  );
}
