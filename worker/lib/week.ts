/**
 * Assembling a full week's payroll.
 *
 * Shared by the week screen, the history list and the dashboard, so the same
 * numbers appear everywhere.
 */

import {
  advanceDelta,
  applyToBalance,
  buildLineItems,
  carriedAdvance,
  netPayable,
  suggestFromBalance,
  suggestSettlement,
  sumLineItemWages,
  totalQuantity,
  ZERO_ADJUSTMENTS,
  ZERO_BALANCE,
} from "@shared/calc";
import { HTTPException } from "hono/http-exception";
import { weekEndOf } from "@shared/dates";
import type { ISODate } from "@shared/dates";
import type {
  Balance,
  WeekResult,
  WeekStatus,
  WorkType,
  Worker,
  WorkerWeekResult,
} from "@shared/types";
import {
  loadSettings,
  toAdvance,
  toEntry,
  toWeekAdjustment,
  toWorkType,
  toWorker,
  toWorkerRate,
  type AdvanceRow,
  type EntryRow,
  type WeekAdjustmentRow,
  type WorkTypeRow,
  type WorkerRateRow,
  type WorkerRow,
} from "./db";

export interface WeekContext {
  workers: Worker[];
  workTypes: Map<number, WorkType>;
  /** opening balance per worker, entering `weekStart` */
  openingBalances: Map<number, Balance>;
}

/**
 * Compute one week for every worker.
 *
 * `includeInactive` keeps workers who have since been deactivated but who still
 * have entries or adjustments in this week — their history must not vanish.
 */
