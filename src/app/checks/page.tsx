"use client";

/**
 * The test cases, run in front of whoever is watching.
 *
 * `npm run test:cases` already runs these and fails the build. This screen
 * exists because that proof lives in a terminal, and the people who most need
 * to see it — a client asking whether the aging is right, a manager asking
 * whether their own tenants are scoped correctly — are never going to open
 * one. Same cases, same code, a table anybody can read.
 *
 * It is a display of evidence, not the gate. The gate is the terminal run,
 * which can stop a deploy; this cannot. Said plainly on the screen, because a
 * green page in an app that is itself broken would be worth nothing, and
 * somebody should know which of the two to trust.
 */

import { useEffect, useMemo, useState } from "react";
import {
  parseCases,
  runCases,
  tally,
  needsTheFile,
  whyItNeedsTheFile,
  type CheckCase,
  type CheckResult,
} from "@/lib/checks";
import { Card, CardHeader, EmptyState, StatTile, StatusBadge } from "@/components/ui";

type Filter = "all" | "failed" | "skipped";

export default function ChecksPage() {
  const [cases, setCases] = useState<CheckCase[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [area, setArea] = useState<string>("all");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/test-cases.csv")
      .then((r) => {
        if (!r.ok) throw new Error(`could not read the case file (${r.status})`);
        return r.text();
      })
      .then((t) => alive && setCases(parseCases(t)))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, []);

  const results = useMemo<CheckResult[]>(
    () => (cases ? runCases(cases) : []),
    [cases],
  );

  const tallies = useMemo(() => tally(results), [results]);
  const passed = results.filter((r) => !r.skipped && r.pass).length;
  const failed = results.filter((r) => !r.skipped && !r.pass).length;
  const skipped = results.filter((r) => r.skipped).length;

  const shown = results.filter((r) => {
    if (area !== "all" && r.area !== area) return false;
    if (filter === "failed") return !r.skipped && !r.pass;
    if (filter === "skipped") return Boolean(r.skipped);
    return true;
  });

  if (error) {
    return (
      <EmptyState
        title="The case file could not be read"
        body={`${error}. It is published at /test-cases.csv and rebuilt by "python scripts/build-cases.py".`}
      />
    );
  }

  if (!cases) {
    return <EmptyState title="Running the checks" body="Reading the case file." />;
  }

  return (
    <div className="space-y-4">
      <Card className="border-l-2 border-l-[var(--accent)] px-5 py-4">
        <p className="max-w-prose text-xs leading-relaxed text-ink-secondary">
          Every one of these comes from something MES wrote down: their Flow
          tab, their aging formula, their letters, or what Raman said on the 14
          September call. Each row names the requirement it came from, so a red
          line points at a sentence in their documents rather than at code.
        </p>
        <p className="mt-2 max-w-prose text-xs leading-relaxed text-ink-muted">
          {skipped} of them need MES&rsquo;s workbook itself and are run at the
          terminal by <code className="text-ink-secondary">npm run test:cases</code>,
          which is the run that can stop a deploy. This screen shows the rest,
          worked out here, now. It reports what it cannot do rather than
          counting those as passes.
        </p>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Cases" value={String(results.length)} note="From the published case file" />
        <StatTile label="Passed" value={String(passed)} note="Worked out in this browser" emphasis />
        <StatTile
          label="Failed"
          value={String(failed)}
          note={failed === 0 ? "Nothing disagrees" : "Open them below"}
        />
        <StatTile label="Needs the file" value={String(skipped)} note="Run at the terminal" />
      </div>

      <Card>
        <CardHeader
          title="By area"
          hint="Aging is the largest because it is the one the billing date drives."
        />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line-grid text-left">
                <th className="px-5 py-2.5 text-xs font-medium text-ink-muted">Area</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-ink-muted">Cases</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-ink-muted">Passed</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-ink-muted">Failed</th>
                <th className="px-5 py-2.5 text-right text-xs font-medium text-ink-muted">Needs the file</th>
              </tr>
            </thead>
            <tbody>
              {tallies.map((t) => (
                <tr
                  key={t.area}
                  onClick={() => setArea(area === t.area ? "all" : t.area)}
                  className={`cursor-pointer border-b border-line-hair last:border-0 hover:bg-surface-alt ${
                    area === t.area ? "bg-surface-alt" : ""
                  }`}
                >
                  <td className="px-5 py-2.5 text-ink">{t.area}</td>
                  <td className="tabular px-3 py-2.5 text-right text-ink-secondary">
                    {t.pass + t.fail + t.skipped}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right text-ink-secondary">{t.pass}</td>
                  <td className="tabular px-3 py-2.5 text-right">
                    {t.fail === 0 ? (
                      <span className="text-ink-muted">&mdash;</span>
                    ) : (
                      <span className="font-medium text-[var(--critical)]">{t.fail}</span>
                    )}
                  </td>
                  <td className="tabular px-5 py-2.5 text-right text-ink-muted">
                    {t.skipped === 0 ? "—" : t.skipped}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={area === "all" ? "Every case" : area}
          hint="Click a row to see the requirement it came from, and the exact input."
          right={
            <div className="flex flex-wrap gap-1.5">
              {area !== "all" ? (
                <button
                  type="button"
                  onClick={() => setArea("all")}
                  className="rounded border border-line-hair px-2.5 py-1 text-[11px] text-ink-secondary hover:border-line-grid"
                >
                  All areas
                </button>
              ) : null}
              {(["all", "failed", "skipped"] as Filter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`rounded border px-2.5 py-1 text-[11px] ${
                    filter === f
                      ? "border-accent bg-accent text-accent-ink"
                      : "border-line-hair text-ink-secondary hover:border-line-grid"
                  }`}
                >
                  {f === "all" ? "All" : f === "failed" ? "Failed only" : "Needs the file"}
                </button>
              ))}
            </div>
          }
        />

        {shown.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-ink-muted">
            {filter === "failed"
              ? "Nothing failed."
              : "Nothing to show with those filters."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line-grid text-left">
                  <th className="px-5 py-2.5 text-xs font-medium text-ink-muted">Case</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-ink-muted">What it checks</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-ink-muted">Expected</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-ink-muted">Actual</th>
                  <th className="px-5 py-2.5 text-xs font-medium text-ink-muted">Result</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <>
                    <tr
                      key={r.id}
                      onClick={() => setOpen(open === r.id ? null : r.id)}
                      className="cursor-pointer border-b border-line-hair last:border-0 hover:bg-surface-alt"
                    >
                      <td className="tabular whitespace-nowrap px-5 py-2.5 text-ink-muted">{r.id}</td>
                      <td className="px-3 py-2.5 text-ink-secondary">{r.scenario}</td>
                      <td className="tabular px-3 py-2.5 text-ink-secondary">{r.expected}</td>
                      <td className="tabular px-3 py-2.5 text-ink">
                        {r.skipped ? <span className="text-ink-muted">&mdash;</span> : r.actual}
                      </td>
                      <td className="px-5 py-2.5">
                        {r.skipped ? (
                          <StatusBadge kind="neutral" label="needs the file" />
                        ) : r.pass ? (
                          <StatusBadge kind="good" label="pass" />
                        ) : (
                          <StatusBadge kind="critical" label="FAIL" />
                        )}
                      </td>
                    </tr>
                    {open === r.id ? (
                      <tr key={`${r.id}-why`} className="border-b border-line-hair bg-surface-alt">
                        <td colSpan={5} className="px-5 py-3">
                          <p className="text-[11px] italic leading-relaxed text-ink-muted">
                            From: {r.requirement}
                          </p>
                          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-secondary">
                            <span className="text-ink-muted">Checked with </span>
                            <code>{r.op}</code>
                            <span className="text-ink-muted"> on </span>
                            <code>{r.input === "" ? "(nothing)" : r.input}</code>
                          </p>
                          {r.skipped ? (
                            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">
                              {whyItNeedsTheFile(r.op)}
                            </p>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="border-t border-line-hair px-5 py-3 text-[11px] leading-relaxed text-ink-muted">
          Add your own: edit <code className="text-ink-secondary">public/test-cases.csv</code>,
          one row per case. For aging, the input is the billing date and the
          report date separated by a bar, and the last column is the answer you
          expect. Move the billing date and the answer should move with it.
          {needsTheFile("monthReminded") ? null : null}
        </div>
      </Card>
    </div>
  );
}
