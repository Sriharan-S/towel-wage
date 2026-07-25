import type { ISODate } from "./dates";

/**
 * How a work type turns daily data entry into a weekly wage.
 *
 * count_x_price     — a daily count; wage = count x unit price
 * direct_sum        — a daily rupee amount typed in directly; wage = sum of the week
 * formula_sum_ratio — a daily count; wage = (week's total count / divisor) x multiplier
 */
export type WorkKind = "count_x_price" | "direct_sum" | "formula_sum_ratio";

export const WORK_KINDS: WorkKind[] = [
  "count_x_price",
  "direct_sum",
  "formula_sum_ratio",
];

export const WORK_KIND_LABELS: Record<WorkKind, string> = {
  count_x_price: "Count x price",
  direct_sum: "Direct amount",
  formula_sum_ratio: "Ratio formula",
};

export const WORK_KIND_HELP: Record<WorkKind, string> = {
  count_x_price:
    "Enter how many were done each day. Wage = count x price per piece.",
  direct_sum:
    "Enter the rupee amount for the day directly. Wage = the week's amounts added up.",
  formula_sum_ratio:
    "Enter a count each day. Wage = (the week's total count / divisor) x multiplier.",
};

export type WeekStatus = "open" | "finalized";

export interface WorkType {
  id: number;
  name: string;
  kind: WorkKind;
  unitLabel: string;
  /** paise per unit */
  defaultUnitPrice: number;
  defaultDivisor: number;
  /** paise */
  defaultMultiplier: number;
  color: string;
  isActive: boolean;
  sortOrder: number;
}

export interface Worker {
  id: number;
  name: string;
  phone: string | null;
  notes: string | null;
  isActive: boolean;
  sortOrder: number;
}

/** A work type assigned to a worker, with that worker's rate for it. */
export interface WorkerRate {
  id: number;
  workerId: number;
  workTypeId: number;
  /** paise per unit */
  unitPrice: number;
  divisor: number;
  /** paise */
  multiplier: number;
  /** how many looms this worker runs on this type — input boxes on entry */
  looms: number;
  isActive: boolean;
  sortOrder: number;
}

/**
 * Money handed to a worker outside the weekly wage, and money they hand back.
 *
 * Separate from the credit/debit rounding ledger on purpose: a ₹1,000 loan on a
 * Tuesday and a ₹20 rounding credit are different kinds of thing, and mixing
 * them would make both harder to read on the payout sheet.
 */
export type AdvanceKind = "advance" | "repayment";

export interface Advance {
  id: number;
  workerId: number;
  entryDate: ISODate;
  weekStart: ISODate;
  kind: AdvanceKind;
  /** always positive paise; `kind` carries the direction */
  amount: number;
  note: string | null;
  createdAt: string;
}

export interface Entry {
  id: number;
  entryDate: ISODate;
  weekStart: ISODate;
  workerId: number;
  workTypeId: number;
  /**
   * Which loom this figure came off, 1-based.
   *
   * A worker can run the same towel type on more than one loom. The wage is
   * calculated on the total, but the per-loom figures are recorded separately
   * because that is how the work is actually counted and checked.
   */
  loom: number;
  /** snapshot of the work type's kind at entry time */
  kind: WorkKind;
  /** count, for count_x_price and formula_sum_ratio */
  quantity: number;
  /** paise, for direct_sum */
  amount: number;
  /** snapshot of the rate at entry time, paise */
  unitPrice: number;
  divisor: number;
  /** paise */
  multiplier: number;
  note: string | null;
}

/** The payment adjustments applied to one worker in one week. */
export interface Adjustments {
  /** paid extra this week to round UP; the worker now owes you this */
  credit: number;
  /** taken off this week to recover an earlier credit */
  deduct: number;
  /** withheld this week to round DOWN; you now owe the worker this */
  debit: number;
  /** paid back this week to settle an earlier debit */
  addback: number;
  /** taken off this week against an outstanding advance */
  advanceRecovered: number;
}

export interface WeekAdjustmentRecord extends Adjustments {
  weekStart: ISODate;
  workerId: number;
  /** frozen on finalize, null while the week is open */
  wage: number | null;
  netPayable: number | null;
  paidAt: string | null;
  note: string | null;
}

/** Outstanding carry-forward for a worker, as of the start of some week. */
export interface Balance {
  /** money the worker owes you (unrecovered credits), paise */
  creditOutstanding: number;
  /** money you owe the worker (unpaid debits), paise */
  debitOutstanding: number;
  /** money lent out and not yet recovered or repaid, paise */
  advanceOutstanding: number;
}

