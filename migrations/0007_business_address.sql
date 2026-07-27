-- The address printed on the wage slip cover.
--
-- A setting rather than a constant in the source: it appears on every hard copy
-- and is exactly the kind of thing that changes without a developer around.
INSERT OR IGNORE INTO settings (key, value) VALUES (
  'business_address',
  '1/66-A, Mattampatti, Erumaipatti (PO), Edappadi (TK), Salem (DT), Tamil Nadu - 637102'
);
