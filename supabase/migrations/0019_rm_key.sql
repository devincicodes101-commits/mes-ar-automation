-- ---------------------------------------------------------------------------
-- 0019  The import remembers who owns each tenant
-- ---------------------------------------------------------------------------
--
-- tenants.rm_key has existed since 0005 and nothing has ever written to it.
--
-- The AR export carries a Primary Sales Rep column — "2611 Ray Ang" — and the
-- parser has always read it. It reached the browser, grouped the manager
-- reports on screen, and was then dropped on the way here, because the insert
-- below simply did not list the column. Every tenant ever imported has
-- rm_key null.
--
-- Three things did nothing as a result, and none of them looked broken:
--
--   1. "Group results by Dorm, then by SD / PF / 1FM / LP / SD / RM" is step 3
--      of the standard upload routine MES run on EVERY upload. The RM grouping
--      came back empty every time.
--
--   2. The manager workbooks — "Ray's Clients by dorm" — had nobody to split
--      by, so the 16th's dropdown of relationship managers was always empty.
--
--   3. An RM signing in saw an empty system. can_see_account() requires
--      target_rm_key = app_rm_key() for role 'rm', and null is not equal to
--      anything. Ray Ang's profile is set up correctly with rm_key
--      '2611 Ray Ang'; there was simply no tenant carrying that key.
--
-- And the pipeline reported the consequence as "this export has no Primary
-- Sales Rep column", which pointed at MES's file for a fault that was ours.
--
-- ---------------------------------------------------------------------------
-- Managers come from the report, and must come first
--
-- tenants.rm_key references managers(key), so a tenant cannot point at a
-- manager the database has never heard of. p_managers is therefore inserted
-- before p_tenants in the same transaction.
--
-- They are taken from the export rather than maintained by hand. The names MES
-- use are the names in their own file, and a list typed in somewhere else
-- would drift from it the first time somebody joins or leaves.
--
-- ---------------------------------------------------------------------------
-- A file that does not mention a manager must not un-assign anybody
--
-- coalesce(excluded.rm_key, tenants.rm_key), the same shape as industry and
-- entity above it. A report exported without the Primary Sales Rep column — or
-- one covering a single dormitory — would otherwise wipe every assignment it
-- did not happen to mention, and the first sign would be an RM opening an
-- empty screen. The table comment in 0005 says the assignment "should not
-- change when a file is re-uploaded", and this is what makes that true.
--
-- Changing an assignment deliberately is still a normal update: a later report
-- naming a different rep moves the tenant.
-- ---------------------------------------------------------------------------

-- Postgres identifies a function by its argument list, so adding p_managers
-- would create a SECOND function beside the eight-argument one rather than
-- replacing it. Two overloads that differ only by a defaulted trailing
-- argument are ambiguous for an eight-argument call, and PostgREST resolves
-- by name — so the old one has to go, exactly as 0017 dropped the seven
-- argument version before it.
drop function if exists import_ar_report(
  date, date, jsonb, jsonb, jsonb, text, text, jsonb
);

