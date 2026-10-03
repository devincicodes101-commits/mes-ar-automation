import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Whether the stored report is one the schedule may act on.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 *
 * The upload screen checks a file and gives one of three answers, the worst
 * being "do not use this data". That answer was reaching a person and nothing
 * else: checkUpload ran in the browser and the result was never written down,
 * so the nine o'clock run - which nobody is watching - went ahead on the same
 * figures and sent letters and raised fees from them.
 *
 * A warning the machine cannot read is a warning about a machine's behaviour
 * that only a human sees. 0021 stores the verdict; this reads it.
 *
 * ---------------------------------------------------------------------------
 * What it does not do
 *
 * It does not block the screens. Looking at a file is not acting on it, and an
 * officer needs to see the figures in order to judge whether the file is
 * usable at all. The same split the staleness rule already makes.
 */

export type Verdict = "error" | "warning" | "note" | null;

export interface UploadStanding {
  /** The upload the report on screen came from, where one was found. */
  uploadId: string | null;
  verdict: Verdict;
  /** Set where somebody decided a failed file was usable anyway. */
  overriddenBy: string | null;
  overriddenAt: string | null;
  overrideNote: string | null;
  /** Titles of the error-level findings, for the run's own notes. */
  failed: string[];
}

export const UNKNOWN: UploadStanding = {
  uploadId: null,
  verdict: null,
  overriddenBy: null,
  overriddenAt: null,
  overrideNote: null,
  failed: [],
};

interface StoredFinding {
  severity?: string;
  title?: string;
}

/**
 * The standing of the most recent upload.
 *
 * Keyed on upload order rather than report date, to match newestReport: the
 * report on screen is the one most recently uploaded, so the verdict that
 * governs it has to be that upload's.
 *
 * A database without 0021 applied returns UNKNOWN rather than throwing. The
 * gate then lets everything through, which is the behaviour before this
 * existed - a missing migration should not stop MES's collections.
 */
export async function uploadStanding(db: SupabaseClient): Promise<UploadStanding> {
  const r = await db
    .from("uploads")
    .select("id, checks, verdict, override_by, override_at, override_note")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (r.error || !r.data) return UNKNOWN;

  const row = r.data as {
    id: string;
    checks: StoredFinding[] | null;
    verdict: string | null;
    override_by: string | null;
    override_at: string | null;
    override_note: string | null;
  };

  const verdict =
    row.verdict === "error" || row.verdict === "warning" || row.verdict === "note"
      ? row.verdict
      : null;

  return {
    uploadId: row.id,
    verdict,
    overriddenBy: row.override_by,
    overriddenAt: row.override_at,
    overrideNote: row.override_note,
    failed: (row.checks ?? [])
      .filter((f) => f.severity === "error")
      .map((f) => f.title ?? "an unnamed check")
      .slice(0, 6),
  };
}

/**
 * May the schedule act on this report?
 *
 * Acting means writing to a tenant or charging one: the 7th, the 16th and the
 * 21st. The other three days read and rebuild, which is safe whatever the
 * checks said, and is how an officer sees the problem in the first place.
 *
 * Mirrors tooOldToAct, deliberately: same shape, same days, same reasoning.
 * Both answer "is this report fit to act on", and a reader who has met one
 * should recognise the other.
 */
export function refusedByChecks(
  day: number,
  standing: UploadStanding,
  /* As tooOldToAct: the run says whether it writes today, and that wins. */
  writesToday?: boolean,
): { act: false; why: string } | { act: true; warn: string | null } {
  const acts = writesToday ?? (day === 7 || day === 16 || day === 21);

  if (standing.verdict !== "error") return { act: true, warn: null };

  if (standing.overriddenAt) {
    return {
      act: true,
      warn:
        "The checks on this upload failed and somebody marked it usable anyway" +
        (standing.overrideNote ? `: ${standing.overrideNote}` : ".") +
        " Acting on it as instructed.",
    };
  }

  if (!acts) {
    return {
      act: true,
      warn:
        "The checks on this upload failed, but today writes to nobody, so the " +
        "day runs as usual.",
    };
  }

  const named = standing.failed.length > 0 ? ` ${standing.failed.join("; ")}.` : "";
  return {
    act: false,
    why:
      "The checks on the stored report failed, so nothing was sent and no fee " +
      `was raised.${named} Upload a corrected file, or mark this one usable on ` +
      "the Upload Reports screen if the figures are right.",
  };
}

/* -------------------------------------------------------------- writing */

/**
 * File the checks against the upload they describe.
 *
 * Separate from import_ar_report rather than an argument to it, so the import
 * keeps the signature every deployed database already has, and separate from
 * the route because that route is deliberately thin: everything it stores goes
 * through one atomic call, and a second write sitting beside it would be the
 * first crack in that rule.
 *
 * A failure is returned, never thrown. The figures are stored and correct
 * either way, and refusing a good import because its verdict could not be
 * filed would be the tail wagging the dog - the same rule the run log follows.
 */
export async function recordVerdict(
  db: SupabaseClient,
  uploadId: string,
  findings: readonly { severity?: string; title?: string; detail?: string }[],
): Promise<string | null> {
  const rank: Record<string, number> = { error: 3, warning: 2, note: 1 };
  const worst =
    findings
      .map((f) => String(f?.severity ?? ""))
      .filter((s) => s in rank)
      .sort((a, b) => (rank[b] ?? 0) - (rank[a] ?? 0))[0] ?? null;

  const r = await db
    .from("uploads")
    .update({ checks: findings, verdict: worst })
    .eq("id", uploadId);

  return r.error ? `the checks were not stored: ${r.error.message}` : null;
}

/**
 * Record that somebody looked at a failed file and decided it is usable.
 *
 * Written to the upload and to the audit log, because this is a person
 * overruling a safety check on money. Against that upload rather than as a
 * setting, so the next file starts clean: the decision was about these
 * figures, not about the system.
 */
export async function markUsable(
  db: SupabaseClient,
  actor: { userId: string; name: string },
  note: string,
): Promise<{ ok: true; uploadId: string } | { ok: false; error: string; status: number }> {
  const last = await db
    .from("uploads")
    .select("id")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (last.error) return { ok: false, error: last.error.message, status: 502 };
  if (!last.data) return { ok: false, error: "There is no upload to mark.", status: 404 };

  const uploadId = (last.data as { id: string }).id;
  const wrote = await db
    .from("uploads")
    .update({
      override_by: actor.userId,
      override_at: new Date().toISOString(),
      override_note: note || null,
    })
    .eq("id", uploadId);

  if (wrote.error) return { ok: false, error: wrote.error.message, status: 502 };

  /* Said in the one place nobody can edit afterwards. */
  await db.from("audit_log").insert({
    actor: actor.userId,
    actor_name: actor.name,
    action: "upload.override",
    subject: uploadId,
    meta: { note: note || null },
  });

  return { ok: true, uploadId };
}
