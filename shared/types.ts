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
  isActive: boolean;
  sortOrder: number;
}

export interface Entry {
  id: number;
  entryDate: ISODate;
  weekStart: ISODate;
  workerId: number;
  workTypeId: number;
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

/** The four payment adjustments applied to one worker in one week. */
export interface Adjustments {
  /** paid extra this week to round UP; the worker now owes you this */
  credit: number;
  /** taken off this week to recover an earlier credit */
  deduct: number;
  /** withheld this week to round DOWN; you now owe the worker this */
  debit: number;
  /** paid back this week to settle an earlier debit */
  addback: number;
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
  /** value per day of the week, keyed by ISO date */
  daily: Record<ISODate, number>;
  daysWorked: number;
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
    netPayable: number;
    quantity: number;
  };
}

export interface Settings {
  businessName: string;
  timezone: string;
  roundingStep: number;
  currency: string;
}

export interface Bootstrap {
  workers: Worker[];
  workTypes: WorkType[];
  rates: WorkerRate[];
  settings: Settings;
  today: ISODate;
}
