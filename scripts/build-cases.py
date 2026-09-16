# -*- coding: utf-8 -*-
"""
Builds test-cases.csv.

The CSV is the artifact a reader opens; this file is how it stays consistent
when a boundary moves. Every row names the requirement it comes from, so a
failure points at a sentence in MES's own documents rather than at a function.

It is written into public/ because two things read it: the terminal runner,
which fails the build, and the Checks screen, which is how the same evidence
is shown to somebody who is never going to open a terminal.

  python scripts/build-cases.py
"""
import csv
import datetime
import io

rows = []
_n = [0]


def add(area, req, scenario, op, inp, exp):
    _n[0] += 1
    rows.append({
        "ID": "TC-%03d" % _n[0],
        "Area": area,
        "Requirement": req,
        "Scenario": scenario,
        "Op": op,
        "Input": inp,
        "Expected": exp,
    })


D = datetime.date


def plus(d, k):
    return (D.fromisoformat(d) + datetime.timedelta(days=k)).isoformat()


def diff(a, b):
    return (D.fromisoformat(b) - D.fromisoformat(a)).days


# The date MES's August export was actually run: every one of its 3,117 lines
# agrees on it, via due date plus age.
REPORT = "2026-08-28"
CREDIT, FINAL = 14, 30

# ----------------------------------------------------------------- A. AGING
# The control the client asked for. Hold the report date still, move the
# billing date, and check the age, both deadlines and where the run stands.
FLOW = "AR Collections Cycle: billing date is the pivot, 14 and 30 day credit"

BILLINGS = [
    "2026-08-28", "2026-08-27", "2026-08-21", "2026-08-15", "2026-08-14",
    "2026-08-13", "2026-08-01", "2026-07-31", "2026-07-29", "2026-07-15",
    "2026-07-01", "2026-06-15", "2026-05-15", "2026-04-14", "2026-02-15",
    "2026-01-15", "2025-12-15", "2025-08-15", "2024-07-15", "2020-03-15",
]

for b in BILLINGS:
    add("Aging", FLOW, "Billed %s, report %s: how old is that run" % (b, REPORT),
        "cycleAge", "%s|%s" % (b, REPORT), str(diff(b, REPORT)))

for b in BILLINGS[:12]:
    add("Aging", FLOW, "Billed %s: payment falls due 14 days on" % b,
        "dueBy", b, plus(b, CREDIT))

for b in BILLINGS[:12]:
    add("Aging", FLOW, "Billed %s: the second deadline is 30 days on" % b,
        "finalBy", b, plus(b, FINAL))

# Exactly on, and either side of, each deadline.
for k, exp in [
    (-7, "not yet due"), (-1, "not yet due"), (0, "within credit"),
    (1, "within credit"), (13, "within credit"), (14, "within credit"),
    (15, "past 14 days"), (16, "past 14 days"), (29, "past 14 days"),
    (30, "past 14 days"), (31, "past 30 days"), (60, "past 30 days"),
    (400, "past 30 days"),
]:
    b = plus(REPORT, -k)
    add("Aging", FLOW, "Billed %s days before the report (%s)" % (k, b),
        "stage", "%s|%s" % (b, REPORT), exp)

# MES's own formula, off their Formula tab, at every boundary and either side.
FORMULA = ('Formula tab: IF(L2<=15,"Current", <=45 "30 days", <=75 "60 days", '
           '<=105 "90 days", else "More than 90 days")')
for age, exp in [
    (-30, "Current"), (-1, "Current"), (0, "Current"), (1, "Current"),
    (14, "Current"), (15, "Current"), (16, "30 days"), (17, "30 days"),
    (44, "30 days"), (45, "30 days"), (46, "60 days"), (74, "60 days"),
    (75, "60 days"), (76, "90 days"), (104, "90 days"), (105, "90 days"),
    (106, "More than 90 days"), (200, "More than 90 days"),
    (400, "More than 90 days"),
]:
    add("Aging", FORMULA, "A line %s days past its due date" % age,
        "bucket", str(age), exp)

# Calendar traps: month ends, a leap year, a year end.
for b, k in [
    ("2026-01-31", 14), ("2026-02-14", 14), ("2024-02-15", 14),
    ("2024-02-15", 30), ("2026-12-20", 14), ("2026-12-20", 30),
    ("2026-03-31", 30), ("2026-01-15", 30),
]:
    add("Aging", "Calendar arithmetic must not drift over month or year ends",
        "%s plus %s days" % (b, k), "addDays", "%s|%s" % (b, k), plus(b, k))

