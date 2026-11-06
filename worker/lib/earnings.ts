/**
 * What each worker earned, week by week, across a range of weeks.
 *
 * Follows computeWeek's order of precedence for a wage — old record, then the
 * figure frozen at finalize, then the live calculation — without running it once
 * per week, which would cost a year's worth of database round trips.
 */

import { buildLineItems, netPayable, sumLineItemWages, ZERO_ADJUSTMENTS } from "@shared/calc";
import type { ISODate } from "@shared/dates";
import type { Worker } from "@shared/types";
import {
  toEntry,
  toWeekAdjustment,
  toWorkType,
  toWorker,
  toWorkerRate,
  type EntryRow,
  type WeekAdjustmentRow,
  type WorkTypeRow,
  type WorkerRateRow,
  type WorkerRow,
} from "./db";

export interface WeekWage {
  weekStart: ISODate;
  workerId: number;
  /** earned, before any rounding, paise */
  wage: number;
  /** what the adjustments made of it, paise */
  paid: number;
  oldRecord: boolean;
}

export async function weeklyWages(
  db: D1Database,
  startWeek: ISODate,
  endWeek: ISODate,
): Promise<{ workers: Worker[]; wages: WeekWage[] }> {
  const [workerRes, typeRes, rateRes, entryRes, adjRes, weekRes] = await db.batch([
    db.prepare("SELECT * FROM workers ORDER BY sort_order, name"),
    db.prepare("SELECT * FROM work_types"),
    db.prepare("SELECT * FROM worker_rates ORDER BY sort_order, id"),
    db
      .prepare("SELECT * FROM entries WHERE week_start >= ? AND week_start <= ?")
      .bind(startWeek, endWeek),
    db
      .prepare("SELECT * FROM week_adjustments WHERE week_start >= ? AND week_start <= ?")
      .bind(startWeek, endWeek),
    db
      .prepare(
        "SELECT week_start FROM weeks WHERE status = 'finalized' AND week_start >= ? AND week_start <= ?",
      )
      .bind(startWeek, endWeek),
  ]);

  const workers = (workerRes.results as unknown as WorkerRow[]).map(toWorker);
  const workTypes = new Map(
    (typeRes.results as unknown as WorkTypeRow[]).map(toWorkType).map((t) => [t.id, t] as const),
  );
  const rates = (rateRes.results as unknown as WorkerRateRow[]).map(toWorkerRate);
  const entries = (entryRes.results as unknown as EntryRow[]).map(toEntry);
  const adjustments = (adjRes.results as unknown as WeekAdjustmentRow[]).map(toWeekAdjustment);
  const finalized = new Set(
    (weekRes.results as unknown as Array<{ week_start: string }>).map((r) => r.week_start),
  );

  const key = (weekStart: string, workerId: number) => `${weekStart}|${workerId}`;

  const adjustmentFor = new Map(adjustments.map((a) => [key(a.weekStart, a.workerId), a] as const));
  const entriesFor = new Map<string, typeof entries>();
  for (const entry of entries) {
    const k = key(entry.weekStart, entry.workerId);
    const list = entriesFor.get(k);
    if (list) list.push(entry);
    else entriesFor.set(k, [entry]);
  }

  const wages: WeekWage[] = [];
  for (const k of new Set([...entriesFor.keys(), ...adjustmentFor.keys()])) {
    const [weekStart, id] = k.split("|");
    const workerId = Number(id);
    const adjustment = adjustmentFor.get(k);

    let wage: number;
    if (adjustment?.manualWage != null) {
      wage = adjustment.manualWage;
    } else if (finalized.has(weekStart) && adjustment?.wage != null) {
      wage = adjustment.wage;
    } else {
      wage = sumLineItemWages(
        buildLineItems({
          weekStart,
          entries: entriesFor.get(k) ?? [],
          rates: rates.filter((r) => r.workerId === workerId),
          workTypes,
          includeEmpty: false,
        }),
      );
    }

    wages.push({
      weekStart,
      workerId,
      wage,
      paid: netPayable(wage, adjustment ?? ZERO_ADJUSTMENTS),
      oldRecord: adjustment?.manualWage != null,
    });
  }

  return { workers, wages };
}
