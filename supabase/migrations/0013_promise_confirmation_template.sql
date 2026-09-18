-- ---------------------------------------------------------------------------
-- The promise confirmation exists in the app and not in the database.
--
-- Found by test:activity:rest, which is the first thing to have written a sent
-- letter to Postgres. emails_sent.template_id has a foreign key to templates,
-- the app ships four templates, and only three of them are rows:
--
--   reminder-7th            in both
--   final-21st              in both
--   onefm                   in both
--   promise-confirmation    app only, so every send of it would be rejected
--   giro-setup              database only, nothing sends it
--
-- The consequence is narrow and bad. Proposal section 3 sends a short
-- confirmation the moment a promise is recorded, which is the message that
-- tells a tenant we are holding them to a date. The letter would go out and
-- the record of it would be refused, so the one message whose entire purpose
-- is to be referred to later would be the one with no trace.
--
-- Seeded with the wording the app ships, so the two agree from the start
-- rather than the first time somebody edits it in Settings.
--
-- giro-setup is left alone. Nothing sends it, but it is dormant DBS work
-- rather than a mistake, and deleting a template would take the history of
-- anything sent with it.
-- ---------------------------------------------------------------------------

insert into templates (id, name, trigger, subject, body) values (
  'promise-confirmation',
  'Promise confirmation',
  'Straight after a promise is recorded',
  'Thank you, {{company}}',
  'Dear {{company}},

Thank you for speaking with us today.

This is to confirm what we agreed: payment of SGD {{promiseAmount}} on account {{code}} by {{promiseDate}}.

If anything about that is not right, please reply to this email and let us know.

Kind regards,
Customer Services Department
MES Group'
)
-- Never overwrite an edit. If this row already exists, somebody may have
-- changed the wording in Settings, and a migration is not the place to undo
-- that.
on conflict (id) do nothing;
