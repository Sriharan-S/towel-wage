import { formatCount, formatINR } from "@shared/money";
import { weekDays } from "@shared/dates";
import type { ISODate } from "@shared/dates";
import type { WorkerWeekResult } from "@shared/types";

/**
 * A worker's week as days down and towel types across.
 *
 * Each towel type gets a count column and a price column, so the sheet answers
 * both questions at once: how much was made, and what it was worth. A day run
 * on more than one loom shows the looms in brackets — "(10 + 15)" — because
 * that is how the figures are counted and checked, and collapsing them to 25
 * loses the ability to verify against a loom's own tally.
 */

export interface GridColumn {
  workTypeId: number;
  name: string;
  color: string;
  /** paid on the week's total, so its daily prices are blank by definition */
  weeklyOnly: boolean;
  totalQuantity: number;
  totalWage: number;
}

export interface GridCell {
  /** per loom, in loom order */
  looms: number[];
  quantity: number;
  wage: number;
}

export interface GridRow {
  date: ISODate;
  cells: Map<number, GridCell>;
  quantity: number;
  wage: number;
}

export interface WeekGrid {
  columns: GridColumn[];
  rows: GridRow[];
  totals: { quantity: number; wage: number };
}

/** Fold a worker's week into the day x towel-type shape above. */
export function buildWeekGrid(worker: WorkerWeekResult, weekStart: ISODate): WeekGrid {
  // Only types that actually saw work; an empty column is noise on a payslip.
  const columns: GridColumn[] = worker.lineItems
    .filter((item) => item.totalQuantity !== 0 || item.totalAmount !== 0 || item.wage !== 0)
    .map((item) => ({
      workTypeId: item.workTypeId,
      name: item.name,
      color: item.color,
      weeklyOnly: item.kind === "formula_sum_ratio",
      totalQuantity: item.kind === "direct_sum" ? 0 : item.totalQuantity,
      totalWage: item.wage,
    }));

  const rows: GridRow[] = weekDays(weekStart).map((date) => {
    const cells = new Map<number, GridCell>();
    let quantity = 0;
    let wage = 0;

    for (const item of worker.lineItems) {
      const looms = item.dailyByLoom[date] ?? [];
      const dayQuantity = item.kind === "direct_sum" ? 0 : (item.daily[date] ?? 0);
      const dayWage = item.dailyWage[date] ?? 0;
      if (looms.length === 0 && dayQuantity === 0 && dayWage === 0) continue;

      cells.set(item.workTypeId, { looms, quantity: dayQuantity, wage: dayWage });
      quantity += dayQuantity;
      wage += dayWage;
    }

    return { date, cells, quantity, wage };
  });

  return {
    columns,
    rows,
    totals: {
      quantity: columns.reduce((sum, c) => sum + c.totalQuantity, 0),
      wage: worker.wage,
    },
  };
}

/** "(10 + 15)" for two looms, "25" for one, "—" for nothing. */
export function formatCellCount(cell: GridCell | undefined): string {
  if (!cell) return "—";
  const worked = cell.looms.filter((v) => v !== 0);
  if (worked.length > 1) return `(${worked.map((v) => formatCount(v)).join(" + ")})`;
  if (cell.quantity === 0) return cell.wage !== 0 ? "—" : "—";
  return formatCount(cell.quantity);
}

export function formatCellWage(cell: GridCell | undefined, weeklyOnly: boolean): string {
  if (!cell) return "—";
  // A weekly ratio has no honest per-day price; it is paid on the week's total.
  if (weeklyOnly) return "—";
  return cell.wage !== 0 ? formatINR(cell.wage) : "—";
}
