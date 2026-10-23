# User manual notes

Explanations taken off the screens so the app reads cleanly. Each one belongs
in the user manual, under the page it describes.

## How the system works

- Every morning at 9am Singapore time, the system sends each tenant the
  reminder they are due. It counts from each tenant's own billing date (the
  Date column of the uploaded AR report). Nobody needs to open a screen for it
  to happen.
- The first reminder goes a set number of days after billing (23 by default)
  and the final notice after another set number (27 by default). Both are
  changed in Settings, Reminder timing, and the 9am run uses the saved numbers.
- Any reminder can be sent early, by hand, from Reminder Emails. The 9am run
  sees it and does not send the same letter again for that bill.
- On the 16th, the 9am run raises the late payment fee (S$100) on anything
  unpaid 14 days past its due date. Tenants on GIRO are left out.
- A tenant who is missing from a newer AR report is treated as having paid in
  full.

## Upload Reports

- The AR report is the NetSuite export (Finance AR Download, from the Detailed
  AR report). The Custom A/R Aging Detail export is read too. Upload it every
  month.
- The client contact list is the workbook with an Email Address column. Upload
  it only when it changes: the last one uploaded is kept. Without addresses,
  tenants can only be phoned.
- The billing month is filled in from the file. It is a label for the month the
  report belongs to; it does not set any billing date, because every charge
  carries its own.

## Outstanding Balances

- Press Aging columns to see each tenant's money split by age in the same
  table; click a column heading to sort by it. Everything to the right of the
  thick line (30 days and older) needs chasing.
- "Show charge types and billing runs" adds the balance by charge type and
  what each billing run is still owed.
- "Over 90 days" is the hardest money to recover.
- Tenants in credit have overpaid and are not chased.
- In "What each billing run is still owed", chaseable means more than fifteen
  days past the due date, which is where MES's own aging stops calling a charge
  Current. The credit clock beside each run counts from the billing date, not
  the due date, so it always reads higher.

## Reminder Emails and Send By Hand

- The tabs are First reminder, Final notice, Sent, and All tenants. All tenants
  lists every tenant with the date each letter is due and what has been sent;
  click a "where they stand" filter to narrow it.
- Tenants with no email address cannot be sent a reminder. A line above the
  list says how many there are and links to Send By Hand. They also stay on the
  Call List. Add an address on Outstanding Balances and they join the next send.
- On Send By Hand, each letter is ready to send: open it, copy it and send it
  from your own email.
- To add many addresses at once: press Download the list, fill in the Email
  Address column, and upload it as a contact list on Upload Reports. Those
  tenants then get their reminders automatically.

## Editing a letter

- To change what one tenant's automatic letter says, press Edit letter beside
  them on Reminder Emails (either the letter tab or All tenants). The 9am run sends the saved wording
  to that tenant for that bill; everyone else gets the standard letter.

## Call List

- A first call is due after the first reminder, and a second call after the
  final notice. Log each call once you hang up; it is saved with the date and
  time.
- The filters: Everyone, Not called yet, Already called, and Promised to pay.
  A tenant who agreed to pay stays on the list, marked with the date they
  promised, and is not counted as still to call.
- When logging a call, choose what happened; nothing is chosen for you. "Agreed
  to pay" asks for the amount and a date that has not passed, and creates a
  payment promise.
- "Calls made" narrows the list by how many times a tenant has been rung:
  never, once, twice, or three times or more.
- Calls logged lists every call, and can be narrowed by which reminder the call
  was about, by outcome, or by a word in the notes.

## Payment Promises

- A promise comes from a phone call or an email reply, and has the date the
  tenant promised to pay by. A promise whose date has passed unpaid needs
  chasing again.
- "Record a promise" is for one made outside a logged call, such as a reply to
  a reminder. Type a name or customer code to find the tenant.
- "Send confirmation" emails the tenant the amount and date they agreed. The
  promise reads "Confirmed to tenant" only once the email has gone.

## Late Payment Fees

- Nothing is charged until you approve it.
- Settled fees: a tenant who is no longer in the latest report has paid, so
  the fee is not pursued. The record of raising it is kept.
- GIRO tenants are recognised by a rejected-GIRO fee on their account, so no
  bank statement is needed.

## The Schedule

- The 9am run (Singapore time) does two jobs:
  - Every morning, reminder emails, counted from each tenant's billing date:
    the first reminder and the final notice go out the number of days after
    it set in Settings, Reminder timing.
  - On the 16th, the S$100 late payment fee on anything unpaid 14 days past
    its due date. Tenants on GIRO are held back.
- The line at the top of the page shows when each job last ran.
- "Needs attention" appears only when something went wrong, and says what:
  - A 16th that did not run or stopped: its late fees were never raised. The
    button raises them, as the 16th would have.
  - A morning whose letters did not all go: the button sends the rest.
  - A morning that stopped: the button runs it again. If it stopped because the
    report was too old, upload the current report instead.
  - No run yet today, after the morning is over: the button runs it now.
  - A morning with no run, where the next morning sent its reminders: nothing
    to do.
  Every button asks first, and says it sends for real. Running a morning twice
  never sends a letter or charges a fee twice.
- The run history is newest first, two weeks to a page. Each morning is also a
  line in the Activity Log, under "9am run".

## Reports & Export

- The NetSuite file holds every email, call and promise in the period, ready
  to upload into NetSuite.
- Relationship manager balances: one sheet per manager, covering only their own
  tenants, with the dormitories stacked down the sheet.
- Outstanding by business type appears only when the uploaded report carries
  each tenant's line of business. The Aging Detail export does not, so it is
  not shown for it.
- Report recipients' addresses are set in Settings, Report recipients. There is
  one row for the AR team, CSD and Management, and one for each relationship
  manager named in the uploaded report.

## Settings

- Report recipients: one row each for the AR team, CSD and Management, and one
  for each relationship manager named in the uploaded report. An address is
  saved when you leave the box, for everyone who uses the system.

- Mailbox: connect a Google or Outlook account. Reminders go out from it, and
  replies come back to it. The test letter says it is a test, not a bill, and
  takes the same route as a real reminder.
- Charge types: each invoice line is classified from its description, and the
  first rule that matches wins. Rules are changed by the system administrator.
- Report recipients: the people offered on the Reports screen. Add an address
  to make someone available.

## Users and access

- Each person's role decides what they can see and do, and the database
  enforces it, not only the screen.
- A relationship manager sees only their own tenants and never tenant email
  addresses (personal data under the PDPA).
- The Activity Log can be added to, never changed or deleted, by anyone.
- Users (admins and super admins) lists everyone who has a login, their role,
  and when they last signed in. "Add a login" creates one with a first password
  you give the person yourself; nothing is emailed. A relationship manager's
  login is tied to the manager name the report uses, and sees only those
  tenants.
- A role can be changed, and a login switched off and back on, from the same
  list. Nobody can change their own role or switch themselves off, and only a
  super admin can create or change a super admin. Logins are switched off, never
  deleted, so the record of who did what stays readable. Every change is in the
  Activity Log.
- Access lists exactly what each role may do, read from the same rules the
  system enforces.
