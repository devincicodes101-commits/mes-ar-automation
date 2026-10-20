-- ---------------------------------------------------------------------------
-- Letters an officer has edited by hand, for the automatic run to send.
--
-- The 9am run builds every letter from MES's standard wording in the code.
-- Until now the only way to change what one tenant received was to send that
-- letter by hand. This keeps an edit so the automatic run sends it as edited,
-- and every letter nobody has edited is untouched.
--
-- One row per tenant, per letter, per bill:
--
--   tenant_id   which tenant
--   stage       first-reminder or final-notice
--   billed_on   the billing date of the bill the letter is about
--
-- billed_on is in the key so an edit belongs to one bill. The next month's
-- bill has a different date, so its letter is the standard wording again; an
-- edit made for October is never quietly reused for November.
--
-- The text is saved with its {{placeholders}} (amount, dates, company) still
-- in it. The figures are filled in on the day the letter goes, by the same
-- code as every other letter, so an edit made on the 3rd cannot send a balance
-- that changed on the 5th.
--
-- Row level security is on and there is no policy: only the service role, on
-- the server, reads or writes it, behind a check of who is asking.
-- ---------------------------------------------------------------------------

create table if not exists letter_edits (
  tenant_id   text not null,
  stage       text not null check (stage in ('first-reminder', 'final-notice')),
  billed_on   date not null,

  subject     text not null,
  body        text not null,

  edited_by   uuid references profiles(id) on delete set null,
  edited_at   timestamptz not null default now(),

  primary key (tenant_id, stage, billed_on)
);

alter table letter_edits enable row level security;

comment on table letter_edits is
  'A tenant''s letter edited by hand. The 9am run sends this instead of the '
  'standard wording for that tenant, that letter and that bill. Kept with '
  '{{placeholders}} so figures are filled in on the day it is sent.';
