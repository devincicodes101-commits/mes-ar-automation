-- ---------------------------------------------------------------------------
-- 0020  A line-by-line record of what the schedule did
-- ---------------------------------------------------------------------------
--
-- cron_runs holds one row per day with a summary: how many letters, how many
-- fees, which tenants were held back. That answers "what happened" and not
-- "why", and the two questions are asked at different times. The summary is
-- read the morning after; this is read six weeks later when somebody asks why
-- a particular tenant got a particular letter, and the summary has long since
-- stopped being enough.
--
-- So: every step, in order, with the figures it worked from.
--
--   the report it read, its date, how many tenants and lines came back
--   what it already knew — who had been reminded, charged, who had promised
--   what the day decided, per tenant, and the reason
--   every fee written and every letter attempted, with the outcome
--
-- ---------------------------------------------------------------------------
-- Append only, like the audit log
--
-- A log somebody can tidy is not a log. Same trigger as audit_log: even a
-- direct owner connection is refused an update or a delete. The only way a
-- line leaves is the whole day being deleted, which cascades from cron_runs
-- and is how a bad run is removed wholesale rather than edited.
--
-- ---------------------------------------------------------------------------
-- What it costs
--
-- MES's 21st touches 81 owing tenants, so a busy day writes a few hundred
-- rows and a quiet one writes two. A year is on the order of twenty thousand,
-- which is nothing. The run inserts them in one batch at the end rather than
-- line by line: a hundred round trips inside a serverless function with a
-- sixty second budget is a real risk, and the log must never be the reason a
-- letter did not go out.
-- ---------------------------------------------------------------------------

create table if not exists run_log (
  id          bigserial primary key,

  -- The Singapore date the run is for, not the date it happened. A day caught
  -- up late belongs to the day it was for, or the history reads out of order.
  ran_for     date not null references cron_runs(ran_for) on delete cascade,

  -- Position within the run. The clock is not enough: a batch written in one
  -- statement shares a timestamp to the millisecond, and the order steps ran
  -- in is the whole point of reading this.
  seq         int not null,

  at          timestamptz not null default now(),

  -- Which part of the run. Coarse on purpose, so a query can ask for one
  -- stage without knowing the wording: 'start', 'report', 'memory', 'plan',
  -- 'fee', 'letter', 'finish'.
  step        text not null,

  -- 'info', 'warn', 'error'. Text rather than an enum for the same reason
  -- cron_runs.status is: this is a log, and a state the schema did not expect
  -- should still be recordable.
  level       text not null default 'info',

  -- One sentence, readable without the detail beside it.
  message     text not null,

  -- The figures behind that sentence: what was counted, what was decided,
  -- what the mail gate said. Shaped by the step rather than by a fixed schema,
  -- because a fee and a letter do not have the same facts.
  detail      jsonb not null default '{}'::jsonb,

  -- Set where the line is about one tenant, so a tenant's whole history
  -- across months can be pulled in one query. Nullable, and deliberately not
  -- a foreign key: a tenant removed from a later report must not take the
  -- record of what was done to them with it.
  tenant_id   text,

  unique (ran_for, seq)
);

comment on table run_log is
  'Every step of a scheduled run, in order, with the figures it worked from. '
  'Append only. cron_runs says what happened; this says why.';

create index if not exists run_log_day_idx    on run_log (ran_for, seq);
create index if not exists run_log_tenant_idx on run_log (tenant_id, at desc)
  where tenant_id is not null;
create index if not exists run_log_step_idx   on run_log (step, at desc);

alter table run_log enable row level security;

-- Read by anybody who may read the audit log: the administrators, CSD and
-- management. A relationship manager is not among them — the log covers every
-- tenant and narrowing it per line would be a lie by omission, since a run
-- that touched forty tenants did so as one act.
create policy run_log_read on run_log
  for select using (can_read_all());

create policy run_log_append on run_log
  for insert with check (auth.uid() is not null);

-- Belt and braces alongside the missing update and delete policies: even a
-- direct table owner connection is refused.
create or replace function run_log_is_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'run_log is append only';
end;
$$;

drop trigger if exists run_log_no_update on run_log;
create trigger run_log_no_update
  before update or delete on run_log
  for each row execute function run_log_is_append_only();

grant select, insert on run_log to authenticated;
grant usage, select on sequence run_log_id_seq to authenticated;
