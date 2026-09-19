import { NextResponse } from "next/server";

import { identify } from "@/lib/api-auth";
import { serverSupabase } from "@/lib/supabase-server";
import { askedFor, inSingapore } from "@/lib/schedule";

/**
 * What the schedule has done, and a way for an administrator to run a day.
 *
 * ---------------------------------------------------------------------------
 * Why a second route rather than opening the first one up
 *
 * /api/cron is the button that raises fees and writes to tenants. Its guard is
 * CRON_SECRET, compared in constant time, and that is the only thing standing
 * between the open internet and a letter. The obvious way to make the schedule
 * demonstrable — let an administrator's own token past that guard too — weakens
 * the one lock that matters, on the one endpoint where a mistake reaches
 * somebody outside MES and cannot be taken back.
 *
 * So the secret stays where it is. This route authenticates the administrator
 * the ordinary way and then makes the privileged call itself, server side,
 * holding the secret the browser never sees. /api/cron's guard is untouched and
 * still refuses everything but the secret.
 *
 * ---------------------------------------------------------------------------
 * Why it needs to exist at all
 *
 * cron_runs is written on every run and no screen read it. The one part of the
 * system that works on its own was the one part nobody could be shown, and a
 * dry run is a different claim: it proves the code decides correctly, not that
 * the schedule fired. This makes the record visible and lets somebody watch a
 * real day happen.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function admin(role: string): boolean {
  return role === "admin" || role === "super-admin";
}

interface RunRow {
  ran_for: string;
  cycle_day: number | null;
  status: string;
  summary: Record<string, unknown> | null;
  missed: string[] | null;
  report_date: string | null;
  error: string | null;
  finished_at: string;
}

/** Every run, newest first. Readable by anyone signed in. */
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

  const { data, error } = await db
    .from("cron_runs")
    .select("ran_for,cycle_day,status,summary,missed,report_date,error,finished_at")
    .order("ran_for", { ascending: false })
    .limit(60);

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "Could not read the schedule's history.",
        detail: error.message,
        hint: /does not exist|schema cache/i.test(error.message)
          ? "This database does not have 0014_cron_runs.sql applied yet."
          : null,
      },
      { status: 502 },
    );
  }

  const runs = (data ?? []) as RunRow[];
  const today = inSingapore();

  return NextResponse.json({
    ok: true,
    runs,
    /*
     * Said rather than left for the screen to work out, so that one answer
     * exists. "When did it last run" and "is today a day that matters" are the
     * two questions somebody opens this page with.
     */
    today: today.iso,
    todayIsCycleDay: runs.length >= 0 && [1, 4, 7, 15, 16, 21].includes(today.day),
    lastRun: runs[0]?.ran_for ?? null,
    canRun: admin(who.caller.role),
  });
}

/**
 * Run one day, as the schedule would.
 *
 * This is the real path, not a simulation: it calls /api/cron, which raises
 * real fees and sends real letters through whatever gate MAIL_MODE currently
 * allows. Restricted to administrators for that reason, and it grants them
 * nothing they did not already have — they can send and raise from the screens
 * already. What it adds is doing it as the schedule does, for a chosen date.
 */
export async function POST(request: Request) {
  const who = await identify(request);
  if (!who.ok) {
    return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  }
  if (!admin(who.caller.role)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Only an administrator can run a day of the schedule. It raises fees " +
          "and writes to tenants.",
      },
      { status: 403 },
    );
  }

  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "CRON_SECRET is not set on this deployment, so the schedule cannot " +
          "be run. The daily run is not working either.",
      },
      { status: 500 },
    );
  }

  let body: { for?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Unreadable request." }, { status: 400 });
  }

  /*
   * Validated here as well as in /api/cron. The date decides which day's work
   * runs, so a typo is a letter sent for the wrong month, and the error is
   * more useful arriving from the screen that asked than from a route the
   * browser did not call.
   */
  const asked = (body.for ?? "").trim();
  if (asked) {
    const checked = askedFor(asked, inSingapore());
    if ("error" in checked) {
      return NextResponse.json({ ok: false, error: checked.error }, { status: 400 });
    }
  }

  const base = (
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    new URL(request.url).origin
  )
    .trim()
    .replace(/\/+$/, "");

  const url = `${base}/api/cron${asked ? `?for=${encodeURIComponent(asked)}` : ""}`;

  let ran: Response;
  try {
    ran = await fetch(url, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `The schedule could not be reached: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  const result = (await ran.json().catch(() => null)) as Record<string, unknown> | null;
  if (!ran.ok || !result?.ok) {
    return NextResponse.json(
      {
        ok: false,
        error:
          (result?.error as string) ?? `The schedule answered ${ran.status}.`,
      },
      { status: ran.status === 401 ? 500 : ran.status },
    );
  }

  /*
   * Recorded, because an administrator running a day by hand is a different
   * event from the schedule running it, and six weeks later the difference is
   * the answer to "why did that tenant get a letter on a Tuesday".
   */
  try {
    const db = serverSupabase();
    await db.from("audit_log").insert({
      actor: who.caller.userId,
      actor_name: who.caller.email ?? "unknown",
      action: "Ran a day of the schedule by hand",
      subject: (result.ranFor as string) ?? asked ?? "today",
      meta: { cycleDay: result.cycleDay ?? null, status: result.status ?? null },
    });
  } catch {
    /* The day ran. Failing to note it must not report the run as failed. */
  }

  return NextResponse.json({ ok: true, ...result });
}
