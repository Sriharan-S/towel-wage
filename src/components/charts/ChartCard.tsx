import { useState, type ReactNode } from "react";
import { BarChart3, Table2 } from "lucide-react";
import { Panel, cx } from "@/components/ui";

/**
 * Wrapper for every chart on the dashboard.
 *
 * Each chart ships a table view alongside it. Tooltips enhance a chart, they
 * must never be the only way to read a value — and three of the light-mode
 * palette slots sit below 3:1 against the panel, which obliges visible labels
 * or a table. The toggle is that relief.
 */
export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  children,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  legend?: ReactNode;
  table: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [showTable, setShowTable] = useState(false);

  return (
    <Panel className={cx("overflow-hidden", className)}>
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs ink-2">{subtitle}</p>}
        </div>
        <button
          onClick={() => setShowTable((v) => !v)}
          className="shrink-0 rounded-lg p-1.5 transition hover:bg-black/5 dark:hover:bg-white/10"
          style={{ color: "var(--ink-2)" }}
          aria-label={showTable ? "Show chart" : "Show data table"}
          title={showTable ? "Show chart" : "Show data table"}
        >
          {showTable ? <BarChart3 size={16} /> : <Table2 size={16} />}
        </button>
      </div>

      {legend && !showTable && <div className="px-4 pt-3">{legend}</div>}

      <div className="px-1 pb-3 pt-2">
        {showTable ? <div className="px-3">{table}</div> : children}
      </div>
    </Panel>
  );
}

/**
 * Identity channel for two or more series. Always present — a reader must never
 * have to match colours by eye alone.
 */
export function Legend({
  items,
}: {
  items: Array<{ label: string; color: string; value?: string }>;
}) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-xs">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
            style={{ background: item.color }}
            aria-hidden
          />
          {/* Text wears text tokens, never the series colour — the swatch
              beside it carries identity. */}
          <span style={{ color: "var(--ink-secondary, var(--ink-2))" }}>
            {item.label}
          </span>
          {item.value && <span className="tnum font-medium">{item.value}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Compact data table used as every chart's table view. */
export function DataTable({
  columns,
  rows,
  align = [],
}: {
  columns: string[];
  rows: Array<Array<ReactNode>>;
  align?: Array<"left" | "right">;
}) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm ink-2">No data yet.</p>;
  }
  return (
    <div className="max-h-72 overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0" style={{ background: "var(--panel)" }}>
          <tr>
            {columns.map((column, i) => (
              <th
                key={column}
                scope="col"
                className={cx(
                  "border-b py-1.5 text-xs font-medium",
                  align[i] === "right" ? "text-right" : "text-left",
                )}
                style={{ color: "var(--ink-2)" }}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={cx(
                    "border-b py-1.5",
                    align[j] === "right" ? "tnum text-right" : "text-left",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Shared tooltip shell so every chart's hover layer looks the same. */
export function TooltipBox({
  title,
  rows,
  footer,
}: {
  title: string;
  rows: Array<{ label: string; value: string; color?: string }>;
  footer?: string;
}) {
  return (
    <div
      className="rounded-xl border px-3 py-2 text-xs shadow-lg"
      style={{ background: "var(--panel)", borderColor: "var(--line-strong)" }}
    >
      <p className="font-semibold">{title}</p>
      <div className="mt-1 space-y-0.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2">
            {row.color && (
              <span
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{ background: row.color }}
              />
            )}
            <span className="ink-2">{row.label}</span>
            <span className="tnum ml-auto font-medium">{row.value}</span>
          </div>
        ))}
      </div>
      {footer && <p className="mt-1 ink-2">{footer}</p>}
    </div>
  );
}
