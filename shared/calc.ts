/**
 * The wage engine.
 *
 * This module is imported by BOTH the Worker and the React app, so the figure
 * shown on screen and the figure stored in the database can never disagree.
 * It is pure: no I/O, no dates beyond the strings handed to it.
 */

import type { ISODate } from "./dates";
import { weekDays } from "./dates";
import { roundPaiseTo } from "./money";
import type {
  Adjustments,
  Balance,
  Entry,
  LineItemResult,
  WorkKind,
  WorkType,
  WorkerRate,
} from "./types";

export const ZERO_ADJUSTMENTS: Adjustments = {
  credit: 0,
  deduct: 0,
  debit: 0,
  addback: 0,
};

export const ZERO_BALANCE: Balance = { creditOutstanding: 0, debitOutstanding: 0 };

/**
 * Wage for a single work type over one week.
 *
 * Note that formula_sum_ratio is deliberately a *weekly* calculation, not a sum
 * of daily ones — (150 cones / 75) x ₹35 is not the same as summing seven
 * separate daily divisions once rounding is involved.
 */
export function lineItemWage(params: {
  kind: WorkKind;
  totalQuantity: number;
  totalAmount: number;
  unitPrice: number;
  divisor: number;
  multiplier: number;
}): number {
  const { kind, totalQuantity, totalAmount, unitPrice, divisor, multiplier } = params;

  switch (kind) {
    case "count_x_price":
      return Math.round(totalQuantity * unitPrice);
    case "direct_sum":
      return Math.round(totalAmount);
    case "formula_sum_ratio":
      // A zero divisor would be a division by zero; treat it as "not configured".
      if (!divisor) return 0;
      return Math.round((totalQuantity / divisor) * multiplier);
  }
}

/**
 * Roll a worker's entries for one week up into per-work-type line items.
 *
 * Rates come from the entries themselves (each entry snapshots the rate that
 * was in force when it was typed), which is what keeps past weeks historically
 * accurate when prices change. Where a week has entries under more than one
 * rate, the most recent entry in the week wins — relevant only for
 * formula_sum_ratio, where the divisor/multiplier apply to the week as a whole.
 * Work types with no entries fall back to the worker's current configured rate.
 */
export function buildLineItems(params: {
  weekStart: ISODate;
  entries: Entry[];
  rates: WorkerRate[];
  workTypes: Map<number, WorkType>;
  /** include assigned work types that have no entries this week */
  includeEmpty?: boolean;
}): LineItemResult[] {
  const { weekStart, entries, rates, workTypes, includeEmpty = true } = params;
  const days = weekDays(weekStart);
  const daySet = new Set(days);

  // Seed one line item per assigned work type, at the worker's current rate.
  const byWorkType = new Map<number, LineItemResult>();

  const seed = (workTypeId: number, rate: WorkerRate | undefined): LineItemResult | null => {
    const workType = workTypes.get(workTypeId);
    if (!workType) return null;
    const item: LineItemResult = {
      workTypeId,
      name: workType.name,
      kind: workType.kind,
      unitLabel: workType.unitLabel,
      color: workType.color,
      totalQuantity: 0,
      totalAmount: 0,
      unitPrice: rate?.unitPrice ?? workType.defaultUnitPrice,
      divisor: rate?.divisor ?? workType.defaultDivisor,
      multiplier: rate?.multiplier ?? workType.defaultMultiplier,
      wage: 0,
      daily: Object.fromEntries(days.map((d) => [d, 0])),
      daysWorked: 0,
    };
    byWorkType.set(workTypeId, item);
    return item;
  };

  if (includeEmpty) {
    for (const rate of rates) {
      if (rate.isActive) seed(rate.workTypeId, rate);
    }
  }

  const rateByWorkType = new Map(rates.map((r) => [r.workTypeId, r]));

  // Track the latest entry date per work type so the newest snapshot wins.
  const latestRateDate = new Map<number, ISODate>();

  for (const entry of entries) {
    if (!daySet.has(entry.entryDate)) continue;

    let item = byWorkType.get(entry.workTypeId);
    if (!item) {
      // An entry exists for a work type no longer assigned to this worker (or
      // since deactivated). It still has to be paid, so include it anyway.
      item = seed(entry.workTypeId, rateByWorkType.get(entry.workTypeId)) ?? undefined;
      if (!item) continue;
    }

    // The entry's own snapshot is the source of truth for the rate.
    const latest = latestRateDate.get(entry.workTypeId);
    if (!latest || entry.entryDate >= latest) {
      latestRateDate.set(entry.workTypeId, entry.entryDate);
      item.kind = entry.kind;
      item.unitPrice = entry.unitPrice;
      item.divisor = entry.divisor;
      item.multiplier = entry.multiplier;
    }

    const value = entry.kind === "direct_sum" ? entry.amount : entry.quantity;
    if (entry.kind === "direct_sum") {
      item.totalAmount += entry.amount;
    } else {
      item.totalQuantity += entry.quantity;
    }
    item.daily[entry.entryDate] = value;
    if (value !== 0) item.daysWorked += 1;
  }

  const items = [...byWorkType.values()];
  for (const item of items) {
    item.wage = lineItemWage(item);
  }

  // Keep the worker's configured display order, unassigned types last.
  const order = new Map(rates.map((r, i) => [r.workTypeId, r.sortOrder * 1000 + i]));
  items.sort(
    (a, b) =>
      (order.get(a.workTypeId) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.workTypeId) ?? Number.MAX_SAFE_INTEGER) ||
      a.name.localeCompare(b.name),
  );

  return items;
}

