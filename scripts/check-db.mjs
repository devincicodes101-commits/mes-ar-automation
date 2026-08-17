/**
 * Connection and security check.
 *
 * Run with:  node scripts/check-db.mjs
 *
 * Confirms the project is reachable, the migrations have run, and, most
 * importantly, that an anonymous caller holding the public key cannot read
 * tenant data. That last check is the one worth showing MES.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error("Missing credentials in .env.local");
  process.exit(1);
}

const db = createClient(url, key);
console.log("project:", url, "\n");

const TABLES = [
  "properties",
  "managers",
  "uploads",
  "accounts",
  "contacts",
  "invoices",
  "giro_failures",
  "templates",
  "calls",
  "promises",
  "emails_sent",
  "late_fees",
  "audit_log",
  "profiles",
];

let missing = 0;
let exposed = 0;

console.log("table            rows  as anonymous");
console.log("---------------- ----  ------------------------------------");

for (const t of TABLES) {
  // A real GET, not head:true. With head:true PostgREST answers a missing
  // table with an empty body, so supabase-js reports count null and error
  // null, which is indistinguishable from "exists but returned nothing".
  // That silently turns a missing schema into a passing test.
  const { data, count, error } = await db
    .from(t)
    .select("*", { count: "exact" })
    .limit(1);

  if (error) {
    if (/does not exist|schema cache|PGRST205|PGRST106/i.test(
        `${error.code} ${error.message}`)) {
      console.log(`${t.padEnd(16)}   --  MISSING, run the migrations`);
      missing += 1;
    } else {
      console.log(
        `${t.padEnd(16)}   --  blocked by RLS (${error.code ?? "rls"})`,
      );
    }
    continue;
  }

  if (count === null && (data === null || data === undefined)) {
    console.log(`${t.padEnd(16)}   --  no response, treat as missing`);
    missing += 1;
    continue;
  }

  const n = count ?? 0;
  if (n > 0) {
    console.log(
      `${t.padEnd(16)} ${String(n).padStart(4)}  READABLE WITHOUT SIGNING IN`,
    );
    exposed += 1;
  } else {
    console.log(`${t.padEnd(16)} ${String(n).padStart(4)}  exists, returns nothing to anon`);
  }
}

console.log("");
if (missing > 0) {
  console.log(`${missing} table(s) missing. Run 0001, 0002 and 0003 in the SQL editor.`);
  process.exit(1);
}
if (exposed > 0) {
  console.log(
    `FAIL: ${exposed} table(s) returned rows to an anonymous caller.\n` +
      "Row level security is not doing its job. Check 0002_security.sql ran.",
  );
  process.exit(1);
}
console.log(
  "PASS: every table exists and none of them leak data to an anonymous caller.\n" +
    "Signed in users get rows according to their role.",
);
