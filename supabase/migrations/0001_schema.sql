-- =====================================================================
--  MES AR Automation, schema
--  DeVinci Codes
--
--  Design notes worth knowing before reading:
--
--  1. An ACCOUNT is a company at one property, never a company alone.
--     The same tenant can rent at two dormitories and owes a separate
--     balance at each. OKINAWAN PTE LTD appears at both JPD2 and BSD.
--
--  2. Everything is stamped with a BILLING PERIOD. Billing runs from the
--     15th on 30 day terms and the report may be uploaded any time after,
--     so the period is recorded rather than inferred from the upload date.
--     This is what makes month on month comparison possible.
--
--  3. Money is numeric(14,2), never float. Balances must not drift.
--
--  4. Security lives in 0002_security.sql. Every table in this file is
--     unreadable until that migration runs.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- enums

create type user_role as enum ('csd', 'rm', 'management');
create type account_status as enum ('live', 'terminated');
create type giro_status as enum ('enrolled', 'no_mandate', 'unknown');
create type call_outcome as enum (
  'promised_to_pay',
  'will_call_back',
  'disputes_amount',
  'no_answer',
  'wrong_number'
);
create type fee_basis as enum ('flat', 'percent');

-- ------------------------------------------------------------- profiles
-- One row per person who can sign in. `role` decides what they may do and
-- `rm_key` ties a relationship manager to their own tenants.

create table profiles (
  id          uuid primary key references auth.users on delete cascade,
  full_name   text not null,
  role        user_role not null default 'csd',
  rm_key      text,
  created_at  timestamptz not null default now(),

  -- A relationship manager without an rm_key would see nothing at all,
  -- which is a configuration mistake rather than a valid state.
  constraint rm_needs_key check (role <> 'rm' or rm_key is not null)
);

comment on table profiles is
  'Application users. Role drives every policy in 0002_security.sql.';

-- ----------------------------------------------------------- properties

create table properties (
  code        text primary key,          -- JPD1, JPD2, BSD, LEO
  name        text not null,             -- Jurong Penjuru Dormitory 1
  entity      text                       -- the legal entity that owns it
);

-- ------------------------------------------------------------- managers

create table managers (
  key         text primary key,          -- rm1, rm2
  name        text not null
);

-- ------------------------------------------------------------- uploads
-- One row each time CSD uploads a pair of reports. Every account and
-- invoice row points back at the upload it came from, so a bad import can
-- be identified and removed without touching anything else.

create table uploads (
  id            uuid primary key default gen_random_uuid(),
  period        date not null,           -- first day of the billing month
  ar_filename   text,
  dbs_filename  text,
  ar_as_of      date,                    -- the "As of" date inside the file
  summary       jsonb not null default '{}'::jsonb,
  uploaded_by   uuid references profiles(id),
  uploaded_at   timestamptz not null default now()
);

create index uploads_period_idx on uploads (period desc);

-- ------------------------------------------------------------- accounts

create table accounts (
  id              text primary key,      -- dorm-166-jpd2
  upload_id       uuid references uploads(id) on delete cascade,
  period          date not null,
  customer_code   text not null,         -- DORM-166
  company_name    text not null,
  property_code   text not null references properties(code),
  status          account_status not null default 'live',
  giro            giro_status not null default 'unknown',
  rm_key          text references managers(key),
  industry        text,
  entity          text,

  bucket_current  numeric(14,2) not null default 0,
  bucket_30       numeric(14,2) not null default 0,
  bucket_60       numeric(14,2) not null default 0,
  bucket_90       numeric(14,2) not null default 0,
  bucket_90_plus  numeric(14,2) not null default 0,
  total           numeric(14,2) not null default 0,

  is_onefm        boolean not null default false,
  late_fee_count  int not null default 0,
  legacy_note     text,                  -- the old spreadsheet Update column

  created_at      timestamptz not null default now(),

  -- The company + property rule, enforced by the database rather than by
  -- hoping the importer gets it right.
  unique (period, customer_code, property_code)
);

create index accounts_period_idx    on accounts (period desc);
create index accounts_property_idx  on accounts (property_code);
create index accounts_rm_idx        on accounts (rm_key);
create index accounts_company_idx   on accounts (lower(company_name));

-- Balance past the 30 day trigger line. Generated, so no screen can
-- compute it differently from any other screen.
alter table accounts
  add column overdue numeric(14,2)
  generated always as (bucket_30 + bucket_60 + bucket_90 + bucket_90_plus)
  stored;

comment on column accounts.overdue is
  'Everything past the 30 day trigger line. MES SOP section 1.3.';

-- ------------------------------------------------------------- contacts
-- A tenant usually has several finance contacts, so this is one row per
-- address rather than a semicolon separated string.

