/**
 * Empties the data so the system can be tested from nothing.
 *
 *   npm run reset:data -- --yes
 *
 * Deletes what an upload and a month of work produce. Keeps what makes the
 * system usable: the people who can sign in, the four dormitories, the
 * managers, the letter wordings and any connected mailbox. Wiping those would
 * mean nobody could log in to see the empty system they just asked for.
 *
 * ---------------------------------------------------------------------------
 * Why this is safe enough to have as a script
 *
 * Everything it removes can be put back by uploading the report again. That is
 * the one property that makes a reset button reasonable here, and it is worth
 * saying out loud because it stops being true the moment somebody has logged a
 * real phone call. Calls, promises and letters cannot be re-derived from
 * anything, so this refuses to run without --yes and prints what it is about
 * to remove first.
 */
import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!BASE || !KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed.");
  process.exit(1);
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

/*
 * Children before parents. Several of these cascade anyway, but relying on
 * that would mean the order silently mattering the day somebody changes a
 * foreign key.
 */
const ORDER = [
  "invoices",
  "account_snapshots",
  "calls",
  "promises",
  "emails_sent",
  "late_fees",
  "giro_failures",
  "tenants",
  "contacts",
  "uploads",
  "cron_runs",
];

/*
 * The audit log cannot be emptied, and that is the point of it.
 *
 * 0002_security.sql gives it no update or delete policy and the database
 * refuses the attempt outright: "audit_log is append only". A log somebody can
 * tidy is not a log. It is left alone rather than tried and reported as a
 * failure, because failing is the correct behaviour and reading it as a fault
 * is how somebody ends up removing the protection.
 *
 * It holds no figures, so an empty system still reads as empty on every
 * screen. What it holds is the history of who did what, which is the one thing
 * a reset has no business touching.
 */
const APPEND_ONLY = ["audit_log"];

/** Left alone: without these nobody can sign in to see the empty system. */
const KEEP = ["profiles", "properties", "managers", "templates", "mail_accounts", "oauth_client"];

async function count(table) {
  const r = await fetch(`${BASE}/rest/v1/${table}?select=*&limit=1`, {
    headers: { ...H, Prefer: "count=exact" },
  });
  if (!r.ok) return null;
  return Number(r.headers.get("content-range")?.split("/")[1] ?? 0);
}

/**
 * Deletes every row.
 *
 * PostgREST refuses an unfiltered delete, which is a good rule and an awkward
 * one here. The filter is on the primary key being "not null", which is true
 * of every row and is the narrowest way of saying "all of them" that it will
 * accept.
 */
async function empty(table, key) {
  const r = await fetch(`${BASE}/rest/v1/${table}?${key}=not.is.null`, {
    method: "DELETE",
    headers: H,
  });
  if (!r.ok && r.status !== 404) {
    const text = await r.text();
    return `${r.status} ${text.slice(0, 120)}`;
  }
  return null;
}

const KEYS = {
  invoices: "id",
  account_snapshots: "id",
  calls: "id",
  promises: "id",
  emails_sent: "id",
  late_fees: "id",
  giro_failures: "id",
  tenants: "id",
  contacts: "id",
  uploads: "id",
  cron_runs: "ran_for",
};

console.log(`\nproject: ${BASE}\n`);

let total = 0;
const before = {};
for (const t of ORDER) {
  const n = await count(t);
  before[t] = n;
  if (n === null) continue;
  total += n;
  if (n > 0) console.log(`  ${t.padEnd(20)} ${String(n).padStart(6)} rows`);
}

if (total === 0) {
  console.log("  already empty\n");
  process.exit(0);
}

console.log(`\n  ${total} rows in total.`);
console.log(`  Keeping: ${KEEP.join(", ")}.`);

if (!process.argv.includes("--yes")) {
  console.log("\n  Nothing was deleted. Run again with --yes to go ahead.\n");
  process.exit(0);
}

/*
 * A last look at the one thing that cannot be re-derived. A report can be
 * uploaded again; a phone call at half past four on a Tuesday cannot, so it is
 * worth a sentence rather than a silent delete.
 */
const work = (before.calls ?? 0) + (before.promises ?? 0) + (before.emails_sent ?? 0);
if (work > 0) {
  console.log(
    `\n  WARNING: ${work} calls, promises or letters are about to go. ` +
      "Those cannot be rebuilt from any file.",
  );
}

console.log("\ndeleting");
for (const t of ORDER) {
  if (before[t] === null || before[t] === 0) continue;
  const problem = await empty(t, KEYS[t]);
  console.log(`  ${t.padEnd(20)} ${problem ? `FAILED  ${problem}` : "cleared"}`);
}

console.log("\nafter");
for (const t of ORDER) {
  const n = await count(t);
  if (n) console.log(`  ${t.padEnd(20)} ${String(n).padStart(6)} rows LEFT`);
}
for (const t of [...KEEP, ...APPEND_ONLY]) {
  const n = await count(t);
  if (n !== null) console.log(`  ${t.padEnd(20)} ${String(n).padStart(6)} kept`);
}
console.log("\n  Upload a report and it fills back up.\n");
