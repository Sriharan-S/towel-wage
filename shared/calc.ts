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
  AdvanceKind,
  Balance,
  Entry,
  LineItemResult,
  RoundingMode,
  Settlement,
  WorkKind,
  WorkType,
  WorkerRate,
} from "./types";

export const ZERO_ADJUSTMENTS: Adjustments = {
  credit: 0,
  deduct: 0,
  debit: 0,
  addback: 0,
  advanceRecovered: 0,
};

export const ZERO_BALANCE: Balance = {
  creditOutstanding: 0,
  debitOutstanding: 0,
  advanceOutstanding: 0,
};

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
 * Rates come from the entries themselves — each entry snapshots the rate that
 * was in force when it was typed — which is what keeps past weeks historically
 * accurate when prices change.
 *
 * Crucially, a per-piece line is priced **entry by entry**, not by summing the
 * week's count and multiplying once. Rates can and do change mid-week, and
 * summing first would silently reprice Monday's towels at Thursday's rate.
 *
 * formula_sum_ratio is the one exception: it is defined over the week's total,
 * so it needs a single divisor/multiplier. There the latest snapshot in the
 * week wins, and `rateVaried` flags it if that hid a change.
 *
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
  /** distinct per-piece rates seen this week, to detect a mid-week change */
  const ratesSeen = new Map<number, Set<number>>();
  /** running wage for the kinds that accumulate per entry */
  const accruedWage = new Map<number, number>();

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
      dailyWage: Object.fromEntries(days.map((d) => [d, 0])),
      daysWorked: 0,
      looms: 1,
      loomTotals: [],
      rateVaried: false,
    };
    byWorkType.set(workTypeId, item);
    ratesSeen.set(workTypeId, new Set());
    accruedWage.set(workTypeId, 0);
    return item;
  };

  if (includeEmpty) {
    for (const rate of rates) {
      if (rate.isActive) seed(rate.workTypeId, rate);
    }
  }

  const rateByWorkType = new Map(rates.map((r) => [r.workTypeId, r]));

  // Track the latest entry date per work type so the newest snapshot wins for
  // the week-level formula rate.
  const latestRateDate = new Map<number, ISODate>();
  const daysWithWork = new Map<number, Set<ISODate>>();

  for (const entry of entries) {
    if (!daySet.has(entry.entryDate)) continue;

    let item = byWorkType.get(entry.workTypeId);
    if (!item) {
      // An entry exists for a work type no longer assigned to this worker (or
      // since deactivated). It still has to be paid, so include it anyway.
      item = seed(entry.workTypeId, rateByWorkType.get(entry.workTypeId)) ?? undefined;
      if (!item) continue;
    }

    const latest = latestRateDate.get(entry.workTypeId);
    if (!latest || entry.entryDate >= latest) {
      latestRateDate.set(entry.workTypeId, entry.entryDate);
      item.kind = entry.kind;
      item.unitPrice = entry.unitPrice;
      item.divisor = entry.divisor;
      item.multiplier = entry.multiplier;
    }

    // Each loom is recorded separately but paid as one line.
    const loom = Math.max(1, entry.loom);
    item.looms = Math.max(item.looms, loom);
    while (item.loomTotals.length < loom) item.loomTotals.push(0);

    const value = entry.kind === "direct_sum" ? entry.amount : entry.quantity;

    if (entry.kind === "direct_sum") {
      item.totalAmount += entry.amount;
      accruedWage.set(entry.workTypeId, (accruedWage.get(entry.workTypeId) ?? 0) + entry.amount);
      item.dailyWage[entry.entryDate] =
        (item.dailyWage[entry.entryDate] ?? 0) + entry.amount;
    } else {
      item.totalQuantity += entry.quantity;
      if (entry.kind === "count_x_price") {
        // Price this entry at ITS OWN snapshot, then add it in.
        ratesSeen.get(entry.workTypeId)!.add(entry.unitPrice);
        const earned = Math.round(entry.quantity * entry.unitPrice);
        accruedWage.set(entry.workTypeId, (accruedWage.get(entry.workTypeId) ?? 0) + earned);
        item.dailyWage[entry.entryDate] = (item.dailyWage[entry.entryDate] ?? 0) + earned;
      } else {
        // A weekly ratio has no honest per-day figure; dailyWage stays zero.
        ratesSeen.get(entry.workTypeId)!.add(entry.multiplier * 1e6 + entry.divisor);
      }
    }

    item.loomTotals[loom - 1] += value;
    item.daily[entry.entryDate] = (item.daily[entry.entryDate] ?? 0) + value;

    if (value !== 0) {
      if (!daysWithWork.has(entry.workTypeId)) daysWithWork.set(entry.workTypeId, new Set());
      daysWithWork.get(entry.workTypeId)!.add(entry.entryDate);
    }
  }

  const items = [...byWorkType.values()];
  for (const item of items) {
    item.daysWorked = daysWithWork.get(item.workTypeId)?.size ?? 0;
    item.rateVaried = (ratesSeen.get(item.workTypeId)?.size ?? 0) > 1;
    if (item.loomTotals.length === 0) item.loomTotals = [0];

    // formula_sum_ratio is a whole-week calculation; the others are already
    // totalled entry by entry above.
    item.wage =
      item.kind === "formula_sum_ratio"
        ? lineItemWage(item)
        : (accruedWage.get(item.workTypeId) ?? 0);
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
 *   credit          — extra paid to round UP   (worker ends up owing you)
 *   deduct          — clawing back an old credit
 *   debit           — withheld to round DOWN   (you end up owing the worker)
 *   addback         — paying back an old debit
 *   advanceRecovered— taken off against money lent out mid-week
 */
export function netPayable(wage: number, adj: Adjustments): number {
  return (
    wage + adj.credit - adj.deduct - adj.debit + adj.addback - adj.advanceRecovered
  );
}

/**
 * Cancel a rounding balance that runs both ways.
 *
 * Owing someone ₹30 while they owe you ₹10 is just owing them ₹20 — carrying
 * both figures forward is bookkeeping for its own sake, and it compounds week
 * after week until neither number means anything. Only one side is ever left
 * standing.
 *
 * Advances are left alone: a loan is a distinct arrangement from the loose
 * change of rounding, and it is recovered on its own terms.
 */
export function netBalance(balance: Balance): Balance {
  const net = balance.creditOutstanding - balance.debitOutstanding;
  return {
    ...balance,
    creditOutstanding: Math.max(0, net),
    debitOutstanding: Math.max(0, -net),
  };
}

/**
 * Fold one week's adjustments into a running balance.
 *
 * `advanceDelta` is the net of advances handed out minus repayments taken in
 * during the week; recovering from the wage reduces what is still outstanding.
 *
 * The result is always netted, so a balance can never be owed in both
 * directions at once.
 */
export function applyToBalance(
  balance: Balance,
  adj: Adjustments,
  advanceDelta = 0,
): Balance {
  return netBalance({
    creditOutstanding: balance.creditOutstanding + adj.credit - adj.deduct,
    debitOutstanding: balance.debitOutstanding + adj.debit - adj.addback,
    advanceOutstanding:
      balance.advanceOutstanding + advanceDelta - adj.advanceRecovered,
  });
}

/** Net effect of a set of advance/repayment rows on what is owed. */
export function advanceDelta(rows: Array<{ kind: AdvanceKind; amount: number }>): number {
  return rows.reduce(
    (total, row) => total + (row.kind === "advance" ? row.amount : -row.amount),
    0,
  );
}

/** Total the adjustment rows of every week before `weekStart` into a balance. */
export function balanceBefore(
  history: Array<{ weekStart: ISODate } & Adjustments>,
  weekStart: ISODate,
  advances: Array<{ weekStart: ISODate; kind: AdvanceKind; amount: number }> = [],
): Balance {
  let balance = ZERO_BALANCE;
  for (const row of history) {
    if (row.weekStart >= weekStart) continue;
    balance = applyToBalance(balance, row);
  }
  // Advances given before this week add to what is outstanding.
  const earlier = advances.filter((a) => a.weekStart < weekStart);
  return {
    ...balance,
    advanceOutstanding: balance.advanceOutstanding + advanceDelta(earlier),
  };
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
 * Round a payable amount to a clean figure.
 *
 * Paise are always resolved to the NEAREST rupee first: nobody hands over 56
 * paise, and ₹2,109.56 should become ₹2,110 rather than ₹2,109. The chosen step
 * is then applied to that whole-rupee figure in the requested direction.
 *
 * Guard: rounding down must never wipe the payment out entirely. Flooring ₹21
 * to the nearest ₹100 would be ₹0 — pay nothing, still owe ₹21 — so in that
 * case the whole-rupee figure stands instead.
 */
export function roundPayable(
  amount: number,
  stepRupees: number,
  direction: "up" | "down" | "nearest",
): number {
  const toRupee = roundPaiseTo(amount, 1, "nearest");
  if (stepRupees <= 1) return toRupee;

  const target = roundPaiseTo(toRupee, stepRupees, direction);
  if (target === 0 && toRupee > 0) return toRupee;
  return target;
}

/**
 * Work out the Credit or Debit needed to make the payment a round figure.
 *
 * Deduct and add-back are treated as already settled, so only the rounding
 * knobs move: wage ₹1,980 rounded up to ₹100 gives credit ₹20 (pay ₹2,000);
 * wage ₹2,010 rounded down gives debit ₹10 (pay ₹2,000).
 */
export function computeRounding(
  wage: number,
  adj: Adjustments,
  stepRupees: number,
  direction: "up" | "down" | "nearest",
): { credit: number; debit: number; netPayable: number } {
  const settled = wage - adj.deduct + adj.addback - adj.advanceRecovered;
  const target = roundPayable(settled, stepRupees, direction);
  const delta = target - settled;
  return {
    credit: delta > 0 ? delta : 0,
    debit: delta < 0 ? -delta : 0,
    netPayable: target,
  };
}

/**
 * Work out the credit or debit that makes the payment land on an exact figure.
 *
 * The inverse of the rounding buttons: instead of picking a step and letting
 * the app choose the amount, you name the amount you intend to hand over and
 * the difference is booked automatically. Paying more than the wage leaves the
 * worker owing you the excess (a credit); paying less leaves you owing them the
 * shortfall (a debit).
 *
 * Everything else already entered — an advance recovered, a credit clawed back,
 * a debit repaid — is taken off first, so the figure you type is what actually
 * changes hands, not a subtotal.
 */
export function computeTargetPayment(
  wage: number,
  adj: Adjustments,
  target: number,
): { credit: number; debit: number; netPayable: number; settled: number } {
  const settled = wage - adj.deduct + adj.addback - adj.advanceRecovered;
  const delta = Math.round(target) - settled;
  return {
    credit: delta > 0 ? delta : 0,
    debit: delta < 0 ? -delta : 0,
    netPayable: Math.round(target),
    settled,
  };
}

const DIRECTION_FOR_MODE: Record<RoundingMode, "up" | "down" | "nearest"> = {
  hold: "down",
  nearest: "nearest",
  give: "up",
};

/**
 * The one-tap proposal for what to hand a worker this week.
 *
 * It does in one step what would otherwise be four fields and a rounding
 * button, and it does them in the order that actually makes sense:
 *
 *   1. Recover what the worker already owes you — but never more than they
 *      earned this week. Clawing back ₹500 from a ₹300 wage would mean handing
 *      over a negative amount; the shortfall simply stays outstanding.
 *   2. Pay back whatever you owe them, in full.
 *   3. Resolve the paise to the nearest rupee.
 *   4. Round to the chosen step, preferring to hold money back rather than
 *      front it: rounding down leaves a debit that carries to next week, which
 *      costs you nothing, whereas rounding up puts your own money out on loan
 *      until you remember to claw it back.
 *
 * Rounding up stays available — it is a preference, not a rule.
 */
export function suggestSettlement(params: {
  wage: number;
  opening: Balance;
  /** rupees; 1 means "just clear the paise" */
  step: number;
  mode: RoundingMode;
  /** adjustments already entered by hand, to detect a no-op */
  current?: Adjustments;
}): Settlement {
  const { wage, step, mode, current } = params;

  // Netted first, so a balance owed in both directions never produces a deduct
  // and an add-back that partly undo each other.
  const opening = netBalance(params.opening);

  // 1. Recover an earlier credit, capped at this week's wage.
  const outstandingCredit = Math.max(0, opening.creditOutstanding);
  const deduct = Math.min(outstandingCredit, Math.max(0, wage));
  const remainingCredit = outstandingCredit - deduct;

  // 2. Repay an earlier debit in full.
  const addback = Math.max(0, opening.debitOutstanding);

  /**
   * 3. Advances are deliberately NOT recovered automatically.
   *
   * A loan is a conversation — how much comes off this week depends on what
   * the worker can afford, not on what the arithmetic allows. The outstanding
   * figure is surfaced prominently instead, and whatever you type is respected
   * here so the rounding lands on the right number.
   */
  const advanceRecovered = Math.max(0, current?.advanceRecovered ?? 0);

  // 4 & 5. Clear the paise, then round to the step.
  const settled = wage - deduct + addback - advanceRecovered;
  const netPayable = roundPayable(settled, step, DIRECTION_FOR_MODE[mode]);
  const delta = netPayable - settled;
  const credit = delta > 0 ? delta : 0;
  const debit = delta < 0 ? -delta : 0;

  const proposal: Adjustments = { credit, deduct, debit, addback, advanceRecovered };
  const isNoop =
    current !== undefined &&
    current.credit === credit &&
    current.deduct === deduct &&
    current.debit === debit &&
    current.addback === addback &&
    current.advanceRecovered === advanceRecovered;

  return {
    ...proposal,
    netPayable,
    settled,
    remainingCredit,
    // What you will owe once this is paid: the old debit is cleared by the
    // add-back, and anything rounded down is newly owed.
    carriedDebit: Math.max(0, opening.debitOutstanding - addback) + debit,
    advanceOutstanding: Math.max(0, opening.advanceOutstanding - advanceRecovered),
    mode,
    step,
    isNoop,
  };
}

/** Total quantity across every count-based line item (towels handled). */
export function totalQuantity(items: LineItemResult[]): number {
  return items.reduce(
    (total, item) => total + (item.kind === "direct_sum" ? 0 : item.totalQuantity),
    0,
  );
}
