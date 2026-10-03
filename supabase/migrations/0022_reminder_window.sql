-- ---------------------------------------------------------------------------
-- 0022  How many days after billing each reminder goes, stored where the
--       nine o'clock run can read it
-- ---------------------------------------------------------------------------
--
-- Reminders went out on the 7th and the 21st, written into the code. They are
-- now counted from each tenant's own billing date: the first reminder so many
-- days after it, the final notice so many days after that.
--
-- The two numbers were first stored in the browser, on the Settings screen.
-- That moved the dates on screen and nothing else: the scheduled run happens on
-- a server with no browser, read no setting, and could only ever use whatever
-- default the code carried - which is a hard-coded number with extra steps.
-- They live here instead, so changing them on the Settings screen changes what
-- the run actually does.
--
-- A key/value table rather than two columns somewhere, because this is the
-- first setting the run needs from the database and is unlikely to be the
-- last, and a table shaped for one setting would need a migration for the
-- second.
-- ---------------------------------------------------------------------------

create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);

comment on table app_settings is
  'Settings the scheduled run reads. One row per setting; value is jsonb.';

alter table app_settings enable row level security;

-- Everyone signed in may read them: the Schedule screen shows every tenant's
-- reminder dates, and those are worked out from these numbers.
drop policy if exists app_settings_read on app_settings;
create policy app_settings_read on app_settings
  for select using (auth.uid() is not null);

-- Changing when every tenant is chased is the same weight of decision as
-- changing the wording they receive, so it takes the same permission.
drop policy if exists app_settings_write on app_settings;
create policy app_settings_write on app_settings
  for all to authenticated
  using (can_edit_settings())
  with check (can_edit_settings());

-- The values dictated on 3 October. Inserted only if absent, so running this
-- again never undoes a change somebody has since made on the Settings screen.
insert into app_settings (key, value)
values ('reminder_window', '{"first": 23, "final": 27}'::jsonb)
on conflict (key) do nothing;
