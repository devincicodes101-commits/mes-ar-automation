# Deployment and configuration

One of the five items the proposal hands over at UAT. It covers getting the
project running from nothing, what each setting is for, and the operational
things that have already caught us out once.

Written for somebody who has never seen this repository.

---

## What it is

| | |
|---|---|
| **Front end** | Next.js 14.2.35, App Router, TypeScript, Tailwind |
| **Database** | Supabase (PostgreSQL 17), Singapore region |
| **Spreadsheets** | SheetJS 0.20.3, read in the browser |
| **Hosting** | Vercel |

Two things it deliberately does **not** do: it does not connect to NetSuite,
and it does not connect to the bank. A person exports a file from NetSuite and
uploads it here, and a person carries the finished file back. MES asked for it
that way and it removes a whole class of integration problems.

### SheetJS is not installed from npm

`package.json` points at the vendor CDN rather than the npm registry:

```
"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
```

The version on npm is 0.18.5, is years out of date and carries known
prototype-pollution and ReDoS advisories. SheetJS publish current releases
only from their own CDN. **Do not "fix" this back to the registry.**

---

## Prerequisites

**Node 22 or newer.** Developed on 24.16.0. This is not optional: the test
suite runs TypeScript directly through Node's `--experimental-strip-types`,
which older versions do not have. No `engines` field is declared, so nothing
will warn you.

Nothing else. No global installs.

---

## Getting it running

```bash
git clone https://github.com/devincicodes101-commits/mes-ar-automation.git
cd mes-ar-automation
npm install
```

Create `.env.local` in the project root. It is gitignored and never committed.

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<the publishable key>
SUPABASE_SERVICE_ROLE_KEY=<the secret key>
SUPABASE_DB_PASSWORD=<the database password>
SUPABASE_PROJECT_REF=<project-ref>
```

| Setting | What it is for | Safe in a browser? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Which project to talk to | yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The public key. Row level security decides what it may read | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | **Bypasses every security policy.** Scripts only | **no, never** |
| `SUPABASE_DB_PASSWORD` | Direct Postgres connection, for migrations | no |
| `SUPABASE_PROJECT_REF` | The project id, used to build connection strings | no |

The two prefixed `NEXT_PUBLIC_` are compiled into the browser bundle by
design. **The other three must never be.** If a service role key ever reaches
a browser, every access rule in the system is void.

Then:

```bash
node scripts/migrate.mjs     # creates the schema
npm run dev                  # http://localhost:3000
```

---

## The database

Seven migrations, applied in order. `migrate.mjs` tracks what has run in a
`schema_migrations` table and skips anything already applied, so re-running it
is safe.

| | |
|---|---|
| `0001_schema.sql` | Tables, enums, indexes |
| `0002_security.sql` | Row level security, helper functions, the append-only audit log |
| `0003_seed.sql` | Sample data from MES's own workbooks |
| `0004_grants.sql` | Table privileges. `anon` is deliberately granted nothing |
| `0005_snapshots.sql` | Splits tenants from snapshots so uploads cannot destroy call records |
| `0006_view_security.sql` | Makes `current_accounts` obey row level security |
| `0007_import.sql` | `import_ar_report`, the all-or-nothing import |

### Two gates, not one

Postgres needs **both** a table privilege (`GRANT`) and a passing policy
before a row is returned. Getting the policy right while forgetting the grant
produces `42501` on everything, which reads like a security bug and is not.
That is why `0004_grants.sql` exists as its own file.

### The rule that matters most

An upload may replace balances and invoice lines. It may **never** touch
calls, promises, emails sent, fees or the audit log. Those are the officer's
own work and nothing can recreate them.

`scripts/test-import.mjs` proves it, including by reading the import
function's own source back out of the database and asserting it contains no
delete against any protected table.

---

## Tests

```bash
npm run test:revenue      # no database needed. Runs before every build
npm run test:snapshots    # needs the database
npm run test:rls          # needs the database
npm run test:import       # needs the database
```

| Suite | Guards against |
|---|---|
| **revenue** | A change to charge classification quietly moving money between categories. Occupancy Fee alone is 92% of the value |
| **snapshots** | Multiple uploads in one month failing, or an upload losing a phone call |
| **rls** | A manager reading another manager's tenants, or the audit log being rewritten |
| **import** | The import reaching a table it must not touch |

Only `test:revenue` runs during `npm run build`, because the other three need
network access. The three database suites run inside a transaction that is
rolled back, so they leave nothing behind.

---

## Deploying

Vercel, connected to the GitHub repository. Every push to `master` deploys.

**Set the same environment variables in the Vercel dashboard.** They are not
read from `.env.local`, which is local only.

### Vercel only builds commits authored by the account owner

On the Hobby plan, a commit authored by any other email is shown as
**Blocked** with no useful explanation. Commits must be authored as
`devincicodes101@gmail.com`. This cost us a day once.

### Deployment protection

The preview URL shows real tenant names and balances. **Deployment protection
must stay on**, under Settings → Deployment Protection.

---

## Operational notes

### A free Supabase project pauses after about a week

It stops resolving entirely. DNS fails, so every tool reports a connection
error rather than anything useful.

**Symptom:**

```
getaddrinfo ENOTFOUND <project-ref>.supabase.co
```

**Fix:** open the Supabase dashboard and restore the project. It takes about a
minute.

This has happened once and it wasted time because two scripts reported it
badly: `check-db.mjs` treated the failure as "blocked by row level security"
and printed **PASS**, and `migrate.mjs` blamed the database password. Both now
detect it and say so.

### Direct Postgres connections

`db.<ref>.supabase.co` no longer resolves on newer projects. Use the session
pooler:

```
host  aws-0-ap-southeast-1.pooler.supabase.com
port  5432
user  postgres.<project-ref>
```

Session mode, port 5432, not transaction mode on 6543: DDL and prepared
statements misbehave on the transaction pooler.

### Rotating the service role key

Supabase dashboard → Settings → API → roll the `service_role` key, then update
`.env.local` and Vercel. Do it whenever the key may have been seen by anyone,
including in a chat window or a screenshot.

---

## Things that will look wrong and are not

**Dates read from spreadsheets never go through `toISOString()`.** A date in a
spreadsheet is a calendar date, not an instant. Converting local midnight to
UTC lands on the previous day anywhere east of Greenwich, and Singapore is
UTC+8, so every due date shifted by one and invoices moved between ageing
buckets. The calendar fields are read directly. See `excelDate` in
`src/lib/parser.ts`.

**Charge classification rules are in code, not in a settings screen.** The
order is load-bearing and Occupancy Fee is most of the money. A drag handle in
the UI would be a way to reclassify thousands of dollars with no error and no
audit trail. Settings shows the rules read-only.

**The parser reads columns by name, not position.** MES have changed the
export layout twice and renamed a tab three times. Reading by offset turned
the open balance into an ageing label with no error at all.

**`tsconfig.json` sets `allowImportingTsExtensions`.** The test suites import
source files directly with a `.ts` extension so they can run under Node
without a build step.

---

## Where things stand

Built, tested and applied: the database, its security, the import, the file
readers, the classification rules, every screen.

**Not built:** a login screen, and actual email sending. The screens therefore
still keep their state in the browser rather than in the database, because
Supabase correctly returns nothing to a caller who has not signed in.

Login is the next thing, and everything else waits behind it.
