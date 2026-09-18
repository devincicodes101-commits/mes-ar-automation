-- ---------------------------------------------------------------------------
-- An invoice line must belong to a snapshot.
--
-- Found by running the import test for the first time, in September 2026.
--
-- import_ar_report links each line to its snapshot by looking one up for the
-- line's own tenant and the report date:
--
--   (select s.id from account_snapshots s
--     where s.tenant_id = r.tenant_id and s.report_date = p_report_date)
--
-- If a caller sends a line without tenant_id, that subquery returns null, the
-- line is inserted with snapshot_id null, and nothing complains. The damage is
-- not the null itself. It is that every later delete misses the row:
--
--   the upload cascade       reaches it only through upload_id
--   the snapshot cascade     reaches it only through snapshot_id, which is null
--   the import's own delete  joins account_snapshots on snapshot_id
--
-- So a re-import of the same report date leaves the old lines in place and
-- adds new ones on top. MES upload three or more times a month. The charge
-- tabs, the billing runs and the revenue breakdown all read invoices, so those
-- would double, then triple, with the snapshot totals beside them still
-- correct. Two numbers on one screen disagreeing, and no error anywhere.
--
-- The caller that produced this was a test with an incomplete payload, and the
-- application does send tenant_id. That is exactly the point: it was one
-- missing field away, and it failed silently.
--
-- Made impossible instead of documented.
-- ---------------------------------------------------------------------------

-- Any line already orphaned cannot be attributed to a report date, so it is
-- removed rather than guessed at. Reuploading the file rebuilds it correctly.
delete from invoices where snapshot_id is null;

alter table invoices alter column snapshot_id set not null;

comment on column invoices.snapshot_id is
  'The snapshot this line arrived with. NOT NULL because a line without it is '
  'unreachable by every delete in the system and silently accumulates on '
  're-import: see 0010. Set by import_ar_report from the line''s tenant_id, so '
  'a caller must send that.';
