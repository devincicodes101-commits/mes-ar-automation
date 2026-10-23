"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { data, formatSgd, kpis } from "@/lib/data";
import { suggestPeriod, type PeriodGuess } from "@/lib/suggest-period";
import { Card, CardHeader, Skeleton, StatusBadge, Tag } from "@/components/ui";
import { useSession, useToast } from "@/lib/session";
import { formatDate, formatMonth } from "@/lib/format";
import { ReportViewer } from "@/components/ReportViewer";
import { ParseResult, parseWorkbook } from "@/lib/parser";
import { unrecognisedDescriptions } from "@/lib/revenue-rules";
import {
  applyDataset,
  datasetFromResults,
  storeContacts,
  storeDataset,
  useDataset,
} from "@/lib/dataset";
import { newAddresses, sameFigures } from "@/lib/upload-compare";
import { compareReports, newBills, summarise, type Movement } from "@/lib/movement";
import { isAdHoc } from "@/lib/billing-cycles";
import { useRules } from "@/lib/use-rules";
import type { Account } from "@/lib/types";
import { sumExact } from "@/lib/money";
import type { ParsedContacts } from "@/lib/parser";
import { checkUpload, worst, type Finding } from "@/lib/upload-checks";

type Phase = "idle" | "parsing" | "done";

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
/*
 * The upload in progress, kept while the app is open.
 *
 * It lived in the page's own state, so going to another screen and back threw
 * away the chosen files, what was read from them and the "Use this report?"
 * step. Kept here, an officer can check a figure elsewhere and come back to
 * exactly where they were. A browser refresh still starts clean: a chosen file
 * cannot be put back without the person choosing it again.
 */
const kept = new Map<string, unknown>();

function useKept<T>(key: string, initial: T | (() => T)) {
  const [value, setValue] = useState<T>(() => {
    if (!kept.has(key)) {
      kept.set(key, typeof initial === "function" ? (initial as () => T)() : initial);
    }
    return kept.get(key) as T;
  });
  const set = useCallback(
    (next: T) => {
      /* Written here first, so a read that finishes after the officer has
         moved on is still there when they come back. */
      kept.set(key, next);
      setValue(next);
    },
    [key],
  );
  return [value, set] as const;
}

