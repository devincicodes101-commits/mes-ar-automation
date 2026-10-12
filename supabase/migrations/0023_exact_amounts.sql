-- ---------------------------------------------------------------------------
-- 0023  Keep MES's amounts as they exported them
-- ---------------------------------------------------------------------------
--
-- MES's September export carries 283 amounts to three and four decimals -
-- 6.752, 15.1926 - and MES's own totals add those up exactly. This database
-- rounded every one of them to the cent on the way in (numeric(14,2)), so:
--
--   - a total made from the stored lines no longer matched the account's own
--     total: Late Fees read SORAM ENGINEERING as overdue 118,264.15 while
--     every other screen said 118,264.19;
--   - the billing-run table said 832,730.35 was chaseable, against 832,730.58
--     on the tile it claims to agree with;
--   - nothing on screen could match MES's grand total of 2,718,955.01.
--
-- Six decimal places keeps every digit MES export and is still exact decimal,
-- not floating point: the rule in 0001 that money must not drift holds. The
-- screens round once, when a figure is shown, the way MES's Excel does.
--
-- Widening a column's scale keeps every stored value exactly as it is. Rows
-- stored before this keep their cents; the next upload of a report stores its
-- full amounts.
--
-- current_accounts reads four of these columns, and Postgres will not change
-- a column's type underneath a view, so it is dropped and recreated exactly as
-- 0005 and 0006 left it. Nothing in the application reads it.
-- ---------------------------------------------------------------------------

drop view if exists current_accounts;

alter table account_snapshots
  alter column bucket_current type numeric(18,6),
  alter column bucket_30      type numeric(18,6),
  alter column bucket_60      type numeric(18,6),
  alter column bucket_90      type numeric(18,6),
  alter column bucket_90_plus type numeric(18,6),
  alter column total          type numeric(18,6);

alter table invoices
  alter column open_balance type numeric(18,6);

create view current_accounts as
select distinct on (s.tenant_id)
  t.id            as tenant_id,
  t.customer_code,
  t.company_name,
  t.property_code,
  t.rm_key,
  t.industry,
  t.entity,
  s.id            as snapshot_id,
  s.report_date,
  s.period,
  s.status,
  s.bucket_current, s.bucket_30, s.bucket_60, s.bucket_90, s.bucket_90_plus,
  s.total,
  s.is_onefm,
  s.late_fee_count,
  s.legacy_note
from tenants t
join account_snapshots s on s.tenant_id = t.id
order by s.tenant_id, s.report_date desc;

-- As 0006: the view obeys row level security, so a manager still sees only
-- their own tenants through it.
alter view current_accounts set (security_invoker = on);

comment on view current_accounts is
  'The most recent snapshot for every tenant. Runs as the caller '
  '(security_invoker), so a manager sees only their own. Without that setting '
  'a view runs as its owner and silently bypasses row level security.';

grant select on current_accounts to authenticated;
