-- ---------------------------------------------------------------------------
-- Importing one AR report.
--
-- Written as a database function rather than as a sequence of calls from the
-- application, for one reason: it has to be all or nothing. An import that
-- half succeeded would leave a report date with some tenants at this month's
-- balances and the rest at last month's, and no error anywhere to say so. A
-- function runs inside a single transaction, so either the whole report lands
-- or none of it does.
--
-- What it is allowed to touch:
--
--   tenants             added and updated, never deleted
--   account_snapshots   replaced for this report date
--   invoices            replaced for this report date
--
-- What it must never touch:
--
--   calls, promises, emails_sent, late_fees, audit_log
--
-- That second list is the officer's own work. MES upload three times a month,
-- so an import that could delete a phone call would be destroying her work
-- three times a month, silently, because as far as the database is concerned
-- nothing went wrong. The deletes below are therefore scoped to the report
-- date and reach nothing else, and scripts/test-import.mjs asserts it.
-- ---------------------------------------------------------------------------

create or replace function import_ar_report(
  p_report_date date,
  p_period      date,
  p_tenants     jsonb,
  p_snapshots   jsonb,
  p_invoices    jsonb,
  p_ar_filename text default null
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
begin
  insert into uploads (period, report_date, ar_filename, ar_as_of)
  values (p_period, p_report_date, p_ar_filename, p_report_date)
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
    bucket, description, revenue_type, is_onefm, open_balance
  )
  select
    v_upload_id,
    (select s.id from account_snapshots s
      where s.tenant_id = r.tenant_id and s.report_date = p_report_date),
    r.tenant_id, p_period, r.transaction_type,
    r.document_number, r.linked_contract, r.issued_on, r.due_on, r.age_days,
    r.bucket, r.description, r.revenue_type, r.is_onefm, r.open_balance
  from jsonb_populate_recordset(null::invoices, p_invoices) r;

  get diagnostics v_invoices = row_count;

  return jsonb_build_object(
    'upload_id',   v_upload_id,
    'report_date', p_report_date,
    'tenants',     v_tenants,
    'snapshots',   v_snapshots,
    'invoices',    v_invoices
  );
end;
$$;

comment on function import_ar_report is
  'Imports one AR report in a single transaction. Replaces the snapshots and '
  'invoices for that report date, upserts tenants, and touches nothing that '
  'records what an officer did.';

grant execute on function import_ar_report to authenticated;