# --------------------------------------------------- B. SEVERAL BILLING DATES
RAMAN = 'Raman 14 Sep: "in one report you may have several billing dates"'
add("Billing runs", RAMAN, "Two lines billed the same day are one run",
    "cycleCount", "2026-07-15:100|2026-07-15:50", "1")
add("Billing runs", RAMAN, "Two billing dates are two runs",
    "cycleCount", "2026-07-15:100|2026-08-03:25", "2")
add("Billing runs", RAMAN, "Three billing dates are three runs",
    "cycleCount", "2026-07-15:100|2026-08-03:25|2026-06-01:10", "3")
add("Billing runs", RAMAN, "Lines within a run are added up",
    "cycleTotal", "2026-07-15:100|2026-07-15:50", "150.00")
add("Billing runs", RAMAN, "The newest run is listed first",
    "cycleFirst", "2026-07-15:100|2026-08-03:25", "2026-08-03")
add("Billing runs", RAMAN, "A line with no billing date joins no run",
    "cycleCount", "2026-07-15:100|none:40", "1")
add("Billing runs", RAMAN, "That undated line is still counted",
    "cycleUndated", "2026-07-15:100|none:40", "1")
add("Billing runs", RAMAN, "And its value is reported, not lost",
    "cycleUndatedTotal", "2026-07-15:100|none:40", "40.00")
add("Billing runs", RAMAN, "A run inside its credit period owes nothing overdue",
    "cycleOverdue", "2026-08-20:100", "0.00")
add("Billing runs", RAMAN, "A run past 14 days is overdue in full",
    "cycleOverdue", "2026-07-01:100", "100.00")
ADHOC = 'Flow tab: "Adhoc billing can happen on any other dates eg. 21 or 24th"'
add("Billing runs", ADHOC, "A run billed on the 21st is treated like any other",
    "stage", "2026-07-21|%s" % REPORT, "past 30 days")
add("Billing runs", ADHOC, "A run billed on the 24th is treated like any other",
    "stage", "2026-08-24|%s" % REPORT, "within credit")

# ------------------------------------------------------------ C. CHARGE TYPE
TYPES = "Flow tab: group by SD/PF/1FM/LP/SD/RM"
for desc, doc, cat, exp in [
    ("Occupancy Fee Charges for the month of August 2026", "BSD-786/002070",
     "Occupancy Fee", "Occupancy Fee"),
    ("Security Deposit - REFUNDABLE", "BSD-786/002071", "Security Deposit",
     "Security Deposit"),
    ("BEING SECURITY DEPOSIT OF X P/L HAS BEEN OFFSET AGAINST A/R OUTSTANDING",
     "BSDCN/017", "Security Deposit", "Security Deposit"),
    ("Admin Fee For Late Payment", "BSD-786/002072", "Admin Fee",
     "Late Payment Fee"),
    ("Admin Fee for Rejected Giro - 02-JAN-26", "BSD-786/002073", "Admin Fee",
     "Rejected GIRO Fee"),
    ("Stamp Duty", "BSD-786/002074", "Reimbursement", "Stamp Duty"),
    ("Quarterly Charges for Season Parking of vehicle", "BSD-786/002075", "",
     "Season Parking"),
]:
    add("Charge types", TYPES, 'A line reading "%s"' % desc[:50],
        "revenueType", "%s|%s|%s" % (desc, doc, cat), exp)

ONEFM = 'MES note in G2:I2: 1FM = Prefix "DORMFM", example BSDFM/1598'
for doc, exp in [
    ("BSDFM/1598", "true"), ("JPD1FM/2705", "true"), ("JP1FM/2705", "true"),
    ("JPD2FM/11", "true"), ("LEOFM/3", "true"), ("BSD-786/002070", "false"),
    ("JPD1-786/002429", "false"), ("KTM-1444", "false"),
    ("REC-BSD367", "false"), ("BSDCN/017", "false"),
]:
    add("Charge types", ONEFM, "Document number %s" % doc, "isOneFm",
        "%s|" % doc, exp)

# -------------------------------------------------------------- D. DORMITORY
DORM = "Flow tab: Show by Dorm. Placed from the document number prefix"
for doc, exp in [
    ("BSD-786/002070", "BSD"), ("BSD786/44140", "BSD"), ("BSDFM/1598", "BSD"),
    ("BSDCN/017", "BSD"), ("REC-BSD367", "BSD"), ("JPD1-786/002429", "JPD1"),
    ("JP1FM/2705", "JPD1"), ("JPD2-786/1", "JPD2"), ("JPD2FM/9", "JPD2"),
    ("LEO-786/5", "LEO"), ("LEOFM/3", "LEO"), ("KTM-1444", "BSD"),
]:
    add("Dormitory", DORM, "Document %s" % doc, "property", "%s|BSD" % doc, exp)

