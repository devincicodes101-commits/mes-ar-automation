# MES AR Automation — what it does

Written for anyone, not just developers. No technical knowledge needed.

---

## The problem in one paragraph

MES rent dormitory space to companies in Singapore. Lots of them pay late.
Today somebody exports a spreadsheet from the accounting system, reads
through 3,000 lines by eye, works out who's overdue, types reminder emails
one at a time, phones people, and writes notes in a spreadsheet column. Every
month. This system does that automatically.

---

## How it works, in plain words

**You upload one file.** MES's normal AR report, exported from NetSuite.
Nothing is connected to NetSuite or to the bank — a person exports the file,
a person uploads it.

**The system reads it and works out who owes what.** It groups the charges,
calculates how overdue each one is, and works out who needs chasing.

**Then it chases them on MES's own calendar:**

| Day | What happens |
|-----|--------------|
| 1st | Payment deadline passes (14 days from billing) |
| 4th | Report uploaded, month rebuilt |
| **7th** | **First reminder emailed.** Call list appears |
| 15th | Second deadline passes (30 days) |
| **16th** | **$100 late fee charged.** Report to the AR team |
| **21st** | **Final notice emailed.** Call list again |

This happens **by itself**, at 9am Singapore time, with nobody logged in.

---

## The rules it follows

All of these come from MES's own documents.

- **Nobody gets the same letter twice in a month.**
- **The final notice only goes to someone who got the first reminder.** A
  brand-new tenant never gets a legal-threat letter as their first contact.
- **If somebody promised to pay, they're left alone** until the promised date
  passes.
- **Tenants who pay by GIRO are never charged the $100.** A bounced bank
  deduction is the bank's failure, not theirs.
- **Somebody who's paid disappears from the next report**, and that's how the
  system knows. No one has to mark them as paid.
- **A tenant with no email address is never emailed** — they go to the call
  list instead.

---

## Who uses it, and what they can do

| Role | What they see and do |
|------|----------------------|
| **Super admin** | Everything, plus managing users |
| **Admin** | Everything except users |
| **CSD** (Jacqueline) | Upload, send, call, raise fees — the day-to-day |
| **Management** | Sees everything, changes nothing. Cannot see tenant email addresses (personal data) |
| **Relationship manager** (Ray, Harry) | Only their own tenants. Can log calls and record promises, nothing else |

A relationship manager genuinely cannot see another manager's tenants. The
database itself refuses, not just the screen.

---

## Where everything is

MES's workflow document lists what they want. Here is where each one lives.

| MES asked for | Where it is |
|---------------|-------------|
| Latest report drives everything | Shown in the sidebar, under "AR AUTOMATION" |
| Billing on the 15th, plus adhoc dates | Outstanding Balances → *What each billing run is still owed* |
| 14 and 30 day credit periods | Same table → *Credit clock* column |
| GIRO deductions | ⚠️ Partial — see *What's missing* |
| Upload the AR report | Upload Reports |
| Tag the date, calculate aging | Automatic on upload — the `Age` and `Aging` columns |
| **Show by Dorm, then SD / PF / 1FM / LP / SD / RM** | Reports & Export → *Email a report* dropdown. Ten reports: four dormitories first, then the charge types, then one per manager — the same order as MES's own spreadsheet tabs |
| First reminder, bulk email | Reminder Emails — automatic on the 7th |
| Email list, editable and saved | Settings → templates |
| Call customer | Call List |
| Calling E-Form | Call List → *Log this call* |
| Repeated calls allowed | Call List — tenants stay on the list, marked "called N times" |
| Call status count | Call List → the four tiles at the top |
| Late payment report, over 14 days | Late Payment Fees |
| Send to AR team, pick one or more managers | Late Payment Fees → manager buttons + *Download the listing* |
| Final reminder, bulk email | Reminder Emails — automatic on the 21st |
| Upload a report any time | Upload Reports — any date, any day |
| Email any report from a dropdown | Reports & Export → *Email a report* |

**Documents MES promised, and sent:**

- First and final reminder templates — used word for word
- RM and AR team email templates — both in use
- Revenue categories list — drives the charge type sorting
- Client contact list — uploads alongside the AR report

---

## How the relationship managers work

Each tenant belongs to a relationship manager. The system takes that from the
**Primary Sales Rep** column in MES's own report, so nobody maintains a list —
whoever the report says owns a company is who owns it.

