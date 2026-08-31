-- ---------------------------------------------------------------------------
-- One record per report date, not one per month.
--
-- MES uploads the AR report on the 4th, the 7th and the 16th, and on any other
-- day they feel like it. All three of those are August. The accounts table
-- allowed one row per company per month, so the first upload of a month
-- succeeded and every one after it was rejected by the database.
--
-- Fixing the key alone would not have been enough, and would have been worse
-- than the bug. Calls, promises, emails and fees all pointed at accounts.id
-- with `on delete cascade`. If a row were replaced on every upload, then every
-- upload would silently delete the officer's own work: the phone call she
-- logged on the 7th would be gone on the 16th, with no error, because as far
-- as the database was concerned nothing had gone wrong.
--
-- So the two things being conflated are pulled apart:
--
--   tenants            a company at a dormitory. Exists once, forever.
--   account_snapshots  what that tenant owed as at one report date.
--
-- Balances can always be rebuilt by uploading the file again. Calls and
-- promises cannot be rebuilt by anything. The first now hang off snapshots,
-- which are replaced freely, and the second hang off tenants, which are not.
-- ---------------------------------------------------------------------------

-- ------------------------------------------------------------- uploads

-- The date printed inside the report, which is what ageing is measured from.
-- MES are explicit that a report uploaded late still ages as at its own date,
-- so this is the significant field and uploaded_at is only bookkeeping.
alter table uploads add column if not exists report_date date;

update uploads set report_date = coalesce(ar_as_of, period) where report_date is null;

alter table uploads alter column report_date set not null;

create index if not exists uploads_report_date_idx on uploads (report_date desc);

comment on column uploads.period is
  'The billing month this upload belongs to. Grouping only: ageing is '
  'measured from report_date.';
comment on column uploads.report_date is
  'The "As of" date inside the file. Everything is counted from here, never '
  'from the day somebody happened to upload it.';

-- ------------------------------------------------------------- tenants

create table tenants (
  id             text primary key,        -- dorm-166-jpd2
  customer_code  text not null,           -- DORM-166
  company_name   text not null,
  property_code  text not null references properties(code),

  -- Who looks after them. Lives here rather than on the snapshot because
  -- every row level security policy in the system keys off it, and it should
  -- not change when a file is re-uploaded.
  rm_key         text references managers(key),
  industry       text,
  entity         text,

  -- Dormant since the DBS upload was removed at MES's request. Kept rather
  -- than dropped so restoring it is a screen change: see docs/dbs-removal.md.
  giro           giro_status not null default 'unknown',

  first_seen     date not null,
  last_seen      date not null,
  created_at     timestamptz not null default now(),

  -- A company renting at two dormitories is two tenants, because it owes at
  -- each one separately. OKINAWAN PTE. LTD. is the live example: JPD2 and BSD,
  -- two balances. Merging them would make every figure for that company wrong
  -- and nobody would notice.
  unique (customer_code, property_code)
);

create index tenants_rm_idx       on tenants (rm_key);
create index tenants_property_idx on tenants (property_code);

comment on table tenants is
  'A company at a dormitory. One row for the life of the relationship, so '
  'calls, promises, emails and fees have something stable to attach to.';

-- --------------------------------------------------- account snapshots

create table account_snapshots (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       text not null references tenants(id) on delete cascade,
  upload_id       uuid references uploads(id) on delete cascade,

  -- The date on the report this came from. Two uploads in the same month are
  -- two snapshots, which is the whole point of this migration.
  report_date     date not null,
  period          date not null,          -- billing month, for grouping

  status          account_status not null default 'live',

  bucket_current  numeric(14,2) not null default 0,
  bucket_30       numeric(14,2) not null default 0,
  bucket_60       numeric(14,2) not null default 0,
  bucket_90       numeric(14,2) not null default 0,
  bucket_90_plus  numeric(14,2) not null default 0,
  total           numeric(14,2) not null default 0,

  is_onefm        boolean not null default false,
  late_fee_count  int not null default 0,
  legacy_note     text,                   -- the spreadsheet's Update column

  created_at      timestamptz not null default now(),

  -- Re-uploading the same report replaces that snapshot rather than adding a
  -- second one. Uploading a different date adds to the history.
  unique (tenant_id, report_date)
);

create index snapshots_tenant_idx on account_snapshots (tenant_id, report_date desc);
create index snapshots_date_idx   on account_snapshots (report_date desc);
create index snapshots_upload_idx on account_snapshots (upload_id);

comment on table account_snapshots is
  'What one tenant owed as at one report date. Disposable: delete the lot, '
  'upload the files again, and the same numbers come back.';

-- ------------------------------------------------ move the existing rows

insert into tenants (
  id, customer_code, company_name, property_code,
  rm_key, industry, entity, giro, first_seen, last_seen
)
select
  a.id, a.customer_code, a.company_name, a.property_code,
  a.rm_key, a.industry, a.entity, a.giro, a.period, a.period
from accounts a;

insert into account_snapshots (
  tenant_id, upload_id, report_date, period, status,
  bucket_current, bucket_30, bucket_60, bucket_90, bucket_90_plus, total,
  is_onefm, late_fee_count, legacy_note, created_at
)
select
  a.id,
  a.upload_id,
  coalesce((select u.report_date from uploads u where u.id = a.upload_id), a.period),
  a.period,
  a.status,
  a.bucket_current, a.bucket_30, a.bucket_60, a.bucket_90, a.bucket_90_plus,
  a.total,
  a.is_onefm, a.late_fee_count, a.legacy_note, a.created_at
from accounts a;

