-- ---------------------------------------------------------------------------
-- 0021  The checks on an upload, stored, so the schedule can obey them
-- ---------------------------------------------------------------------------
--
-- The upload screen already runs a set of checks over a file and gives one of
-- three answers: nothing of concern, usable but read these first, or do not
-- use this data. The strongest of them adds up each customer's charges and
-- compares the total against the one MES print for that customer in the same
-- file. It is the check that found a charge wiped out of a file where every
-- individual row looked correct.
--
-- None of that reached the schedule. checkUpload ran in the browser, on the
-- upload page, and the result was never written down. So the red answer was
-- advice to whoever happened to be looking, and the nine o'clock run - which
-- nobody is watching - went ahead on the same figures and sent letters and
-- raised fees from them.
--
-- The verdict is stored here so there is something for the run to read.
--
-- ---------------------------------------------------------------------------
-- Why an override, and why it is a column rather than a setting
--
-- A gate with no way through is worse than no gate. The first time MES send a
-- slightly odd but perfectly usable export, collections stop dead and nobody
-- can start them again. So an officer can mark one upload as checked and
-- usable - and because it is recorded against that upload, with who and when,
-- the decision is attributable rather than a switch somebody flipped once and
-- forgot. A later upload starts clean again.
-- ---------------------------------------------------------------------------

alter table uploads
  -- Every finding, as the upload screen produced it: severity, title, detail.
  -- Kept whole rather than reduced to a count, because the question asked six
  -- weeks later is which check failed, not how many did.
  add column if not exists checks jsonb not null default '[]'::jsonb,

  -- The worst severity among them: 'error', 'warning', 'note', or null for a
  -- file with nothing to say. Stored separately so the run can decide without
  -- unpacking the array, and text rather than an enum for the same reason
  -- cron_runs.status is: a verdict the schema did not anticipate should still
  -- be recordable.
  add column if not exists verdict text,

  -- Set when somebody looks at a failed file and decides it is usable anyway.
  add column if not exists override_by uuid references profiles(id),
  add column if not exists override_at timestamptz,
  add column if not exists override_note text;

comment on column uploads.checks is
  'The findings the upload screen produced for this file, kept whole.';
comment on column uploads.verdict is
  'Worst severity among the checks. The schedule refuses to act on ''error'' '
  'unless override_at is set.';
comment on column uploads.override_by is
  'Who decided a failed file was usable anyway. Null means nobody did.';

-- Reading a verdict is reading an upload, which every signed-in role may
-- already do, so the existing uploads policies cover it. Writing the override
-- is a CSD action and uploads_write already says so.

create index if not exists uploads_verdict_idx on uploads (verdict)
  where verdict is not null;
