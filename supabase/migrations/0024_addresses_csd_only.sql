-- ---------------------------------------------------------------------------
-- 0024  Tenant email addresses: CSD, admin and super admin only
-- ---------------------------------------------------------------------------
--
-- The permission table in the application (src/lib/auth.ts) gives
-- view-tenant-emails to CSD, admin and super admin, and to nobody else:
-- addresses are personal data under the PDPA, and the people who send the
-- letters are the people who need them.
--
-- The database said something different. 0002 let Management read contacts
-- ("Only CSD, who send the reminders, and Management"), and 0005 let a
-- relationship manager read every letter sent to their own tenants, with its
-- recipients. Checked 14 October, signed in as each role: Management could
-- read every address in contacts directly, though no screen showed them one.
--
-- Both now follow the application's table. Nothing in the application reads
-- either table with a user's own session - every read goes through a server
-- route holding the service role key, which hides addresses from those roles
-- itself (see hideAddresses in src/lib/scope-server.ts) - so no screen
-- changes. What changes is that a session token can no longer be used to go
-- around the screens and read them straight from the database.
-- ---------------------------------------------------------------------------

drop policy if exists contacts_read on contacts;
create policy contacts_read on contacts
  for select using (is_csd());

comment on policy contacts_read on contacts is
  'Tenant email addresses: CSD, admin and super admin (is_csd). Not RM, not '
  'Management. Personal data under the PDPA.';

drop policy if exists emails_read on emails_sent;
create policy emails_read on emails_sent
  for select using (is_csd());

comment on policy emails_read on emails_sent is
  'Letters sent, with their recipients: CSD, admin and super admin. Other '
  'roles read them through /api/activity, which withholds the recipients.';
