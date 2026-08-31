-- ---------------------------------------------------------------------------
-- Make the current_accounts view obey row level security.
--
-- 0005 added the view with a comment claiming security was inherited from the
-- underlying tables. That was wrong, and the RLS test caught it: a manager
-- entitled to 15 tenants could read all 53 by asking the view instead of the
-- table.
--
-- A Postgres view runs as its owner, not as the caller, so the policies on
-- tenants and account_snapshots simply do not apply to anything read through
-- it. The view was a way around the very thing it was built on top of.
--
-- security_invoker makes the view run as whoever is querying it, so the
-- policies apply exactly as they do on the tables themselves.
--
-- Worth remembering for every view added after this one: a view is not safe
-- because the tables under it are safe.
-- ---------------------------------------------------------------------------

alter view current_accounts set (security_invoker = on);

comment on view current_accounts is
  'The most recent snapshot for every tenant. Runs as the caller '
  '(security_invoker), so a manager sees only their own. Without that setting '
  'a view runs as its owner and silently bypasses row level security.';
