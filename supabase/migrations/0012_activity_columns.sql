-- ---------------------------------------------------------------------------
-- Three facts the browser kept that the tables had nowhere to put.
--
-- An earlier draft of this migration also repointed calls, promises,
-- emails_sent and late_fees from accounts to tenants. That was wrong, and
-- worth recording rather than quietly deleting: 0005 had already done it,
-- renaming account_id to tenant_id on all four tables and dropping accounts
-- outright. The draft was written from 0001's schema without checking whether
-- a later migration had superseded it, and it failed on the first statement
-- with "relation accounts does not exist".
--
-- What remains is genuinely missing, and all three are the same kind of thing:
-- something the officer's browser has been recording that would be lost on the
-- way to the database, silently, with no error anywhere.
-- ---------------------------------------------------------------------------

-- Whether a send was real or a dry run.
--
-- CAN_SEND_FOR_REAL is false in every build so far, so every row written until
-- it is turned on is a simulation. Without this column they are
-- indistinguishable from genuine sends afterwards, and "did we actually chase
-- this tenant in September" stops being answerable.
--
-- Defaults to true so a row written by a build that does not know about this
-- column is never mistaken for a real send. The safe default is the one that
-- under-claims.
alter table emails_sent
  add column if not exists was_simulated boolean not null default true;

comment on column emails_sent.was_simulated is
  'True where the send was a dry run, which is every send while '
  'CAN_SEND_FOR_REAL is false. Defaults to true so a row written by a build '
  'that does not know about this column is not mistaken for a real send.';

-- The letter as it went out.
--
-- A subject line and a recipient tell you a send happened, not whether it was
-- right. Every date, amount and merge field is filled in at send time, so the
-- body is the only place a template fault is visible, and by the time anybody
-- notices, the figures that produced it have moved on.
--
-- Nullable, and the two empty cases mean different things: null is a send that
-- predates this column, which is nothing to worry about, while an empty string
-- is a letter that really did go out with no text in it, which is a fault
-- worth shouting about. Collapsing them would make every old row accuse the
-- system of sending blank letters.
alter table emails_sent
  add column if not exists body text;

comment on column emails_sent.body is
  'The letter as it went out. Null means the send predates this column. An '
  'empty string means a letter really did go out with no text in it.';

-- When the tenant was told their promise had been recorded.
--
-- Section 3 sends a short confirmation. A promise with none is one the tenant
-- may not know we are holding them to, which matters on the 21st when the
-- final notice cites it.
alter table promises
  add column if not exists confirmation_sent_at timestamptz;

comment on column promises.confirmation_sent_at is
  'When the confirmation for this promise was sent. Null means none has been, '
  'so the tenant has not been told we are holding them to it.';
