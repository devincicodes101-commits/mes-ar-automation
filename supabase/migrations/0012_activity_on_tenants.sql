-- ---------------------------------------------------------------------------
-- What an officer did hangs off tenants, not accounts.
--
-- 0001 gave calls, promises, emails_sent and late_fees a foreign key to
-- accounts(id). 0007 then introduced tenants and account_snapshots and moved
-- the import onto them, because a tenant is a company at a dormitory that
-- persists across months, while a row in accounts was one month's figures.
--
-- accounts was left behind. Nothing has written to it since except the 0003
-- seed, so as things stand a call logged against a tenant who arrived through
-- an upload cannot be stored at all: the foreign key has nothing to point at.
-- That is what blocks the activity log moving off the browser.
--
-- The two id formats are already the same, "dorm-166-jpd2", so this is a
-- repoint rather than a remapping. What it is not is automatic: a call row
-- naming an account with no matching tenant would fail the new constraint, so
-- the missing tenants are created from the accounts they came from first.
--
-- accounts is left in place. Dropping it is a separate decision, and doing it
-- here would mean a migration that both moves history and destroys the only
-- copy of anything this missed.
-- ---------------------------------------------------------------------------

-- Every account that has activity against it but no tenant row becomes one.
-- first_seen and last_seen take the account's own period, which is the only
-- honest date available: it is when we know they existed, not when they began.
insert into tenants (
  id, customer_code, company_name, property_code,
  industry, entity, rm_key, first_seen, last_seen
)
select distinct on (a.id)
  a.id, a.customer_code, a.company_name, a.property_code,
  a.industry, a.entity, a.rm_key, a.period, a.period
from accounts a
where exists (select 1 from calls       c where c.account_id = a.id)
   or exists (select 1 from promises    p where p.account_id = a.id)
   or exists (select 1 from emails_sent e where e.account_id = a.id)
   or exists (select 1 from late_fees   f where f.account_id = a.id)
on conflict (id) do nothing;

-- Anything still pointing at an account that does not exist as a tenant is an
-- orphan already: its account row is gone, so it names nothing either way.
-- Removed rather than left to fail the constraint halfway through.
delete from calls       where account_id not in (select id from tenants);
delete from promises    where account_id not in (select id from tenants);
delete from emails_sent where account_id not in (select id from tenants);
delete from late_fees   where account_id not in (select id from tenants);

alter table calls
  drop constraint if exists calls_account_id_fkey,
  add constraint calls_account_id_fkey
    foreign key (account_id) references tenants(id) on delete cascade;

alter table promises
  drop constraint if exists promises_account_id_fkey,
  add constraint promises_account_id_fkey
    foreign key (account_id) references tenants(id) on delete cascade;

alter table emails_sent
  drop constraint if exists emails_sent_account_id_fkey,
  add constraint emails_sent_account_id_fkey
    foreign key (account_id) references tenants(id) on delete cascade;

alter table late_fees
  drop constraint if exists late_fees_account_id_fkey,
  add constraint late_fees_account_id_fkey
    foreign key (account_id) references tenants(id) on delete cascade;

comment on column calls.account_id is
  'The tenant rung: a company at one dormitory, as tenants(id). Repointed from '
  'accounts in 0012, because accounts stopped being written when 0007 moved '
  'the import onto tenants.';

-- ---------------------------------------------------------------------------
-- Two facts the browser store keeps that the tables had nowhere to put.
--
-- A call the officer logs carries who they reached and a free text note, both
-- of which calls already has. What it does not have is the promise a call
-- produced expressed the way the promises screen reads it, and whether a sent
-- email was really sent or only simulated. CAN_SEND_FOR_REAL is false in every
-- build so far, so every row would otherwise read as a genuine send once the
-- flag is turned on, and nobody could tell the dry runs from the real ones
-- afterwards.
-- ---------------------------------------------------------------------------

alter table emails_sent
  add column if not exists was_simulated boolean not null default true;

comment on column emails_sent.was_simulated is
  'True where the send was a dry run, which is every send while '
  'CAN_SEND_FOR_REAL is false. Defaults to true so a row written by a build '
  'that does not know about this column is not mistaken for a real send.';

-- The rendered letter, which is the only place a template fault is visible.
-- A subject line and a recipient say a send happened, not whether it was
-- right, and every merge field is decided at send time. Nullable, and null
-- means the send predates the column rather than that a blank letter went out:
-- the two are different faults and collapsing them would make every old row
-- accuse the system of sending empty letters.
alter table emails_sent
  add column if not exists body text;

comment on column emails_sent.body is
  'The letter as it went out. Null means the send predates this column. An '
  'empty string means a letter really did go out with no text in it.';

-- When the tenant was told their promise had been recorded. Section 3 sends a
-- short confirmation, and a promise with none is one the tenant may not know
-- we are holding them to.
alter table promises
  add column if not exists confirmation_sent_at timestamptz;

comment on column promises.confirmation_sent_at is
  'When the confirmation for this promise was sent. Null means none has been, '
  'so the tenant has not been told we are holding them to it.';
