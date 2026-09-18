-- ---------------------------------------------------------------------------
-- Which version of the rules read this report.
--
-- Buckets, charge types and dormitories are decided when a report is read and
-- stored as they were decided that day. That is deliberate: a letter went out
-- on the strength of them, and re-deriving them later would mean August's
-- figures quietly changing the first time a rule was fixed.
--
-- The cost is that a fix does not reach what is already stored. Four rules
-- changed in the week this column was added:
--
--   the 1FM prefix, which had matched JPD only
--   the J1- dormitory prefix, fifteen lines filed under the wrong block
--   rounding, which leant one way on invoices and the other on credit notes
--   the report date, where a title disagreed with its own lines by 11 days
--
-- Without this column there is no way to tell, looking at a stored snapshot,
-- whether it was read before or after any of those. With it, the ones worth
-- re-importing can be found and re-imported on purpose, which is the only
-- honest way to correct history: deliberately, and not by accident the next
-- time somebody opens a screen.
--
-- A date rather than a number, because it is read by a person deciding whether
-- a snapshot predates a fix they remember making.
-- ---------------------------------------------------------------------------

alter table uploads add column if not exists rules_version text;

comment on column uploads.rules_version is
  'The version of the classification rules that read this report, as an ISO '
  'date. Buckets and charge types are stored as decided at import, so a fix '
  'does not reach what is already here: this is how to find what predates one.';

-- Everything already stored was read before the column existed, which is worth
-- recording as a fact rather than leaving as a null somebody has to interpret.
update uploads set rules_version = 'before-2026-09-18' where rules_version is null;

-- ---------------------------------------------------------------------------
-- The stamp is written by the import, not after it.
--
-- The first version of this wrote the column from the upload route, straight
-- after the rpc call returned. That is an update to a table from outside the
-- transaction, and it fails the wiring guard for the same reason the guard
-- exists: the route holds the service role key, so every direct write from it
-- bypasses row level security, and a write that lands after the import can
-- fail on its own, leaving a stored report whose rules version says nothing.
--
-- Folding it in makes the stamp as reliable as the rows it describes. Either
-- the report and its version are both there, or neither is.
--
-- The parameter has a default so the column can be null for a caller that does
-- not send one, but the six argument signature is dropped: leaving it would
-- make a six argument call ambiguous between the two, which Postgres refuses
-- at call time rather than here, where it would be easier to understand.
-- ---------------------------------------------------------------------------

drop function if exists import_ar_report(date, date, jsonb, jsonb, jsonb, text);

create or replace function import_ar_report(
  p_report_date   date,
  p_period        date,
  p_tenants       jsonb,
  p_snapshots     jsonb,
  p_invoices      jsonb,
  p_ar_filename   text default null,
  p_rules_version text default null
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

  return jsonb_build_object(
    'upload_id',     v_upload_id,
    'report_date',   p_report_date,
    'tenants',       v_tenants,
    'snapshots',     v_snapshots,
    'invoices',      v_invoices,
    'rules_version', p_rules_version
  );
end;
$$;

comment on function import_ar_report is
  'Imports one AR report in a single transaction. Replaces the snapshots and '
  'invoices for that report date, upserts tenants, records which rules read '
  'the report, and touches nothing that records what an officer did.';

grant execute on function import_ar_report to authenticated;