# ---------------------------------------------------------------- E. LETTERS
LETTERS = "Documents 1 and 2: the first and final reminder templates"
DEADLINE = {"first-reminder": 6, "final-notice": 7}
for lid in ("first-reminder", "final-notice"):
    for sent in ("2026-08-28", "2026-12-28", "2024-02-20", "2026-01-31"):
        add("Letters", LETTERS, "%s sent %s: the pay-by date" % (lid, sent),
            "deadline", "%s|%s" % (lid, sent), plus(sent, DEADLINE[lid]))

add("Letters", LETTERS, "The final notice cites the manpower regulations",
    "letterMentions", "final-notice|Employment of Foreign Manpower", "true")
add("Letters", LETTERS, "The first reminder does not cite them",
    "letterMentions", "first-reminder|Employment of Foreign Manpower", "false")
add("Letters", LETTERS, "The first reminder leaves no merge field unfilled",
    "letterUnfilled", "first-reminder", "0")
add("Letters", LETTERS, "Nor does the final notice",
    "letterUnfilled", "final-notice", "0")
add("Letters", LETTERS, "A letter is dated from the report, not from today",
    "letterDatedFromReport", "2026-08-28", "true")

# ------------------------------------------------------------------ F. MONEY
MONEY = "Amounts print to two decimals and totals must not drift"
for v, exp in [
    ("0", "0.00"), ("0.5", "0.50"), ("0.005", "0.01"), ("1", "1.00"),
    ("1000", "1,000.00"), ("-1234.5", "-1,234.50"),
    ("2782348.27", "2,782,348.27"), ("439528.29", "439,528.29"),
    ("100", "100.00"),
]:
    add("Money", MONEY, "Print %s" % v, "currency", v, exp)
for v, exp in [
    ("0.1", "0.1"), ("1.005", "1.01"), ("2.675", "2.68"), ("-1.005", "-1.01"),
    ("1000.004", "1000"),
]:
    add("Money", MONEY, "Round %s to the cent" % v, "round2", v, exp)
add("Money", MONEY, "A thousand additions of a cent come to ten dollars",
    "round2Sum", "1000", "10")

# ---------------------------------------------- G. RISK EXPOSURE AND DEPOSIT
RISK = 'Raman: "Risk Exposure ... it is Grand total minus Security Deposit"'
for tot, dep, exp in [
    ("6428.16", "34000", "-27571.84"), ("11216.44", "11160", "56.44"),
    ("5000", "1000", "4000"), ("1000", "5000", "-4000"),
    ("1000", "1000", "0"), ("0", "8000", "-8000"),
    ("6428.16", "none", "blank"), ("6428.16", "0", "6428.16"),
]:
    add("Risk exposure", RISK, "Owes %s, deposit %s" % (tot, dep),
        "riskExposure", "%s|%s" % (tot, dep), exp)

DEPOSIT = "Raman 14 Sep: take it from the AR report's Security Deposit lines"
for amounts, exp in [
    ("11360|11360", "22720.00"), ("932", "932.00"), ("-21120", "blank"),
    ("500|-500", "blank"), ("12800|1200", "14000.00"), ("", "blank"),
]:
    add("Security deposit", DEPOSIT, "Deposit lines totalling [%s]" % amounts,
        "depositHeld", amounts, exp)

# ----------------------------------------------------------------- H. EMAILS
EMAIL = 'Raman: "one client may have more than one email" - send to all of them'
for cell, exp in [
    ("a@x.com", "1"),
    ("a@x.com; b@x.com", "2"),
    ("Tan Xin Yuan <xinyuan.tan@checsg.com.sg>; Tang Lizhen <lizhen.tang@checsg.com.sg>", "2"),
    (" finance@brightsun.com.sg; sathiya@brightsun.com.sg; prakash@brightsun.com.sg; prasanna@brightsun.com.sg", "4"),
    ("", "0"),
    ("no email", "0"),
    ("-", "0"),
    ("a@x.com, b@x.com", "2"),
    ("a@x.com; a@x.com", "1"),
]:
    add("Emails", EMAIL, 'An email cell reading "%s"' % cell.strip()[:42],
        "emailCount", cell, exp)
