-- ---------------------------------------------------------------------------
-- Which kind of account each connected mailbox is: Google or Microsoft.
--
-- mail_accounts was written for Google sign in. Outlook / Microsoft 365 uses
-- the same table - one connection per person, one nominated for the schedule -
-- and only needs to know which provider's token it is holding, so the send
-- path picks the right one.
--
-- Every existing row is a Google connection, which is the default.
-- ---------------------------------------------------------------------------

alter table mail_accounts
  add column if not exists provider text not null default 'google';

alter table mail_accounts
  drop constraint if exists mail_accounts_provider_check;

alter table mail_accounts
  add constraint mail_accounts_provider_check
  check (provider in ('google', 'microsoft'));

comment on column mail_accounts.provider is
  'google or microsoft. Decides which service the refresh token belongs to.';
