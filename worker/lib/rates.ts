/**
 * Applying a rate change.
 *
 * Entries snapshot the rate they were written at, which is what keeps a paid
 * week paid. But a price agreed on Wednesday is understood to cover the whole
 * week, not just Wednesday onward — and a week that has not been paid yet
 * should reflect the rate actually in force.
 *
 * So a change repriices every entry in every week that is still open, and
 * leaves finalized weeks alone. Finalizing is the act that fixes a week's
 * figures; until then they follow the current rate.
 */

import { todayISO, weekStartOf } from "@shared/dates";
import { loadSettings } from "./db";

export interface RateValues {
  unitPrice: number;
  divisor: number;
  multiplier: number;
}

export interface RepriceResult {
  entriesRepriced: number;
  effectiveWeek: string;
  changedOn: string;
}

/**
 * Reprice a worker's open entries for one towel type, and record the change.
 *
 * Returns null when nothing actually changed, so callers can skip writing a
 * meaningless audit row.
 */
export async function applyRateChange(
  db: D1Database,
  params: {
    workerId: number;
    workTypeId: number;
    before: RateValues;
    after: RateValues;
  },
): Promise<RepriceResult | null> {
  const { workerId, workTypeId, before, after } = params;

  const unchanged =
    before.unitPrice === after.unitPrice &&
    before.divisor === after.divisor &&
    before.multiplier === after.multiplier;
  if (unchanged) return null;

  const settings = await loadSettings(db);
  const changedOn = todayISO(settings.timezone);
  const effectiveWeek = weekStartOf(changedOn);

  /*
    Every open week, not just this one and later. An unfinalized week has not
    been handed over, so it has no claim to an old price — and the alternative
    (a week priced half at the old rate and half at the new) is exactly the
    confusion this is meant to remove.
  */
  const repriced = await db
    .prepare(
      `UPDATE entries
          SET unit_price = ?, divisor = ?, multiplier = ?, updated_at = datetime('now')
        WHERE worker_id = ?
          AND work_type_id = ?
          AND week_start NOT IN (SELECT week_start FROM weeks WHERE status = 'finalized')`,
    )
    .bind(after.unitPrice, after.divisor, after.multiplier, workerId, workTypeId)
    .run();

  const entriesRepriced = repriced.meta.changes ?? 0;

  await db
    .prepare(
      `INSERT INTO rate_changes
         (worker_id, work_type_id, changed_on, effective_week,
          old_unit_price, new_unit_price, old_divisor, new_divisor,
          old_multiplier, new_multiplier, entries_repriced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      workerId,
      workTypeId,
      changedOn,
      effectiveWeek,
      before.unitPrice,
      after.unitPrice,
      before.divisor,
      after.divisor,
      before.multiplier,
      after.multiplier,
      entriesRepriced,
    )
    .run();

  return { entriesRepriced, effectiveWeek, changedOn };
}
