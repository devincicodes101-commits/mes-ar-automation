"use client";

import { useRef, useState } from "react";
import { data, formatSgd, kpis } from "@/lib/data";
import { Card, CardHeader, Skeleton, StatusBadge, Tag } from "@/components/ui";
import { useSession, useToast } from "@/lib/session";
import { ParseResult, parseWorkbook } from "@/lib/parser";
import { unrecognisedDescriptions } from "@/lib/revenue-rules";
import { applyDataset, datasetFromResults, revertToSample, useDataset } from "@/lib/dataset";

type Phase = "idle" | "parsing" | "done";

/**
 * The tabs the detail export normally carries. Used to report what a file
 * turned out to contain, never to reject one: MES may add or drop a tab and
 * the reader copes either way, it just says so.
 */
const EXPECTED_DETAIL_SHEETS = [
  "Detailed Full Report",
  "Stamp Duty",
  "Park Fee",
  "Late Fee",
  "Industry",
  "RM - User1",
  "RM - User2",
  "Contact Details",
];

/**
 * Upload Reports.
 *
 * The workbooks are read for real, in the browser, using the parser in
 * lib/parser.ts. Nothing is uploaded: tenant data stays on the officer's
 * machine, which also means this works before any backend exists.
 *
 * When FastAPI arrives the same parser runs server side instead, so results
 * can be written to Supabase. The screen does not change.
 */