create table contacts (
  id            uuid primary key default gen_random_uuid(),
  customer_code text not null,
  company_name  text not null,
  email         text not null,
  created_at    timestamptz not null default now(),
  unique (customer_code, email)
);

create index contacts_company_idx on contacts (lower(company_name));

-- ------------------------------------------------------------- invoices

create table invoices (
  id                uuid primary key default gen_random_uuid(),
  upload_id         uuid references uploads(id) on delete cascade,
  account_id        text references accounts(id) on delete cascade,
  period            date not null,
  transaction_type  text,                -- Invoice, Credit Memo, Journal
  document_number   text,
  linked_contract   text,
  issued_on         date,
  due_on            date,
  age_days          int,                 -- negative means not yet due
  bucket            text,
  description       text,
  revenue_type      text not null,
  is_onefm          boolean not null default false,
  open_balance      numeric(14,2) not null default 0
);

create index invoices_account_idx on invoices (account_id);
create index invoices_revenue_idx on invoices (revenue_type);

comment on column invoices.is_onefm is
  'True when the description carries an ONEFM payment notice reference. '
  '1FM is MES''s own maintenance system, so the tag means maintenance '
  'outstanding rather than rent.';

-- ------------------------------------------------- failed GIRO lines
-- Parsed from the DBS Bulk Collection Report. account_id stays null until
-- the line is matched, which is why unmatched rows are visible on screen
-- rather than silently dropped.

create table giro_failures (
  id             uuid primary key default gen_random_uuid(),
  upload_id      uuid references uploads(id) on delete cascade,
  period         date not null,
  batch_ref      text,
  payment_date   date,
  item_no        int,
  payer_name     text,
  dda_reference  text,
  bank_account   text,
  amount         numeric(14,2),
  reason         text not null,          -- NO DDA, REFER PAYING PARTY
  account_id     text references accounts(id) on delete set null,
  matched_by     text                    -- how we matched it, or null
);

create index giro_failures_account_idx on giro_failures (account_id);

-- ------------------------------------------------------------ templates

create table templates (
  id          text primary key,          -- reminder-7th, final-21st
  name        text not null,
  trigger     text not null,             -- 7th of the month
  subject     text not null,
  body        text not null,
  updated_by  uuid references profiles(id),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- calls

create table calls (
  id                  uuid primary key default gen_random_uuid(),
  account_id          text not null references accounts(id) on delete cascade,
  period              date not null,
  called_at           timestamptz not null default now(),
  reached             text,
  outcome             call_outcome not null,
  promised_amount     numeric(14,2),
  promised_date       date,
  next_action_date    date,
  aging_bucket        text,
  deduction_fail_date date,
  notes               text,
  created_by          uuid references profiles(id)
);

create index calls_account_idx on calls (account_id, called_at desc);

-- ------------------------------------------------------------- promises

create table promises (
  id            uuid primary key default gen_random_uuid(),
  account_id    text not null references accounts(id) on delete cascade,
  call_id       uuid references calls(id) on delete set null,
  amount        numeric(14,2) not null,
  promised_for  date not null,
  source        text not null default 'call',
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now(),
  settled_at    timestamptz            -- set when they drop off the next
                                       -- DBS failure report
);

create index promises_due_idx on promises (promised_for) where settled_at is null;

-- ---------------------------------------------------------- emails sent

create table emails_sent (
  id             uuid primary key default gen_random_uuid(),
  account_id     text not null references accounts(id) on delete cascade,
  template_id    text references templates(id),
  template_name  text not null,
  subject        text not null,
  recipients     text[] not null,
  sent_at        timestamptz not null default now(),
  sent_by        uuid references profiles(id)
);

create index emails_account_idx on emails_sent (account_id, sent_at desc);

-- ------------------------------------------------------------ late fees

create table late_fees (
  id          uuid primary key default gen_random_uuid(),
  account_id  text not null references accounts(id) on delete cascade,
  period      date not null,
  basis       fee_basis not null,
  rule_value  numeric(10,2) not null,
  amount      numeric(14,2) not null,
  raised_at   timestamptz not null default now(),
  raised_by   uuid references profiles(id),

  -- The 16th runs once per account per month. Running it twice must not
  -- double charge the tenant.
  unique (account_id, period)
);

comment on table late_fees is
  'MES SOP 2.3, raised on the 16th. The unique constraint is the guard '
  'against a rerun charging a tenant twice.';

-- ------------------------------------------------------------ audit log
-- Append only. See 0002_security.sql: there is deliberately no update or
-- delete policy, so history cannot be rewritten by anyone using the API.

create table audit_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor       uuid references profiles(id),
  actor_name  text not null,
  action      text not null,
  subject     text not null,
  meta        jsonb not null default '{}'::jsonb
);

create index audit_log_at_idx on audit_log (at desc);

comment on table audit_log is
  'MES SOP 2.2 requires every call, email and commitment to leave a '
  'verifiable trace. Append only by policy.';
