import { NextResponse } from "next/server";

import { identify } from "@/lib/api-auth";
import { serverSupabase } from "@/lib/supabase-server";
import { reportDates, reportOn } from "@/lib/read-report";
import { chronic, compareReports, summarise, type Snapshot } from "@/lib/movement";

/**
 * What changed between two reports, and who has been stuck.
 *
 * The only thing in this system that shows a direction rather than a moment.
 * Everything else answers "who owes what today"; this answers "who paid since
 * the 4th, who slid a bucket, and who has been in 90+ since June", which are
 * the three facts that decide what an officer actually does with their morning.
 *
 * Without arguments it compares the two newest reports, because that is what
 * somebody opening the screen almost always wants. `from` and `to` name report
 * dates explicitly.
 *
 * Ordered by report date, never by when a file was uploaded. MES re-upload
 * months late, and comparing them the wrong way round would turn every
 * settlement into a new debt.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** How many reports back the chronic list looks. Four covers about a month. */
const HISTORY = 4;

export async function GET(request: Request) {
  const who = await identify(request);
  if (!who.ok) {
    return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  }

  let db;
  try {
    db = serverSupabase();
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }

  const dates = await reportDates(db);
  if (!dates.ok) {
    return NextResponse.json({ ok: false, error: dates.error }, { status: 502 });
  }

  /*
   * One report is not a fault, it is a system that has been used once. Said
   * plainly so the screen can explain rather than show an empty table, which
   * looks identical to everybody having paid.
   */
  if (dates.dates.length < 2) {
    return NextResponse.json({
      ok: true,
      movements: null,
      dates: dates.dates,
      reason:
        dates.dates.length === 0
          ? "No reports are stored yet."
          : "Only one report is stored, so there is nothing to compare it with. " +
            "Upload the next one and this fills in.",
    });
  }

  const params = new URL(request.url).searchParams;
  // Newest first from the database, so [1] is the previous report.
  const to = params.get("to") ?? dates.dates[0]!;
  const from = params.get("from") ?? dates.dates[1]!;

  for (const [name, value] of [["from", from], ["to", to]] as const) {
    if (!dates.dates.includes(value)) {
      return NextResponse.json(
        {
          ok: false,
          error: `There is no report dated ${value}.`,
          dates: dates.dates,
          which: name,
        },
        { status: 400 },
      );
    }
  }

  if (from === to) {
    return NextResponse.json(
      { ok: false, error: "Those are the same report, so nothing would have changed." },
      { status: 400 },
    );
  }

  if (from > to) {
    /*
     * Refused rather than swapped. A caller who asked for these the wrong way
     * round has misunderstood something, and quietly reversing it would return
     * a correct-looking answer to a wrong question.
     */
    return NextResponse.json(
      {
        ok: false,
        error:
          `${from} is newer than ${to}. "from" is the earlier report and "to" ` +
          "the later one, because everything here reads as a change over time.",
      },
      { status: 400 },
    );
  }

  const [older, newer] = await Promise.all([reportOn(db, from), reportOn(db, to)]);

  if (!older.ok || !newer.ok) {
    const bad = !older.ok ? older : (newer as { error: string; detail: string | null });
    return NextResponse.json(
      { ok: false, error: bad.error, detail: bad.detail },
      { status: 502 },
    );
  }
  if (!older.report || !newer.report) {
    return NextResponse.json(
      { ok: false, error: "One of those reports has no accounts stored against it." },
      { status: 502 },
    );
  }

  const movements = compareReports(older.report.accounts, newer.report.accounts);

  /*
   * The chronic list needs more than two reports, so it is loaded separately
   * and only as far back as HISTORY. Reading every report ever stored would
   * grow without limit and answer a question nobody asked.
   */
  const recent = dates.dates.slice(0, HISTORY);
  const loaded = await Promise.all(recent.map((d) => reportOn(db, d)));
  const snapshots: Snapshot[] = [];
  loaded.forEach((r, i) => {
    if (r.ok && r.report) snapshots.push({ reportDate: recent[i]!, accounts: r.report.accounts });
  });

  return NextResponse.json({
    ok: true,
    from,
    to,
    dates: dates.dates,
    movements,
    summary: summarise(movements, older.report.accounts, newer.report.accounts),
    chronic: chronic(snapshots, { atLeast: 3, from: "60 days" }),
    /*
     * How many reports the chronic list could actually see. "Nobody is
     * chronic" and "there is not enough history to tell" look the same on
     * screen and mean opposite things.
     */
    chronicAcross: snapshots.length,
  });
}
