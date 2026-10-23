-- ---------------------------------------------------------------------------
-- Which bills each reminder letter was about.
--
-- Reminders are counted from each billing date on its own: a tenant billed on
-- the 15th and again on the 24th gets a first reminder for each, 23 days after
-- each. To know whether the 24th's reminder has gone, a letter has to say
-- which billing dates it covered - the date it was sent cannot tell the 15th's
-- letter from the 24th's.
--
-- Null for letters sent before this column existed. Those were about the
-- tenant's whole balance, so the code counts them for every bill raised on or
-- before the day they went.
-- ---------------------------------------------------------------------------

alter table emails_sent
  add column if not exists billed_on date[];

comment on column emails_sent.billed_on is
  'The billing dates of the invoices this reminder listed. Null for letters '
  'sent before letters listed invoices; those covered the whole balance.';
