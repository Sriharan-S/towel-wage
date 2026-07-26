-- PIN sign-in.
--
-- A four-digit PIN is only 10,000 combinations, so the rate limiting below is
-- not an optional extra — it is the thing that makes the PIN viable at all.
-- Without it the whole space can be walked in seconds.

-- Live sessions. The token itself is never stored: only its SHA-256, so a
-- copy of this table cannot be replayed as a login.
CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  -- Hash of the PIN the session was opened with. When the PIN is changed in
  -- the environment this stops matching, which signs everyone out — exactly
  -- what you want from changing a password.
  pin_hash   TEXT NOT NULL,
  -- The business-timezone calendar date this session is good for. Comparing
  -- date strings avoids any timezone arithmetic on expiry, and "valid for the
  -- day" is precisely what it means.
  valid_for  TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_agent TEXT
);

CREATE INDEX idx_auth_sessions_valid_for ON auth_sessions(valid_for);

-- Every attempt, good or bad, so failures can be counted per address.
CREATE TABLE auth_attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ip           TEXT    NOT NULL,
  ok           INTEGER NOT NULL,
  attempted_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_auth_attempts_ip ON auth_attempts(ip, attempted_at);
