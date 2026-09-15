"use client";

import { useMemo, useRef, useState } from "react";
import { readWorkbook, runPipeline, type Pipeline } from "@/lib/pipeline";
import {
  CYCLE_DAYS,
  emptyState,
  markPaid,
  markPromised,
  planFor,
  runDay,
  snapshot,
  stillOwing,
  type CycleDay,
  type SimEvent,
  type SimState,
} from "@/lib/cycle";
import { CAN_SEND_FOR_REAL } from "@/lib/outbox";
import { formatSgd, overdueTotal } from "@/lib/data";
import { useToast } from "@/lib/session";
import {
  Card,
  CardHeader,
  EmptyState,
  ScrollPanel,
  Spinner,
  StatTile,
  StatusBadge,
} from "@/components/ui";

/**
 * A month of MES's cycle, run one day at a time, sending nothing.
 *
 * The first version of this screen reported what each day would do, computed
 * from the same starting position every time. That is not a simulation: the
 * 21st had no idea the 7th had happened and both named the same tenants.
 *
 * This runs. State carries from one day to the next, and the two things that
 * happen in the world rather than in the software - a payment arriving,
 * somebody promising on the phone - are supplied by whoever is driving it.
 * That is the part that makes the flow legible: send the reminder on the 7th,
 * mark one tenant paid, and the 15th, the 16th and the 21st all change.
 */
