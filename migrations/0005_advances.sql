-- Advances: money handed to a worker outside the weekly wage, and money they
-- hand back. Either can happen on any day of the week.
--
-- Kept separate from the credit/debit rounding ledger on purpose. A ₹1,000 loan
-- on a Tuesday and a ₹20 rounding credit are different kinds of thing, and
-- mixing them would make both harder to read on the payout sheet.

CREATE TABLE advances (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id  INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  entry_date TEXT    NOT NULL,             -- 'YYYY-MM-DD', when it changed hands
  week_start TEXT    NOT NULL,             -- denormalised, as on entries
  kind       TEXT    NOT NULL CHECK (kind IN ('advance', 'repayment')),
  amount     INTEGER NOT NULL CHECK (amount > 0),  -- paise; kind carries direction
  note       TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_advances_worker ON advances(worker_id);
CREATE INDEX idx_advances_week   ON advances(week_start);
CREATE INDEX idx_advances_date   ON advances(entry_date);

-- Amount taken off this week's wage against an outstanding advance.
-- Never filled in automatically: how much of a loan comes off a given week is a
-- conversation, not arithmetic.
ALTER TABLE week_adjustments ADD COLUMN advance_recovered INTEGER NOT NULL DEFAULT 0;