create or replace function import_ar_report(
  p_report_date   date,
  p_period        date,
  p_tenants       jsonb,
  p_snapshots     jsonb,
  p_invoices      jsonb,
  p_ar_filename   text default null,
  p_rules_version text default null,
  p_contacts      jsonb default null,
  -- Sent before the tenants that point at them: tenants.rm_key is a foreign
  -- key to managers(key), so a tenant cannot name a manager the database has
  -- never heard of. Defaulted so an older client is not broken by the change.
  p_managers      jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker          -- runs as the caller, so row level security applies
as $$
declare
  v_upload_id uuid;
  v_tenants   int;
  v_snapshots int;
  v_invoices  int;
  v_contacts  int := 0;
  v_managers  int := 0;
begin
  insert into uploads (period, report_date, ar_filename, ar_as_of, rules_version)
  values (p_period, p_report_date, p_ar_filename, p_report_date, p_rules_version)
  returning id into v_upload_id;

  -- The managers this report names, before the tenants that point at them.
  -- Taken from the export rather than maintained by hand: the names MES use
  -- are the names in their own file, and a list typed in somewhere else would
  -- drift from it the first time somebody joins.
  insert into managers (key, name)
  select trim(m.key), trim(m.name)
  from jsonb_populate_recordset(null::managers, p_managers) m
  where coalesce(trim(m.key), '') <> ''
  on conflict (key) do update set name = excluded.name;

  get diagnostics v_managers = row_count;

  -- Tenants are upserted. A tenant who has moved out keeps their row, because
  -- calls and fees hang off it and deleting the row would take those with it.
  -- first_seen is left alone once set; last_seen moves forward.
  insert into tenants (
    id, customer_code, company_name, property_code,
    rm_key, industry, entity, first_seen, last_seen
  )
  select
    r.id, r.customer_code, r.company_name, r.property_code,
    r.rm_key, r.industry, r.entity, p_report_date, p_report_date
  from jsonb_populate_recordset(null::tenants, p_tenants) r
  on conflict (id) do update set
    company_name  = excluded.company_name,
    property_code = excluded.property_code,
    -- Kept when this file does not name one. A report exported without the
    -- Primary Sales Rep column, or covering a single dormitory, would
    -- otherwise un-assign every tenant it did not mention, and the first sign
    -- would be a manager opening an empty screen.
    rm_key        = coalesce(excluded.rm_key, tenants.rm_key),
    industry      = coalesce(excluded.industry, tenants.industry),
    entity        = coalesce(excluded.entity, tenants.entity),
    last_seen     = greatest(tenants.last_seen, excluded.last_seen);

  get diagnostics v_tenants = row_count;

  -- Re-uploading the same report date replaces that snapshot rather than
  -- adding a second one. A different date adds to the history and leaves
  -- every earlier date alone.
  delete from account_snapshots where report_date = p_report_date;

  insert into account_snapshots (
    tenant_id, upload_id, report_date, period, status,
    bucket_current, bucket_30, bucket_60, bucket_90, bucket_90_plus,
    total, is_onefm, late_fee_count, legacy_note
  )
  select
    s.tenant_id, v_upload_id, p_report_date, p_period, s.status,
    s.bucket_current, s.bucket_30, s.bucket_60, s.bucket_90, s.bucket_90_plus,
    s.total, s.is_onefm, s.late_fee_count, s.legacy_note
  from jsonb_populate_recordset(null::account_snapshots, p_snapshots) s;

  get diagnostics v_snapshots = row_count;

  -- Invoice detail belongs to the snapshot it arrived with, so the same rule
  -- applies: this report date's lines are replaced, no other date is touched.
  delete from invoices i
   using account_snapshots s
   where i.snapshot_id = s.id and s.report_date = p_report_date;

  insert into invoices (
    upload_id, snapshot_id, tenant_id, period, transaction_type,
    document_number, linked_contract, issued_on, due_on, age_days,
    bucket, description, revenue_type, is_onefm, open_balance,
    category
  )
  select
    v_upload_id,
    (select s.id from account_snapshots s
      where s.tenant_id = r.tenant_id and s.report_date = p_report_date),
    r.tenant_id, p_period, r.transaction_type,
    r.document_number, r.linked_contract, r.issued_on, r.due_on, r.age_days,
    r.bucket, r.description, r.revenue_type, r.is_onefm, r.open_balance,
    r.category
  from jsonb_populate_recordset(null::invoices, p_invoices) r;

  get diagnostics v_invoices = row_count;

  -- The contact list, where one was given. Null means the officer uploaded
  -- only the AR report, which is the normal case: the list changes rarely and
  -- the screen says so.
  if p_contacts is not null then
    insert into contacts (customer_code, company_name, email)
    select c.customer_code, c.company_name, lower(c.email)
    from jsonb_populate_recordset(null::contacts, p_contacts) c
    where c.email is not null and c.email <> ''
    on conflict (customer_code, email) do update set
      company_name = excluded.company_name;

    get diagnostics v_contacts = row_count;
  end if;

  return jsonb_build_object(
    'upload_id',     v_upload_id,
    'report_date',   p_report_date,
    'tenants',       v_tenants,
    'snapshots',     v_snapshots,
    'invoices',      v_invoices,
    'contacts',      v_contacts,
    'managers',      v_managers,
    'rules_version', p_rules_version
  );
end;
$$;

comment on function import_ar_report is
  'Imports one AR report, and the contact list where one was given, in a '
  'single transaction. Replaces the snapshots and invoices for that report '
  'date, upserts managers, tenants and contacts, and touches nothing that '
  'records what an officer did. Managers are inserted before tenants because '
  'tenants.rm_key points at them, and rm_key is kept when a file does not '
  'name one so a partial export cannot silently un-assign a book.';

grant execute on function import_ar_report to authenticated;

-- The demo seed left two placeholder managers behind. They are not MES
-- employees and, once the import starts writing real ones, they would sit in
-- the dropdown next to them. Written so it cannot take a real one: only these
-- two keys, and only while no tenant references them.
delete from managers
 where key in ('rm1', 'rm2')
   and not exists (select 1 from tenants t where t.rm_key = managers.key);
