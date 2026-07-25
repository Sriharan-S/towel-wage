import { Hono } from "hono";
import { buildLineItems, sumLineItemWages, totalQuantity } from "@shared/calc";
import {
  recentWeekStarts,
  todayISO,
  weekDays,
  weekEndOf,
  weekStartOf,
} from "@shared/dates";
import type { ISODate } from "@shared/dates";
import type { AppEnv } from "../lib/http";
import {
  loadSettings,
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
} from "../lib/db";

const app = new Hono<AppEnv>();

/**
 * Everything the dashboard needs, in one request.
 *
 * The aggregation runs in JS rather than SQL on purpose: formula_sum_ratio is a
 * whole-week calculation, so it cannot be expressed as a row-wise SUM without
 * duplicating the wage rules in a second place. Pulling the range's entries and
 * folding them through the same shared calc the week screen uses keeps exactly
 * one definition of what a wage is. A year of data is a few thousand rows.
 */
app.get("/summary", async (c) => {
  const weekCount = Math.min(Math.max(Number(c.req.query("weeks") ?? 12) || 12, 1), 52);
  const settings = await loadSettings(c.env.DB);
  const today = todayISO(settings.timezone);
  const currentWeek = weekStartOf(today);
  const weekStarts = recentWeekStarts(today, weekCount);
  const rangeStart = weekStarts[0];
  const rangeEnd = weekEndOf(currentWeek);

  const [workerRes, typeRes, rateRes, entryRes, adjRes] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM workers ORDER BY sort_order, name"),
    c.env.DB.prepare("SELECT * FROM work_types ORDER BY sort_order, name"),
    c.env.DB.prepare("SELECT * FROM worker_rates ORDER BY sort_order, id"),
    c.env.DB
      .prepare("SELECT * FROM entries WHERE entry_date >= ? AND entry_date <= ?")
      .bind(rangeStart, rangeEnd),
    // All adjustments ever, so balances are true totals rather than
    // window-limited ones.
    c.env.DB.prepare("SELECT * FROM week_adjustments"),
  ]);

  const workers = (workerRes.results as unknown as WorkerRow[]).map(toWorker);
  const workTypeList = (typeRes.results as unknown as WorkTypeRow[]).map(toWorkType);
  const workTypes = new Map(workTypeList.map((t) => [t.id, t] as const));
  const rates = (rateRes.results as unknown as WorkerRateRow[]).map(toWorkerRate);
  const entries = (entryRes.results as unknown as EntryRow[]).map(toEntry);
  const adjustments = (adjRes.results as unknown as WeekAdjustmentRow[]).map(toWeekAdjustment);

  const ratesByWorker = groupBy(rates, (r) => r.workerId);
  const workerById = new Map(workers.map((w) => [w.id, w] as const));

  // --- per week x per worker rollup -----------------------------------------
  const entriesByWeek = groupBy(entries, (e) => e.weekStart);

  interface WeekRow {
    weekStart: ISODate;
    weekEnd: ISODate;
    wage: number;
    quantity: number;
    byWorker: Record<number, number>;
    byWorkType: Record<number, { wage: number; quantity: number }>;
  }

  const weekRows: WeekRow[] = weekStarts.map((weekStart) => {
    const weekEntries = entriesByWeek.get(weekStart) ?? [];
    const byWorkerEntries = groupBy(weekEntries, (e) => e.workerId);

    const row: WeekRow = {
      weekStart,
      weekEnd: weekEndOf(weekStart),
      wage: 0,
      quantity: 0,
      byWorker: {},
      byWorkType: {},
    };

    for (const [workerId, workerEntries] of byWorkerEntries) {
      const items = buildLineItems({
        weekStart,
        entries: workerEntries,
        rates: ratesByWorker.get(workerId) ?? [],
        workTypes,
        includeEmpty: false,
      });
      const wage = sumLineItemWages(items);
      row.wage += wage;
      row.quantity += totalQuantity(items);
      row.byWorker[workerId] = wage;

      for (const item of items) {
        const bucket = (row.byWorkType[item.workTypeId] ??= { wage: 0, quantity: 0 });
        bucket.wage += item.wage;
        bucket.quantity += item.kind === "direct_sum" ? 0 : item.totalQuantity;
      }
    }

    return row;
  });

  // --- daily totals, for the heatmap and day-of-week chart -------------------
  // Daily wage uses the per-entry rate directly. For formula_sum_ratio that is
  // an approximation (the real formula is weekly), so it is reported as a
  // count-only signal and excluded from daily wage.
  const dailyMap = new Map<ISODate, { wage: number; quantity: number; entryCount: number }>();
  for (const entry of entries) {
    const bucket = dailyMap.get(entry.entryDate) ?? { wage: 0, quantity: 0, entryCount: 0 };
    if (entry.kind === "count_x_price") {
      bucket.wage += Math.round(entry.quantity * entry.unitPrice);
      bucket.quantity += entry.quantity;
    } else if (entry.kind === "direct_sum") {
      bucket.wage += entry.amount;
    } else {
      bucket.quantity += entry.quantity;
    }
    bucket.entryCount += 1;
    dailyMap.set(entry.entryDate, bucket);
  }

  const allDays = weekStarts.flatMap((w) => weekDays(w)).filter((d) => d <= today);
  const daily = allDays.map((date) => ({
    date,
    ...(dailyMap.get(date) ?? { wage: 0, quantity: 0, entryCount: 0 }),
  }));

  const dayOfWeek = Array.from({ length: 7 }, (_, dow) => {
    const days = daily.filter((d) => new Date(`${d.date}T12:00:00Z`).getUTCDay() === dow);
    const active = days.filter((d) => d.entryCount > 0);
    return {
      dayOfWeek: dow,
      avgQuantity: active.length
        ? active.reduce((s, d) => s + d.quantity, 0) / active.length
        : 0,
      avgWage: active.length ? active.reduce((s, d) => s + d.wage, 0) / active.length : 0,
      daysRecorded: active.length,
    };
  });

  // --- outstanding balances, across all time --------------------------------
  const balanceByWorker = new Map<number, { creditOutstanding: number; debitOutstanding: number }>();
  for (const adj of adjustments) {
    const bal = balanceByWorker.get(adj.workerId) ?? {
      creditOutstanding: 0,
      debitOutstanding: 0,
    };
    bal.creditOutstanding += adj.credit - adj.deduct;
    bal.debitOutstanding += adj.debit - adj.addback;
    balanceByWorker.set(adj.workerId, bal);
  }

  const balances = [...balanceByWorker.entries()]
    .map(([workerId, bal]) => ({
      workerId,
      workerName: workerById.get(workerId)?.name ?? `#${workerId}`,
      ...bal,
      net: bal.creditOutstanding - bal.debitOutstanding,
    }))
    .filter((b) => b.creditOutstanding !== 0 || b.debitOutstanding !== 0)
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

  // --- headline figures -----------------------------------------------------
  const thisWeek = weekRows.at(-1);
  const lastWeek = weekRows.at(-2);
  const missingDays = weekDays(currentWeek)
    .filter((d) => d <= today)
    .filter((d) => !dailyMap.has(d));

  return c.json({
    today,
    currentWeek,
    weeks: weekRows,
    daily,
    dayOfWeek,
    balances,
    workers: workers.map((w) => ({ id: w.id, name: w.name, isActive: w.isActive })),
    workTypes: workTypeList.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      kind: t.kind,
      unitLabel: t.unitLabel,
    })),
    kpis: {
      thisWeekWage: thisWeek?.wage ?? 0,
      lastWeekWage: lastWeek?.wage ?? 0,
      thisWeekQuantity: thisWeek?.quantity ?? 0,
      lastWeekQuantity: lastWeek?.quantity ?? 0,
      activeWorkers: workers.filter((w) => w.isActive).length,
      totalCreditOutstanding: balances.reduce((s, b) => s + Math.max(0, b.creditOutstanding), 0),
      totalDebitOutstanding: balances.reduce((s, b) => s + Math.max(0, b.debitOutstanding), 0),
      missingDays,
    },
  });
});

