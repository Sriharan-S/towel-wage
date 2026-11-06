-- Old records: a week's wage typed straight from the notebook, for weeks that
-- were paid before this app existed. When set it replaces the wage worked out
-- from entries, and the week books no credit, debit or other adjustment.
ALTER TABLE week_adjustments ADD COLUMN manual_wage INTEGER;

-- One Deepavali bonus per year. Live while a draft; finalizing copies each
-- worker's figures into bonus_lines, so later edits to old weeks cannot change
-- a bonus already decided.
CREATE TABLE bonus_runs (
  year         INTEGER PRIMARY KEY,
  start_week   TEXT NOT NULL,              -- 'YYYY-MM-DD', a Sunday
  end_week     TEXT NOT NULL,              -- 'YYYY-MM-DD', a Sunday
  percent      REAL NOT NULL,
  excluded     TEXT NOT NULL DEFAULT '[]', -- JSON array of worker ids left out
  finalized_at TEXT
);

CREATE INDEX idx_bonus_runs_end_week ON bonus_runs(end_week);

CREATE TABLE bonus_lines (
  year         INTEGER NOT NULL,
  worker_id    INTEGER NOT NULL,
  worker_name  TEXT    NOT NULL,           -- snapshot
  earned       INTEGER NOT NULL,           -- paise
  weeks_worked INTEGER NOT NULL,
  bonus        INTEGER NOT NULL,           -- paise
  included     INTEGER NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (year, worker_id)
);
