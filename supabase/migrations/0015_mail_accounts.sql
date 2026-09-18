-- ---------------------------------------------------------------------------
-- The Google accounts people have connected, so letters can be sent as them.
--
-- Each officer signs in with Google once and the refresh token is kept here.
-- Keeping it, rather than relying on whoever happens to be signed in, is what
-- lets the 7th and the 21st still run: the cron fires at 9am with nobody at a
-- desk, and without a stored token there would be no account to send from and
-- the scheduled letters would simply not go.
--
-- So exactly one connected account is marked as the one the schedule uses.
-- That is a deliberate choice somebody makes, not the first row found, because
-- "which mailbox did that letter come from" is a question a tenant may ask.
--
-- ---------------------------------------------------------------------------
-- What is stored, and what is not
--
-- A refresh token is a long lived credential that can send mail as that person
-- until they revoke it. It is not a password and cannot be used to sign in as
-- them, but it is not harmless either, so:
--
--   row level security lets a person see only their own row
--   the token column is never selected by anything the browser can reach
--   only the service role, on the server, ever reads it
--
-- Revoking is one click in a Google account, and disconnecting here deletes
-- the row. Both should work, and neither should depend on the other.
-- ---------------------------------------------------------------------------

create table if not exists mail_accounts (
  -- One connection per person. Reconnecting replaces rather than accumulates.
  user_id           uuid primary key references profiles(id) on delete cascade,

  -- The address letters will come from. Read back from Google rather than
  -- typed, so it cannot disagree with the account that actually authorised.
  email             text not null,
  display_name      text,

  -- The long lived credential. Never sent to a browser.
  refresh_token     text not null,

  -- What Google granted. Kept so a scope that was reduced later is visible
  -- rather than showing up as a send that fails for no stated reason.
  scope             text,

  -- The one the schedule sends from. Enforced as at most one below.
  is_default        boolean not null default false,

  connected_at      timestamptz not null default now(),
  last_used_at      timestamptz,
  -- Set when Google refuses the token, so a screen can say "reconnect" rather
  -- than leaving somebody to wonder why the 7th sent nothing.
  last_error        text,
  last_error_at     timestamptz
);

comment on table mail_accounts is
  'Google accounts connected for sending. The refresh token is kept so the '
  'scheduled 7th and 21st can send with nobody logged in; without it those '
  'letters would not go at all.';

comment on column mail_accounts.is_default is
  'The account the schedule sends from. At most one, and chosen deliberately: '
  '"which mailbox did that letter come from" is a question a tenant may ask.';

-- At most one default, enforced rather than trusted. Two would make the
-- sending address depend on row order, which is the kind of thing that works
-- for a year and then changes for no visible reason.
create unique index if not exists mail_accounts_one_default
  on mail_accounts ((is_default)) where is_default;

alter table mail_accounts enable row level security;

-- A person may see that they are connected, and disconnect. They may not read
-- anybody else's row, and the token is not selectable from the browser at all:
-- everything that needs it runs on the server with the service role.
drop policy if exists mail_accounts_own_read on mail_accounts;
create policy mail_accounts_own_read on mail_accounts
  for select to authenticated using (user_id = auth.uid());

drop policy if exists mail_accounts_own_delete on mail_accounts;
create policy mail_accounts_own_delete on mail_accounts
  for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Which account sent a letter.
--
-- emails_sent already records what went out and whether it was a dry run. With
-- people sending from their own mailboxes it also has to record which one,
-- because "MES wrote to us" and "someone at MES wrote to us from a personal
-- address" are different facts, and only the second is answerable by asking
-- the sender.
-- ---------------------------------------------------------------------------

alter table emails_sent
  add column if not exists sent_from text;

comment on column emails_sent.sent_from is
  'The mailbox the letter actually left from. Null for a dry run or for a send '
  'that predates connected accounts.';
