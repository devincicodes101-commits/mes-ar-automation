-- ---------------------------------------------------------------------------
-- The contact list is stored too.
--
-- It was not. The upload screen read it, linked it to the tenants and showed
-- the addresses, and then sent the server only the accounts and the invoices.
-- So the addresses lived in one browser until the next load, at which point
-- the screens fetched contacts from this table and the uploaded ones vanished.
--
-- Nothing about that looked wrong. The upload reported success, the addresses
-- appeared, reminders could be composed. It is the shape of fault this project
-- keeps finding: everything works, once, for the person who did it.
--
-- The 21 rows in here at the time of writing are from the 0003 seed. No real
-- contact list had ever reached the database.
--
-- ---------------------------------------------------------------------------
-- Added rather than replaced
--
-- An upload inserts and updates. It does not delete an address that is absent
-- from the file.
--
-- That is a judgement and it could go the other way. MES's own list covers 21
-- of 190 tenants and is four months older than their AR report, so a partial
-- or stale list is the normal case, not the exception. Treating every upload
-- as the complete truth would mean one old file wiping addresses somebody had
-- since found, and an address that is gone is a tenant who silently stops
-- being written to.
--
-- Removing an address is therefore deliberate, not a side effect of uploading
-- an older file.
-- ---------------------------------------------------------------------------

drop function if exists import_ar_report(date, date, jsonb, jsonb, jsonb, text, text);

create or replace function import_ar_report(
  p_report_date   date,
  p_period        date,
  p_tenants       jsonb,
  p_snapshots     jsonb,
  p_invoices      jsonb,
  p_ar_filename   text default null,
  p_rules_version text default null,
  p_contacts      jsonb default null
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
begin
  insert into uploads (period, report_date, ar_filename, ar_as_of, rules_version)
  values (p_period, p_report_date, p_ar_filename, p_report_date, p_rules_version)
  returning id into v_upload_id;

  -- Tenants are upserted. A tenant who has moved out keeps their row, because
  -- calls and fees hang off it and deleting the row would take those with it.
  -- first_seen is left alone once set; last_seen moves forward.
  insert into tenants (
    id, customer_code, company_name, property_code,
    industry, entity, first_seen, last_seen
  )
  select
    r.id, r.customer_code, r.company_name, r.property_code,
    r.industry, r.entity, p_report_date, p_report_date
  from jsonb_populate_recordset(null::tenants, p_tenants) r
  on conflict (id) do update set
    company_name  = excluded.company_name,
    property_code = excluded.property_code,
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
    'rules_version', p_rules_version
  );
end;
$$;

comment on function import_ar_report is
  'Imports one AR report, and the contact list where one was given, in a '
  'single transaction. Replaces the snapshots and invoices for that report '
  'date, upserts tenants and contacts, and touches nothing that records what '
  'an officer did.';

grant execute on function import_ar_report to authenticated;
