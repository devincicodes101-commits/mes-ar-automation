-- =====================================================================
--  MES AR Automation, the two admin roles
--  DeVinci Codes
--
--  The original model had three roles: csd, rm, management. MES asked for
--  two more above them:
--
--    super_admin   everything csd can do, plus managing who may sign in
--                  and changing the fee rules.
--    admin         everything csd can do, plus the settings. No user
--                  management.
--
--  Written as a widening of the existing model rather than a rewrite. The
--  helper functions in 0002_security.sql are the only place that decides
--  what a role may do, so extending them extends every policy at once and
--  no table policy is edited here. A policy this file forgot would
--  otherwise fail open, and the whole point of 0002 is that it cannot.
-- =====================================================================

-- ------------------------------------------------------------ the enum
-- Postgres will not add an enum value inside a transaction that then uses
-- it, so the values are added first and used by the functions below.

alter type user_role add value if not exists 'admin';
alter type user_role add value if not exists 'super_admin';

commit;

-- ---------------------------------------------------------- the helpers
--
-- `is_csd` is the gate on every write in 0002. Widening it here is what
-- gives the two new roles the whole collections workflow without touching
-- a single table policy.
--
-- Deliberately still excluded from write access: rm and management. That
-- was the rule before and it has not changed.

create or replace function is_csd() returns boolean
language sql stable as $$
  select app_role() in ('csd', 'admin', 'super_admin')
$$;

comment on function is_csd() is
  'May act: send reminders, log calls, raise fees, upload. Named for the '
  'role it started as; now true for admin and super_admin as well.';

create or replace function can_read_all() returns boolean
language sql stable as $$
  select app_role() in ('csd', 'management', 'admin', 'super_admin')
$$;

-- ------------------------------------------------- the two new powers
-- These are new, so they get their own functions rather than being
-- bolted onto is_csd(). A CSD officer must not acquire them by accident.

create or replace function can_edit_settings() returns boolean
language sql stable as $$
  select app_role() in ('admin', 'super_admin')
$$;

comment on function can_edit_settings() is
  'Change the fee rule, the templates and the report recipients.';

create or replace function can_manage_users() returns boolean
language sql stable as $$
  select app_role() = 'super_admin'
$$;

comment on function can_manage_users() is
  'Add and remove people, and change what role they hold. Super admin only.';

-- --------------------------------------------------------- profiles
--
-- Who may change a profile: super admin, and nobody else.
--
-- THE DROP BELOW IS LOAD BEARING. 0002 has:
--
--     create policy profiles_admin_write on profiles
--       for all using (is_csd()) with check (is_csd());
--
-- Postgres RLS policies are permissive, which means they are OR'd together.
-- Widening is_csd() above to include admin and super_admin therefore widens
-- that policy too, and leaving it in place would let every CSD officer edit
-- profiles no matter what the stricter policies below say. Adding rules would
-- not have restricted anything; the old rule has to go.
--
-- Two things the replacements deliberately refuse, because both are ways to
-- quietly grant yourself more than you were given:
--   - changing your own role, even as super admin
--   - deleting the last super admin, which would lock everyone out

drop policy if exists profiles_admin_write on profiles;

drop policy if exists profiles_insert on profiles;
create policy profiles_insert on profiles
  for insert to authenticated
  with check (can_manage_users());

drop policy if exists profiles_update on profiles;
create policy profiles_update on profiles
  for update to authenticated
  using (can_manage_users())
  with check (
    can_manage_users()
    -- you may edit anyone but yourself, so no one can promote themselves
    and id <> auth.uid()
  );

drop policy if exists profiles_delete on profiles;
create policy profiles_delete on profiles
  for delete to authenticated
  using (
    can_manage_users()
    and id <> auth.uid()
    -- never remove the last super admin
    and (
      role <> 'super_admin'
      or (select count(*) from profiles p where p.role = 'super_admin') > 1
    )
  );

-- --------------------------------------------------------- templates
-- Editing the wording moves from "anyone who may act" to "admin and above".
-- The letters cite employment law and threaten disruption of services, so
-- changing them is a heavier act than sending one.

drop policy if exists templates_write on templates;
create policy templates_write on templates
  for all to authenticated
  using (can_edit_settings())
  with check (can_edit_settings());