export default function SimulationPage() {
  const { notify } = useToast();
  const [ar, setAr] = useState<File | null>(null);
  const [contacts, setContacts] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [state, setState] = useState<SimState>(emptyState());

  const load = async () => {
    if (!ar) return;
    setBusy(true);
    try {
      const p = runPipeline(
        readWorkbook(await ar.arrayBuffer()),
        contacts ? readWorkbook(await contacts.arrayBuffer()) : null,
      );
      setPipeline(p);
      setState(emptyState());
      notify(
        "Loaded",
        `${p.invoices.length} charge lines across ${p.accounts.length} accounts. The month has not started.`,
      );
    } catch (e) {
      notify("Could not read those files", e instanceof Error ? e.message : "Unknown problem.");
    } finally {
      setBusy(false);
    }
  };

  const doneDays = useMemo(
    () => (state.at === null ? [] : CYCLE_DAYS.filter((d) => d <= state.at!)),
    [state.at],
  );
  const nextDay: CycleDay | null =
    CYCLE_DAYS.find((d) => state.at === null || d > state.at) ?? null;

  const plan = pipeline && nextDay ? planFor(pipeline, state, nextDay) : null;
  const snap = pipeline ? snapshot(pipeline, state) : null;
  const owing = pipeline ? stillOwing(pipeline, state) : [];

  return (
    <div className="space-y-5">
      <Card className="border-l-2 border-l-[var(--warning)] px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge kind="warning" label="Sandbox" />
          <p className="text-xs leading-relaxed text-ink-secondary">
            Nothing here is sent, saved or recorded, and reloading loses it.{" "}
            {CAN_SEND_FOR_REAL
              ? "Sending is configured, which it should not be."
              : "Sending is off at the code level, not in a setting, so it cannot be switched on by accident."}
          </p>
        </div>
      </Card>

      {!pipeline ? (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            <Drop
              title="AR Report"
              hint="Finance AR Download, or the Custom A/R Aging Detail. Either is read."
              file={ar}
              onFile={setAr}
            />
            <Drop
              title="Client contact list"
              hint="Optional. Leave it out to see what the month looks like with nobody reachable."
              file={contacts}
              onFile={setContacts}
            />
          </div>
          <button
            type="button"
            onClick={load}
            disabled={!ar || busy}
            className="inline-flex items-center gap-2 rounded border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? <Spinner /> : null}
            {busy ? "Reading" : "Load the month"}
          </button>
        </>
      ) : null}

      {pipeline && snap ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Still owing"
              value={String(snap.owing)}
              note={`${formatSgd(snap.owed)} of ${snap.tenants} tenants`}
              emphasis
            />
            <StatTile
              label="Reminded"
              value={`${snap.reminded} / ${snap.finalised}`}
              note="First reminder / final notice"
            />
            <StatTile
              label="Fees raised"
              value={String(snap.charged)}
              note={`${formatSgd(snap.feeValue)} before GST`}
            />
            <StatTile
              label="Paid or promised"
              value={`${snap.paid} / ${snap.promised}`}
              note="Paid is settled, promised is held"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
            <Card>
              <CardHeader
                title={
                  state.at === null
                    ? "The month has not started"
                    : `Ran to the ${state.at}${ordinal(state.at)}`
                }
                hint="MES's own cycle, from the Flow tab of their workbook. Each day runs against where the month has got to, not against the file as loaded."
                right={
                  <button
                    type="button"
                    onClick={() => setState(emptyState())}
                    className="rounded border border-line-hair px-2.5 py-1 text-[11px] text-ink-secondary hover:border-line-grid"
                  >
                    Start the month again
                  </button>
                }
              />

              <ol className="divide-y divide-line-grid">
                {CYCLE_DAYS.map((d) => {
                  const done = doneDays.includes(d);
                  const isNext = nextDay === d;
                  return (
                    <li
                      key={d}
                      className={`flex flex-wrap items-center gap-3 px-5 py-3 ${
                        isNext ? "bg-surface-alt" : ""
                      }`}
                    >
                      <span
                        className={`tabular w-12 shrink-0 text-sm font-medium ${
                          done ? "text-ink-muted" : "text-ink"
                        }`}
                      >
                        {d}
                        <span className="text-[10px]">{ordinal(d)}</span>
                      </span>
                      <span className="min-w-0 flex-1 text-sm text-ink-secondary">
                        {planFor(pipeline, state, d).title}
                      </span>
                      {done ? (
                        <StatusBadge kind="good" label="done" />
                      ) : isNext ? (
                        <StatusBadge kind="warning" label="next" />
                      ) : (
                        <span className="text-[11px] text-ink-muted">waiting</span>
                      )}
                    </li>
                  );
                })}
              </ol>

              {plan && nextDay ? (
                <div className="space-y-3 border-t border-line-hair bg-surface-alt px-5 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-medium text-ink">
                      Next: the {nextDay}
                      {ordinal(nextDay)}, {plan.title.toLowerCase()}
                    </h3>
                    <span className="text-[11px] text-ink-muted">
                      {plan.affected} tenants &middot; {formatSgd(plan.value)}
                    </span>
                  </div>

                  {plan.fromFlowTab ? (
                    <p className="text-[11px] italic leading-relaxed text-ink-muted">
                      MES&rsquo;s wording: &ldquo;{plan.fromFlowTab}&rdquo;
                    </p>
                  ) : null}

                  <ul className="space-y-1">
                    {plan.willDo.map((w) => (
                      <li key={w} className="text-[11px] leading-relaxed text-ink-secondary">
                        &middot; {w}
                      </li>
                    ))}
                  </ul>

                  {plan.blockers.length > 0 ? (
                    <ul className="space-y-1 rounded border border-line-hair bg-surface px-3 py-2">
                      {plan.blockers.map((b) => (
                        <li key={b} className="text-[11px] leading-relaxed text-ink-muted">
                          &middot; {b}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => setState(runDay(pipeline, state, nextDay))}
                    className="rounded border border-accent bg-accent px-3.5 py-2 text-xs font-medium text-accent-ink hover:opacity-90"
                  >
                    Run the {nextDay}
                    {ordinal(nextDay)}
                  </button>
                </div>
              ) : (
                <div className="border-t border-line-hair px-5 py-4 text-xs text-ink-secondary">
                  The month is finished. {snap.owing} tenants are still owing{" "}
                  {formatSgd(snap.owed)}, which is what carries into next month.
                </div>
              )}
            </Card>

            <div className="space-y-4">
              <MeanwhileCard
                owing={owing}
                day={(state.at ?? 1) as CycleDay}
                onPaid={(a) => setState(markPaid(state, a, (state.at ?? 1) as CycleDay))}
                onPromised={(a, by) =>
                  setState(markPromised(state, a, by, (state.at ?? 1) as CycleDay))
                }
              />
              <LogCard log={state.log} />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * The things that happen off-screen.
 *
 * A month is not only what the software does on six dates. Tenants pay, and
 * tenants ring up and say they will. Without a way to say so, every run ends
 * with exactly the tenants it started with, which is the thing that made the
 * first version of this screen a report rather than a simulation.
 */
function MeanwhileCard({
  owing,
  day,
  onPaid,
  onPromised,
}: {
  owing: ReturnType<typeof stillOwing>;
  day: CycleDay;
  onPaid: (a: ReturnType<typeof stillOwing>[number]) => void;
  onPromised: (a: ReturnType<typeof stillOwing>[number], by: string) => void;
}) {
  const [by, setBy] = useState("");

  return (
    <Card>
      <CardHeader
        title="Meanwhile, in the real world"
        hint="Mark a tenant as having paid, or as having promised on the phone. Every later day changes accordingly."
      />
      {owing.length === 0 ? (
        <EmptyState title="Nobody is owing" body="Nothing left to chase this month." />
      ) : (
        <ScrollPanel className="max-h-72">
          <ul className="divide-y divide-line-hair">
            {owing.slice(0, 40).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] text-ink">
                    {a.companyName}
                  </span>
                  <span className="tabular text-[10px] text-ink-muted">
                    {formatSgd(overdueTotal(a))} overdue
                    {a.hasContact ? "" : " · no address"}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onPaid(a)}
                  className="rounded border border-line-hair px-2 py-0.5 text-[10px] text-ink-secondary hover:border-line-grid"
                >
                  Paid
                </button>
                <button
                  type="button"
                  onClick={() => onPromised(a, by || "end of the month")}
                  className="rounded border border-line-hair px-2 py-0.5 text-[10px] text-ink-secondary hover:border-line-grid"
                >
                  Promised
                </button>
              </li>
            ))}
          </ul>
        </ScrollPanel>
      )}
      <div className="border-t border-line-hair px-4 py-2.5">
        <input
          value={by}
          onChange={(e) => setBy(e.target.value)}
          placeholder="Promised by when, e.g. 30 September"
          className="w-full rounded border border-line-hair bg-surface px-2.5 py-1.5 text-[11px] text-ink placeholder:text-ink-muted"
        />
        <p className="mt-1.5 text-[10px] leading-relaxed text-ink-muted">
          Paid settles the debt. Promised only holds it: the final notice stays
          away while the date stands, and they come back if it passes unpaid.
          Day {day} of the cycle.
        </p>
      </div>
    </Card>
  );
}

function LogCard({ log }: { log: SimEvent[] }) {
  const TONE: Record<SimEvent["kind"], string> = {
    sent: "text-ink",
    called: "text-ink-secondary",
    charged: "text-ink",
    paid: "text-ink",
    promised: "text-ink-secondary",
    note: "text-ink-muted",
    blocked: "text-ink-muted",
  };
  return (
    <Card>
      <CardHeader title="What happened" hint="In the order it happened." />
      {log.length === 0 ? (
        <EmptyState title="Nothing yet" body="Run a day and it appears here." />
      ) : (
        <ScrollPanel className="max-h-80">
          <ul className="divide-y divide-line-hair">
            {log.map((e, n) => (
              <li key={n} className="px-4 py-2">
                <div className="flex items-baseline gap-2">
                  <span className="tabular shrink-0 text-[10px] text-ink-muted">
                    {e.day}
                    {ordinal(e.day)}
                  </span>
                  <span className={`text-[11px] leading-relaxed ${TONE[e.kind]}`}>
                    {e.text}
                  </span>
                </div>
                {e.accounts && e.accounts.length > 0 ? (
                  <p className="mt-0.5 pl-7 text-[10px] leading-relaxed text-ink-muted">
                    {e.accounts.slice(0, 4).join(", ")}
                    {e.accounts.length > 4 ? ` and ${e.accounts.length - 4} more` : ""}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </ScrollPanel>
      )}
    </Card>
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

/** 1st, 4th, 7th, 15th, 16th, 21st. The teens are all th. */
function ordinal(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][day % 10] ?? "th";
}
