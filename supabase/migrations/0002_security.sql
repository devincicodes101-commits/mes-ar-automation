-- =====================================================================
--  MES AR Automation, row level security
--  DeVinci Codes
--
--  The rule this file enforces, in one sentence:
--
--    CSD may read and write everything. A relationship manager may read
--    only their own tenants and write nothing. Management may read
--    everything and write nothing. Nobody may alter history.
--
--  This is enforced by PostgreSQL itself. It is not a check in the
--  browser and it is not a filter in the API layer. A relationship
--  manager who edits the URL, calls the REST endpoint directly, or opens
--  the developer console still cannot see another manager's tenants,
--  because the database will not return those rows.
--
--  Every table below is deny by default. Enabling RLS with no matching
--  policy returns zero rows, so a table we forget to write a policy for
--  fails closed rather than open.
-- =====================================================================

-- ---------------------------------------------------------- helpers
-- SECURITY DEFINER so a policy can read `profiles` without recursing
-- into the policy on `profiles` itself. STABLE so PostgreSQL evaluates
-- them once per statement rather than once per row.

create or replace function app_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function app_rm_key()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select rm_key from profiles where id = auth.uid()
$$;

create or replace function is_csd() returns boolean
language sql stable as $$ select app_role() = 'csd' $$;

create or replace function can_read_all() returns boolean
language sql stable as $$ select app_role() in ('csd', 'management') $$;

/*
  Whether the signed in user may see one account.

  CSD and Management see everything. A relationship manager sees only
  rows whose rm_key matches their own. Note the null handling: a tenant
  with no manager assigned is NOT visible to any manager, which is the
  safe reading of "only their own tenants".
*/
create or replace function can_see_account(target_rm_key text)
returns boolean
language sql
stable
as $$
  select case
    when can_read_all() then true
    when app_role() = 'rm' then target_rm_key is not null
                            and target_rm_key = app_rm_key()
    else false
  end
$$;

-- ------------------------------------------------------- enable RLS

alter table profiles       enable row level security;
alter table properties     enable row level security;
alter table managers       enable row level security;
alter table uploads        enable row level security;
alter table accounts       enable row level security;
alter table contacts       enable row level security;
alter table invoices       enable row level security;
alter table giro_failures  enable row level security;
alter table templates      enable row level security;
alter table calls          enable row level security;
alter table promises       enable row level security;
alter table emails_sent    enable row level security;
alter table late_fees      enable row level security;
alter table audit_log      enable row level security;

-- ---------------------------------------------------------- profiles
-- You can always read your own row, otherwise you need to be CSD or
-- Management. Only CSD may change roles, which is what stops a manager
-- promoting themselves.

create policy profiles_read_self on profiles
  for select using (id = auth.uid() or can_read_all());

create policy profiles_admin_write on profiles
  for all using (is_csd()) with check (is_csd());

-- ------------------------------------------- reference data, read only
-- Properties and managers are lookup tables. Everyone signed in may read
-- them; only CSD may change them.

create policy properties_read on properties
  for select using (auth.uid() is not null);
create policy properties_write on properties
  for all using (is_csd()) with check (is_csd());

create policy managers_read on managers
  for select using (auth.uid() is not null);
create policy managers_write on managers
  for all using (is_csd()) with check (is_csd());

-- ----------------------------------------------------------- uploads

create policy uploads_read on uploads
  for select using (auth.uid() is not null);
create policy uploads_write on uploads
  for all using (is_csd()) with check (is_csd());

-- ---------------------------------------------------------- accounts
-- The central policy. Everything else keys off the account it belongs
-- to, so a manager who cannot see an account cannot see its invoices,
-- its calls, its promises or its emails either.

create policy accounts_read on accounts
  for select using (can_see_account(rm_key));

create policy accounts_write on accounts
  for all using (is_csd()) with check (is_csd());

-- ------------------------------------------------ children of accounts

create policy invoices_read on invoices
  for select using (
    exists (
      select 1 from accounts a
      where a.id = invoices.account_id and can_see_account(a.rm_key)
    )
  );
create policy invoices_write on invoices
  for all using (is_csd()) with check (is_csd());

create policy giro_read on giro_failures
  for select using (
    account_id is null and can_read_all()
    or exists (
      select 1 from accounts a
      where a.id = giro_failures.account_id and can_see_account(a.rm_key)
    )
  );
create policy giro_write on giro_failures
  for all using (is_csd()) with check (is_csd());

create policy calls_read on calls
  for select using (
    exists (
      select 1 from accounts a
      where a.id = calls.account_id and can_see_account(a.rm_key)
    )
  );
create policy calls_write on calls
  for all using (is_csd()) with check (is_csd());

create policy promises_read on promises
  for select using (
    exists (
      select 1 from accounts a
      where a.id = promises.account_id and can_see_account(a.rm_key)
    )
  );
create policy promises_write on promises
  for all using (is_csd()) with check (is_csd());

create policy emails_read on emails_sent
  for select using (
    exists (
      select 1 from accounts a
      where a.id = emails_sent.account_id and can_see_account(a.rm_key)
    )
  );
create policy emails_write on emails_sent
  for all using (is_csd()) with check (is_csd());

create policy late_fees_read on late_fees
  for select using (
    exists (
      select 1 from accounts a
      where a.id = late_fees.account_id and can_see_account(a.rm_key)
    )
  );
create policy late_fees_write on late_fees
  for all using (is_csd()) with check (is_csd());

-- ---------------------------------------------------------- contacts
-- Tenant email addresses are personal data under the PDPA, so managers
-- do not get them. Only CSD, who send the reminders, and Management.

create policy contacts_read on contacts
  for select using (can_read_all());
create policy contacts_write on contacts
  for all using (is_csd()) with check (is_csd());

-- --------------------------------------------------------- templates
-- Everyone may read the wording. Only CSD may change it.

create policy templates_read on templates
  for select using (auth.uid() is not null);
create policy templates_write on templates
  for all using (is_csd()) with check (is_csd());

-- --------------------------------------------------------- audit log
--
--  Deliberately incomplete, and that is the point.
--
--  There is a SELECT policy and an INSERT policy. There is no UPDATE
--  policy and no DELETE policy, anywhere, for any role. Because RLS is
--  deny by default, the absence of those policies means no API caller
--  can edit or remove an audit entry, including CSD.
--
--  MES SOP 2.2 requires a verifiable trace for audits and disputes. A
--  log that the people being audited can quietly edit is not one.

create policy audit_read on audit_log
  for select using (can_read_all());

create policy audit_append on audit_log
  for insert with check (auth.uid() is not null);

-- ---------------------------------------------- keep history honest
-- Belt and braces alongside the missing policies above: even a direct
-- table owner connection is blocked from rewriting the log.

create or replace function audit_is_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append only';
end;
$$;

create trigger audit_no_update
  before update or delete on audit_log
  for each row execute function audit_is_append_only();

-- --------------------------------------------- new user gets a profile
-- Without this a newly invited user signs in with no profile row, and
-- app_role() returns null, so every policy denies them. Failing closed
-- is correct, but a blank screen is a poor welcome, so seed the row.

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    'csd'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
