# DBS ingestion and GIRO status: removed

Removed at MES's request. The system now takes **one input, the AR report**.

**This is reversible.** The state of the code immediately before the removal is
tagged:

```
git diff before-dbs-removal          # everything that changed
git revert <this commit>             # put it all back
```

## Why

MES asked for the second upload to go, along with the modules and tags that
depended on it.

The DBS Bulk Collection Report was never readable in the first place. It
arrived as a JPEG with the payer names blanked out and the DDA reference
column truncated, so no failed payment could ever be tied to a tenant. Every
GIRO status on screen was therefore either a proxy read out of the AR report,
or an honest "not confirmed", which is what 52 of the 53 sample tenants showed.

## What went

| Removed | Was |
|---|---|
| `src/app/failed-payments/` | Proposal 4.1. Never populated |
| Second drop zone on Upload | The DBS file input |
| `giroStatus()`, `GiroStatus`, `GIRO_LABEL` | Status derived from the Rejected GIRO Fee charge |
| GIRO filter, Outstanding Balances | |
| GIRO filter, Action List | |
| GIRO status line under each tenant | Read "not confirmed" on 52 of 53 rows |
| `LAST_BANK_RUN` | Hardcoded from the screenshot's batch header |
| "GIRO setup request" template | Had no possible audience |
| Queue reason `giro-no-dda` | No code path could ever produce it |

## What stayed, deliberately

**The `Rejected GIRO Fee` charge type.** It is an invoice line in the AR
report, not bank data, so it keeps arriving in every monthly upload and still
appears in the charge type breakdown, the charge filter and the reports. GIRO
stops being a *status* and remains a *charge*.

**The `giro_failures` table and `accounts.giro` column.** Dormant, not dropped.
Nothing reads them. Leaving them means restoring DBS later is a screen change
rather than a migration.

## What was renamed

Queue reason `giro-refer-paying-party` became **`repeat-late-fees`**.

It never measured GIRO. It fires on `lateFeeCount >= 3`, meaning late payment
admin fees. The old label, "Payment fails every month", described a bank
failure we had no evidence of. `reasonLabel()` now reads the count from the
account, so the text follows the data instead of asserting a fixed number.

## Contract position

This deletes named, priced deliverables. It needs a written scope change from
MES, not a verbal instruction, covering **every** affected reference. There are
34 mentions of DBS, GIRO or DDA across nine sections:

| Section | |
|---|---|
| **4.1 DBS GIRO Reconciliation** | The section is named for it |
| **Section 2, Objective** | Names GIRO status as a required grouping |
| **Section 3, steps 1 to 2** | The process flow uploads and parses both files |
| **4.4 Collections Queue** | Lists GIRO status as a required field |
| **4.6 Recurring-Defaulter Insights** | "tenants whose GIRO repeatedly fails across months" |
| **4.9 Admin Dashboard** | "DBS and AR file upload"; "chronic GIRO-failure accounts" |
| **7.1 Predictive** | Phase 2 models use "historical GIRO-failure patterns" |
| **7.2 Other Baseline Inputs** | Names the DBS report as the second upload |

7.1 is the one that bites later. Phase 2 names GIRO failure history as a model
input. Not ingesting DBS means that history never accumulates, so the input
does not exist when Phase 2 starts.

## The open question

Whether MES does not want the feature, or whether exporting cleanly from DBS is
simply inconvenient. If the second, a priced deliverable was dropped to save a
few minutes. The report can stay anonymised: all that is needed is the DDA
reference column untruncated, so lines can be matched to tenants.
