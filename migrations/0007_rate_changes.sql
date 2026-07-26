-- Rate changes, and when they took effect.
--
-- A price change is dated, and applies from the start of the week it was made
-- in. Weeks already finalized keep the figures they were paid at; every week
-- still open is repriced, including earlier ones, because an open week has not
-- been paid and should reflect the rate that is actually in force.
--
-- The audit row is the record of what changed, when, and by how much — without
-- it a repriced week has no explanation for why last Tuesday is worth more
-- today than it was yesterday.
CREATE TABLE rate_changes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id      INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  work_type_id   INTEGER NOT NULL REFERENCES work_types(id) ON DELETE CASCADE,
  -- Business-timezone calendar date the change was made.
  changed_on     TEXT    NOT NULL,
  -- The Sunday of the week it takes effect from.
  effective_week TEXT    NOT NULL,
  old_unit_price INTEGER NOT NULL,
  new_unit_price INTEGER NOT NULL,
  old_divisor    REAL    NOT NULL DEFAULT 75,
  new_divisor    REAL    NOT NULL DEFAULT 75,
  old_multiplier INTEGER NOT NULL DEFAULT 3500,
  new_multiplier INTEGER NOT NULL DEFAULT 3500,
  -- How many open entries were repriced by this change.
  entries_repriced INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_rate_changes_worker ON rate_changes(worker_id, work_type_id);
CREATE INDEX idx_rate_changes_week   ON rate_changes(effective_week);
