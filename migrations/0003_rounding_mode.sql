-- Rounding preference for the one-tap settlement.
--
-- 'hold' means: when a payment doesn't land on a clean figure, pay the round
-- figure BELOW and carry the difference forward as money owed to the worker,
-- rather than paying extra out of pocket and having to claw it back later.
INSERT OR IGNORE INTO settings (key, value) VALUES ('rounding_mode', 'hold');