/** One work type's contribution to a worker's weekly wage. */
export interface LineItemResult {
  workTypeId: number;
  name: string;
  kind: WorkKind;
  unitLabel: string;
  color: string;
  /** sum of the week's counts (count_x_price, formula_sum_ratio) */
  totalQuantity: number;
  /** sum of the week's typed amounts, paise (direct_sum) */
  totalAmount: number;
  /** effective rate used for this week, paise */
  unitPrice: number;
  divisor: number;
  multiplier: number;
  /** paise */
  wage: number;
  /** value per day of the week, keyed by ISO date (summed across looms) */
  daily: Record<ISODate, number>;
  daysWorked: number;
  /** how many looms this worker ran on this type during the week */
  looms: number;
  /** the week's total per loom, index 0 = loom 1 — kept for the record */
  loomTotals: number[];
  /** true when the rate changed part-way through the week */
  rateVaried: boolean;
}

export interface WorkerWeekResult {
  workerId: number;
  workerName: string;
  lineItems: LineItemResult[];
  /** paise */
  wage: number;
  adjustments: Adjustments;
  /** wage + credit - deduct - debit + addback, paise */
  netPayable: number;
  /** carry-forward entering this week */
  openingBalance: Balance;
  /** carry-forward leaving this week */
  closingBalance: Balance;
  /** what the app proposes for deduct / addback based on openingBalance */
  suggested: { deduct: number; addback: number };
  /** the one-tap proposal: settle the carry-forward, then round */
  settlement: Settlement;
  /** advances given and repaid during this week, for the payout sheet */
  advances: Advance[];
  paidAt: string | null;
  note: string | null;
}

export interface WeekResult {
  weekStart: ISODate;
  weekEnd: ISODate;
  status: WeekStatus;
  finalizedAt: string | null;
  workers: WorkerWeekResult[];
  totals: {
    wage: number;
    credit: number;
    deduct: number;
    debit: number;
    addback: number;
    advanceRecovered: number;
    netPayable: number;
    quantity: number;
  };
}

/**
 * Which way to round when the payment doesn't land on a clean figure.
 *
 * hold    — round DOWN, keeping the difference as a debit you carry forward.
 *           You never front money out of pocket. The default.
 * nearest — round to whichever clean figure is closer.
 * give    — round UP, handing over the difference as a credit to recover later.
 */
export type RoundingMode = "hold" | "nearest" | "give";

export const ROUNDING_MODES: RoundingMode[] = ["hold", "nearest", "give"];

export const ROUNDING_MODE_LABELS: Record<RoundingMode, string> = {
  hold: "Hold back",
  nearest: "Nearest",
  give: "Give extra",
};

export const ROUNDING_MODE_HELP: Record<RoundingMode, string> = {
  hold: "Pay the round figure below and carry the difference forward as money you owe them. You never pay extra out of pocket.",
  nearest: "Pay whichever round figure is closer, whether that is slightly more or slightly less.",
  give: "Pay the round figure above and recover the difference from next week's wage.",
};

/**
 * A complete proposed payment for one worker in one week: settle what is
 * carried forward, then round. See suggestSettlement() in calc.ts.
 */
export interface Settlement {
  /** recovering an earlier credit, capped at what they earned this week */
  deduct: number;
  /** repaying an earlier debit */
  addback: number;
  /** rounding up (only when the mode allows it) */
  credit: number;
  /** rounding down — money held back for next week */
  debit: number;
  /** echoed back from what you typed — never proposed automatically */
  advanceRecovered: number;
  /** the round figure actually handed over */
  netPayable: number;
  /** wage − deduct + addback, before rounding */
  settled: number;
  /** outstanding credit that this week's wage could not cover */
  remainingCredit: number;
  /** what you will owe the worker once this payment is made */
  carriedDebit: number;
  /** advance still outstanding after whatever recovery was entered */
  advanceOutstanding: number;
  mode: RoundingMode;
  /** rupees */
  step: number;
  /** true when the proposal changes nothing — already settled and round */
  isNoop: boolean;
}

export interface Settings {
  businessName: string;
  timezone: string;
  roundingStep: number;
  roundingMode: RoundingMode;
  currency: string;
}

export interface Bootstrap {
  workers: Worker[];
  workTypes: WorkType[];
  rates: WorkerRate[];
  settings: Settings;
  today: ISODate;
}
