-- =====================================================================
--  MES AR Automation, table privileges
--
--  Why this file exists.
--
--  The project was created with "Automatically expose new tables" turned
--  OFF, which is the safer setting: a new table is not published to the
--  API until somebody says so. The consequence is that grants must be
--  issued deliberately, which is what this file does.
--
--  There are two independent gates in front of every row:
--
--    1. GRANT   does this role have any privilege on the table at all?
--    2. RLS     of the rows in that table, which ones may it see?
--
--  Postgres checks the grant first. Without it the answer is 42501 and
--  the policies in 0002 never run. Both gates are required.
--
--  Note who is deliberately absent below: `anon`. An unauthenticated
--  caller holding the public key gets no privilege on any table, so the
--  data is refused before RLS is consulted. The policies would refuse it
--  anyway; this is the belt to that pair of braces.
-- =====================================================================

-- Schema access. Without usage on the schema, nothing inside it is
-- reachable regardless of table grants.
grant usage on schema public to authenticated, service_role;

-- Signed in users get the full set of verbs, and RLS decides which rows
-- each verb may touch. A relationship manager holds the delete privilege
-- in the same way they hold a key to a door that is bolted: the policy in
-- 0002 gives them no rows to delete.
grant select, insert, update, delete
  on all tables in schema public
  to authenticated;

-- The service role is the trusted server side identity used by
-- migrations and the backend. It bypasses RLS by design.
grant all on all tables in schema public to service_role;

-- bigserial columns need the sequence too, or inserts fail with a
-- permission error on the sequence rather than on the table, which is a
-- confusing way to spend an afternoon.
grant usage, select on all sequences in schema public
  to authenticated, service_role;

-- Anything created later gets the same treatment automatically, so a new
-- table added next month does not silently become unreachable.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

alter default privileges in schema public
  grant all on tables to service_role;

alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;

-- Make the absence of anon explicit rather than incidental, so a future
-- change to the project defaults cannot quietly hand it access.
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
