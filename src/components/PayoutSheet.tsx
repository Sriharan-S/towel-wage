import { Fragment } from "react";
import { formatCount, formatINR } from "@shared/money";
import { formatWeekRange, longDayName, parseISO } from "@shared/dates";
import type { ISODate } from "@shared/dates";
import type { WeekResult, WorkerWeekResult } from "@shared/types";
import { buildWeekGrid, formatCellCount, formatCellWage } from "./WeekGrid";

/**
 * The printed week sheet.
 *
 * A record, not a receipt: one table per worker, days down the side and towel
 * types across the top, each type showing what was made and what it was worth.
 * A day run on more than one loom keeps its looms in brackets, so the sheet can
 * be checked line by line against the loom tallies rather than only in total.
 *
 * Screen-hidden, print-only.
 */
export function PayoutSheet({
  week,
  businessName,
}: {
  week: WeekResult;
  businessName: string;
}) {
  return (
    <div className="print-only" aria-hidden>
      <header style={S.header}>
        <div style={S.headerRow}>
          <h1 style={S.title}>{businessName}</h1>
          <span style={S.small}>
            {week.status === "finalized" ? "Finalized" : "Draft"}
          </span>
        </div>
        <p style={S.subtitle}>
          Wage sheet · {formatWeekRange(week.weekStart)} · Sunday to Saturday
        </p>
      </header>

      {week.workers.map((worker) => (
        <WorkerTable key={worker.workerId} worker={worker} weekStart={week.weekStart} />
      ))}

      <section style={S.summary} className="print-block">
        <h2 style={S.summaryTitle}>Week summary</h2>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={{ ...S.th, ...S.left }}>Worker</th>
              <th style={{ ...S.th, ...S.right }}>Towels</th>
              <th style={{ ...S.th, ...S.right }}>Wage</th>
              <th style={{ ...S.th, ...S.right }}>Adjustments</th>
              <th style={{ ...S.th, ...S.right }}>Net paid</th>
              <th style={{ ...S.th, ...S.left, width: "22%" }}>Signature</th>
            </tr>
          </thead>
          <tbody>
            {week.workers.map((worker) => {
              const grid = buildWeekGrid(worker, week.weekStart);
              const adjustment = worker.netPayable - worker.wage;
              return (
                <tr key={worker.workerId}>
                  <td style={{ ...S.td, ...S.left }}>{worker.workerName}</td>
                  <td style={{ ...S.td, ...S.right }}>
                    {formatCount(grid.totals.quantity)}
                  </td>
                  <td style={{ ...S.td, ...S.right }}>{formatINR(worker.wage)}</td>
                  <td style={{ ...S.td, ...S.right }}>
                    {adjustment === 0
                      ? "—"
                      : `${adjustment > 0 ? "+" : "−"}${formatINR(Math.abs(adjustment))}`}
                  </td>
                  <td style={{ ...S.td, ...S.right, fontWeight: 700 }}>
                    {formatINR(worker.netPayable)}
                  </td>
                  <td style={{ ...S.td, ...S.left }} />
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ ...S.tdTotal, ...S.left }}>
                Total · {week.workers.length} workers
              </td>
              <td style={{ ...S.tdTotal, ...S.right }}>
                {formatCount(week.totals.quantity)}
              </td>
              <td style={{ ...S.tdTotal, ...S.right }}>{formatINR(week.totals.wage)}</td>
              <td style={{ ...S.tdTotal, ...S.right }}>
                {formatINR(week.totals.netPayable - week.totals.wage)}
              </td>
              <td style={{ ...S.tdTotal, ...S.right }}>
                {formatINR(week.totals.netPayable)}
              </td>
              <td style={S.tdTotal} />
            </tr>
          </tfoot>
        </table>
      </section>
    </div>
  );
}

function WorkerTable({
  worker,
  weekStart,
}: {
  worker: WorkerWeekResult;
  weekStart: ISODate;
}) {
  const grid = buildWeekGrid(worker, weekStart);
  if (grid.columns.length === 0) return null;

  const adjustments = adjustmentLines(worker);

  return (
    <section style={S.workerBlock} className="print-block">
      <div style={S.workerHead}>
        <h2 style={S.workerName}>{worker.workerName}</h2>
        <span style={S.workerWage}>{formatINR(worker.netPayable)}</span>
      </div>

      <table style={S.table}>
        <thead>
          <tr>
            <th rowSpan={2} style={{ ...S.th, ...S.left, width: "22%" }}>
              Date
            </th>
            {grid.columns.map((column) => (
              <th key={column.workTypeId} colSpan={2} style={{ ...S.th, ...S.group }}>
                {column.name}
              </th>
            ))}
          </tr>
          <tr>
            {grid.columns.map((column) => (
              <Fragment key={column.workTypeId}>
                <th key={`${column.workTypeId}-q`} style={{ ...S.thSub, ...S.right }}>
                  Towels
                </th>
                <th key={`${column.workTypeId}-p`} style={{ ...S.thSub, ...S.right }}>
                  Price
                </th>
              </Fragment>
            ))}
          </tr>
        </thead>

        <tbody>
          {grid.rows.map((row) => (
            <tr key={row.date}>
              <td style={{ ...S.td, ...S.left }}>{printDate(row.date)}</td>
              {grid.columns.map((column) => {
                const cell = row.cells.get(column.workTypeId);
                return (
                  <Fragment key={column.workTypeId}>
                    <td key={`${column.workTypeId}-q`} style={{ ...S.td, ...S.right }}>
                      {formatCellCount(cell)}
                    </td>
                    <td key={`${column.workTypeId}-p`} style={{ ...S.td, ...S.right }}>
                      {formatCellWage(cell, column.weeklyOnly)}
                    </td>
                  </Fragment>
                );
              })}
            </tr>
          ))}
        </tbody>

        <tfoot>
          <tr>
            <td style={{ ...S.tdTotal, ...S.left }}>Total</td>
            {grid.columns.map((column) => (
              <Fragment key={column.workTypeId}>
                <td key={`${column.workTypeId}-q`} style={{ ...S.tdTotal, ...S.right }}>
                  {column.totalQuantity > 0 ? formatCount(column.totalQuantity) : "—"}
                </td>
                <td key={`${column.workTypeId}-p`} style={{ ...S.tdTotal, ...S.right }}>
                  {formatINR(column.totalWage)}
                </td>
              </Fragment>
            ))}
          </tr>
        </tfoot>
      </table>

      <div style={S.tail}>
        <div style={S.tailNotes}>
          {grid.columns.some((c) => c.weeklyOnly) && (
            <p style={S.note}>
              {grid.columns
                .filter((c) => c.weeklyOnly)
                .map((c) => c.name)
                .join(", ")}{" "}
              paid on the week's total, so daily prices are blank.
            </p>
          )}
          {worker.lineItems.some((i) => i.rateVaried) && (
            <p style={S.note}>
              A rate changed during the week; each day is priced at the rate in force when it
              was recorded.
            </p>
          )}
          {worker.advances.length > 0 && (
            <p style={S.note}>
              {worker.advances
                .map(
                  (a) =>
                    `${a.kind === "advance" ? "Advance" : "Returned"} ${formatINR(a.amount)} on ${printDate(a.entryDate)}`,
                )
                .join(" · ")}
            </p>
          )}
        </div>

        <table style={S.settleTable}>
          <tbody>
            <tr>
              <td style={S.settleLabel}>Wage</td>
              <td style={S.settleValue}>{formatINR(worker.wage)}</td>
            </tr>
            {adjustments.map((line) => (
              <tr key={line.label}>
                <td style={S.settleLabel}>{line.label}</td>
                <td style={S.settleValue}>{line.value}</td>
              </tr>
            ))}
            <tr>
              <td style={{ ...S.settleLabel, ...S.settleTotal }}>Net paid</td>
              <td style={{ ...S.settleValue, ...S.settleTotal }}>
                {formatINR(worker.netPayable)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p style={S.sign}>Received by ______________________ Date ____________</p>
    </section>
  );
}

/** "26/07/2026 Sunday" — the format asked for, day spelled out. */
function printDate(date: ISODate): string {
  const d = parseISO(date);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()} ${longDayName(date)}`;
}

function adjustmentLines(worker: WorkerWeekResult) {
  const lines: Array<{ label: string; value: string }> = [];
  const a = worker.adjustments;
  if (a.advanceRecovered > 0)
    lines.push({ label: "Less advance", value: `−${formatINR(a.advanceRecovered)}` });
  if (a.deduct > 0)
    lines.push({ label: "Less earlier credit", value: `−${formatINR(a.deduct)}` });
  if (a.addback > 0)
    lines.push({ label: "Plus balance repaid", value: `+${formatINR(a.addback)}` });
  if (a.credit > 0) lines.push({ label: "Plus rounded up", value: `+${formatINR(a.credit)}` });
  if (a.debit > 0) lines.push({ label: "Less held back", value: `−${formatINR(a.debit)}` });
  return lines;
}

/* Print styles are inline so nothing depends on the app's CSS surviving. */
const S: Record<string, React.CSSProperties> = {
  header: { borderBottom: "1.5pt solid #000", paddingBottom: "5pt", marginBottom: "10pt" },
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "baseline" },
  title: { fontSize: "14pt", fontWeight: 700, margin: 0, letterSpacing: "0.01em" },
  subtitle: { margin: "2pt 0 0", fontSize: "10pt" },
  small: { fontSize: "8.5pt", textTransform: "uppercase", letterSpacing: "0.06em" },

  workerBlock: { marginBottom: "14pt" },
  workerHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: "3pt",
  },
  workerName: { fontSize: "11.5pt", fontWeight: 700, margin: 0 },
  workerWage: { fontSize: "11.5pt", fontWeight: 700 },

  table: { width: "100%", borderCollapse: "collapse", fontSize: "9pt" },
  th: {
    borderTop: "0.75pt solid #000",
    borderBottom: "0.5pt solid #000",
    padding: "2.5pt 4pt",
    fontWeight: 700,
    fontSize: "8.5pt",
  },
  thSub: {
    borderBottom: "0.75pt solid #000",
    padding: "1.5pt 4pt",
    fontWeight: 400,
    fontSize: "7.5pt",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "#444",
  },
  group: { textAlign: "center", borderLeft: "0.5pt solid #999" },
  td: { borderBottom: "0.4pt solid #ccc", padding: "2.5pt 4pt" },
  tdTotal: {
    borderTop: "0.75pt solid #000",
    padding: "3pt 4pt",
    fontWeight: 700,
  },
  left: { textAlign: "left" },
  right: { textAlign: "right", fontVariantNumeric: "tabular-nums" },

  tail: { display: "flex", gap: "10pt", marginTop: "4pt", alignItems: "flex-start" },
  tailNotes: { flex: 1, fontSize: "7.5pt", color: "#333" },
  note: { margin: "0 0 1.5pt" },
  settleTable: { borderCollapse: "collapse", fontSize: "9pt", minWidth: "40%" },
  settleLabel: { padding: "1pt 8pt 1pt 0", textAlign: "left" },
  settleValue: { padding: "1pt 0", textAlign: "right", fontVariantNumeric: "tabular-nums" },
  settleTotal: { borderTop: "0.75pt solid #000", fontWeight: 700, paddingTop: "2.5pt" },

  sign: { margin: "8pt 0 0", fontSize: "8.5pt" },

  summary: { borderTop: "1.5pt solid #000", paddingTop: "6pt", marginTop: "4pt" },
  summaryTitle: { fontSize: "10.5pt", fontWeight: 700, margin: "0 0 3pt" },
};
