-- ===========================================================================
-- 0028: connected mailboxes become one shared list
--
-- mail_accounts was keyed on the person who connected it: one mailbox per
-- login. So the same Outlook account connected from two logins showed as two
-- rows, and one login could not connect a second account without replacing
-- the first (found 25 October). MES think of it the other way round: a list
-- of mailboxes, one of them active, the rest there to switch to.
--
-- Now each row is a mailbox, keyed on its own id, with at most one row per
-- address. Who connected it is kept, as a fact about the row rather than its
-- key. The active mailbox (is_default, at most one, as before) sends every
-- letter.
-- ===========================================================================

alter table mail_accounts
  add column if not exists id uuid not null default gen_random_uuid();

-- One row per address. Where the same account was connected more than once,
-- keep the active row, or else the most recent connection; the others are the
-- same mailbox with an older token.
delete from mail_accounts a
using mail_accounts b
where a.provider = b.provider
  and lower(a.email) = lower(b.email)
  and a.ctid <> b.ctid
  and (
    (b.is_default and not a.is_default)
    or (a.is_default = b.is_default and (b.connected_at, b.ctid::text) > (a.connected_at, a.ctid::text))
  );

alter table mail_accounts drop constraint if exists mail_accounts_pkey;
alter table mail_accounts add primary key (id);

alter table mail_accounts rename column user_id to connected_by;
alter table mail_accounts alter column connected_by drop not null;
alter table mail_accounts drop constraint if exists mail_accounts_user_id_fkey;
alter table mail_accounts
  add constraint mail_accounts_connected_by_fkey
  foreign key (connected_by) references profiles(id) on delete set null;

create unique index if not exists mail_accounts_one_per_address
  on mail_accounts (provider, lower(email));

comment on table mail_accounts is
  'Mailboxes connected for sending, one row per address. The one marked '
  'is_default is the active mailbox: every letter goes out from it.';
comment on column mail_accounts.connected_by is
  'Who connected it. Kept for the record; any administrator can change or '
  'remove a mailbox.';

-- The browser never reads this table directly (the server uses the service
-- role), but the policies named the old column, so they are restated.
drop policy if exists mail_accounts_own_read on mail_accounts;
create policy mail_accounts_own_read on mail_accounts
  for select to authenticated using (connected_by = auth.uid());

drop policy if exists mail_accounts_own_delete on mail_accounts;
create policy mail_accounts_own_delete on mail_accounts
  for delete to authenticated using (connected_by = auth.uid());