add("Emails", EMAIL, "A display name is dropped and the address kept",
    "emailFirst", "Tan Xin Yuan <xinyuan.tan@checsg.com.sg>",
    "xinyuan.tan@checsg.com.sg")
add("Emails", EMAIL, "A leading space does not break the address",
    "emailFirst", " finance@brightsun.com.sg", "finance@brightsun.com.sg")

# ----------------------------------------------------------------- I. ACCESS
ACCESS = "Each role sees only what it should; a manager sees only their own"
for role, route, exp in [
    ("super-admin", "/", "true"), ("super-admin", "/users", "true"),
    ("super-admin", "/simulation", "true"), ("admin", "/reminders", "true"),
    ("admin", "/users", "false"), ("CSD", "/reminders", "true"),
    ("CSD", "/users", "false"), ("RM", "/", "true"), ("RM", "/users", "false"),
    ("RM", "/reminders", "false"), ("Management", "/reports", "true"),
    ("Management", "/users", "false"), ("Management", "/reminders", "false"),
    ("Management", "/no-email", "false"),
]:
    add("Access", ACCESS, "%s opening %s" % (role, route), "canOpen",
        "%s|%s" % (role, route), exp)
for role, cap, exp in [
    ("super-admin", "send-reminders", "true"),
    ("RM", "send-reminders", "false"),
    ("Management", "view-tenant-emails", "false"),
    ("CSD", "view-tenant-emails", "true"),
    ("Management", "generate-reports", "true"),
    ("admin", "manage-users", "false"),
    ("super-admin", "manage-users", "true"),
    ("RM", "view-all-tenants", "false"),
    ("RM", "view-own-tenants", "true"),
]:
    add("Access", ACCESS, "%s and the %s permission" % (role, cap), "can",
        "%s|%s" % (role, cap), exp)

# ------------------------------------------------------------------ J. NAMES
NAMES = "The customer code is printed once, not twice"
for name, code, exp in [
    ("DORM-1600 MODERN WELLNESS PTE. LTD", "DORM-1600",
     "MODERN WELLNESS PTE. LTD"),
    ("MODERN WELLNESS PTE. LTD", "DORM-1600", "MODERN WELLNESS PTE. LTD"),
    ("dorm-166 BURNING SUN", "DORM-166", "BURNING SUN"),
    ("DORM-17 SOMEBODY", "DORM-1", "DORM-17 SOMEBODY"),
    ("DORM-166", "DORM-166", "DORM-166"),
]:
    add("Names", NAMES, 'Name "%s" with code %s' % (name[:32], code),
        "withoutCode", "%s|%s" % (name, code), exp)

# ------------------------------------------------------------- K. REAL FILES
REAL = "End to end against MES's own files, not made up input"
add("Real file", REAL, "Tenants read from the Aging Detail", "fileAccounts", "aging", "190")
add("Real file", REAL, "Charge lines read from it", "fileLines", "aging", "3117")
add("Real file", REAL, "Separate billing runs found in it", "fileCycles", "aging", "315")
add("Real file", REAL, "MES's own per-tenant subtotals that disagree with ours",
    "fileSubtotalsDisagreeing", "aging", "0")
add("Real file", REAL, "Grand total", "fileTotal", "aging", "2782348.27")
add("Real file", REAL, "GIRO tenants identified", "fileGiro", "aging", "6")
add("Real file", REAL, "Tenants holding a security deposit", "fileDeposits", "aging", "8")
add("Real file", REAL, "Tenants whose deposit was spent against arrears",
    "fileDepositsOffset", "aging", "2")
add("Real file", REAL, "The date the lines themselves agree the report was run",
    "fileDataDate", "aging", "2026-08-28")
add("Real file", REAL,
    "The report date the system settles on, where the title disagrees",
    "fileHeaderDate", "aging", "2026-08-28")
add("Real file", REAL, "The title of that same file says something else",
    "fileTitleDate", "aging", "2026-08-17")
add("Real file", REAL, "A report whose header and data disagree is flagged",
    "fileDateConflictFlagged", "aging", "true")
MEANING = ('Raman 14 Sep: "use the billing date and accordingly create buckets '
           'along that date". MES file: column L is Age, column M is Aging, and '
           'their Formula tab buckets column L')
add("Aging", MEANING,
    "Our bucket against the Aging column MES already have in their file",
    "fileBucketsVsMes", "finance", "0")
