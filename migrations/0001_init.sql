-- Towel Wage Manager — initial schema
--
-- Money is stored as INTEGER paise (1 rupee = 100 paise). Never floats: the
-- carry-forward balance ledger accumulates across weeks indefinitely, and float
-- drift would eventually surface as phantom ₹0.01 balances.
--
-- Calendar dates are TEXT 'YYYY-MM-DD' resolved in the business timezone
-- (Asia/Kolkata by default), never UTC timestamps.

-- ---------------------------------------------------------------------------
-- work_types: towel types and other job types
-- ---------------------------------------------------------------------------
CREATE TABLE work_types (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT    NOT NULL UNIQUE,
  -- count_x_price      : daily count entered, wage = count * unit_price
  -- direct_sum         : daily rupee amount entered, wage = sum of amounts
  -- formula_sum_ratio  : daily count entered, wage = (weekly sum / divisor) * multiplier
  kind               TEXT    NOT NULL CHECK (kind IN ('count_x_price', 'direct_sum', 'formula_sum_ratio')),
  unit_label         TEXT    NOT NULL DEFAULT 'towels',
  default_unit_price INTEGER NOT NULL DEFAULT 0,   -- paise per unit
  default_divisor    REAL    NOT NULL DEFAULT 75,
  default_multiplier INTEGER NOT NULL DEFAULT 3500, -- paise
  color              TEXT    NOT NULL DEFAULT '#6366f1',
  is_active          INTEGER NOT NULL DEFAULT 1,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- workers
-- ---------------------------------------------------------------------------
CREATE TABLE workers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  phone      TEXT,
  notes      TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- worker_rates: which work types a worker does, and at what rate.
-- A worker may be assigned any number of work types.
-- ---------------------------------------------------------------------------
CREATE TABLE worker_rates (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id    INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  work_type_id INTEGER NOT NULL REFERENCES work_types(id) ON DELETE CASCADE,
  unit_price   INTEGER NOT NULL DEFAULT 0,    -- paise per unit
  divisor      REAL    NOT NULL DEFAULT 75,
  multiplier   INTEGER NOT NULL DEFAULT 3500, -- paise
  is_active    INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (worker_id, work_type_id)
);

CREATE INDEX idx_worker_rates_worker ON worker_rates(worker_id);

-- ---------------------------------------------------------------------------
-- entries: one row per (date, worker, work type).
--
-- Rate columns are SNAPSHOTS taken at the moment of entry. Editing a worker's
-- price later therefore only affects future entries — past weeks recompute to
-- exactly the figures they were originally paid at.
-- ---------------------------------------------------------------------------
CREATE TABLE entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_date   TEXT    NOT NULL,              -- 'YYYY-MM-DD'
  week_start   TEXT    NOT NULL,              -- 'YYYY-MM-DD', the Sunday; denormalised for fast rollups
  worker_id    INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  work_type_id INTEGER NOT NULL REFERENCES work_types(id) ON DELETE CASCADE,
  kind         TEXT    NOT NULL,              -- snapshot of work_types.kind
  quantity     REAL    NOT NULL DEFAULT 0,    -- count, for count_x_price / formula_sum_ratio
  amount       INTEGER NOT NULL DEFAULT 0,    -- paise, for direct_sum
  unit_price   INTEGER NOT NULL DEFAULT 0,    -- snapshot, paise
  divisor      REAL    NOT NULL DEFAULT 75,   -- snapshot
  multiplier   INTEGER NOT NULL DEFAULT 3500, -- snapshot, paise
  note         TEXT,
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (entry_date, worker_id, work_type_id)
);

CREATE INDEX idx_entries_week        ON entries(week_start);
CREATE INDEX idx_entries_worker_date ON entries(worker_id, entry_date);
CREATE INDEX idx_entries_date        ON entries(entry_date);

-- ---------------------------------------------------------------------------
-- weeks: Sunday-anchored. A finalized week is locked against entry edits.
-- ---------------------------------------------------------------------------
CREATE TABLE weeks (
  week_start   TEXT PRIMARY KEY,              -- 'YYYY-MM-DD', a Sunday
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'finalized')),
  finalized_at TEXT,
  note         TEXT
);

-- ---------------------------------------------------------------------------
-- week_adjustments: the per-worker payment adjustments for a week.
--
--   credit  : extra paid this week to round the payment UP  -> worker owes you
--   deduct  : subtracted this week to recover an earlier credit
--   debit   : withheld this week to round the payment DOWN  -> you owe worker
--   addback : added this week to repay an earlier debit
--
-- net_payable = wage + credit - deduct - debit + addback
--
-- wage/net_payable are NULL while the week is open (always recomputed live) and
-- frozen on finalize as a second line of defence for historical accuracy.
-- ---------------------------------------------------------------------------
CREATE TABLE week_adjustments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start  TEXT    NOT NULL,
  worker_id   INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  credit      INTEGER NOT NULL DEFAULT 0, -- paise
  deduct      INTEGER NOT NULL DEFAULT 0,
  debit       INTEGER NOT NULL DEFAULT 0,
  addback     INTEGER NOT NULL DEFAULT 0,
  wage        INTEGER,                    -- frozen on finalize
  net_payable INTEGER,                    -- frozen on finalize
  paid_at     TEXT,
  note        TEXT,
  UNIQUE (week_start, worker_id)
);

CREATE INDEX idx_week_adjustments_worker ON week_adjustments(worker_id);

-- ---------------------------------------------------------------------------
-- settings: single-row-per-key app configuration
-- ---------------------------------------------------------------------------
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('business_name', 'Towel Wage'),
  ('timezone',      'Asia/Kolkata'),
  ('rounding_step', '100'),
  ('currency',      'INR');
