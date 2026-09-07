-- ---------------------------------------------------------------------------
-- Keeping MES's own answer alongside ours.
--
-- The aging detail export carries a Categories column: NetSuite's own view of
-- what each charge is. We do not classify from it, because it is coarser than
-- our rules where MES's own reports need detail. Their Admin fee is 48 lines
-- that are 12 admin fees, 27 late payment fees and 9 rejected GIRO fees, and
-- they have asked us for a late payment report their column cannot produce.
--
-- It is stored anyway, exactly as written, for two reasons.
--
-- It fills gaps. On the BSD export our rules found nothing for 10 lines, 7
-- vending machine commissions and 3 bad debt write offs, and their column
-- named all 10.
--
-- And it is a second opinion on every line, every month, from their system
-- rather than our rules. Comparing the two is what surfaced the Admin fee
-- problem: 594 of 3,117 lines disagreed, and reading that list took minutes
-- where reading 3,117 rows takes nobody.
--
-- Null on every export before this one. None of them had the column.
-- ---------------------------------------------------------------------------

alter table invoices add column if not exists category text;

comment on column invoices.category is
  'MES''s own Categories value, verbatim. Not what we classify from: see '
  'src/lib/revenue-rules.ts. Null for exports that predate the column.';

-- Replaced only to carry the new column through. Every other line is
-- identical to 0007, including the deletes, which still reach nothing beyond
-- this report date's snapshots and invoices.

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