add("Aging", MEANING,
    "Lines that would stop matching MES if age were counted from the billing date",
    "fileBucketsFromBillingVsMes", "finance", "18")

add("Real file", REAL, "Tenants read from Finance AR Download", "fileAccounts", "finance", "7")
add("Real file", REAL, "Charge lines read from Finance AR Download", "fileLines", "finance", "173")
add("Real file", REAL, "Billing runs in Finance AR Download", "fileCycles", "finance", "28")
add("Real file", REAL, "Manager reports built from it", "fileManagers", "finance", "3")
add("Real file", REAL, "Its header carries no as-of row, so the date is recovered",
    "fileDataDate", "finance", "2026-08-17")

# -------------------------------------------------------------- L. THE MONTH
MONTH = "Flow tab cycle: the 1st, 4th, 7th, 15th, 16th and 21st"
add("The month", MONTH, "Nobody has been reminded before the month starts",
    "monthReminded", "0", "0")
add("The month", MONTH, "The 7th reminds everyone reachable and owing",
    "monthReminded", "7", "4")
add("The month", MONTH, "Running the 7th again does not remind anyone twice",
    "monthRemindedTwice", "7", "4")
add("The month", MONTH, "The 16th charges the fee to everyone not on GIRO",
    "monthCharged", "16", "75")
add("The month", MONTH, "GIRO tenants are held back from that fee",
    "monthHeld", "16", "6")
add("The month", MONTH, "The 21st sends the final notice", "monthFinalised", "21", "4")
add("The month", MONTH, "A tenant marked paid drops out of the rest of the month",
    "monthPaidDrops", "", "true")
add("The month", MONTH, "A tenant who promised is held off the final notice",
    "monthPromisedDrops", "", "true")
add("The month", MONTH, "The same file run twice produces the same month",
    "monthDeterministic", "", "true")
add("The month", MONTH, "The 7th, 4th and 16th are all upload days",
    "monthUploadDays", "", "true")
add("The month", MONTH, "The 16th can be sent to a chosen subset of managers",
    "monthRmChoice", "2", "2")
add("The month", MONTH, "Choosing no manager is refused rather than silently skipped",
    "monthRmNoneBlocked", "", "true")
SAFE = "Raman asked for simulations rather than production: real client emails"
add("The month", SAFE, "Nothing can be sent for real", "sendingDisabled", "", "true")
add("The month", SAFE, "No mail transport is imported anywhere", "noMailer", "", "true")


# ============================================================================
# M. A REPORT THE CODE HAS NEVER SEEN
# ============================================================================
# MES have sent two files and the system was built against both, so passing on
# them shows only that nothing has regressed. scripts/build-test-data.mts
# writes a third, in the exact shape of their Finance AR Download, with the
# billing dates chosen: rows sit exactly on every bucket boundary and on both
# credit deadlines, and a day either side of each.
#
# The expectations below are read out of test-data/facts.json, which that
# script writes at the same time as the spreadsheet. Move a billing date there
# and the case moves with it, so the two can never disagree.

import json as _json
import os as _os