/** A worker's total wage for the week, before adjustments. */
export function sumLineItemWages(items: LineItemResult[]): number {
  return items.reduce((total, item) => total + item.wage, 0);
}

/**
 * What the worker is actually handed on Saturday.
 *
 *   credit  — extra paid to round UP   (worker ends up owing you)
 *   deduct  — clawing back an old credit
 *   debit   — withheld to round DOWN   (you end up owing the worker)
 *   addback — paying back an old debit
 */
export function netPayable(wage: number, adj: Adjustments): number {
  return wage + adj.credit - adj.deduct - adj.debit + adj.addback;
}

/** Fold one week's adjustments into a running balance. */
export function applyToBalance(balance: Balance, adj: Adjustments): Balance {
  return {
    creditOutstanding: balance.creditOutstanding + adj.credit - adj.deduct,
    debitOutstanding: balance.debitOutstanding + adj.debit - adj.addback,
  };
}

/** Total the adjustment rows of every week before `weekStart` into a balance. */
export function balanceBefore(
  history: Array<{ weekStart: ISODate } & Adjustments>,
  weekStart: ISODate,
): Balance {
  let balance = ZERO_BALANCE;
  for (const row of history) {
    if (row.weekStart >= weekStart) continue;
    balance = applyToBalance(balance, row);
  }
  return balance;
}

/**
 * What to propose for this week's Deduct and Add-back, given what is carried
 * forward. These are suggestions only — the UI offers them as a chip to apply,
 * it never fills them in silently.
 */
export function suggestFromBalance(opening: Balance): { deduct: number; addback: number } {
  return {
    deduct: Math.max(0, opening.creditOutstanding),
    addback: Math.max(0, opening.debitOutstanding),
  };
}

/**
 * Work out the Credit or Debit needed to make the payment a round figure.
 *
 * Deduct and add-back are treated as already settled, so only the rounding
 * knobs move: wage ₹1,980 rounded up to ₹10 gives credit ₹20 (pay ₹2,000);
 * wage ₹2,010 rounded down gives debit ₹10 (pay ₹2,000).
 */
export function computeRounding(
  wage: number,
  adj: Adjustments,
  stepRupees: number,
  direction: "up" | "down" | "nearest",
): { credit: number; debit: number; netPayable: number } {
  const settled = wage - adj.deduct + adj.addback;
  const target = roundPaiseTo(settled, stepRupees, direction);
  const delta = target - settled;
  return {
    credit: delta > 0 ? delta : 0,
    debit: delta < 0 ? -delta : 0,
    netPayable: target,
  };
}

/** Total quantity across every count-based line item (towels handled). */
export function totalQuantity(items: LineItemResult[]): number {
  return items.reduce(
    (total, item) => total + (item.kind === "direct_sum" ? 0 : item.totalQuantity),
    0,
  );
}
