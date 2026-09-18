-- ---------------------------------------------------------------------------
-- Every scheduled run, including the ones that did nothing.
--
-- A cron job that fails is silent. Vercel retries nothing and tells nobody,
-- so the only evidence a run did not happen is a row that is not here. On
-- MES's calendar that is not a missing log line: the 16th is when the $100
-- late fee is raised and the 21st is when the final notice goes out, so a day
-- nobody noticed is money not charged and a tenant not chased.
--
-- So the row is written whatever happens, including on the 2nd when there is
-- nothing to do. A quiet day recorded as quiet is how the next run can tell
-- "nothing was due" from "nothing ran", and those need opposite responses.
--
-- Keyed on the Singapore date rather than the UTC one. Vercel fires in UTC and
-- MES work in Singapore, which disagree for eight hours of every day: at
-- 23:00 UTC it is already tomorrow in Singapore, and a run keyed on the UTC
-- date would file the 16th's late fees under the 15th.
-- ---------------------------------------------------------------------------

create table if not exists cron_runs (
  -- The Singapore date this run is for. Primary key, so a second attempt on
  -- the same day updates the row rather than adding a second history.
  ran_for       date primary key,

  -- Which of MES's days it was, or null on a day they do nothing.
  cycle_day     int,

  -- 'ok', 'nothing-due', 'failed', or 'no-report' when there is nothing stored
  -- to run against. Text rather than an enum: this is a log, and a run that
  -- ends in a state the schema did not anticipate should still be recorded.
  status        text not null,

  -- What the run did, in the shape the day produced: how many tenants it
  -- touched, what it would have sent, what it charged. Read by the screen that
  -- shows the month, so it is kept as sent rather than summarised away.
  summary       jsonb not null default '{}'::jsonb,

  -- Cycle days between the previous run and this one that nothing ran on.
  -- Written here rather than worked out on the fly so that a gap stays visible
  -- after the fact, when the dates either side are no longer in view.
  missed        text[] not null default '{}',

  -- The report the run read, so a surprising result can be traced to the
  -- figures it came from rather than to the figures that are current now.
  report_date   date,

  error         text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

comment on table cron_runs is
  'One row per scheduled run, including days with nothing to do. Keyed on the '
  'Singapore date: Vercel fires in UTC and MES work in UTC+8, so a run keyed '
  'on the UTC date would file the 16th''s late fees under the 15th.';

comment on column cron_runs.missed is
  'Cycle days between the last run and this one that nothing ran on. A cron '
  'that fails is silent, and on this calendar a missed 16th is money not '
  'charged.';

create index if not exists cron_runs_recent on cron_runs (ran_for desc);

-- ---------------------------------------------------------------------------
-- Who may read it.
--
-- Same rule as the rest of the system: the service role writes it, because
-- only the cron route does, and signed-in people may read it. There is
-- deliberately no update or delete policy, so a run that went wrong cannot be
-- tidied away by anybody using the API.
-- ---------------------------------------------------------------------------

alter table cron_runs enable row level security;

drop policy if exists cron_runs_read on cron_runs;
create policy cron_runs_read on cron_runs
  for select to authenticated using (true);