_FACTS = "test-data/facts.json"
if _os.path.exists(_FACTS):
    F = _json.load(io.open(_FACTS, encoding="utf-8"))
    NEW = ("A generated report the code has never seen, built by "
           "scripts/build-test-data.mts with the billing dates chosen")

    add("New data", NEW, "The report dates itself from its own lines",
        "newAsOf", "", F["report"])
    add("New data", NEW, "Every charge line is read", "newLines", "", str(F["lines"]))
    add("New data", NEW, "Customers become accounts, split by dormitory",
        "newAccounts", "", str(F["accounts"]))
    add("New data", NEW, "Nothing in it is rejected as an error",
        "newErrors", "", "0")
    add("New data", NEW, "Our figures agree with its own subtotals",
        "newSubtotalsDisagreeing", "", "0")
    add("New data", NEW, "Separate billing runs found in one report",
        "newBillingRuns", "", str(F["billingDates"]))
    add("New data", NEW, "All four dormitories are represented",
        "newDormitories", "", "JPD1,JPD2,BSD,LEO")
    add("New data", NEW, "One manager report per sales rep",
        "newManagers", "", str(F["reps"]))

    # --- the aging control, on data built for it ----------------------------
    AGE = ("Formula tab bucket, checked on a generated report where the "
           "billing date was chosen to land the age exactly on a boundary")
    for r in F["rows"]:
        if not r["expectBucket"]:
            continue
        add("New data", AGE,
            "Billed %s, due %s: age %s, so %s"
            % (r["billed"], r["due"], r["age"], r["expectBucket"]),
            "newBucketOn", r["billed"], r["expectBucket"])
        add("New data", AGE,
            "And the file's own age for that line is %s" % r["age"],
            "newAgeOn", r["billed"], str(r["age"]))

    # --- the credit deadlines, by billing date ------------------------------
    CRED = ("AR Collections Cycle: 14 calendar days credit, then 30, counted "
            "from the billing date")
    STAGE_ROWS = [
        (0, "within credit", "Billed on the report date itself"),
        (14, "within credit", "Billed exactly 14 days ago: the last day inside credit"),
        (15, "past 14 days", "Billed 15 days ago: the first day past it"),
        (30, "past 14 days", "Billed exactly 30 days ago: on the second deadline"),
        (31, "past 30 days", "Billed 31 days ago: the first day past the second deadline"),
        (-5, "not yet due", "Billed after the report date"),
    ]
    _by_days = {}
    for r in F["rows"]:
        _by_days.setdefault(r["billedDaysAgo"], r["billed"])
    for days, expected, why in STAGE_ROWS:
        if days in _by_days:
            add("New data", CRED, "%s (%s)" % (why, _by_days[days]),
                "newStageOn", _by_days[days], expected)

    # --- every charge type MES group by -------------------------------------
    TYPES = "Flow tab: group by SD/PF/1FM/LP/SD/RM, on the generated report"
    _seen = set()
    for r in F["rows"]:
        if not r["expectType"] or r["expectType"] in _seen:
            continue
        _seen.add(r["expectType"])
        add("New data", TYPES,
            'A line reading "%s"' % r["description"][:46],
            "newTypeOf", r["description"][:46], r["expectType"])

    # --- the things that only show up in whole-file behaviour ---------------
    add("New data", "Jacqueline's rule: GIRO clients come off the fee listing",
        "Tenants identified as paying by GIRO", "newGiro", "", "2")
    add("New data", "Repeat GIRO failures are flagged as defaulters",
        "Tenants who bounced more than once", "newDefaulters", "", "1")
    add("New data",
        "Raman 14 Sep: the deposit comes from the Security Deposit lines",
        "Tenants holding a deposit", "newDeposits", "", "1")
    add("New data",
        "A deposit offset against arrears is spent, not held",
        "Tenants whose deposit has gone", "newDepositsOffset", "", "1")
    add("New data", 'Raman: "one client may have more than one email"',
        "A tenant with three addresses gets all three",
        "newAddressesFor", "DORM-9005", "3")
    add("New data", 'Raman: "one client may have more than one email"',
        "A display name is stripped and the address kept",
        "newAddressesFor", "DORM-9002", "2")
    add("New data", "Tenants with no address go to Send By Hand",
        "Accounts that can be emailed at all", "newWithAddress", "",
        str(F["accounts"] - 2))
    add("New data",
        "An account is company plus dormitory, so one company can be two",
        "The same company's balance at its first dormitory",
        "newAccountTotal", "DORM-9010|JPD1", "10100.00")
    add("New data",
        "An account is company plus dormitory, so one company can be two",
        "And its separate balance at the second",
        "newAccountTotal", "DORM-9010|BSD", "3300.00")
    add("New data", 'MES note: 1FM = Prefix "DORMFM"',
        "A 1FM invoice and its VAT line both land on the 1FM tab",
        "newTabLines", "1FM", "2")
    add("New data", "Flow tab: a Parking Fee tab",
        "A parking line, which no MES export has ever contained",
        "newTabLines", "PF", "1")
    add("New data", "Flow tab: a Late Payment tab",
        "The $100 fee already raised", "newTabLines", "LP", "1")
    add("New data", "Flow tab: a Stamp Duty tab",
        "Stamp duty, which MES categorise as Reimbursement",
        "newTabLines", "SD-STAMP", "1")
    add("New data", "Flow tab: Show by Dorm, from the document number",
        "A 1FM document number places its line in JPD2",
        "newDormOf", "JPD2FM/5501", "JPD2")
    add("New data", "Flow tab: Show by Dorm, from the document number",
        "A credit note number places its line in JPD1",
        "newDormOf", "JPD1CN/0091", "JPD1")

with io.open("public/test-cases.csv", "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(
        f, fieldnames=["ID", "Area", "Requirement", "Scenario", "Op", "Input",
                       "Expected"])
    w.writeheader()
    for r in rows:
        w.writerow(r)

print("wrote %d cases to public/test-cases.csv" % len(rows))
