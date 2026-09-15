"use client";

import { useRef, useState } from "react";
import { readWorkbook, runPipeline, type Pipeline } from "@/lib/pipeline";
import { cycleSteps, cycleSummary, type CycleStep } from "@/lib/cycle";
import { CAN_SEND_FOR_REAL } from "@/lib/outbox";
import { formatSgd } from "@/lib/data";
import { useToast } from "@/lib/session";
import {
  Card,
  CardHeader,
  EmptyState,
  Spinner,
  StatTile,
  StatusBadge,
} from "@/components/ui";

/**
 * A whole month, run against two files, with nothing sent.
 *
 * Taha's opening words on the 14 September call are the requirement: "it's
 * better if we can run a few simulations instead of attaching with the
 * backend, because we have actual emails. The simulations will work perfectly
 * fine for understanding the flow completely, instead of going into the
 * production environment."
 *
 * The same walkthrough already existed as `npm run simulate`, which prints a
 * month to a terminal. That is the wrong shape for showing a client. This is
 * the same pipeline, the same functions the real screens call, on a screen.
 *
 * Nothing here writes. It does not mark anything sent, does not touch the
 * stored uploads, and does not queue work. Reloading loses it, which is
 * correct: a sandbox that leaves traces is not one.
 */
export default function SimulationPage() {
  const { notify } = useToast();
  const [ar, setAr] = useState<File | null>(null);
  const [contacts, setContacts] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [open, setOpen] = useState<number | null>(7);

  const run = async () => {
    if (!ar) return;
    setBusy(true);
    try {
      const arWb = readWorkbook(await ar.arrayBuffer());
      const contactWb = contacts
        ? readWorkbook(await contacts.arrayBuffer())
        : null;
      const p = runPipeline(arWb, contactWb);
      setPipeline(p);
      setOpen(7);
      notify(
        "Run finished",
        `${p.invoices.length} charge lines across ${p.accounts.length} accounts. Nothing was sent.`,
      );
    } catch (e) {
      notify(
        "Could not read those files",
        e instanceof Error ? e.message : "Unknown problem.",
      );
    } finally {
      setBusy(false);
    }
  };

  const steps = pipeline ? cycleSteps(pipeline) : [];
  const summary = pipeline ? cycleSummary(pipeline) : null;

  return (
    <div className="space-y-5">
      {/* The guarantee first, because it is the reason this screen is safe to
          point at a client's real tenant list. */}
      <Card className="border-l-2 border-l-[var(--warning)] px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge kind="warning" label="Sandbox" />
          <p className="text-xs leading-relaxed text-ink-secondary">
            Nothing here is sent, saved or recorded. The letters are written and
            counted and stop.{" "}
            {CAN_SEND_FOR_REAL
              ? "Sending is configured, which it should not be on this screen."
              : "Sending is off at the code level, not in a setting, so it cannot be switched on by accident."}
          </p>
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Drop
          title="AR Report"
          hint="Finance AR Download, or the Custom A/R Aging Detail. Either is read."
          file={ar}
          onFile={setAr}
        />
        <Drop
          title="Client contact list"
          hint="Optional. Without it every tenant looks unreachable, which is itself worth seeing."
          file={contacts}
          onFile={setContacts}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={!ar || busy}
          className="inline-flex items-center gap-2 rounded border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Spinner /> : null}
          {busy ? "Running the month" : "Run the month"}
        </button>
        {pipeline ? (
          <button
            type="button"
            onClick={() => {
              setPipeline(null);
              setAr(null);
              setContacts(null);
            }}
            className="rounded border border-line-hair px-3 py-2 text-xs text-ink-secondary hover:border-line-grid"
          >
            Clear
          </button>
        ) : null}
      </div>

      {summary ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Tenants read"
              value={String(summary.tenants)}
              note={`${summary.lines} charge lines`}
            />
            <StatTile
              label="Would be chased"
              value={String(summary.chasing)}
              note={`${formatSgd(summary.overdue)} overdue`}
              emphasis
            />
            <StatTile
              label="Reachable by email"
              value={`${summary.reachable} of ${summary.chasing}`}
              note={`${summary.emails} addresses`}
            />
            <StatTile
              label="Fees that would be raised"
              value={String(summary.fees)}
              note={`${formatSgd(summary.feeValue)} before GST`}
            />
          </div>

          <Card>
            <CardHeader
              title="The month, step by step"
              hint="MES's own cycle from the Flow tab of their workbook. Open a day to see what the system would do on it, against the file you just loaded."
              right={
                <span className="text-[11px] text-ink-muted">
                  {summary.errors} errors &middot; {summary.warnings} warnings
                </span>
              }
            />
            <ul className="divide-y divide-line-grid">
              {steps.map((s) => (
                <Step
                  key={s.day}
                  step={s}
                  open={open === s.day}
                  onToggle={() => setOpen(open === s.day ? null : s.day)}
                />
              ))}
            </ul>
          </Card>
        </>
      ) : (
        <EmptyState
          title="Nothing loaded yet"
          body="Choose an AR report and run it. The month is walked through against that file, and nothing is sent."
        />
      )}
    </div>
  );
}

