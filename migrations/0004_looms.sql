-- Looms.
--
-- A worker can run the same towel type on more than one loom. The wage is
-- calculated on the combined count, but each loom's figure is recorded
-- separately because that is how the work is counted and checked on the floor.
--
-- The unique constraint has to grow from (date, worker, type) to
-- (date, worker, type, loom). SQLite can't alter an inline UNIQUE, so the
-- entries table is rebuilt and copied. Existing rows become loom 1.

-- How many looms this worker runs on this type — drives the entry screen.
ALTER TABLE worker_rates ADD COLUMN looms INTEGER NOT NULL DEFAULT 1;

CREATE TABLE entries_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_date   TEXT    NOT NULL,
  week_start   TEXT    NOT NULL,
  worker_id    INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  work_type_id INTEGER NOT NULL REFERENCES work_types(id) ON DELETE CASCADE,
  loom         INTEGER NOT NULL DEFAULT 1,
  kind         TEXT    NOT NULL,
  quantity     REAL    NOT NULL DEFAULT 0,
  amount       INTEGER NOT NULL DEFAULT 0,
  unit_price   INTEGER NOT NULL DEFAULT 0,
  divisor      REAL    NOT NULL DEFAULT 75,
  multiplier   INTEGER NOT NULL DEFAULT 3500,
  note         TEXT,
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (entry_date, worker_id, work_type_id, loom)
);

INSERT INTO entries_new
  (id, entry_date, week_start, worker_id, work_type_id, loom, kind,
   quantity, amount, unit_price, divisor, multiplier, note, updated_at)
SELECT
   id, entry_date, week_start, worker_id, work_type_id, 1, kind,
   quantity, amount, unit_price, divisor, multiplier, note, updated_at
FROM entries;

DROP TABLE entries;

ALTER TABLE entries_new RENAME TO entries;

CREATE INDEX idx_entries_week        ON entries(week_start);
CREATE INDEX idx_entries_worker_date ON entries(worker_id, entry_date);
CREATE INDEX idx_entries_date        ON entries(entry_date);