/** Per-worker detail: trend, type mix and ledger. */
app.get("/worker/:workerId", async (c) => {
  const workerId = Number(c.req.param("workerId"));
  const weekCount = Math.min(Math.max(Number(c.req.query("weeks") ?? 12) || 12, 1), 52);
  const settings = await loadSettings(c.env.DB);
  const today = todayISO(settings.timezone);
  const weekStarts = recentWeekStarts(today, weekCount);

  const [typeRes, rateRes, entryRes] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM work_types"),
    c.env.DB.prepare("SELECT * FROM worker_rates WHERE worker_id = ? ORDER BY sort_order").bind(workerId),
    c.env.DB
      .prepare("SELECT * FROM entries WHERE worker_id = ? AND entry_date >= ?")
      .bind(workerId, weekStarts[0]),
  ]);

  const workTypes = new Map(
    (typeRes.results as unknown as WorkTypeRow[]).map(toWorkType).map((t) => [t.id, t] as const),
  );
  const rates = (rateRes.results as unknown as WorkerRateRow[]).map(toWorkerRate);
  const entries = (entryRes.results as unknown as EntryRow[]).map(toEntry);
  const byWeek = groupBy(entries, (e) => e.weekStart);

  const weeks = weekStarts.map((weekStart) => {
    const items = buildLineItems({
      weekStart,
      entries: byWeek.get(weekStart) ?? [],
      rates,
      workTypes,
      includeEmpty: false,
    });
    const wage = sumLineItemWages(items);
    const quantity = totalQuantity(items);
    return {
      weekStart,
      wage,
      quantity,
      // Blended rate actually achieved, in paise per piece.
      effectiveRate: quantity > 0 ? Math.round(wage / quantity) : 0,
      byWorkType: items.map((i) => ({
        workTypeId: i.workTypeId,
        name: i.name,
        color: i.color,
        wage: i.wage,
        quantity: i.totalQuantity,
      })),
    };
  });

  return c.json({ workerId, weeks });
});

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

export default app;
