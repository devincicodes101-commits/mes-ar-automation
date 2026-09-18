-- ---------------------------------------------------------------------------
-- The Google OAuth client, kept here rather than in the environment.
--
-- These credentials identify the application to Google. One per installation,
-- not one per person: every officer who signs in does so through this same
-- client. Connected accounts live in mail_accounts and are a separate thing.
--
-- They were in environment variables, which meant only somebody with access to
-- the hosting account could change them and every change needed a redeploy.
-- For a system being handed to MES that is the wrong shape: they should own
-- the connection to their own Google account and be able to rotate the secret
-- without anybody from DeVinci being available.
--
-- ---------------------------------------------------------------------------
-- The secret never leaves the server
--
-- A client secret is a credential. Moving it into the database means there are
-- now two places to protect instead of one, so this table is deliberately the
-- most locked down in the schema:
--
--   row level security is on, and there is no policy at all
--   which means no signed-in user can select, insert, update or delete
--   only the service role, on the server, can touch it
--
-- No endpoint returns the secret, not even to a super admin. The settings
-- screen is told whether one is set, never what it is. A form that showed it
-- back would put it in a browser, in a log, and in whatever the browser
-- decides to remember.
-- ---------------------------------------------------------------------------

create table if not exists oauth_client (
  -- One row, always. The check is what makes that true rather than a comment
  -- somebody has to read: a second row cannot be inserted.
  id            boolean primary key default true check (id),

  provider      text not null default 'google',
  client_id     text not null,
  client_secret text not null,

  -- Where Google sends people back to. Stored so the screen can show the
  -- exact string that has to be pasted into the Google credential, which is
  -- the single most common thing to get wrong by a character.
  redirect_uri  text,

  updated_by    uuid references profiles(id),
  updated_at    timestamptz not null default now()
);

comment on table oauth_client is
  'The Google OAuth client for this installation. One row. RLS is on with no '
  'policy, so only the service role can read it: the secret must never reach '
  'a browser, and no endpoint returns it.';

comment on column oauth_client.client_secret is
  'Never selected by anything a browser can reach. The settings screen is told '
  'whether a secret is set, never what it is.';

alter table oauth_client enable row level security;

-- Deliberately no policy. With RLS on and nothing granted, every signed-in
-- caller is refused, which is the intent. Written down because an empty policy
-- list looks like an oversight and this one is not.

-- ---------------------------------------------------------------------------
-- Changes are recorded, because this decides who can sign in.
--
-- Swapping the client out points every future sign in at a different Google
-- project. That is a legitimate thing for MES to do and an unhelpful thing to
-- discover by accident, so it leaves a trace in the log everything else leaves
-- a trace in.
-- ---------------------------------------------------------------------------

comment on column oauth_client.updated_by is
  'Who last changed it. Swapping the client points every future sign in at a '
  'different Google project, which is worth being able to trace.';