function Step({
  step,
  open,
  onToggle,
}: {
  step: CycleStep;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left hover:bg-surface-alt"
      >
        <span className="tabular w-12 shrink-0 text-sm font-medium text-ink">
          {step.day}
          <span className="text-[10px] text-ink-muted">{ordinal(step.day)}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-ink">{step.title}</span>
          {step.affected !== null ? (
            <span className="mt-0.5 block text-[11px] text-ink-muted">
              {step.affected} tenants
              {step.value !== null ? ` · ${formatSgd(step.value)}` : ""}
            </span>
          ) : null}
        </span>
        {step.blockers.length > 0 ? (
          <StatusBadge kind="warning" label={`${step.blockers.length} to know`} />
        ) : (
          <StatusBadge kind="good" label="would run" />
        )}
      </button>

      {open ? (
        <div className="space-y-3 border-t border-line-hair bg-surface-alt px-5 py-4">
          {step.fromFlowTab ? (
            <div>
              <span className="text-[11px] font-medium text-ink-secondary">
                MES&rsquo;s wording
              </span>
              <p className="mt-1 text-[11px] italic leading-relaxed text-ink-muted">
                &ldquo;{step.fromFlowTab}&rdquo;
              </p>
            </div>
          ) : null}

          <div>
            <span className="text-[11px] font-medium text-ink-secondary">
              What would happen
            </span>
            <ul className="mt-1 space-y-1">
              {step.outcome.map((o) => (
                <li key={o} className="text-[11px] leading-relaxed text-ink-secondary">
                  &middot; {o}
                </li>
              ))}
            </ul>
          </div>

          {step.blockers.length > 0 ? (
            <div className="rounded border border-line-hair bg-surface px-3 py-2">
              <span className="text-[11px] font-medium text-ink-secondary">
                Worth knowing
              </span>
              <ul className="mt-1 space-y-1">
                {step.blockers.map((b) => (
                  <li key={b} className="text-[11px] leading-relaxed text-ink-muted">
                    &middot; {b}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function Drop({
  title,
  hint,
  file,
  onFile,
}: {
  title: string;
  hint: string;
  file: File | null;
  onFile: (f: File | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{hint}</p>
      <div
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
        onClick={() => ref.current?.click()}
        className={`mt-3 cursor-pointer rounded border border-dashed px-4 py-8 text-center text-xs ${
          over ? "border-accent text-ink" : "border-line-grid text-ink-muted"
        }`}
      >
        {file ? (
          <span className="text-ink">{file.name}</span>
        ) : (
          <>
            Choose a file, or drag one here
            <span className="mt-1 block text-[11px]">Excel or CSV</span>
          </>
        )}
      </div>
      <input
        ref={ref}
        type="file"
        accept=".xlsx,.xls,.csv"
        hidden
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
    </Card>
  );
}

/** 1st, 2nd, 3rd, 4th, and the teens which are all th. */
function ordinal(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][day % 10] ?? "th";
}