export async function computeWeek(
  db: D1Database,
  weekStart: ISODate,
): Promise<WeekResult> {
  const [workerRes, typeRes, rateRes, entryRes, adjRes, weekRow, advanceRes, recoveredRes] =
    await db.batch([
      db.prepare("SELECT * FROM workers ORDER BY sort_order, name"),
      db.prepare("SELECT * FROM work_types ORDER BY sort_order, name"),
      db.prepare("SELECT * FROM worker_rates ORDER BY sort_order, id"),
      db.prepare("SELECT * FROM entries WHERE week_start = ?").bind(weekStart),
      // Everything up to and including this week: earlier rows build the opening
      // balance, this week's row supplies the current adjustments.
      db
        .prepare("SELECT * FROM week_adjustments WHERE week_start <= ? ORDER BY week_start")
        .bind(weekStart),
      db.prepare("SELECT status, finalized_at FROM weeks WHERE week_start = ?").bind(weekStart),
      // All of them, later weeks too: what was returned afterwards decides what
      // this week shows as still carried.
      db.prepare("SELECT * FROM advances ORDER BY entry_date, id"),
      db
        .prepare(
          `SELECT week_start, worker_id, advance_recovered FROM week_adjustments
           WHERE week_start > ? AND advance_recovered > 0`,
        )
        .bind(weekStart),
    ]);

  const workers = (workerRes.results as unknown as WorkerRow[]).map(toWorker);
  const workTypes = new Map(
    (typeRes.results as unknown as WorkTypeRow[])
      .map(toWorkType)
      .map((t) => [t.id, t] as const),
  );
  const rates = (rateRes.results as unknown as WorkerRateRow[]).map(toWorkerRate);
  const entries = (entryRes.results as unknown as EntryRow[]).map(toEntry);
  const adjustments = (adjRes.results as unknown as WeekAdjustmentRow[]).map(toWeekAdjustment);
  const advances = (advanceRes.results as unknown as AdvanceRow[]).map(toAdvance);

  // The settlement proposal depends on the configured rounding preference.
  const settings = await loadSettings(db);

  const weekMeta = weekRow.results[0] as { status?: string; finalized_at?: string } | undefined;
  const status: WeekStatus = weekMeta?.status === "finalized" ? "finalized" : "open";
  const finalizedAt = weekMeta?.finalized_at ?? null;

  // Group by worker.
  const ratesByWorker = new Map<number, typeof rates>();
  for (const rate of rates) {
    const list = ratesByWorker.get(rate.workerId) ?? [];
    list.push(rate);
    ratesByWorker.set(rate.workerId, list);
  }

  const entriesByWorker = new Map<number, typeof entries>();
  for (const entry of entries) {
    const list = entriesByWorker.get(entry.workerId) ?? [];
    list.push(entry);
    entriesByWorker.set(entry.workerId, list);
  }

  const openingBalances = new Map<number, Balance>();
  const currentAdjustments = new Map<number, (typeof adjustments)[number]>();
  for (const row of adjustments) {
    if (row.weekStart < weekStart) {
      openingBalances.set(
        row.workerId,
        applyToBalance(openingBalances.get(row.workerId) ?? ZERO_BALANCE, row),
      );
    } else {
      currentAdjustments.set(row.workerId, row);
    }
  }

  // Advances from earlier weeks add to the opening balance. Advances taken
  // during THIS week belong to this week's payout, so they are folded into the
  // opening figure too — the money is already out of the till, and holding it
  // back on Saturday is the whole point.
  const advancesThisWeek = new Map<number, typeof advances>();
  const laterAdvanceMoves = new Map<number, Array<{ date: string; delta: number }>>();
  const addLaterMove = (workerId: number, date: string, delta: number) => {
    const list = laterAdvanceMoves.get(workerId) ?? [];
    list.push({ date, delta });
    laterAdvanceMoves.set(workerId, list);
  };
  for (const row of recoveredRes.results as unknown as Array<{
    week_start: string;
    worker_id: number;
    advance_recovered: number;
  }>) {
    // Taken off the wage, so it happens at that week's payout.
    addLaterMove(row.worker_id, weekEndOf(row.week_start), -row.advance_recovered);
  }
  for (const advance of advances) {
    if (advance.weekStart > weekStart) {
      addLaterMove(advance.workerId, advance.entryDate, advanceDelta([advance]));
      continue;
    }
    const balance = openingBalances.get(advance.workerId) ?? ZERO_BALANCE;
    openingBalances.set(advance.workerId, {
      ...balance,
      advanceOutstanding: balance.advanceOutstanding + advanceDelta([advance]),
    });
    if (advance.weekStart === weekStart) {
      const list = advancesThisWeek.get(advance.workerId) ?? [];
      list.push(advance);
      advancesThisWeek.set(advance.workerId, list);
    }
  }

  const results: WorkerWeekResult[] = [];

  for (const worker of workers) {
    const workerEntries = entriesByWorker.get(worker.id) ?? [];
    const workerRates = ratesByWorker.get(worker.id) ?? [];
    const adjustmentRow = currentAdjustments.get(worker.id);

    const workerAdvances = advancesThisWeek.get(worker.id) ?? [];

    // A deactivated worker only appears if this week actually concerns them.
    if (
      !worker.isActive &&
      workerEntries.length === 0 &&
      !adjustmentRow &&
      workerAdvances.length === 0
    )
      continue;
    // An active worker with nothing assigned and nothing entered is noise.
    if (
      worker.isActive &&
      workerRates.length === 0 &&
      workerEntries.length === 0 &&
      workerAdvances.length === 0 &&
      adjustmentRow?.manualWage == null
    )
      continue;

    /*
      Outside their join and end dates a worker is left off, unless the week
      involves money: hiding recorded work or a balance still owed would make
      the figures wrong, which is worse than an extra name.
    */
    const startedBy = !worker.joinDate || worker.joinDate <= weekEndOf(weekStart);
    const stillThere = !worker.endDate || worker.endDate >= weekStart;
    if (!startedBy || !stillThere) {
      const balance = openingBalances.get(worker.id) ?? ZERO_BALANCE;
      const concernsMoney =
        workerEntries.length > 0 ||
        workerAdvances.length > 0 ||
        adjustmentRow?.manualWage != null ||
        Boolean(adjustmentRow?.wage) ||
        Boolean(adjustmentRow?.credit) ||
        Boolean(adjustmentRow?.deduct) ||
        Boolean(adjustmentRow?.debit) ||
        Boolean(adjustmentRow?.addback) ||
        Boolean(adjustmentRow?.advanceRecovered) ||
        balance.creditOutstanding !== 0 ||
        balance.debitOutstanding !== 0 ||
        balance.advanceOutstanding !== 0;
      if (!concernsMoney) continue;
    }

    const calculatedItems = buildLineItems({
      weekStart,
      entries: workerEntries,
      rates: workerRates,
      workTypes,
    });

    // An old record stands in for the whole calculation.
    const manualWage = adjustmentRow?.manualWage ?? null;
    const lineItems = manualWage === null ? calculatedItems : [];

    const adj = adjustmentRow
      ? {
          credit: adjustmentRow.credit,
          deduct: adjustmentRow.deduct,
          debit: adjustmentRow.debit,
          addback: adjustmentRow.addback,
          advanceRecovered: adjustmentRow.advanceRecovered,
        }
      : { ...ZERO_ADJUSTMENTS };

    // A finalized week pays whatever was frozen at finalize time, so later
    // edits to prices or entries can never rewrite a payment already made.
    const liveWage = sumLineItemWages(lineItems);
    const wage =
      manualWage ??
      (status === "finalized" && adjustmentRow?.wage != null ? adjustmentRow.wage : liveWage);

    const opening = openingBalances.get(worker.id) ?? ZERO_BALANCE;
    const closing = applyToBalance(opening, adj);

    results.push({
      workerId: worker.id,
      workerName: worker.name,
      lineItems,
      wage,
      adjustments: adj,
      netPayable: netPayable(wage, adj),
      openingBalance: opening,
      closingBalance: closing,
      manualWage,
      ignoredWage: manualWage === null ? 0 : sumLineItemWages(calculatedItems),
      carriedAdvance: carriedAdvance(
        closing.advanceOutstanding,
        laterAdvanceMoves.get(worker.id) ?? [],
      ),
      suggested: suggestFromBalance(opening),
      settlement:
        manualWage === null
          ? suggestSettlement({
              wage,
              opening,
              step: settings.roundingStep,
              mode: settings.roundingMode,
              current: adj,
            })
          : // Already paid, so there is nothing to propose.
            {
              ...ZERO_ADJUSTMENTS,
              netPayable: wage,
              settled: wage,
              remainingCredit: 0,
              carriedDebit: closing.debitOutstanding,
              advanceOutstanding: closing.advanceOutstanding,
              mode: settings.roundingMode,
              step: settings.roundingStep,
              isNoop: true,
            },
      advances: workerAdvances,
      paidAt: adjustmentRow?.paidAt ?? null,
      note: adjustmentRow?.note ?? null,
    });
  }

  const totals = results.reduce(
    (acc, r) => ({
      wage: acc.wage + r.wage,
      credit: acc.credit + r.adjustments.credit,
      deduct: acc.deduct + r.adjustments.deduct,
      debit: acc.debit + r.adjustments.debit,
      addback: acc.addback + r.adjustments.addback,
      advanceRecovered: acc.advanceRecovered + r.adjustments.advanceRecovered,
      netPayable: acc.netPayable + r.netPayable,
      quantity: acc.quantity + totalQuantity(r.lineItems),
    }),
    {
      wage: 0,
      credit: 0,
      deduct: 0,
      debit: 0,
      addback: 0,
      advanceRecovered: 0,
      netPayable: 0,
      quantity: 0,
    },
  );

  return {
    weekStart,
    weekEnd: weekEndOf(weekStart),
    status,
    finalizedAt,
    workers: results,
    totals,
  };
}

/** Ensure a `weeks` row exists so status can be tracked. */
export async function ensureWeek(db: D1Database, weekStart: ISODate): Promise<void> {
  await db
    .prepare("INSERT OR IGNORE INTO weeks (week_start, status) VALUES (?, 'open')")
    .bind(weekStart)
    .run();
}

/** Reject edits to a week that has already been paid out. */
export async function assertWeekOpen(db: D1Database, weekStart: ISODate): Promise<void> {
  const row = await db
    .prepare("SELECT status FROM weeks WHERE week_start = ?")
    .bind(weekStart)
    .first<{ status: string }>();
  if (row?.status === "finalized") {
    throw new HTTPException(409, {
      message: `Week of ${weekStart} is finalized. Reopen it before making changes.`,
    });
  }
}
