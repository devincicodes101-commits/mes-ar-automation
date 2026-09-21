/**
 * What the schedule has actually done, and whether anybody helped it.
 *
 *   npm run check:schedule
 *
 * The companion to predict:schedule. That one says what should happen; this
 * says what did, read straight out of the database with nothing opened and
 * nothing clicked.
 *
 * ---------------------------------------------------------------------------
 * The question it really answers
 *
 * "Is it automated" cannot be settled by watching letters arrive, because a
 * letter looks the same whoever sent it. It is settled by two columns:
 *
 *   emails_sent.sent_by   null means the schedule. A uuid means a person sat
 *                         at a screen and pressed something.
 *   audit_log             a day run by hand is recorded there. An empty list
 *                         means no human has ever triggered a run.
 *
 * So this prints those rather than a count. A run nobody can be found to have
 * caused is the whole of the claim.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("\n  NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

interface Summary {
  title?: string;
  feesRaised?: number;
  lettersWritten?: number;
  lettersSent?: number;
  lettersBlocked?: number;
  notes?: string[];
}

const runs = await db
  .from("cron_runs")
  .select("ran_for,cycle_day,status,summary,error,finished_at")
  .order("ran_for", { ascending: false })
  .limit(12);

console.log("\n  THE SCHEDULE'S OWN RECORD        (newest first)\n");
if (runs.error) {
  console.log(`    could not read it: ${runs.error.message}`);
} else if ((runs.data ?? []).length === 0) {
  console.log("    nothing. The schedule has never run.");
} else {
  for (const r of runs.data!) {
    const s = (r.summary ?? {}) as Summary;
    const did =
      r.cycle_day === null
        ? "quiet day, nothing due"
        : [
            s.lettersSent ? `${s.lettersSent} letters sent` : null,
            s.lettersBlocked ? `${s.lettersBlocked} blocked` : null,
            s.feesRaised ? `${s.feesRaised} fees` : null,
          ]
            .filter(Boolean)
            .join(", ") || (s.title ?? "—");
    console.log(
      `    ${r.ran_for}  ${String(r.cycle_day ?? "-").padStart(2)}  ` +
        `${String(r.status).padEnd(12)} ${did}`,
    );
    for (const n of s.notes ?? []) console.log(`                            ${n}`);
    if (r.error) console.log(`                            ERROR ${r.error}`);
  }
}

/* Whether a person is missing from the picture, which is the point. */
const byHand = await db.from("audit_log").select("at,action,subject,actor_name").ilike("action", "%schedule%");

console.log("\n  DAYS RUN BY HAND\n");
if (byHand.error) {
  console.log(`    could not read the audit log: ${byHand.error.message}`);
} else if ((byHand.data ?? []).length === 0) {
  console.log("    none. No person has ever triggered a run.");
} else {
  for (const r of byHand.data!) {
    console.log(`    ${String(r.at).slice(0, 16)}  ${r.subject}  by ${r.actor_name}`);
  }
}

const letters = await db
  .from("emails_sent")
  .select("sent_at,template_name,period,was_simulated,sent_by,recipients,tenants(customer_code)")
  .eq("was_simulated", false)
  .order("sent_at", { ascending: false })
  .limit(25);

console.log("\n  LETTERS THAT GENUINELY LEFT      (newest first)\n");
if (letters.error) {
  console.log(`    could not read them: ${letters.error.message}`);
} else if ((letters.data ?? []).length === 0) {
  console.log("    none yet.");
} else {
  for (const r of letters.data!) {
    const who = r.sent_by === null ? "the schedule" : "a person";
    const code = (r.tenants as { customer_code?: string } | null)?.customer_code ?? "?";
    console.log(
      `    ${String(r.sent_at).slice(0, 16).replace("T", " ")}  ${String(r.template_name).padEnd(15)}` +
        ` ${String(r.period ?? "?").slice(0, 7)}  ${code.padEnd(9)} ${who.padEnd(12)}` +
        ` ${(r.recipients as string[] | null)?.join(", ") ?? ""}`,
    );
  }
}

const sentByNobody = (letters.data ?? []).filter((r) => r.sent_by === null).length;
const sentByPerson = (letters.data ?? []).length - sentByNobody;
console.log(
  `\n  ${sentByNobody} sent by the schedule with nobody logged in, ${sentByPerson} sent by a person.\n`,
);
