import type { SupabaseClient } from "@supabase/supabase-js";

import { fillWording, type LetterContext, type LetterId } from "./letters.ts";

/**
 * One tenant's letter, edited by hand and saved.
 *
 * The rule, in one line: a letter somebody has edited is sent as edited; every
 * other letter is built from MES's standard wording and the usual figures.
 *
 * ---------------------------------------------------------------------------
 * Why the edit keeps {{placeholders}} rather than the words as they looked
 *
 * An edit can be made days before the letter goes. The balance, the date on
 * the letter and the deadline are all worked out on the day it is sent, so an
 * edit that froze them as typed would send a figure that may no longer be true
 * on a letter about money. Saved with {{amount}}, {{today}} and {{dueBy}} still
 * in it, the officer's words are kept and the figures are filled in by the
 * same code as every other letter, on the day.
 *
 * ---------------------------------------------------------------------------
 * Which bill an edit belongs to
 *
 * An edit is for one tenant, one letter (first reminder or final notice) and
 * one bill (its billing date). When the next month's bill arrives the date
 * differs, so that letter is the standard wording again. An edit made for
 * October's reminder is not quietly reused for November's.
 */

export interface LetterEdit {
  tenantId: string;
  stage: LetterId;
  /** The billing date of the bill the letter is about, ISO. */
  billedOn: string;
  subject: string;
  body: string;
  editedBy: string | null;
  editedAt: string;
}

/** The same key the 9am run uses to name a letter. */
export const editKey = (tenantId: string, stage: LetterId, billedOn: string): string =>
  `${billedOn}|${stage}|${tenantId}`;

/** Words in double braces that get filled in. Anything else would go out as typed. */
export const FILLED_IN = ["company", "code", "property", "amount", "overdue", "today", "dueBy"] as const;

const MAX_LENGTH = 20_000;

/**
 * Whether an edit may be saved, and if not, why - in words the person can act
 * on. Checked on the server, and on the screen so they hear it before pressing.
 */
export function checkEdit(subject: string, body: string): string | null {
  if (subject.trim().length === 0) return "The subject is empty.";
  if (body.trim().length === 0) return "The letter is empty. A letter with no words would reach the tenant blank.";
  if (subject.length > 300) return "The subject is too long.";
  if (body.length > MAX_LENGTH) return "The letter is too long.";

  const unknown = Array.from((subject + body).matchAll(/\{\{\s*([\w]+)\s*\}\}/g))
    .map((m) => m[1]!)
    .filter((name) => !(FILLED_IN as readonly string[]).includes(name));
  if (unknown.length > 0) {
    return (
      `{{${unknown[0]}}} is not something the system fills in, so it would go to the tenant as typed. ` +
      `The ones it fills in are: ${FILLED_IN.map((n) => `{{${n}}}`).join(", ")}.`
    );
  }
  return null;
}

/** An edit, filled for one tenant on the day it goes. */
export function renderEdited(
  edit: Pick<LetterEdit, "stage" | "subject" | "body">,
  c: LetterContext,
): { subject: string; body: string } {
  return {
    subject: fillWording(edit.stage, edit.subject, c),
    body: fillWording(edit.stage, edit.body, c),
  };
}

interface Row {
  tenant_id: string;
  stage: LetterId;
  billed_on: string;
  subject: string;
  body: string;
  edited_by: string | null;
  edited_at: string;
}

/**
 * Every saved edit, by key.
 *
 * A missing table (0026 not applied yet) is not an error for the run: with no
 * edits the run sends the standard letters exactly as it always did. The
 * problem is returned so it can be said rather than hidden.
 */
export async function loadLetterEdits(
  db: SupabaseClient,
): Promise<{ edits: Map<string, LetterEdit>; problem: string | null }> {
  const { data, error } = await db
    .from("letter_edits")
    .select("tenant_id,stage,billed_on,subject,body,edited_by,edited_at");

  const edits = new Map<string, LetterEdit>();
  if (error) {
    const missing = /does not exist|schema cache/i.test(error.message);
    return {
      edits,
      problem: missing
        ? "This database does not have 0026_letter_edits.sql applied yet, so edited letters cannot be used."
        : error.message,
    };
  }

  for (const r of (data ?? []) as Row[]) {
    edits.set(editKey(r.tenant_id, r.stage, r.billed_on), {
      tenantId: r.tenant_id,
      stage: r.stage,
      billedOn: r.billed_on,
      subject: r.subject,
      body: r.body,
      editedBy: r.edited_by,
      editedAt: r.edited_at,
    });
  }
  return { edits, problem: null };
}
