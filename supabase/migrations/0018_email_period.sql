-- ---------------------------------------------------------------------------
-- A letter records which month it was for.
--
-- It recorded when it left, which is a different thing, and the difference is
-- the whole of this bug. MES upload late: the October report arrives on the
-- 4th of November and its first reminder goes out on the 7th. So the month a
-- letter is about and the month it was posted are routinely not the same, and
-- neither one can be worked out from the other.
--
-- ---------------------------------------------------------------------------
-- What went wrong without it
--
-- The Reminder Emails screen crossed a tenant off by asking whether they had
-- ever had that wording:
--
--     store.emails.filter(e => e.templateId === templateId)
--
-- No date in it anywhere. So a tenant chased in September was crossed off in
-- October, in November, and for good. Month one worked and the list emptied
-- out after that, while the screen said "everyone who can be emailed has had
-- this one" — which reads as success.
--
-- The scheduled run did not share the fault: it builds a letter id from the
-- date, so a new month is a new id and it sends. Which is worse than both
-- being wrong the same way. On the 7th of December the cron would write to a
-- tenant the screen showed as already done, and an officer reading the screen
-- would not know a letter had gone out.
--
-- ---------------------------------------------------------------------------
-- Backfilled from sent_at, which is the best available answer
--
-- For letters already stored there is nothing else to go on. Every one of them
-- was sent in the month it was about, because they were all sent by hand
-- during testing, so the backfill is right for the rows that exist. It would
-- not be right in general, which is exactly why the column has to be written
-- from now on rather than derived.
-- ---------------------------------------------------------------------------

alter table emails_sent
  add column if not exists period date;

comment on column emails_sent.period is
  'The billing month this letter was about, as the first of it. Not the month '
  'it was sent: MES upload late, so the October report goes out in November. '
  'Null only for letters stored before this column existed.';

update emails_sent
   set period = date_trunc('month', sent_at)::date
 where period is null;

-- The question this column exists to answer is "has this tenant had this
-- wording for this month", asked once per tenant on every reminder run.
create index if not exists emails_sent_period_idx
  on emails_sent (tenant_id, template_id, period);
