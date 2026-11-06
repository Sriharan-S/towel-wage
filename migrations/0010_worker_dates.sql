-- When a worker started and stopped. Either may be NULL: no join date means they
-- appear in every past week, and no end date means they are still working.
ALTER TABLE workers ADD COLUMN join_date TEXT;
ALTER TABLE workers ADD COLUMN end_date TEXT;