export default function UploadPage() {
  const { canAct } = useSession();
  const { notify } = useToast();
  const ds = useDataset();
  const [phase, setPhase] = useKept<Phase>("phase", "idle");
  const [arFile, setArFile] = useKept<File | null>("arFile", null);
  const [contactFile, setContactFile] = useKept<File | null>("contactFile", null);
  const [results, setResults] = useKept<ParseResult[]>("results", []);
  /* This month until a file is read, then the month the file says it is for.
     It started on the bundled sample's month, so the picker read August
     beside an October report. */
  const [period, setPeriod] = useKept<string>("period", () =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit" })
      .format(new Date())
      .slice(0, 7),
  );
  /* How the month was worked out from the file, and whether the officer has
     chosen one themselves. Once they have, a later file does not overwrite it. */
  const [guess, setGuess] = useKept<PeriodGuess | null>("guess", null);
  const [chosenByHand, setChosenByHand] = useKept<boolean>("chosenByHand", false);
  const [error, setError] = useKept<string | null>("error", null);
  const [viewing, setViewing] = useState(false);

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

      /* The month is in the file: fill it in, say how, and leave it changeable. */
      const found = suggestPeriod(parsed);
      setGuess(found);
      if (found && !chosenByHand) setPeriod(found.period);

      const readable = parsed.filter((r) => r.kind !== "unreadable").length;
      const errors = parsed.reduce(
        (n, r) => n + r.problems.filter((p) => p.severity === "error").length,
        0,
      );
      notify(
        readable > 0 ? `Read ${readable} file${readable === 1 ? "" : "s"}` : "Could not read the files",
        errors > 0
          ? `${errors} problem${errors === 1 ? "" : "s"} found, see below`
          : `Billing period ${formatMonth(found?.period ?? period)}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong reading the files.");
      setPhase("idle");
    }
  }

  return (
    <div className="space-y-5">
      {/* What is live, first: the question an officer opens this page with. */}
      {ds.source === "uploaded" ? (
        <Card className="px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge kind="good" label="Report in use" />
                <span className="text-sm font-semibold text-ink">{formatMonth(ds.period)}</span>
              </div>
              <p className="mt-1.5 text-sm text-ink-secondary">
                {ds.accounts.length} tenants · {ds.invoices.length} invoice lines · report of{" "}
                {formatDate(ds.asOf)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setViewing(true)}
              className="w-full shrink-0 rounded-md border border-line-strong px-4 py-2 text-sm font-medium text-ink sm:w-auto"
            >
              View report
            </button>
          </div>
          <p className="mt-3 border-t border-line-hair pt-3 text-xs text-ink-muted">
            Uploaded the wrong file? Upload the right one below and it replaces this one. Calls,
            promises and typed-in addresses are kept.
          </p>
        </Card>
      ) : null}

      {viewing ? <ReportViewer ds={ds} onClose={() => setViewing(false)} /> : null}

      {error ? (
        <Card className="px-5 py-3.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
            <StatusBadge kind="critical" label="Cannot read that file" />
            <p className="text-xs leading-relaxed text-ink-secondary">{error}</p>
          </div>
        </Card>
      ) : null}

      {/* Two inputs, and they are not equals. The AR report is the cycle;
          the contact list is a reference file that changes rarely. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <DropZone
          step={1}
          title="AR report"
          hint="The NetSuite export. Upload it every month."
          // Raman named the sheet on 14 September: Finance AR Download, the
          // first worksheet of Detailed AR report(Final). The Custom A/R Aging
          // Detail is still accepted, so both are named.
          note="Finance AR Download (Detailed AR report). The Custom A/R Aging Detail export works too."
          file={arFile}
          onFile={setArFile}
        />

        <DropZone
          step={2}
          title="Client contact list"
          optional
          hint="Only when it changes. The last one you uploaded is kept."
          file={contactFile}
          onFile={setContactFile}
        />
      </div>

      {/* Which month this upload belongs to. The report is pulled on or
          after the 15th and may be uploaded later, so the month is read from
          the file rather than from the upload date, and can be changed. */}
      <Card className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:gap-5 sm:px-5">
        <label className="block shrink-0">
          <span className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-ink">
            <StepDot n={3} />
            Billing month
          </span>
          <input
            type="month"
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value);
              setChosenByHand(true);
            }}
            className="rounded-md border bg-surface px-3 py-2 text-sm text-ink"
          />
        </label>
        <div className="min-w-0 space-y-1.5 sm:pt-7">
          {guess ? (
            <p className="text-xs leading-snug text-ink-secondary">
              {guess.period === period
                ? guess.basis === "bills"
                  ? `Read from the file: ${guess.tenants} of ${guess.of} tenants were last billed in ${formatMonth(guess.period)}.`
                  : `The file has no bill dates, so this is the month of the report date (${guess.example}). Please check it.`
                : `The file reads as ${formatMonth(guess.period)}, but you chose ${formatMonth(period)}.`}
            </p>
          ) : (
            <p className="text-xs text-ink-muted">
              Filled in from the file once it is read. Change it only if it is wrong.
            </p>
          )}
          <p className="text-xs text-ink-muted">
            It does not set any billing date; each charge carries its own.
            Choose carefully: with a wrong month, figures are
            filed under the wrong month, and fees and reminders count against it.
          </p>
        </div>
      </Card>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={runParse}
          disabled={phase === "parsing" || !canAct}
          className="w-full rounded-md border border-accent bg-accent px-5 py-2.5 text-sm font-medium text-accent-ink sm:w-auto"
        >
          {phase === "parsing"
            ? "Reading"
            : [arFile, contactFile].filter(Boolean).length === 2
              ? "Read both files"
              : "Read the file"}
        </button>
      </div>

      {phase === "parsing" ? <ParseSkeleton /> : null}

      {phase === "done" && results.length > 0 ? (
        <ApplyBar
          results={results}
          period={period}
          canAct={canAct}
          fileName={arFile?.name ?? null}
          onApplied={(label) =>
            notify(
              "Now using your file",
              `${label}. Every screen has switched to it.`,
            )
          }
        />
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
  fileName,
  onApplied,
}: {
  results: ParseResult[];
  period: string;
  canAct: boolean;
  /** Stored against the upload, so a figure can be traced to the file. */
  fileName: string | null;
  onApplied: (label: string) => void;
}) {
  const active = useDataset();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /* Memoised so the comparison below runs once per upload, not per render. */
  const built = useMemo(() => datasetFromResults(results, period), [results, period]);

  /*
   * What changed since the report in use, said before the file is adopted.
   *
   * Worked out against the report every screen is using, and frozen once
   * "Use this report" is pressed: after that the report in use is this file,
   * and comparing it with itself would say nothing changed.
   */
  const changed = useMemo(
    () =>
      built && active.source === "uploaded"
        ? {
            asOf: active.asOf,
            moves: compareReports(active.accounts, built.accounts),
            before: active.accounts,
            bills: newBills(active.invoices, built.invoices),
          }
        : null,
    [built, active],
  );
  const frozen = useRef(changed);
  const [adopted, setAdopted] = useState(false);
  if (!adopted) frozen.current = changed;

  /**
   * Sends the report to the database.
   *
   * Pulled out of the button because the other path needs it too. A file that
   * is already on screen may still not be in the database, and until now that
   * was unreachable: the screen compared what it had just read against the
   * browser's copy, found them the same, and removed the only control that
   * saves anything. The one case where saving matters most had no button.
   */
  async function save(d: NonNullable<typeof built>) {
    setSaving(true);
    setSaveError(null);
    /*
     * The contact list goes with it, where one was uploaded. Without this the
     * addresses were linked in the browser, shown on screen, and never reached
     * the database: the next load fetched contacts from the server and the
     * uploaded ones were gone.
     *
     * Null rather than an empty array when no list was given, because absent
     * and empty mean different things to the import.
     */
    const uploaded = results.find((r) => r.kind === "contact-list");
    /*
     * The same checks the panel below shows, sent with the file.
     *
     * Computed here rather than passed down, because this is where the save
     * happens and the two must describe the same upload. checkUpload is a pure
     * function of (results, active), so calling it twice gives one answer.
     *
     * They go to the server so the nine o'clock run can read them. Until it
     * could, "Do not use this data" was advice to whoever was looking, and the
     * run went ahead on the same figures the next morning.
     */
    const result = await storeDataset(
      d,
      fileName ?? null,
      uploaded && "contacts" in uploaded ? uploaded.contacts : null,
      checkUpload(results, active),
    );
    setSaving(false);

    if (!result.ok) {
      setSaveError(
        result.problems?.length
          ? result.problems.map((p) => `${p.what}: ${p.detail}`).join(" ")
          : result.error ?? "The report could not be saved to the database.",
      );
      return false;
    }
    setSaved(true);
    return true;
  }
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
  /*
   * Compared on substance since 13 October.
   *
   * This used to be the report date and the two row counts and nothing else,
   * so the same AR file uploaded with a NEW contact list was "already in use,
   * nothing to apply" and its addresses were never saved - twice in testing,
   * with no error, which looked like a save that had silently failed. A
   * corrected export for the same day, with one amount changed, would have
   * been turned away the same way.
   *
   * Now: same date, same balances account by account, same lines, and no
   * address in this upload that is not already stored. Anything else is a
   * change and gets the normal "Use this data" button. Judging an unchanged
   * file as changed costs nothing - storing the same report date again
   * replaces it - so the comparison errs that way.
   */
  const contactFile = results.find((r) => r.kind === "contact-list");
  const addsAddresses = useMemo(
    () => (built && contactFile ? newAddresses(built.accounts, active.accounts) : 0),
    [built, contactFile, active.accounts],
  );
  const alreadyApplied = useMemo(
    () =>
      built !== null &&
      active.source === "uploaded" &&
      addsAddresses === 0 &&
      sameFigures(built, active),
    [built, active, addsAddresses],
  );

  if (!built) {
    /* A contact list with no report: saved on its own, not turned away. */
    const list = results.find((r) => r.kind === "contact-list") as ParsedContacts | undefined;
    if (list && !results.some((r) => r.kind !== "contact-list")) {
      return <ContactsOnly list={list} fileName={fileName} canAct={canAct} />;
    }
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

  /*
   * Already in use.
   *
   * This returned nothing at all, on the reasoning that the green banner lower
   * down already says the file is in use and a second "Use this data" only
   * invites a second press. Both halves of that were wrong in practice. The
   * banner is below the fold on a laptop, so what the officer sees after
   * pressing Read is the space where the button was, which reads as a failure
   * rather than as a finished job. And silence is the one answer that cannot
   * be told apart from a screen that has broken.
   *
   * So it says so, in the place the button would have been, and keeps the one
   * action that is still meaningful: sending it to the database again. On
   * screen and stored are different things, and a file can be the first
   * without ever having been the second.
   */
  /*
   * Just adopted. The file is now the one in use, so the check below would
   * say "Already in use, nothing to apply" - true, and no answer to somebody
   * who has just pressed the button. Found testing on 24 October: the save
   * worked and the screen never said so. Said here instead, with what changed.
   */
  if (alreadyApplied && adopted) {
    return (
      <Card className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-5">
        <StatusBadge kind={saveError ? "critical" : saved ? "good" : "neutral"} label={saveError ? "Not saved" : saved ? "In use" : "Saving"} />
        <p className="min-w-0 flex-1 text-sm font-medium text-ink">
          {saveError
            ? <>On screen, but <b>not saved</b>: {saveError} Until it is saved, only this browser can see it.</>
            : saved
              ? "Saved. Everyone signed in now sees this report."
              : "Using this report. Saving it for everyone..."}
        </p>
        {frozen.current ? <WhatChanged changed={frozen.current} after={built.accounts} /> : null}
      </Card>
    );
  }

  if (alreadyApplied) {
    return (
      <Card className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:flex-wrap sm:items-center sm:px-5">
        <span className="self-start sm:self-auto">
          <StatusBadge kind="good" label="Already in use" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-ink">
            This is the file every screen is already using.
          </p>
          <p className="mt-0.5 text-[11px] text-ink-muted">
            Same balances, same lines
            {contactFile ? ", and every address in the contact list is already stored" : ""}.
            Nothing to apply.
          </p>
        </div>
        <button
          type="button"
          disabled={!canAct || saving}
          onClick={() => void save(built)}
          className="shrink-0 self-start rounded border border-line-hair px-3 py-1.5 text-xs text-ink-secondary hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 sm:self-auto"
        >
          {saving ? "Saving..." : "Save again"}
        </button>

        {saveError ? (
          <p className="basis-full text-xs leading-relaxed text-crit-ink">
            <b>Not saved</b>: {saveError}
          </p>
        ) : null}
        {saved ? (
          <p className="basis-full text-xs leading-relaxed text-ink-muted">
            Saved again. Anyone signed in is reading this report.
          </p>
        ) : null}
      </Card>
    );
  }

  return (
    <Card className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">
          Use this report for {formatMonth(period)}?
        </p>
        {errors > 0 ? (
          <p className="mt-0.5 text-[11px] text-ink-muted">
            {errors} row{errors === 1 ? "" : "s"} could not be read. They are listed below.
          </p>
        ) : null}
      </div>
      <button
        type="button"
        disabled={!canAct || saving}
        onClick={async () => {
          /*
           * On screen first, then stored.
           *
           * The officer sees their file immediately, which is what they asked
           * for, and the trip to the server happens behind that. If it fails
           * they still have the month in front of them and a line saying it
           * did not save, rather than a spinner and no figures.
           */
          setAdopted(true);
          applyDataset(built);
          onApplied(`${built.accounts.length} tenants loaded`);
          await save(built);
        }}
        className="shrink-0 rounded-md border border-accent bg-accent px-5 py-2.5 text-sm font-medium text-accent-ink"
      >
        {saving ? "Saving..." : "Use this report"}
      </button>

      {frozen.current && built ? (
        <WhatChanged changed={frozen.current} after={built.accounts} />
      ) : null}

      {/*
        * Said out loud, because the alternative is two people working from two
        * different months without either of them knowing. A save that failed
        * means this file lives in this browser and nowhere else.
        */}
      {saveError ? (
        <p className="basis-full text-xs leading-relaxed text-crit-ink">
          On screen, but <b>not saved</b>: {saveError} Until it is saved, only
          this browser can see it.
        </p>
      ) : null}
      {saved ? (
        <p className="basis-full text-sm font-medium text-good-ink">
          Saved. Everyone signed in now sees this report.
        </p>
      ) : null}
    </Card>
  );
}

/**
 * What changed since the report in use, in a few lines.
 *
 * MES's rule for reading two exports: gone from the newer one is paid in
 * full, a smaller balance is part paid, and nothing here is called an amount
 * paid - a balance that fell by $2,000 may be $5,000 paid and $3,000 billed.
 * Each line opens to the names. Kept short on purpose: the full comparison is
 * at /movement.
 */
const NAMED = 20;

function WhatChanged({
  changed,
  after,
}: {
  changed: { asOf: string; moves: Movement[]; before: readonly Account[]; bills: ReturnType<typeof newBills> };
  after: readonly Account[];
}) {
  const s = summarise(changed.moves, changed.before, after);
  const { rules } = useRules();
  const of = (d: Movement["direction"]) => changed.moves.filter((m) => m.direction === d);
  const rows: [string, Movement[]][] = [
    ["Paid in full, no longer in the report", of("settled")],
    ["Paid part, balance went down", of("down")],
    ["Owe more, balance went up", of("up")],
    ["New tenants", of("new")],
  ];
  const shownDates = changed.bills.dates.slice(0, 4);
  return (
    <div className="basis-full border-t border-line-hair pt-3 text-xs text-ink-secondary">
      <p className="mb-1.5 font-medium text-ink">Compared with the report of {formatDate(changed.asOf)}</p>
      {/* Not one tenant in common: almost always the wrong file - another
          dormitory's export, or another company's - rather than everybody
          paying and a new set moving in. */}
      {changed.before.length > 0 && after.length > 0 && changed.moves.every((m) => m.direction === "settled" || m.direction === "new") ? (
        <p className="mb-1.5 text-crit-ink">
          None of the tenants in this file are in the report in use. Check it is the right file before using it.
        </p>
      ) : null}
      <ul className="divide-y divide-line-hair">
        {rows.map(([label, list]) => (
          <li key={label}>
            <details className="group py-1.5">
              <summary className={`flex justify-between gap-3 ${list.length ? "cursor-pointer" : "pointer-events-none"}`}>
                <span>{label}</span>
                <span className="tabular font-medium text-ink">
                  {list.length} {list.length === 1 ? "tenant" : "tenants"}
                </span>
              </summary>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                {list.slice(0, NAMED).map((m) => m.companyName).join(", ")}
                {list.length > NAMED ? `, and ${list.length - NAMED} more` : ""}
              </p>
            </details>
          </li>
        ))}
        <li className="flex flex-wrap justify-between gap-x-3 gap-y-1 py-1.5">
          <span>New bills</span>
          <span className="text-right">
            <span className="tabular font-medium text-ink">
              {changed.bills.lines} {changed.bills.lines === 1 ? "invoice" : "invoices"}
            </span>
            {shownDates.length > 0 ? (
              <span className="ml-1.5 inline-flex flex-wrap items-center justify-end gap-1 text-[11px] text-ink-muted">
                billed
                {shownDates.map((d) => (
                  <span key={d.billedOn} className="inline-flex items-center gap-1">
                    {formatDate(d.billedOn)}
                    {isAdHoc(d.billedOn, rules.regularBillingDay) ? <Tag>Ad hoc</Tag> : null}
                  </span>
                ))}
                {changed.bills.dates.length > shownDates.length
                  ? `and ${changed.bills.dates.length - shownDates.length} more dates`
                  : ""}
              </span>
            ) : null}
          </span>
        </li>
        <li className="flex justify-between gap-3 py-1.5">
          <span>Total owed</span>
          <span className="tabular font-medium text-ink">
            SGD {formatSgd(s.totalBefore)} → {formatSgd(s.totalAfter)}
          </span>
        </li>
      </ul>
    </div>
  );
}

function StepDot({ n }: { n: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-ink"
    >
      {n}
    </span>
  );
}

function DropZone({
  step,
  title,
  optional = false,
  hint,
  note,
  file,
  onFile,
}: {
  step: number;
  title: string;
  optional?: boolean;
  hint: string;
  note?: string;
  file: File | null;
  onFile: (f: File | null) => void;
}) {
  const fileName = file?.name ?? null;
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <Card className="p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <StepDot n={step} />
        {title}
        {optional ? (
          <span className="text-xs font-normal text-ink-muted">optional</span>
        ) : null}
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{hint}</p>

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
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
        className={`mt-3 w-full rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${
          fileName
            ? "border-accent bg-accent-wash"
            : over
              ? "border-accent bg-accent-wash"
              : "border-line-base hover:border-accent hover:bg-accent-wash"
        }`}
      >
        {fileName ? (
          <>
            <p className="break-words text-sm font-medium text-accent-text">{fileName}</p>
            <p className="mt-1 text-[11px] text-ink-muted">
              Click to choose a different file
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-ink-secondary">
              Choose a file, or drag one here
            </p>
            <p className="mt-1 text-xs text-ink-muted">Excel or CSV</p>
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

      {note ? <p className="mt-3 text-[11px] leading-relaxed text-ink-muted">{note}</p> : null}
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
    ? sumExact(balances.accounts, (x) => x.total)
    : fallback.total;
  const inCredit = balances
    ? balances.accounts.filter((a) => a.total < 0).length
    : 0;
  /*
   * The contact list first, because that is where addresses come from now.
   *
   * This asked the AR report, whose older format carried a Contact Details
   * tab. The Finance AR Download has no such tab, so the tile read zero while
   * the badge a few inches below it said "8 companies with an email address"
   * from the contact list that had just been uploaded alongside. Two counts
   * of the same thing, disagreeing on the same screen.
   */
  /* With a contact list, the tenants it reaches: 260 rows on the list said
     nothing about the 13 tenants it has no row for. */
  const listCodes = contactList
    ? new Set(contactList.contacts.map((c) => c.customerCode.toUpperCase()))
    : null;
  const emailCount = contactList
    ? balances
      ? balances.accounts.filter((a) => listCodes!.has(a.customerCode.toUpperCase())).length
      : contactList.contacts.length
    : detail && detail.contacts.length > 0
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
            ? `${formatMonth(period)}. No file was chosen, so these are example figures as at ${formatDate(asOf)}.`
            : `${formatMonth(period)}${summary?.asOf ? ` · report of ${formatDate(summary.asOf)}` : ""}`
        }
        right={
          errors.length > 0 ? (
            <StatusBadge kind="critical" label={`${errors.length} could not be read`} />
          ) : (
            <StatusBadge kind="good" label="Read cleanly" />
          )
        }
      />

      {/* Each figure once. The tenant, line and address counts used to be
          said again in a paragraph, a badge and a box per file below. Not
          shown when nothing could be read: the figures would be the report
          already in use, presented as though they came from this file. */}
      {usingSample || balances || lines || contactList ? (
      <dl className="grid gap-px bg-line-grid sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          label="Tenant accounts"
          value={String(accountCount)}
          note={
            balances
              ? [
                  /* The Aging Detail export has no Status column, so everyone
                     reads as renting; the split is only said when it exists. */
                  balances.accounts.some((a) => a.status === "Terminated")
                    ? `${balances.accounts.filter((a) => a.status === "Terminated").length} moved out`
                    : null,
                  `${inCredit} in credit`,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : undefined
          }
        />
        <Figure label="Total owed" value={`SGD ${formatSgd(total)}`} />
        <Figure
          label="Invoice lines"
          value={lines ? String(lines.invoices.length) : "not loaded"}
          note={lines ? `${chargeTypes} charge types · ${oneFm} 1FM` : undefined}
        />
        <Figure
          label="Can be emailed"
          value={detail || aging || contactList || usingSample ? String(emailCount) : "not loaded"}
          note={
            contactList && balances
              ? `of ${accountCount} tenants · ${contactList.contacts.length} on the contact list`
              : undefined
          }
        />
      </dl>
      ) : null}

      {contactList && contactList.missing.length > 0 ? (
        <p className="border-t border-line-hair px-5 py-3 text-xs leading-relaxed text-ink-secondary">
          {contactList.missing.length} companies rent at a dormitory but have no address on the
          contact list, so no reminder can reach them. They are named under &ldquo;Rows that need
          a look&rdquo; and stay on the call list.
        </p>
      ) : null}

      {lines ? <Unclassified invoices={lines.invoices} /> : null}

      {/* What only each file says about itself, for when a figure needs tracing. */}
      {aging || detail || contactList ? (
        <details className="border-t border-line-hair px-5 py-3 text-[11px] text-ink-muted">
          <summary className="cursor-pointer text-xs text-accent-text">File details</summary>
          <dl className="mt-2.5 grid gap-x-8 gap-y-1 sm:grid-cols-2">
            {aging ? (
              <>
                <FileFact label="Report date" value={aging.asOf ?? "not stated"} />
                <FileFact label="Entity" value={aging.entity ?? "not stated"} />
                <FileFact label="The report's own subtotals" value={String(aging.subtotals.length)} />
              </>
            ) : null}
            {detail ? (
              <>
                <FileFact label="Relationship managers" value={String(detail.managers.length)} />
                <FileFact label="Industry rows" value={String(detail.industries.length)} />
                <FileFact label="Sheets read" value={detail.sheets.join(", ")} />
              </>
            ) : null}
            {contactList ? (
              <>
                <FileFact label="Contact list dated" value={contactList.asOf ?? "not stated"} />
                <FileFact label="Contact list sheets" value={contactList.sheets.join(", ")} />
              </>
            ) : null}
          </dl>
        </details>
      ) : null}

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
                    label={p.row ? `${p.sheet || "File"} row ${p.row}` : p.sheet || "File"}
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
            These still count towards the tenant&apos;s balance, grouped under
            Other Charges. To add a rule for one, contact the system
            administrator.
          </p>
        </>
      ) : null}
    </div>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="bg-surface px-5 py-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </dt>
      <dd className="mt-1.5 text-xl font-semibold text-ink">{value}</dd>
      {note ? <dd className="mt-1 text-[11px] text-ink-muted">{note}</dd> : null}
    </div>
  );
}

function FileFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className="tabular text-right text-ink">{value}</dd>
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

/**
 * A contact list uploaded without an AR report.
 *
 * Used to land on "Nothing usable - neither file could be read as an AR
 * report", with no way to save it, while the Send By Hand screen told the
 * officer to upload exactly this. Now it says what the list holds, how it
 * lines up with the report every screen is using - a code written differently
 * in the two files reaches nobody, and that is worth seeing before saving, not
 * after - and saves it on its own.
 */
function ContactsOnly({
  list,
  fileName,
  canAct,
}: {
  list: ParsedContacts;
  fileName: string | null;
  canAct: boolean;
}) {
  const active = useDataset();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const companies = new Map(list.contacts.map((c) => [c.customerCode.toUpperCase(), c.companyName]));
  const addresses = list.contacts.reduce((n, c) => n + c.emails.length, 0);
  const inReport = new Set(active.accounts.map((a) => a.customerCode.toUpperCase()));
  const strangers = Array.from(companies).filter(([code]) => !inReport.has(code));
  const owingWithout = active.accounts.filter(
    (a) => a.total > 0 && !a.hasContact && !companies.has(a.customerCode.toUpperCase()),
  ).length;
  const compared = active.source === "uploaded";

  async function save() {
    setSaving(true);
    setError(null);
    const r = await storeContacts(list.contacts, fileName);
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setSaved(
      `Saved ${r.addresses} address${r.addresses === 1 ? "" : "es"} for ${r.companies} ` +
        `compan${r.companies === 1 ? "y" : "ies"}. Addresses already stored were kept; none were removed.`,
    );
  }

  return (
    <Card className="px-5 py-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge kind="good" label="Contact list" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-ink">
            {companies.size} companies, {addresses} email addresses. Save them on their own?
          </p>
          <p className="mt-0.5 text-[11px] text-ink-muted">
            The AR report every screen is using stays as it is. Addresses are
            added to the ones already stored; none are removed.
          </p>
        </div>
        <button
          type="button"
          disabled={!canAct || saving || saved !== null}
          onClick={() => void save()}
          className="shrink-0 rounded border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving..." : saved ? "Saved" : "Save these addresses"}
        </button>
      </div>

      {compared ? (
        <div className="mt-3 space-y-1 border-t border-line-hair pt-3 text-[11px] leading-relaxed text-ink-secondary">
          <p>
            <b className="text-ink">{companies.size - strangers.length}</b> of these companies
            match a customer in the report in use ({active.asOf}).
            {owingWithout > 0 ? (
              <> {owingWithout} customers who owe money still have no address after this list.</>
            ) : null}
          </p>
          {strangers.length > 0 ? (
            <p>
              <b className="text-ink">{strangers.length}</b> code{strangers.length === 1 ? " is" : "s are"} not
              in that report, so their addresses would reach nobody yet. Check they are written the
              same way in both files: {strangers.slice(0, 8).map(([c]) => c).join(", ")}
              {strangers.length > 8 ? ` and ${strangers.length - 8} more` : ""}.
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="mt-2 text-xs text-crit-ink">
          <b>Not saved</b>: {error}
        </p>
      ) : null}
      {saved ? <p className="mt-2 text-xs text-ink-muted">{saved}</p> : null}
    </Card>
  );
}
