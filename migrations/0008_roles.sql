-- Two levels of access, told apart by which PIN was used.
--
--   admin   — everything, including settings, workers and towel types
--   manager — the day-to-day work: stats, entry, wages and advances, but not
--             the configuration that decides what anyone is paid
--
-- The role is fixed on the session at sign-in and never sent by the client,
-- so it cannot be raised by editing a request. Existing sessions predate this
-- column and were opened with the admin PIN, so they default to admin.
ALTER TABLE auth_sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'admin';
