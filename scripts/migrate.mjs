/**
 * Runs the SQL migrations against Supabase.
 *
 *   node scripts/migrate.mjs
 *
 * Uses a direct Postgres connection rather than the REST API, because
 * PostgREST cannot execute DDL. Credentials come from .env.local, which is
 * gitignored, so nothing sensitive is passed on the command line where it
 * would land in shell history.
 *
 * Each file runs inside a transaction: if any statement fails the whole file
 * rolls back, so a half applied schema is not possible.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

const env = Object.fromEntries(
  readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const ref = env.SUPABASE_PROJECT_REF;
const pw = env.SUPABASE_DB_PASSWORD;
if (!ref || !pw) {
  console.error("SUPABASE_PROJECT_REF and SUPABASE_DB_PASSWORD must be in .env.local");
  process.exit(1);
}

// Supabase offers several endpoints. Direct is IPv6 only on newer projects,
// which fails from most home networks, so the IPv4 poolers are tried too.
// Session mode (5432) is used rather than transaction mode (6543) because DDL
// and prepared statements misbehave on the transaction pooler.
const CANDIDATES = [
  {
    label: "session pooler, ap-southeast-1",
    config: {
      host: "aws-0-ap-southeast-1.pooler.supabase.com",
      port: 5432,
      user: `postgres.${ref}`,
      password: pw,
      database: "postgres",
      ssl: { rejectUnauthorized: false },
    },
  },
  {
    label: "session pooler, ap-southeast-2",
    config: {
      host: "aws-1-ap-southeast-1.pooler.supabase.com",
      port: 5432,
      user: `postgres.${ref}`,
      password: pw,
      database: "postgres",
      ssl: { rejectUnauthorized: false },
    },
  },
  {
    label: "direct connection",
    config: {
      host: `db.${ref}.supabase.co`,
      port: 5432,
      user: "postgres",
      password: pw,
      database: "postgres",
      ssl: { rejectUnauthorized: false },
    },
  },
];

async function connect() {
  for (const c of CANDIDATES) {
    const client = new pg.Client({ ...c.config, connectionTimeoutMillis: 12000 });
    try {
      await client.connect();
      console.log(`connected via ${c.label}\n`);
      return client;
    } catch (e) {
      console.log(`  ${c.label}: ${e.message}`);
      try {
        await client.end();
      } catch {}
    }
  }
  // Distinguish "wrong password" from "there is nothing there to connect to".
  // A paused Supabase project stops resolving, so every endpoint fails with a
  // DNS error rather than an auth error, and blaming the password sends the
  // next person hunting for a credential that was never wrong.
  throw new Error(
    "Could not connect on any endpoint.\n\n" +
      "If the failures above are DNS errors (ENOTFOUND), the project is not\n" +
      "reachable at all. Free plan projects pause after a week of no traffic\n" +
      "and stop resolving until they are restored from the dashboard.\n\n" +
      "If they are authentication errors, check SUPABASE_DB_PASSWORD.",
  );
}

const client = await connect();

// Track what has run, so re-running the script is safe and only new files
// are applied. Without this a second run fails on "type already exists" and
// tells you nothing useful about what state the database is in.
await client.query(`
  create table if not exists schema_migrations (
    filename    text primary key,
    applied_at  timestamptz not null default now()
  )
`);

const dir = path.join(root, "supabase", "migrations");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

// If the schema is already present but untracked, this is the first run
// after tracking was introduced. Record what is evidently already applied
// rather than trying to run it again.
const { rows: tracked } = await client.query("select filename from schema_migrations");
if (tracked.length === 0) {
  const { rows: exists } = await client.query(`
    select to_regclass('public.accounts') is not null as has_schema,
           to_regclass('public.schema_migrations') is not null as has_tracking
  `);
  if (exists[0].has_schema) {
    const alreadyRun = files.filter((f) => /^000[123]_/.test(f));
    for (const f of alreadyRun) {
      await client.query(
        "insert into schema_migrations (filename) values ($1) on conflict do nothing",
        [f],
      );
    }
    console.log(`adopted ${alreadyRun.length} previously applied migration(s)\n`);
  }
}

const { rows: done } = await client.query("select filename from schema_migrations");
const applied = new Set(done.map((r) => r.filename));

for (const f of files) {
  if (applied.has(f)) {
    console.log(`${f.padEnd(22)} skipped, already applied`);
    continue;
  }
  const sql = readFileSync(path.join(dir, f), "utf8");
  process.stdout.write(`${f.padEnd(22)} `);
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query(
      "insert into schema_migrations (filename) values ($1)",
      [f],
    );
    await client.query("commit");
    console.log("ok");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    console.log("FAILED");
    console.error(`\n  ${e.message}`);
    if (e.position) {
      const upto = sql.slice(0, Number(e.position));
      const line = upto.split("\n").length;
      console.error(`  at line ${line}: ${sql.split("\n")[line - 1]?.trim()}`);
    }
    await client.end();
    process.exit(1);
  }
}

const { rows } = await client.query(`
  select table_name, (xpath('/row/c/text()',
    query_to_xml(format('select count(*) c from %I.%I', table_schema, table_name),
    false, true, '')))[1]::text::int as rows
  from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
  order by table_name
`);

console.log("\ntable            rows");
console.log("---------------- ----");
for (const r of rows) {
  console.log(`${r.table_name.padEnd(16)} ${String(r.rows).padStart(4)}`);
}

await client.end();
console.log("\nmigrations complete");