export default function UploadPage() {
  const { canAct } = useSession();
  const { notify } = useToast();
  const ds = useDataset();
  const [phase, setPhase] = useState<Phase>("idle");
  const [arFile, setArFile] = useState<File | null>(null);
  const [results, setResults] = useState<ParseResult[]>([]);
  const [period, setPeriod] = useState(data.asOfSummary.slice(0, 7));
  const [error, setError] = useState<string | null>(null);

  const accounts = ds.accounts;
  const k = kpis(accounts);
  const withEmail = accounts.filter((a) => a.hasContact).length;

  /**
   * Reads the files for real, in the browser. Nothing is uploaded anywhere,
   * which keeps tenant data on the officer's machine and means this works
   * before any backend exists.
   */
  async function runParse() {
    setError(null);
    setPhase("parsing");

    const chosen = [arFile].filter(Boolean) as File[];
    if (chosen.length === 0) {
      setResults([]);
      setPhase("done");
      notify("No file chosen", "Showing the sample data.");
      return;
    }

    try {
      const parsed = await Promise.all(chosen.map((f) => parseWorkbook(f)));
      setResults(parsed);
      setPhase("done");

      const readable = parsed.filter((r) => r.kind !== "unreadable").length;
      const errors = parsed.reduce(
        (n, r) => n + r.problems.filter((p) => p.severity === "error").length,
        0,
      );
      notify(
        readable > 0 ? `Read ${readable} file${readable === 1 ? "" : "s"}` : "Could not read the files",
        errors > 0 ? `${errors} problem${errors === 1 ? "" : "s"} found, see below` : `Billing period ${period}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong reading the files.");
      setPhase("idle");
    }
  }

  function reset() {
    setPhase("idle");
    setArFile(null);
    setResults([]);
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
        <p className="mb-2 max-w-md text-[11px] text-ink-muted">
          Billing runs from the 15th on 30 day terms. Every screen and export is
          stamped with the period you choose.
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

      {/* One input. The DBS bank report was removed at the client's
          request: see docs/dbs-removal.md. */}
      <DropZone
        title="AR Report"
        hint="The export from NetSuite. This is the only file the system needs."
        note="Every worksheet in the file is listed back to you once it has been read."
        file={arFile}
        onFile={setArFile}
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={runParse}
          disabled={phase === "parsing" || !canAct}
          className="rounded border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {phase === "parsing" ? "Reading the file" : "Read the file"}
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


      </div>

      {phase === "parsing" ? <ParseSkeleton /> : null}

      {phase === "done" && results.length > 0 ? (
        <ApplyBar
          results={results}
          period={period}
          canAct={canAct}
          onApplied={(label) =>
            notify(
              "Now using your file",
              `${label}. Every screen has switched to it.`,
            )
          }
        />
      ) : null}

      {ds.source === "uploaded" ? (
        <Card className="flex flex-wrap items-center gap-3 px-5 py-3">
          <StatusBadge kind="good" label="Using your uploaded file" />
          <p className="flex-1 text-xs text-ink-secondary">
            {ds.accounts.length} tenants, period {ds.period}, as at {ds.asOf}.
          </p>
          <button
            type="button"
            onClick={() => {
              revertToSample();
              notify("Back to the sample data");
            }}
            className="rounded border border-line-hair px-3 py-1.5 text-xs text-ink-secondary hover:border-line-strong hover:text-ink"
          >
            Use the sample instead
          </button>
        </Card>
      ) : null}

      {phase === "done" ? (
        <ParseReport
          results={results}
          period={period}
          fallback={{ accounts: k.accounts, total: k.outstanding, withEmail }}
          asOf={data.asOfSummary}
        />
      ) : null}
    </div>
  );
}

/**
 * Reading a file and adopting it are separate steps on purpose. The officer
 * sees what was found, including anything that could not be read, and only
 * then decides whether the rest of the application should switch to it.
 */
function ApplyBar({
  results,
  period,
  canAct,
  onApplied,
}: {
  results: ParseResult[];
  period: string;
  canAct: boolean;
  onApplied: (label: string) => void;
}) {
  const built = datasetFromResults(results, period);
  const errors = results.reduce(
    (n, r) => n + r.problems.filter((p) => p.severity === "error").length,
    0,
  );

  if (!built) {
    return (
      <Card className="px-5 py-3.5">
        <div className="flex items-start gap-3">
          <StatusBadge kind="critical" label="Nothing usable" />
          <p className="text-xs text-ink-secondary">
            Neither file could be read as an AR report.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex flex-wrap items-center gap-3 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-ink">
          Use this file across the whole application?
        </p>
        <p className="mt-0.5 text-[11px] text-ink-muted">
          {built.accounts.length} tenants, {built.invoices.length} invoices.
          {errors > 0
            ? ` ${errors} row${errors === 1 ? "" : "s"} could not be read.`
            : ""}
        </p>
      </div>
      <button
        type="button"
        disabled={!canAct}
        onClick={() => {
          applyDataset(built);
          onApplied(`${built.accounts.length} tenants loaded`);
        }}
        className="shrink-0 rounded border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Use this data
      </button>
    </Card>
  );
}

function DropZone({
  title,
  hint,
  note,
  file,
  onFile,
}: {
  title: string;
  hint: string;
  note: string;
  file: File | null;
  onFile: (f: File | null) => void;
}) {
  const fileName = file?.name ?? null;
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
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
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
          onFile(e.dataTransfer.files?.[0] ?? null);
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
              Choose a file, or drag one here
            </p>
            <p className="mt-1 text-[11px] text-ink-muted">Excel or CSV</p>
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

      <p className="mt-3 text-[11px] leading-relaxed text-ink-muted">{note}</p>
    </Card>
  );
}

/**
 * Renders what the parser actually found. Every figure here is computed from
 * the uploaded file rather than written into the page, so if the file changes
 * the numbers change with it, and if a row could not be read it is listed
 * rather than quietly dropped.
 */
function ParseReport({
  results,
  period,
  fallback,
  asOf,
}: {
  results: ParseResult[];
  period: string;
  fallback: { accounts: number; total: number; withEmail: number };
  asOf: string;
}) {
  const summary = results.find((r) => r.kind === "ar-summary");
  const detail = results.find((r) => r.kind === "ar-detail");
  const problems = results.flatMap((r) => r.problems);
  const errors = problems.filter((p) => p.severity === "error");
  const warnings = problems.filter((p) => p.severity === "warning");

  const usingSample = results.length === 0;

  const accountCount = summary ? summary.accounts.length : fallback.accounts;
  const total = summary
    ? summary.accounts.reduce((s, a) => s + a.total, 0)
    : fallback.total;
  const inCredit = summary
    ? summary.accounts.filter((a) => a.total < 0).length
    : 0;
  const emailCount = detail ? detail.contacts.length : fallback.withEmail;
  const chargeTypes = detail
    ? new Set(detail.invoices.map((i) => i.revenueType)).size
    : 0;
  const oneFm = detail ? detail.invoices.filter((i) => i.isOneFm).length : 0;

  return (
    <Card>
      <CardHeader
        title={usingSample ? "What we found in the sample data" : "What we found in your files"}
        hint={
          usingSample
            ? `Billing period ${period}. No file was chosen, so these are the MES sample figures as at ${asOf}.`
            : `Billing period ${period}${summary?.asOf ? `. Report dated ${summary.asOf}` : ""}. Read in your browser; nothing was uploaded anywhere.`
        }
        right={
          errors.length > 0 ? (
            <StatusBadge kind="critical" label={`${errors.length} could not be read`} />
          ) : (
            <StatusBadge kind="good" label="Read cleanly" />
          )
        }
      />

      <dl className="grid gap-px bg-line-grid sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Tenant accounts" value={String(accountCount)} />
        <Figure label="Total owed" value={`SGD ${formatSgd(total)}`} />
        <Figure
          label="Charge types"
          value={detail ? String(chargeTypes) : "not loaded"}
        />
        <Figure
          label="Email addresses"
          value={detail || usingSample ? String(emailCount) : "not loaded"}
        />
      </dl>

      {summary ? (
        <div className="grid gap-px border-t border-line-hair bg-line-grid sm:grid-cols-3">
          <Figure
            label="Still renting"
            value={String(summary.accounts.filter((a) => a.status === "Live").length)}
          />
          <Figure
            label="Moved out"
            value={String(summary.accounts.filter((a) => a.status === "Terminated").length)}
          />
          <Figure label="In credit, not chased" value={String(inCredit)} />
        </div>
      ) : null}

      {detail ? (
        <div className="border-t border-line-hair px-5 py-4">
          <p className="text-xs text-ink-secondary">
            {detail.invoices.length} invoices, of which{" "}
            <span className="font-medium text-ink">{oneFm}</span> are 1FM
            maintenance charges, found by the ONEFM reference inside the
            description. {detail.managers.length} relationship managers and{" "}
            {detail.industries.length} industry rows were also read.
          </p>
        </div>
      ) : null}

      {detail ? <SheetsRead sheets={detail.sheets} /> : null}

      {detail ? <Unclassified invoices={detail.invoices} /> : null}

      {problems.length > 0 ? (
        <div className="border-t border-line-hair">
          <div className="flex items-center gap-2 bg-surface-alt px-5 py-2.5">
            <span className="text-xs font-medium text-ink">
              Rows that need a look
            </span>
            <span className="text-[11px] text-ink-muted">
              {errors.length} could not be read, {warnings.length} worth checking
            </span>
          </div>
          <ul className="max-h-64 divide-y divide-line-grid overflow-y-auto">
            {problems.slice(0, 60).map((p, i) => (
              <li key={i} className="flex items-start gap-3 px-5 py-2.5">
                <span className="shrink-0">
                  <StatusBadge
                    kind={p.severity === "error" ? "critical" : "warning"}
                    label={p.row ? `${p.sheet} row ${p.row}` : p.sheet}
                  />
                </span>
                <p className="text-xs leading-relaxed text-ink-secondary">
                  {p.message}
                </p>
              </li>
            ))}
          </ul>
          {problems.length > 60 ? (
            <p className="px-5 py-2 text-[11px] text-ink-muted">
              and {problems.length - 60} more
            </p>
          ) : null}
        </div>
      ) : null}

      {!usingSample && errors.length === 0 && problems.length === 0 ? (
        <div className="border-t border-line-hair px-5 py-3">
          <p className="text-[11px] text-ink-muted">
            Every row was read without a problem.
          </p>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * Descriptions no classification rule claimed.
 *
 * MES types these by hand and new wordings appear every month, so the keyword
 * list will never be finished. This panel is what keeps that honest: anything
 * we failed to recognise is named here, with a count, within one upload.
 *
 * A line reading "Other Charges" is not listed. MES wrote those words
 * deliberately, so it is their classification rather than our failure, and
 * reporting it would have this panel crying wolf on every single upload.
 */
function Unclassified({
  invoices,
}: {
  invoices: { description: string }[];
}) {
  const missed = unrecognisedDescriptions(invoices.map((i) => i.description));
  const lines = missed.reduce((n, m) => n + m.count, 0);

  return (
    <div className="border-t border-line-hair px-5 py-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <StatusBadge
          kind={missed.length === 0 ? "good" : "warning"}
          label={
            missed.length === 0
              ? "Every charge was classified"
              : `${missed.length} description${missed.length === 1 ? "" : "s"} not recognised`
          }
        />
        {missed.length > 0 ? (
          <span className="text-[11px] text-ink-muted">
            {lines} line{lines === 1 ? "" : "s"}, filed under Other Charges
          </span>
        ) : null}
      </div>

      {missed.length > 0 ? (
        <>
          <ul className="mt-2.5 divide-y divide-line-grid rounded border border-line-hair">
            {missed.slice(0, 20).map((m) => (
              <li
                key={m.description}
                className="flex items-start gap-3 px-3 py-2"
              >
                <span className="tabular shrink-0 text-[11px] text-ink-muted">
                  {m.count} line{m.count === 1 ? "" : "s"}
                </span>
                <span className="text-[11px] leading-relaxed text-ink-secondary">
                  {m.description}
                </span>
              </li>
            ))}
          </ul>
          {missed.length > 20 ? (
            <p className="mt-1.5 text-[11px] text-ink-muted">
              and {missed.length - 20} more
            </p>
          ) : null}
          <p className="mt-2 text-[11px] leading-relaxed text-ink-secondary">
            These still count towards the tenant&apos;s balance. They are
            grouped under Other Charges until a rule is added for them, which
            is a code change so that money cannot be reclassified by accident.
          </p>
        </>
      ) : null}
    </div>
  );
}

/**
 * What the workbook turned out to contain.
 *
 * Reported after reading rather than predicted before it, because a list of
 * expected tabs shown while somebody is still choosing a file tells them
 * nothing, and is wrong the moment MES changes their export.
 */
function SheetsRead({ sheets }: { sheets: string[] }) {
  const key = (s: string) => s.trim().replace(/\s+/g, " ").toUpperCase();
  const present = new Set(sheets.map(key));

  const found = EXPECTED_DETAIL_SHEETS.filter((s) => present.has(key(s)));
  const missing = EXPECTED_DETAIL_SHEETS.filter((s) => !present.has(key(s)));

  const expected = new Set(EXPECTED_DETAIL_SHEETS.map(key));
  const extra = sheets.filter((s) => !expected.has(key(s)));

  const lostContacts = missing.some((s) => key(s) === key("Contact Details"));

  return (
    <div className="border-t border-line-hair px-5 py-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <StatusBadge
          kind={missing.length === 0 ? "good" : "warning"}
          label={
            missing.length === 0
              ? "All expected tabs present"
              : `${missing.length} expected tab${missing.length === 1 ? "" : "s"} missing`
          }
        />
        <span className="text-[11px] text-ink-muted">
          {sheets.length} tab{sheets.length === 1 ? "" : "s"} read
        </span>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {found.map((s) => (
          <Tag key={s}>{s}</Tag>
        ))}
        {extra.map((s) => (
          <Tag key={s}>{s}</Tag>
        ))}
      </div>

      {missing.length > 0 ? (
        <p className="mt-2.5 text-[11px] leading-relaxed text-ink-secondary">
          Not in this file: {missing.join(", ")}.
          {lostContacts
            ? " Without Contact Details there are no email addresses, so reminders cannot be sent."
            : ""}
        </p>
      ) : null}
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