**The manager makes the calls.** The system writes the letters; a person picks
up the phone. That's the split, and it's the same on the 7th and the 21st.

**What a manager sees when they sign in:**

- Only their own tenants. Not filtered on screen — the database itself refuses
  to hand over another manager's companies.
- Their call list, in priority order. Oldest money counts triple, and every
  late fee pushes a tenant further up.
- Their payment promises.

**What they can do:** log a call and record a promise. Nothing else. They
cannot send letters, upload reports, raise fees, see another manager's book,
or see a tenant's email address.

**What happens when they log a call.** One action, three results:

1. The call is recorded — who was reached, what was agreed, how many attempts.
2. If they agreed to pay, a promise is created. That tenant is then **left
   alone until the promised date passes** — no final notice on the 21st to
   somebody who has already made an arrangement.
3. The **Update column fills itself** in that manager's report. So the file
   Jacqueline opens already says "Promised $12,000 by 20 Oct" — nobody types
   it twice and nothing waits in an inbox.

**Their report.** One per manager, split into a block per dormitory, in the
layout of the mock-up MES sent: company, status, the aging columns, grand
total, overdue total, Update, security deposit, risk exposure, sales rep.

- Viewed on screen — Reports & Export → Relationship manager balances
- Downloaded as a real Excel file
- Emailed to the manager with that file attached, and a covering note in
  Jacqueline's own wording

**On the 16th**, the late payment listing can be narrowed to one or more
managers, so the AR team can be asked to issue fees for one book at a time
rather than all of them at once.

---

## What's missing, and why

### 1. GIRO deduction status — blocked on MES

To know which bank deductions went through on the 1st, the system needed
MES's DBS Bulk Collection Report.

It arrived as a **photograph** — a JPEG — with the payer names blanked out and
the reference column cut off. No payment could be matched to any tenant. Of
53 sample tenants, 52 showed "not confirmed", because there was nothing to
confirm them against. MES asked for it to be removed.

**What still works:** GIRO tenants are still excluded from the $100, worked
out from "Rejected GIRO" charge lines in the AR report itself.

**To finish it:** MES send the report as a real spreadsheet. The removal is
documented and can be reversed in one step.

### 2. Internal email addresses — waiting on MES

Reports can be emailed to the AR team, CSD, Management and each manager. None
of them has an email address on file, because MES have not given one yet.

Nothing was invented, because a screen saying a report went to an address
nobody confirmed is worse than a screen saying it couldn't go.

**To finish it:** MES give one address per recipient. Then it works.

### 3. Three things before real tenants get emails

- **Google sign-in is in test mode.** The connection expires after 7 days, and
  the 9am run would then fail quietly. Needs MES's own Google Workspace.
- **Demo passwords still exist** on a public address and should be replaced.
- **Sending is currently limited** to three test addresses. Opening it to real
  tenants should be a deliberate decision, not a settings change somebody
  makes by accident.

---

## Questions for MES

1. **"SD" appears twice in their own list** — Security Deposit and Stamp Duty
   share the abbreviation. Two reports, or a duplicate?
2. **Is the credit period 14 days, 15, or to the 1st of the following month?**
   Their documents say all three, and their system issues due dates at 15.
3. **What email address** should each internal recipient use?
4. **Are there only ever four dormitories?**

---

## Things worth knowing

**The report is a photograph.** The "60 days overdue" figures inside it are
frozen when MES press export — they don't age. That's why MES upload three
times a month. If a report gets more than 25 days old, the system stops
sending and charging, and says an upload was missed. A late fee can be caught
up; a wrong charge to somebody who already paid cannot be taken back.

**The calendar decides when, the upload decides who.** Uploading doesn't start
a clock. The 7th is the 7th whatever day the file arrived.

**Nothing is a list somebody maintains.** Who gets an email is worked out
fresh every time from three things: what they owe, whether there's an address,
and what's already been done to them this month.

**The managers make the calls, and everyone sees the result.** The letters are
automatic and the phone calls are not. When a manager logs what was said, it
appears on their own report, on the tenant's history, and in the note that
stops the next letter going out.

**Every automatic run is written down** — which tenants were written to, which
were left alone, and why. So "why did that tenant get a letter" has an answer
six weeks later.
