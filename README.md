# MES AR Automation

MES Group's dormitory accounts receivable process, for DeVinci Codes.

Began as the sign-off gated prototype from the project plan. MES approved the
screens, so this is no longer only a prototype: the database, its security and
the import are built and applied. What is not built is named plainly under
[Where things stand](#where-things-stand), and `docs/deployment.md` covers
running, configuring and deploying it.

## What the system does

MES Group rents dormitory space to companies in Singapore. Many pay late.
Today the CSD team chases that money by exporting spreadsheets, reading them by
eye, typing reminder emails, phoning tenants, and writing notes such as
`Payment by 29.05.26` into a spreadsheet column.

This platform replaces that. It is **upload driven**: the officer uploads the
AR report she already downloads, and the system parses, matches, ranks, drafts
and records, then produces a clean export to re-upload into NetSuite. There is
no live connection to NetSuite or to the bank, by MES's own choice.

It used to take two files. The DBS bulk collection report was removed at MES's
request in the second month; `docs/dbs-removal.md` records what depended on it
and how to put it back. The rejected GIRO fee survived that removal because it
is an AR invoice line rather than bank data.

The billing calendar it follows:

| Day | Action |
| --- | --- |
| 7th | First reminder email, and the first calling list |
| 15th | The $100 late payment fee falls due, being 14 days past the due date |
| 16th | Relationship manager reports |
| 21st | Final notice, and the second calling list |

Reminders send unattended on the 7th and the 21st. MES asked for that, and it
overrides the reviewed-batch flow in the original proposal. It can be switched
back in Settings.

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:3000. Requires **Node 22 or newer**: the tests run
TypeScript directly through `--experimental-strip-types` and no `engines` field
is declared, so an older version fails without warning.

Configuration, environment variables, migrations and deployment are all in
[`docs/deployment.md`](docs/deployment.md).

## Stack

| Layer | Technology | State |
| --- | --- | --- |
| Front end | Next.js 14 (App Router) + TypeScript | built |
| Styling | Tailwind, design tokens in `src/app/globals.css` | built |
| Spreadsheets | SheetJS 0.20.3, from the vendor CDN, not npm | built |
| Database | Supabase (PostgreSQL 17), Singapore, row level security | **built and applied** |
| Hosting | Vercel | built |
| Backend | FastAPI in the original plan | **not started, and worth revisiting** |
| AI orchestration | LangChain in the original plan | not started |

Eight migrations are applied to a live project, row level security is enforced
by the database rather than the application, and `npm run test:rls` proves it
with 28 checks against a real connection.

**On the backend.** Nothing has been built towards FastAPI and there is no
Python in this repository. Before starting it, note that `src/lib/parser.ts` is
993 lines of TypeScript with the test suite that goes with it, and it holds
everything learned about MES's four file shapes. FastAPI would mean rewriting
all of it in Python to arrive where we already are. Next.js runs server side
natively and Supabase and Vercel are already wired for it. Either way the
reason a backend is needed at all is the 7th and the 21st: reminders cannot
send themselves from a browser nobody has open.

## Where the data comes from

MES have sent four different workbook shapes. `src/lib/parser.ts` reads all of
them, and identifies each by its header row rather than its tab name, because
they have renamed the same export four times and the name has never once been
what identified it.

| Shape | What it carries |
| --- | --- |
| `AR Report.xlsx` | Per dormitory summary with aging buckets |
| `AR reports-Final.xlsx` | Invoice detail plus supporting worksheets |
| `R1 - <date>.xlsx` | The client contact list |
| `CustomA_RAgingDetail-WithDescription.xlsx` | Invoice detail with amounts and MES's own Categories column |

`src/lib/mock/arData.json` is generated from the first two: 53 accounts, 172
invoices, 13 revenue types, and only 8 of the 53 with an email address.

**The names in that file are not real.** MES anonymised them, and the codes
survived the anonymisation, so `DORM-1224` is `SUNNY MAY` there and `SUN MOON
MARINE` in the real export. **Join on the customer code, never on the company
name.** Matching by name across those two files fails on every row, silently.

All screens read through `src/lib/data.ts`. When storage lands, only that
module changes.

## Modelling decisions worth preserving

- **An account is company + property, never company alone.** The same company
  can rent at two dormitories and owes a separate balance at each. Where the
  invoice detail cannot say which, those lines are reported and left out rather
  than charged to whichever came first.
- **Accounts in credit are excluded from all chasing.** They are marked
  `In credit` and never enter the queue.
- **1FM is decided by the invoice number, not the wording.** The prefix is the
  dormitory's own code followed by `FM`: `JPD1FM`, `BSDFM`, `LEOFM`. Reading
  descriptions alone found 17 of 45 lines on one file and 99 of 543 on another.
  The description test is kept as well, because 1FM credit notes are numbered
  `BSDCN` and the number alone would miss them.
- **MES's Categories column fills gaps and never overrules.** It looks like it
  should be the primary source and it must not be: their categories are coarser
  than our rules exactly where their own reports need the detail. Their
  `Admin fee` is 48 lines that are 12 admin fees, 27 late payment fees and 9
  rejected GIRO fees, and they have asked for a late payment report their own
  column cannot produce.
- **Charge classification lives in code, not in a settings screen.** The order
  is load-bearing and Occupancy Fee alone is half the value. A drag handle in
  the UI would be a way to reclassify a million dollars with no error and no
  audit trail. Settings shows the rules read-only.
- **Queue ranking is deterministic.** No model is involved in anything touching
  money. Ranking weights the 90 plus balance heaviest, then 60, then 30, plus
  repeat late fees, and de-weights terminated accounts.
- **An upload may replace balances and invoice lines. It may never touch calls,
  promises, emails sent, fees or the audit log.** MES upload several times a
  month, so an import that could delete a phone call would destroy the
  officer's own work several times a month with nothing to say so.
  `scripts/test-import.mjs` proves it by reading the import function's source
  back out of the database.

## Design system

Aging severity is carried by an **ordinal ramp of a single hue** (MES navy),
stepped light to dark. It is not a rainbow, and severity is never encoded by
separate colours. Both ramps were validated rather than eyeballed:

```
light  #86b6ef,#5598e7,#2a78d6,#1c5cab,#104281   ALL CHECKS PASS
dark   #184f95,#256abf,#3987e5,#6da7ec,#9ec5f4   ALL CHECKS PASS
```

Status colours (good, warning, serious, critical) are reserved and never reused
as series colours. Every status badge ships an icon **and** a text label, so
meaning never rests on colour alone.

Light and dark are both supported. Dark values are declared under both the
`prefers-color-scheme` media query and the `[data-theme]` attribute, so the
in-app toggle wins in both directions.

## Screens

Every route is built. None is a placeholder.

| Route | Screen |
| --- | --- |
| `/` | AR Aging Board |
| `/collections` | Collections Queue |
| `/upload` | Upload Centre |
| `/reminders` | Reminder Drafting |
| `/calls` | Calling List and Call Log |
| `/promises` | Promise to Pay Tracker |
| `/defaulters` | Recurring Defaulter View |
| `/late-fees` | Late Fee Run |
| `/reports` | Reports and Export |
| `/activity` | Activity Feed |
| `/settings` | Settings and Audit Trail |
| `/users` | People and Roles |
| `/access` | What each role may see and do |

## Tests

```bash
npm run test:revenue      # no database. Runs before every build
npm run test:snapshots    # needs the database
npm run test:rls          # needs the database
npm run test:import       # needs the database
```

| Suite | Guards against |
| --- | --- |
| revenue | A change to classification quietly moving money between categories |
| snapshots | Several uploads in one month failing, or an upload losing a phone call |
| rls | A manager reading another manager's tenants, or the audit log being rewritten |
| import | The import reaching a table it must not touch |

Only `test:revenue` runs during `npm run build`, because the other three need
network access. Those three run inside a transaction that is rolled back.

## Where things stand

**Built and applied:** the database and its security, the import, the file
readers for all four shapes, the classification rules, and every screen.

**Not built:** a sign-in screen, and email actually leaving. The screens
therefore still hold their state in the browser rather than in the database,
because the security correctly returns nothing to a caller who has not signed
in. Sign-in is next and everything else waits behind it.

**Before sign-in exists**, note that the `handle_new_user` trigger in
`0002_security.sql` gives every new account the `csd` role, which can send
letters, raise fees and read every tenant. Harmless while nobody can sign up.
Not harmless the day that changes.

## Open with MES

Answered and closed since the first version of this file: the late payment fee
rule, the reminder templates, whether the RM worksheets are real (they are
samples), and the failed GIRO reconciliation, which went away with DBS.

Still open, in the order they block work:

1. **Email addresses.** At BSD, 87 companies have money overdue and we hold
   addresses for 9 of them. That is 80% of the overdue value, and it is the one
   that stops the system doing its job.
2. **The same export for JPD1, JPD2 and LEO.** We have one dormitory of four.
3. **Which date the aging detail export was run on.** Its title says 17 August
   and every one of its 3,117 rows is calculated as of the 28th. The fee turns
   on a 14 day window, so the eleven day gap moves five companies in and out.
4. **Whether 1FM means the whole invoice or only the 1FM work on it.** A 1FM
   invoice also carries VAT and a brought-forward opening balance, which at BSD
   is $14,400 of the $36,686 currently reported as 1FM.
5. **Where the security deposit figures live.** The file shows deposits for 13
   companies out of 190, and every tenant pays one. Five of the ten largest
   debtors are behind on a deposit rather than on rent, and the reminder letter
   is written as a rent chase.
6. **How Risk Exposure is calculated.** Two of MES's own example figures are
   negative, which fits `owed minus deposit held` and would follow from 5.
7. **Whether the reminder letters need different bank details per dormitory.**
   Both sample letters are JPD1 and quote MES & JPD Housing's account. BSD is
   KT Mesdorm and LEO is Kaki Bukit Developments, which are different companies.
8. **The real RM and industry lists.** The ones we have are samples covering 35
   companies against 190.
