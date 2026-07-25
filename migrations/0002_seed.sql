-- Seed data: the workers, towel types and prices in use today.
-- Everything here is fully editable in the app afterwards.
-- INSERT OR IGNORE keeps this migration safe to re-run.

INSERT OR IGNORE INTO work_types
  (name, kind, unit_label, default_unit_price, default_divisor, default_multiplier, color, sort_order)
-- Colours are the validated categorical slots, assigned in order (see
-- src/lib/palette.ts). The order is the colourblind-safety mechanism, so new
-- types should take the next unused slot rather than an arbitrary hex.
VALUES
  ('Drill',      'count_x_price',     'towels', 370, 75, 3500, '#2a78d6', 1),
  ('x30',        'count_x_price',     'towels', 365, 75, 3500, '#eb6834', 2),
  ('x27',        'count_x_price',     'towels', 315, 75, 3500, '#1baf7a', 3),
  ('x26',        'count_x_price',     'towels', 230, 75, 3500, '#eda100', 4),
  -- price still to be decided; left at 0 and editable
  ('white',      'count_x_price',     'towels',   0, 75, 3500, '#e87ba4', 5),
  -- daily rupee amount entered directly; weekly wage = sum of the week's entries
  ('Paavu',      'direct_sum',        'amount',   0, 75, 3500, '#008300', 6),
  -- daily count entered; weekly wage = (week's total count / 75) * Rs 35
  ('Kurai Cone', 'formula_sum_ratio', 'cones',    0, 75, 3500, '#4a3aa7', 7);

INSERT OR IGNORE INTO workers (name, sort_order) VALUES
  ('Nallamuthu',  1),
  ('Manikkam',    2),
  ('Kannupaiyan', 3),
  ('Seerangam',   4);

-- Assign towel types to workers at the rate each is actually paid.
-- Written as one statement per assignment: D1's SQLite rejects a compound
-- SELECT with this many UNION terms.

INSERT OR IGNORE INTO worker_rates (worker_id, work_type_id, unit_price, divisor, multiplier, sort_order)
SELECT w.id, t.id, 370, 75, 3500, 1 FROM workers w, work_types t
WHERE w.name = 'Nallamuthu' AND t.name = 'Drill';

INSERT OR IGNORE INTO worker_rates (worker_id, work_type_id, unit_price, divisor, multiplier, sort_order)
SELECT w.id, t.id, 365, 75, 3500, 2 FROM workers w, work_types t
WHERE w.name = 'Nallamuthu' AND t.name = 'x30';

INSERT OR IGNORE INTO worker_rates (worker_id, work_type_id, unit_price, divisor, multiplier, sort_order)
SELECT w.id, t.id, 315, 75, 3500, 1 FROM workers w, work_types t
WHERE w.name = 'Manikkam' AND t.name = 'x27';

INSERT OR IGNORE INTO worker_rates (worker_id, work_type_id, unit_price, divisor, multiplier, sort_order)
SELECT w.id, t.id, 0, 75, 3500, 2 FROM workers w, work_types t
WHERE w.name = 'Manikkam' AND t.name = 'white';

INSERT OR IGNORE INTO worker_rates (worker_id, work_type_id, unit_price, divisor, multiplier, sort_order)
SELECT w.id, t.id, 230, 75, 3500, 3 FROM workers w, work_types t
WHERE w.name = 'Manikkam' AND t.name = 'x26';

INSERT OR IGNORE INTO worker_rates (worker_id, work_type_id, unit_price, divisor, multiplier, sort_order)
SELECT w.id, t.id, 370, 75, 3500, 1 FROM workers w, work_types t
WHERE w.name = 'Kannupaiyan' AND t.name = 'Drill';

INSERT OR IGNORE INTO worker_rates (worker_id, work_type_id, unit_price, divisor, multiplier, sort_order)
SELECT w.id, t.id, 365, 75, 3500, 2 FROM workers w, work_types t
WHERE w.name = 'Kannupaiyan' AND t.name = 'x30';

INSERT OR IGNORE INTO worker_rates (worker_id, work_type_id, unit_price, divisor, multiplier, sort_order)
SELECT w.id, t.id, 0, 75, 3500, 1 FROM workers w, work_types t
WHERE w.name = 'Seerangam' AND t.name = 'Paavu';

INSERT OR IGNORE INTO worker_rates (worker_id, work_type_id, unit_price, divisor, multiplier, sort_order)
SELECT w.id, t.id, 0, 75, 3500, 2 FROM workers w, work_types t
WHERE w.name = 'Seerangam' AND t.name = 'Kurai Cone';
