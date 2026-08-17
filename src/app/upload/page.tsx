"use client";

import { useRef, useState } from "react";
import { allAccounts, data, formatSgd, kpis } from "@/lib/data";
import { Card, CardHeader, Skeleton, StatusBadge, Tag } from "@/components/ui";

type Phase = "idle" | "parsing" | "done";

/**
 * Upload Reports.
 *
 * The prototype simulates the parse so the sign off walkthrough can start here.
 * In production the parse runs server side in FastAPI and this screen only
 * displays the batch summary it returns.
 */
export default function UploadPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [arFile, setArFile] = useState<string | null>(null);
  const [dbsFile, setDbsFile] = useState<string | null>(null);

  const accounts = allAccounts();
  const k = kpis(accounts);
  const withEmail = accounts.filter((a) => a.hasContact).length;

  function runParse() {
    setPhase("parsing");
    window.setTimeout(() => setPhase("done"), 1400);
  }

  function reset() {
    setPhase("idle");
    setArFile(null);
    setDbsFile(null);
  }

  return (
    <div className="space-y-5">
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
          disabled={phase === "parsing"}
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
            hint={`AR figures as at ${data.asOfSummary}. Check anything marked below before you start chasing.`}
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

          <div className="space-y-3 border-t border-line-hair px-5 py-4">
            <Line
              kind="good"
              label="Failed payments sorted"
              detail="1 tenant has never set up GIRO, so they need the form rather than a chasing email. The other 22 have GIRO set up but no money in the account, so they go to the action list."
            />
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