-- ------------------------------------- repoint the work that must survive
-- These four are the officer's own work. They attach to the tenant, so an
-- upload cannot touch them.

alter table calls        add column tenant_id text references tenants(id) on delete cascade;
alter table promises     add column tenant_id text references tenants(id) on delete cascade;
alter table emails_sent  add column tenant_id text references tenants(id) on delete cascade;
alter table late_fees    add column tenant_id text references tenants(id) on delete cascade;

update calls       set tenant_id = account_id;
update promises    set tenant_id = account_id;
update emails_sent set tenant_id = account_id;
update late_fees   set tenant_id = account_id;

alter table calls        alter column tenant_id set not null;
alter table promises     alter column tenant_id set not null;
alter table emails_sent  alter column tenant_id set not null;
alter table late_fees    alter column tenant_id set not null;

alter table calls        drop column account_id;
alter table promises     drop column account_id;
alter table emails_sent  drop column account_id;
alter table late_fees    drop column account_id;

create index calls_tenant_idx    on calls        (tenant_id, called_at desc);
create index promises_tenant_idx on promises     (tenant_id);
create index emails_tenant_idx   on emails_sent  (tenant_id, sent_at desc);

-- One fee per tenant per billing month, however many times the report is
-- uploaded that month. This constraint is the guard against charging twice.
alter table late_fees add constraint late_fees_once_per_month unique (tenant_id, period);

-- --------------------------------------- repoint the disposable records
-- Invoice detail belongs to the snapshot it arrived with, so re-uploading a
-- report replaces its lines rather than doubling them. tenant_id is carried
-- as well, because "every invoice this tenant has ever had" is a real
-- question and because it keeps the security check to a single hop.

alter table invoices add column snapshot_id uuid references account_snapshots(id) on delete cascade;
alter table invoices add column tenant_id   text references tenants(id) on delete cascade;

update invoices i
   set tenant_id   = i.account_id,
       snapshot_id = (
         select s.id from account_snapshots s
         where s.tenant_id = i.account_id
         order by s.report_date desc
         limit 1
       );

alter table invoices drop column account_id;
create index invoices_snapshot_idx on invoices (snapshot_id);
create index invoices_tenant_idx   on invoices (tenant_id);

-- Dormant, like the rest of the DBS work. Repointed so it does not reference
-- a table that is about to disappear.
alter table giro_failures add column tenant_id text references tenants(id) on delete set null;
update giro_failures set tenant_id = account_id;
alter table giro_failures drop column account_id;
create index giro_failures_tenant_idx on giro_failures (tenant_id);

-- ------------------------------------------------------ drop the old table

drop table accounts;

-- ------------------------------------------------------------- security
-- Same model as before: everything keys off whether the reader may see the
-- tenant. Only the table the check lands on has changed.

alter table tenants           enable row level security;
alter table account_snapshots enable row level security;

create policy tenants_read on tenants
  for select using (can_see_account(rm_key));
create policy tenants_write on tenants
  for all using (is_csd()) with check (is_csd());

create policy snapshots_read on account_snapshots
  for select using (
    exists (
      select 1 from tenants t
      where t.id = account_snapshots.tenant_id and can_see_account(t.rm_key)
    )
  );
create policy snapshots_write on account_snapshots
  for all using (is_csd()) with check (is_csd());

create policy invoices_read on invoices
  for select using (
    exists (
      select 1 from tenants t
      where t.id = invoices.tenant_id and can_see_account(t.rm_key)
    )
  );
create policy invoices_write on invoices
  for all using (is_csd()) with check (is_csd());

create policy giro_read on giro_failures
  for select using (
    tenant_id is null and can_read_all()
    or exists (
      select 1 from tenants t
      where t.id = giro_failures.tenant_id and can_see_account(t.rm_key)
    )
  );
create policy giro_write on giro_failures
  for all using (is_csd()) with check (is_csd());

create policy calls_read on calls
  for select using (
    exists (
      select 1 from tenants t
      where t.id = calls.tenant_id and can_see_account(t.rm_key)
    )
  );
create policy calls_write on calls
  for all using (is_csd()) with check (is_csd());

create policy promises_read on promises
  for select using (
    exists (
      select 1 from tenants t
      where t.id = promises.tenant_id and can_see_account(t.rm_key)
    )
  );
create policy promises_write on promises
  for all using (is_csd()) with check (is_csd());

create policy emails_read on emails_sent
  for select using (
    exists (
      select 1 from tenants t
      where t.id = emails_sent.tenant_id and can_see_account(t.rm_key)
    )
  );
create policy emails_write on emails_sent
  for all using (is_csd()) with check (is_csd());

create policy late_fees_read on late_fees
  for select using (
    exists (
      select 1 from tenants t
      where t.id = late_fees.tenant_id and can_see_account(t.rm_key)
    )
  );
create policy late_fees_write on late_fees
  for all using (is_csd()) with check (is_csd());

-- --------------------------------------------------------------- grants
-- Privileges are issued deliberately, because new tables are not exposed
-- automatically. anon is granted nothing, here as everywhere.

grant select                         on tenants           to authenticated;
grant insert, update, delete         on tenants           to authenticated;
grant select                         on account_snapshots to authenticated;
grant insert, update, delete         on account_snapshots to authenticated;

-- ------------------------------------------------------- the latest view
-- Almost every screen wants "where does this tenant stand now", which is the
-- most recent snapshot rather than all of them. Written once here so no
-- caller has to remember to sort and take the first row.

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

comment on view current_accounts is
  'The most recent snapshot for every tenant. Security is inherited from the '
  'underlying tables, so a manager still sees only their own.';

grant select on current_accounts to authenticated;
