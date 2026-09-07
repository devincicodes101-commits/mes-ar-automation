"use client";

import { useMemo, useRef, useState } from "react";
import { data, formatSgd, kpis } from "@/lib/data";
import { Card, CardHeader, Skeleton, StatusBadge, Tag } from "@/components/ui";
import { useSession, useToast } from "@/lib/session";
import { ParseResult, parseWorkbook } from "@/lib/parser";
import { unrecognisedDescriptions } from "@/lib/revenue-rules";
import { applyDataset, datasetFromResults, revertToSample, useDataset } from "@/lib/dataset";
import { checkUpload, worst, type Finding } from "@/lib/upload-checks";

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
  const [contactFile, setContactFile] = useState<File | null>(null);
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

    const chosen = [arFile, contactFile].filter(Boolean) as File[];
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
    setContactFile(null);
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
          Billing runs from the 15th, payment falls due on the 1st, and there
          are two deadlines after that: 14 days, then 30. Every screen and export is
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

      {/* Two inputs, and they are not equals. The AR report is the cycle;
          the contact list is a reference file that changes rarely. The DBS
          bank report was removed at the client's request: see
          docs/dbs-removal.md. */}
      <DropZone
        title="AR Report"
        hint="The export from NetSuite. Upload this every cycle."
        note="Custom A/R Aging Detail. One sheet. Everything on every screen comes from it."
        file={arFile}
        onFile={setArFile}
      />

      <DropZone
        title="Client contact list"
        hint="Only when it changes. The system keeps the last one you gave it."
        note="The workbook with an Email Address column. Without it, reminders cannot be addressed and tenants can only be phoned."
        file={contactFile}
        onFile={setContactFile}
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={runParse}
          disabled={phase === "parsing" || !canAct}
          className="rounded border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {phase === "parsing"
            ? "Reading"
            : [arFile, contactFile].filter(Boolean).length === 2
              ? "Read both files"
              : "Read the file"}
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
        <Card className="px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge kind="good" label="Using your uploaded file" />
            <p className="flex-1 text-xs text-ink-secondary">
              {ds.accounts.length} tenants, period {ds.period}, as at {ds.asOf}.
              <span className="font-medium text-ink">
                {" "}Nothing further to do here.
              </span>{" "}
              Every screen is using this file.
            </p>
          </div>

          {/* The way out, not the next step.
              This sat beside the green tick reading "Use the sample instead",
              which after a successful upload looks like an instruction rather
              than an undo. It is separated, named for what it does, and says
              what it costs. */}
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line-hair pt-3">
            <p className="flex-1 text-[11px] text-ink-muted">
              Uploaded the wrong file? Discard it and go back to the built-in
              sample. Your calls, promises and typed-in addresses are kept.
            </p>
            <button
              type="button"
              onClick={() => {
                revertToSample();
                notify(
                  "Discarded the uploaded file",
                  "Back to the built-in sample data.",
                );
              }}
              className="shrink-0 rounded border border-line-hair px-3 py-1.5 text-xs text-ink-muted hover:border-line-strong hover:text-ink"
            >
              Discard this file
            </button>
          </div>
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
  const active = useDataset();
  const built = datasetFromResults(results, period);
  const errors = results.reduce(
    (n, r) => n + r.problems.filter((p) => p.severity === "error").length,
    0,
  );

  /**
   * Whether the file just read is already the one every screen is using.
   *
   * Without this the screen contradicted itself: after pressing "Use this
   * data" it went on asking "Use this file across the whole application?"
   * directly above a green tick saying the file was already in use. Somebody
   * reading that reasonably concludes the button did not work and presses it
   * again.
   *
   * Compared on the report date and the row counts rather than on a file name,
   * because MES rename their exports between months and the same figures read
   * twice are the same dataset whatever the file was called.
   */
  const alreadyApplied =
    built !== null &&
    active.source === "uploaded" &&
    active.asOf === built.asOf &&
    active.accounts.length === built.accounts.length &&
    active.invoices.length === built.invoices.length;

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

  // Already in use. The green banner below says so; asking again would only
  // invite a second press.
  if (alreadyApplied) return null;

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
  const contactList = results.find((r) => r.kind === "contact-list");

  // MES's current export. It carries the balances and the invoice lines in
  // one file, so it stands in for both of the two above rather than for
  // either: without this every figure on this panel read "not loaded" for
  // the only file they actually send now.
  const aging = results.find((r) => r.kind === "ar-aging-detail");
  const problems = results.flatMap((r) => r.problems);
  const errors = problems.filter((p) => p.severity === "error");
  const warnings = problems.filter((p) => p.severity === "warning");

  const usingSample = results.length === 0;
  const active = useDataset();
  const findings = useMemo(
    () => (results.length === 0 ? [] : checkUpload(results, active)),
    [results, active],
  );

  const balances = summary ?? aging ?? null;
  const lines = aging ?? detail ?? null;

  const accountCount = balances ? balances.accounts.length : fallback.accounts;
  const total = balances
    ? balances.accounts.reduce((s, a) => s + a.total, 0)
    : fallback.total;
  const inCredit = balances
    ? balances.accounts.filter((a) => a.total < 0).length
    : 0;
  const emailCount = detail
    ? detail.contacts.length
    : aging
      ? aging.accounts.filter((a) => a.emails.length > 0).length
      : fallback.withEmail;
  const chargeTypes = lines
    ? new Set(lines.invoices.map((i) => i.revenueType)).size
    : 0;
  const oneFm = lines ? lines.invoices.filter((i) => i.isOneFm).length : 0;

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
          value={lines ? String(chargeTypes) : "not loaded"}
        />
        <Figure
          label="Email addresses"
          value={detail || aging || usingSample ? String(emailCount) : "not loaded"}
        />
      </dl>

      {balances ? (
        <div className="grid gap-px border-t border-line-hair bg-line-grid sm:grid-cols-3">
          <Figure
            label="Still renting"
            value={String(balances.accounts.filter((a) => a.status === "Live").length)}
          />
          <Figure
            label="Moved out"
            value={String(balances.accounts.filter((a) => a.status === "Terminated").length)}
          />
          <Figure label="In credit, not chased" value={String(inCredit)} />
        </div>
      ) : null}

      {aging ? (
        <div className="border-t border-line-hair px-5 py-4">
          <p className="text-xs text-ink-secondary">
            {aging.invoices.length} invoice lines across {chargeTypes} charge
            types, of which{" "}
            <span className="font-medium text-ink">{oneFm}</span> are 1FM
            maintenance, found by the document number prefix MES documented on
            the export. Aging is worked out from the report date,{" "}
            {aging.asOf ?? "not stated"}, so re-reading this file tomorrow
            gives the same figures.
          </p>
        </div>
      ) : detail ? (
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

      {lines ? <Unclassified invoices={lines.invoices} /> : null}

      {contactList ? (
        <div className="border-t border-line-hair px-5 py-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <StatusBadge
              kind={contactList.missing.length === 0 ? "good" : "warning"}
              label={`${contactList.contacts.length} companies with an email address`}
            />
            <span className="text-[11px] text-ink-muted">
              {contactList.contacts.reduce((n, c) => n + c.emails.length, 0)}{" "}
              addresses in total
            </span>
          </div>
          {contactList.missing.length > 0 ? (
            <p className="mt-2.5 text-[11px] leading-relaxed text-ink-secondary">
              {contactList.missing.length} companies rent at a dormitory but
              have no address on this list, so no reminder can reach them. They
              are named under &ldquo;Rows that need a look&rdquo; and stay on
              the call list.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* What each file gave us, separately. The figures above are the two
          files merged, which is what the screens use, but a fault in one of
          them is invisible in a merged number. */}
      <div className="grid gap-px border-t border-line-hair bg-line-grid sm:grid-cols-2">
        <div className="bg-surface px-5 py-4">
          <div className="flex items-center gap-2">
            <StatusBadge
              kind={aging || summary ? "good" : "critical"}
              label={aging || summary ? "AR report read" : "No AR report"}
            />
          </div>
          {aging ? (
            <dl className="mt-2.5 space-y-1 text-[11px] text-ink-muted">
              <div className="flex justify-between gap-3">
                <dt>Report date</dt>
                <dd className="tabular text-ink">{aging.asOf ?? "not stated"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Entity</dt>
                <dd className="text-ink">{aging.entity ?? "not stated"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Invoice lines</dt>
                <dd className="tabular text-ink">{aging.invoices.length}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Tenant accounts</dt>
                <dd className="tabular text-ink">{aging.accounts.length}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Their own subtotals</dt>
                <dd className="tabular text-ink">{aging.subtotals.length}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-2 text-[11px] text-ink-secondary">
              Nothing on any screen can be shown without it.
            </p>
          )}
        </div>

        <div className="bg-surface px-5 py-4">
          <div className="flex items-center gap-2">
            <StatusBadge
              kind={contactList ? "good" : "warning"}
              label={contactList ? "Contact list read" : "No contact list"}
            />
          </div>
          {contactList ? (
            <dl className="mt-2.5 space-y-1 text-[11px] text-ink-muted">
              <div className="flex justify-between gap-3">
                <dt>Dated</dt>
                <dd className="tabular text-ink">{contactList.asOf ?? "not stated"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Sheets</dt>
                <dd className="text-ink">{contactList.sheets.join(", ")}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>With an address</dt>
                <dd className="tabular text-ink">{contactList.contacts.length}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Addresses in total</dt>
                <dd className="tabular text-ink">
                  {contactList.contacts.reduce((n, c) => n + c.emails.length, 0)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Listed but no address</dt>
                <dd className="tabular text-ink">{contactList.missing.length}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-2 text-[11px] text-ink-secondary">
              Addresses already loaded are kept. Reminders need them.
            </p>
          )}
        </div>
      </div>

      {/* Faults that only exist between the two files. */}
      <Findings findings={findings} />

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

/**
 * Faults that live between the files rather than inside one.
 *
 * Kept above the row-by-row problem list because they are the ones that change
 * what somebody should do next. A tenant row that failed to parse is a
 * curiosity; a contact list for the wrong dormitory means the reminder run
 * will reach five people out of a hundred and ninety and say nothing about it.
 */
function Findings({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) return null;
  const level = worst(findings);

  return (
    <div className="border-t border-line-hair">
      <div className="flex flex-wrap items-center gap-2 bg-surface-alt px-5 py-2.5">
        <span className="text-xs font-medium text-ink">Checks on this upload</span>
        <StatusBadge
          kind={
            level === "error" ? "critical" : level === "warning" ? "warning" : "good"
          }
          label={
            level === "error"
              ? "Do not use this data"
              : level === "warning"
                ? "Usable, but read these first"
                : "Nothing of concern"
          }
        />
      </div>
      <ul className="divide-y divide-line-grid">
        {findings.map((f, i) => (
          <li key={i} className="flex items-start gap-3 px-5 py-3">
            <span className="shrink-0 pt-px">
              <StatusBadge
                kind={
                  f.severity === "error"
                    ? "critical"
                    : f.severity === "warning"
                      ? "warning"
                      : "neutral"
                }
                label={f.severity === "note" ? "note" : f.severity}
              />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium text-ink">{f.title}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-secondary">
                {f.detail}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
