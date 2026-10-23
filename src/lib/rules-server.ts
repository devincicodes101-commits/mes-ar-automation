import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DEFAULT_RULES, saneRules, type BusinessRules } from "./rules.ts";

/**
 * The business rules as the database holds them. Never throws: a failed read
 * is the defaults, which are what MES agreed, and the problem is returned so
 * it can be said rather than hidden.
 */

const KEY = "business_rules";

export async function readRules(
  db: SupabaseClient,
): Promise<{ rules: BusinessRules; stored: boolean; problem: string | null }> {
  const r = await db.from("app_settings").select("value").eq("key", KEY).maybeSingle();
  if (r.error) return { rules: DEFAULT_RULES, stored: false, problem: r.error.message };
  if (!r.data) return { rules: DEFAULT_RULES, stored: false, problem: null };
  return { rules: saneRules((r.data as { value: unknown }).value), stored: true, problem: null };
}

export async function writeRules(
  db: SupabaseClient,
  value: unknown,
  actor: { userId: string; name: string },
): Promise<{ ok: true; rules: BusinessRules } | { ok: false; error: string }> {
  const rules = saneRules(value);
  const w = await db
    .from("app_settings")
    .upsert(
      { key: KEY, value: rules, updated_by: actor.userId, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (w.error) return { ok: false, error: w.error.message };

  /* Each of these changes who is charged or written to, so it is recorded
     where nobody can edit it afterwards. */
  await db.from("audit_log").insert({
    actor: actor.userId,
    actor_name: actor.name,
    action: "settings.business_rules",
    subject:
      `fee after ${rules.feeDays} days past the ${rules.feeFrom === "due" ? "due date" : "billing date"}` +
      `; regular billing on the ${rules.regularBillingDay}` +
      `; report warning after ${rules.warnReportAfter} days` +
      `; ${rules.stopReportAfter === null ? "never stops for an old report" : `stops after ${rules.stopReportAfter} days`}`,
    meta: rules,
  });
  return { ok: true, rules };
}
