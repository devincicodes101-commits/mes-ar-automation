# MES AR Automation

GUI prototype for MES Group's dormitory accounts receivable process.

Built by DeVinci Codes. This is the **Week 2 to 3 prototype** from the project
plan, the one that is sign-off gated: application development begins only once
MES approves these screens.

## What the system does

MES Group rents dormitory space to companies in Singapore. Many pay late.
Today the CSD team chases that money by exporting spreadsheets, reading them by
eye, typing reminder emails, phoning tenants, and writing notes such as
`Payment by 29.05.26` into a spreadsheet column.

This platform replaces that. It is **upload driven**: the officer uploads two
files, the system parses, matches, ranks, drafts and records, then produces a
clean export to re-upload into NetSuite. There is no live connection to
NetSuite or to the bank.

The billing calendar it follows:

| Day | Action |
| --- | --- |
| 7th | First reminder email |
| 14th to 15th | Follow up phone calls |
| 15th | Billing starts, first Statement of Account |
| 16th | Late payment admin fee |
| 3rd week | 1FM maintenance routing |
| 21st | Final notice |
| 30th | Second Statement of Account |

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:3000

## Stack

| Layer | Technology |
| --- | --- |
| Front end | Next.js 14 (App Router) + TypeScript |
| Styling | Tailwind, design tokens in `src/app/globals.css` |
| Database (planned) | Supabase (PostgreSQL) with row level security |
| Backend (planned) | FastAPI |
| AI orchestration (planned) | LangChain |

**Nothing beyond the front end is wired up yet.** There is no database, no API
and no credentials in this repository. Every screen reads from a static file.

## Where the data comes from

`src/lib/mock/arData.json` is generated from the two workbooks MES supplied:

- `AR Report.xlsx`, the per property summary with aging buckets
- `AR reports-Final.xlsx`, the invoice level detail plus supporting worksheets

MES anonymised the tenant names before sharing, so the companies in this
repository are placeholders, not real MES customers.

Parsed totals: 53 accounts, 172 invoices, 13 revenue types.

All screens read through `src/lib/data.ts`. When the FastAPI backend lands,
only that module changes.

## Modelling decisions worth preserving

- **An account is company + property, never company alone.** The same company
  can rent at two dormitories and owes a separate balance at each. OKINAWAN
  appears in both JPD2 and BSD.
- **Accounts in credit are excluded from all chasing.** Four accounts carry a
  negative balance. They are marked `In credit` and never enter the queue.
- **1FM is detected from invoice description text.** It is not a column. The
  marker is the literal string `ONEFM` inside the description. 1FM is MES's own
  maintenance application, and the tag means maintenance outstanding.
- **Queue ranking is deterministic.** No model is involved in anything touching
  money. Ranking weights the 90 plus balance heaviest, then 60, then 30, plus
  repeat late fees, and de-weights terminated accounts.

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

## Screen status

| Route | Screen | State |
| --- | --- | --- |
| `/` | AR Aging Board | Built |
| `/collections` | Collections Queue | Built |
| `/upload` | Upload Centre | Built |
| `/reminders` | Reminder Drafting | Planned |
| `/calls` | Calling List and Call Log | Planned |
| `/promises` | Promise to Pay Tracker | Planned |
| `/defaulters` | Recurring Defaulter View | Planned |
| `/reports` | Reports and Export | Planned |
| `/settings` | Settings and Audit Trail | Planned |

Planned routes render a placeholder stating what the screen will do and what it
is waiting on, so no navigation link is dead during the sign-off walkthrough.

## Open items with MES

These block the remaining screens, not the prototype:

1. **How a failed GIRO line links to an AR customer.** The DBS report carries a
   DDA reference and a bank account number. The AR report carries neither. No
   shared key is visible in the samples, and the entire reconciliation rests on
   it.
2. **The master tenant email list.** Only 8 of 53 accounts have an address on
   file, so reminder drafting cannot be completed.
3. **The late payment fee rule.** The sample shows a flat charge repeating each
   month plus a separate rejected GIRO fee.
4. **Reminder templates**, and confirmation of how many escalation levels exist.
5. **Source of the recurring reports**, and whether the RM worksheets are real.
   In the sample they give the same customer code different company names.
