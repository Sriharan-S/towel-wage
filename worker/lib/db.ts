/**
 * D1 row shapes and the mapping between them and the shared domain types.
 *
 * SQLite has no boolean, so `is_active` comes back as 0/1 and is converted at
 * this boundary. Keeping every conversion in one file means the rest of the
 * Worker only ever sees domain types.
 */

import type {
  Advance,
  AdvanceKind,
  Entry,
  RoundingMode,
  Settings,
  WeekAdjustmentRecord,
  WorkKind,
  WorkType,
  Worker,
  WorkerRate,
} from "@shared/types";
import { ROUNDING_MODES } from "@shared/types";
import { DEFAULT_TIMEZONE } from "@shared/dates";

export interface WorkTypeRow {
  id: number;
  name: string;
  kind: string;
  unit_label: string;
  default_unit_price: number;
  default_divisor: number;
  default_multiplier: number;
  color: string;
  is_active: number;
  sort_order: number;
}

export interface WorkerRow {
  id: number;
  name: string;
  phone: string | null;
  notes: string | null;
  is_active: number;
  sort_order: number;
}

export interface WorkerRateRow {
  id: number;
  worker_id: number;
  work_type_id: number;
  unit_price: number;
  divisor: number;
  multiplier: number;
  looms: number;
  is_active: number;
  sort_order: number;
}

export interface EntryRow {
  id: number;
  entry_date: string;
  week_start: string;
  worker_id: number;
  work_type_id: number;
  loom: number;
  kind: string;
  quantity: number;
  amount: number;
  unit_price: number;
  divisor: number;
  multiplier: number;
  note: string | null;
  updated_at: string;
}

export interface AdvanceRow {
  id: number;
  worker_id: number;
  entry_date: string;
  week_start: string;
  kind: string;
  amount: number;
  note: string | null;
  created_at: string;
}

export interface WeekAdjustmentRow {
  week_start: string;
  worker_id: number;
  credit: number;
  deduct: number;
  debit: number;
  addback: number;
  advance_recovered: number;
  wage: number | null;
  net_payable: number | null;
  paid_at: string | null;
  note: string | null;
}

export const toWorkType = (r: WorkTypeRow): WorkType => ({
  id: r.id,
  name: r.name,
  kind: r.kind as WorkKind,
  unitLabel: r.unit_label,
  defaultUnitPrice: r.default_unit_price,
  defaultDivisor: r.default_divisor,
  defaultMultiplier: r.default_multiplier,
  color: r.color,
  isActive: r.is_active === 1,
  sortOrder: r.sort_order,
});

export const toWorker = (r: WorkerRow): Worker => ({
  id: r.id,
  name: r.name,
  phone: r.phone,
  notes: r.notes,
  isActive: r.is_active === 1,
  sortOrder: r.sort_order,
});

export const toWorkerRate = (r: WorkerRateRow): WorkerRate => ({
  id: r.id,
  workerId: r.worker_id,
  workTypeId: r.work_type_id,
  unitPrice: r.unit_price,
  divisor: r.divisor,
  multiplier: r.multiplier,
  looms: Math.max(1, r.looms ?? 1),
  isActive: r.is_active === 1,
  sortOrder: r.sort_order,
});

export const toAdvance = (r: AdvanceRow): Advance => ({
  id: r.id,
  workerId: r.worker_id,
  entryDate: r.entry_date,
  weekStart: r.week_start,
  kind: r.kind as AdvanceKind,
  amount: r.amount,
  note: r.note,
  createdAt: r.created_at,
});

export const toEntry = (r: EntryRow): Entry => ({
  id: r.id,
  entryDate: r.entry_date,
  weekStart: r.week_start,
  workerId: r.worker_id,
  workTypeId: r.work_type_id,
  loom: Math.max(1, r.loom ?? 1),
  kind: r.kind as WorkKind,
  quantity: r.quantity,
  amount: r.amount,
  unitPrice: r.unit_price,
  divisor: r.divisor,
  multiplier: r.multiplier,
  note: r.note,
  updatedAt: r.updated_at,
});

export const toWeekAdjustment = (r: WeekAdjustmentRow): WeekAdjustmentRecord => ({
  weekStart: r.week_start,
  workerId: r.worker_id,
  credit: r.credit,
  deduct: r.deduct,
  debit: r.debit,
  addback: r.addback,
  advanceRecovered: r.advance_recovered ?? 0,
  wage: r.wage,
  netPayable: r.net_payable,
  paidAt: r.paid_at,
  note: r.note,
});

export const DEFAULT_SETTINGS: Settings = {
  businessName: "Towel Wage",
  timezone: DEFAULT_TIMEZONE,
  roundingStep: 100,
  roundingMode: "hold",
  currency: "INR",
};

export function toSettings(rows: Array<{ key: string; value: string }>): Settings {
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const step = Number(map.get("rounding_step"));
  const mode = map.get("rounding_mode");
  return {
    businessName: map.get("business_name") ?? DEFAULT_SETTINGS.businessName,
    timezone: map.get("timezone") ?? DEFAULT_SETTINGS.timezone,
    roundingStep: Number.isFinite(step) && step > 0 ? step : DEFAULT_SETTINGS.roundingStep,
    roundingMode: ROUNDING_MODES.includes(mode as RoundingMode)
      ? (mode as RoundingMode)
      : DEFAULT_SETTINGS.roundingMode,
    currency: map.get("currency") ?? DEFAULT_SETTINGS.currency,
  };
}

/** Read the whole settings table into a Settings object. */
export async function loadSettings(db: D1Database): Promise<Settings> {
  const { results } = await db
    .prepare("SELECT key, value FROM settings")
    .all<{ key: string; value: string }>();
  return toSettings(results);
}

/** Next sort_order for a table, so new rows land at the end of the list. */
export async function nextSortOrder(db: D1Database, table: "workers" | "work_types") {
  const row = await db
    .prepare(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM ${table}`)
    .first<{ next: number }>();
  return row?.next ?? 1;
}
