import type { RGB } from "pdf-lib";
import { formatCount, formatINR } from "@shared/money";
import {
  formatDayMonth,
  formatFullDate,
  formatWeekRange,
  parseISO,
  shortDayName,
} from "@shared/dates";
import type { ISODate } from "@shared/dates";
import type { WeekResult, WorkerWeekResult } from "@shared/types";
import {
  buildWeekGrid,
  formatCellCount,
  formatCellWage,
  type GridColumn,
} from "@/components/WeekGrid";
import { Canvas } from "./canvas";
import { drawTable, type Column, type Row } from "./table";
import { COLORS, PAGE, SPACE, TYPE, fromHex, tint } from "./theme";

/**
 * The week's wage sheet, as a real PDF.
 *
 * The document is built in the order it is used. The summary comes first,
 * because the person holding it is usually about to count out money and wants
 * one page with every figure on it. The per-worker records follow, one block
 * each, each self-contained enough to be torn off and handed over: the worker's
 * name, their week day by day, what was deducted or added, what they were paid,
 * and a line to sign.
 *
 * Nothing here recalculates anything. Every figure comes from WeekResult
 * exactly as the screen shows it, so a printed sheet and the app can never
 * disagree.
 */

export interface SheetOptions {
  week: WeekResult;
  businessName: string;
  /** Printed under the name on the cover. */
  businessAddress?: string;
  /** Order to print workers in — defaults to the order in `week.workers`. */
  workerOrder?: number[];
  /** Omit the day-by-day tables and print the cover and summary alone. */
  summaryOnly?: boolean;
  /** Dashboard figures, printed on the summary page when supplied. */
  stats?: SheetStats;
  generatedAt?: Date;
}

/**
 * The dashboard figures worth having on paper.
 *
 * A subset rather than the whole DashboardStats: the charts do not survive the
 * trip to print, but the numbers underneath them do, and those are what get
 * checked against a notebook.
 */
export interface SheetStats {
  lastWeekWage: number;
  lastWeekQuantity: number;
  /** Per towel type, over the printed week. */
  byType: Array<{ name: string; color: string; quantity: number; wage: number }>;
  /** Outstanding across everyone, all time. */
  balances: Array<{ workerName: string; creditOutstanding: number; debitOutstanding: number; advanceOutstanding: number }>;
}

/** How many worker records go on one page of the detail section. */
const WORKERS_PER_PAGE = 2;

export async function buildWeekSheet(options: SheetOptions): Promise<Uint8Array> {
  const canvas = await Canvas.create();
  const { week, businessName } = options;
  const workers = orderWorkers(week.workers, options.workerOrder);

  // 1. Cover.
  drawCover(canvas, options);

  // 2. Summary — every worker's pay on one page, with the week's figures.
  canvas.addPage();
  drawSummaryHead(canvas, week);
  drawTotalsStrip(canvas, week);
  drawSummary(canvas, week, workers);
  drawStats(canvas, week, options.stats);
  drawLegend(canvas, workers);

  // 3. One page per pair of workers.
  if (!options.summaryOnly) {
    workers.forEach((worker, index) => {
      if (index % WORKERS_PER_PAGE === 0) canvas.addPage();
      drawWorker(canvas, worker, week, index % WORKERS_PER_PAGE);
    });
  }

  const stamp = (options.generatedAt ?? new Date()).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  canvas.onEveryPage((c, page, total) => {
    // The cover carries no furniture; it is the title page.
    if (page === 1) return;
    const top = PAGE.height - SPACE.page.bottom + 14;
    c.hairline(top - 8, { color: COLORS.rule });
    c.text(`${businessName} · ${formatWeekRange(week.weekStart)}`, top, {
      size: TYPE.micro,
      color: COLORS.ink3,
    });
    c.text(`Generated ${stamp}`, top, {
      x: (c.left + c.right) / 2,
      align: "center",
      size: TYPE.micro,
      color: COLORS.ink4,
    });
    c.text(`${page} of ${total}`, top, {
      align: "right",
      size: TYPE.micro,
      color: COLORS.ink3,
    });
  });

  return canvas.save();
}

function orderWorkers(workers: WorkerWeekResult[], order?: number[]): WorkerWeekResult[] {
  if (!order?.length) return workers;
  const rank = new Map(order.map((id, index) => [id, index]));
  // Anyone missing from the order keeps their place at the end rather than
  // being dropped — the order is a preference, not a filter.
  return [...workers].sort(
    (a, b) =>
      (rank.get(a.workerId) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(b.workerId) ?? Number.MAX_SAFE_INTEGER),
  );
}

// -- cover ------------------------------------------------------------------

/**
 * The title page.
 *
 * A slip that gets filed wants a front the eye can identify from across a desk
 * or through a folder sleeve: whose business, what document, which week. The
 * dates are set large because they are the only thing that distinguishes one
 * sheet in the file from the next.
 */
function drawCover(canvas: Canvas, { week, businessName, businessAddress }: SheetOptions): void {
  const centre = (canvas.left + canvas.right) / 2;

  // A band across the head of the page, and a rule at the foot of the block,
  // so the identity reads as a letterhead rather than as loose text.
  canvas.rect(0, 0, PAGE.width, 150, { fill: COLORS.linen });
  canvas.rect(0, 150, PAGE.width, 2, { fill: COLORS.ink });

  let top = 56;
  canvas.text(businessName, top, {
    x: centre,
    align: "center",
    size: TYPE.cover,
    weight: "bold",
    maxWidth: canvas.width,
  });

  if (businessAddress) {
    top += canvas.lineHeight(TYPE.cover, 1.15);
    for (const line of canvas.wrap(businessAddress, canvas.width - 40, TYPE.body)) {
      canvas.text(line, top, {
        x: centre,
        align: "center",
        size: TYPE.body,
        color: COLORS.ink2,
      });
      top += canvas.lineHeight(TYPE.body, 1.4);
    }
  }

  // The document's own title, set apart in the white below the band.
  top = 232;
  canvas.text("WAGE SLIP", top, {
    x: centre,
    align: "center",
    size: TYPE.section,
    weight: "bold",
    color: COLORS.ink3,
    tracking: 4,
  });

  top += 34;
  canvas.hairline(top, {
    from: centre - 70,
    to: centre + 70,
    color: COLORS.ruleStrong,
    width: 0.8,
  });

  // The two dates, large. Which week the work was done, and when it was paid.
  top += 40;
  coverField(canvas, "WEEK", formatWeekRange(week.weekStart), top, centre);

  top += 96;
  coverField(canvas, "WAGE DAY", formatFullDate(week.weekEnd), top, centre);

  // Status last, small — it qualifies the sheet rather than naming it.
  const isFinal = week.status === "finalized";
  const label = isFinal ? "FINALIZED" : "DRAFT — NOT YET FINALIZED";
  const width = canvas.measure(label, TYPE.label, "bold") + 10;
  canvas.pill(label, centre - width / 2, PAGE.height - 150, {
    fill: isFinal ? COLORS.ink : tint(COLORS.negative, 0.82),
    color: isFinal ? COLORS.linen : COLORS.negative,
    size: TYPE.label,
  });

  canvas.text(
    `${week.workers.length} ${week.workers.length === 1 ? "worker" : "workers"}  ·  ${formatINR(
      week.totals.netPayable,
    )} paid out`,
    PAGE.height - 118,
    { x: centre, align: "center", size: TYPE.body, color: COLORS.ink2 },
  );
}

/** A labelled date on the cover: small caps above, the date large below. */
function coverField(
  canvas: Canvas,
  label: string,
  value: string,
  top: number,
  centre: number,
): void {
  canvas.text(label, top, {
    x: centre,
    align: "center",
    size: TYPE.label,
    weight: "bold",
    color: COLORS.ink3,
    tracking: 2,
  });
  canvas.text(value, top + 20, {
    x: centre,
    align: "center",
    size: TYPE.coverDate,
    weight: "bold",
    color: COLORS.ink,
    maxWidth: canvas.width,
  });
}

/** The summary page's own heading, since the masthead now lives on the cover. */
function drawSummaryHead(canvas: Canvas, week: WeekResult): void {
  const top = canvas.y;
  canvas.text("Week summary", top, { size: TYPE.title, weight: "bold" });
  canvas.text(
    `${formatWeekRange(week.weekStart)}  ·  Sunday to Saturday`,
    top + canvas.lineHeight(TYPE.title, 1.15),
    { size: TYPE.body, color: COLORS.ink2 },
  );
  canvas.y = top + canvas.lineHeight(TYPE.title, 1.15) + 22;
}

/** Four figures, side by side, that answer "what does this week come to?". */
function drawTotalsStrip(canvas: Canvas, week: WeekResult): void {
  const tiles: Array<[string, string]> = [
    ["Towels", formatCount(week.totals.quantity)],
    ["Wage earned", formatINR(week.totals.wage, { decimals: false })],
    ["Adjustments", signed(week.totals.netPayable - week.totals.wage)],
    ["Net paid out", formatINR(week.totals.netPayable, { decimals: false })],
  ];

  const height = 42;
  const gap = 8;
  const tileWidth = (canvas.width - gap * (tiles.length - 1)) / tiles.length;
  const top = canvas.y;

  tiles.forEach(([label, value], index) => {
    const x = canvas.left + index * (tileWidth + gap);
    const last = index === tiles.length - 1;
    canvas.rect(x, top, tileWidth, height, {
      fill: last ? COLORS.ink : COLORS.linen,
    });
    canvas.text(label.toUpperCase(), top + 8, {
      x: x + 10,
      size: TYPE.micro,
      weight: "bold",
      tracking: 0.5,
      color: last ? COLORS.ink4 : COLORS.ink3,
    });
    canvas.text(value, top + 19, {
      x: x + 10,
      size: TYPE.figure,
      weight: "bold",
      color: last ? COLORS.linen : COLORS.ink,
      maxWidth: tileWidth - 20,
    });
  });

  canvas.y = top + height + SPACE.block;
}

// -- summary ----------------------------------------------------------------

function drawSummary(canvas: Canvas, week: WeekResult, workers: WorkerWeekResult[]): void {
  const columns: Column[] = [
    { key: "n", header: "#", width: 22, align: "right", color: COLORS.ink4 },
    { key: "name", header: "Worker", flex: true, weight: "bold" },
    { key: "towels", header: "Towels", align: "right" },
    { key: "wage", header: "Wage", align: "right" },
    { key: "adj", header: "Adjustments", align: "right" },
    { key: "net", header: "Net paid", align: "right", weight: "bold" },
  ];

  const rows: Row[] = workers.map((worker, index) => {
    const grid = buildWeekGrid(worker, week.weekStart);
    const adjustment = worker.netPayable - worker.wage;
    return {
      cells: {
        n: String(index + 1),
        name: worker.workerName,
        towels: grid.totals.quantity ? formatCount(grid.totals.quantity) : "—",
        wage: formatINR(worker.wage),
        adj: adjustment === 0 ? "—" : signed(adjustment),
        net: formatINR(worker.netPayable),
      },
      colors: adjustment === 0 ? undefined : { adj: adjustment > 0 ? COLORS.positive : COLORS.negative },
    };
  });

  rows.push({
    emphasis: true,
    cells: {
      name: `Total · ${workers.length} ${workers.length === 1 ? "worker" : "workers"}`,
      towels: formatCount(week.totals.quantity),
      wage: formatINR(week.totals.wage),
      adj: signed(week.totals.netPayable - week.totals.wage),
      net: formatINR(week.totals.netPayable),
    },
  });

  drawTable(canvas, { columns, rows, continuedLabel: "Week summary, continued", bordered: true });
  canvas.y += SPACE.block;
}

/**
 * The dashboard's figures, on paper.
 *
 * The charts do not survive printing, but what they are drawn from does: how
 * this week compares with last, what came off which towel type, and who is
 * carrying a balance. Three short tables rather than three pictures.
 */
function drawStats(canvas: Canvas, week: WeekResult, stats?: SheetStats): void {
  if (!stats) return;

  const wageDelta = stats.lastWeekWage
    ? (week.totals.wage - stats.lastWeekWage) / stats.lastWeekWage
    : null;

  heading(canvas, "This week against last");

  drawTable(canvas, {
    bordered: true,
    columns: [
      { key: "metric", header: "Measure", flex: true },
      { key: "last", header: "Last week", align: "right" },
      { key: "this", header: "This week", align: "right", weight: "bold" },
      { key: "change", header: "Change", align: "right" },
    ],
    rows: [
      {
        cells: {
          metric: "Wages earned",
          last: formatINR(stats.lastWeekWage),
          this: formatINR(week.totals.wage),
          change: percent(wageDelta),
        },
        colors:
          wageDelta === null || wageDelta === 0
            ? undefined
            : { change: wageDelta > 0 ? COLORS.positive : COLORS.negative },
      },
      {
        cells: {
          metric: "Towels handled",
          last: stats.lastWeekQuantity ? formatCount(stats.lastWeekQuantity) : "—",
          this: week.totals.quantity ? formatCount(week.totals.quantity) : "—",
          change: percent(
            stats.lastWeekQuantity
              ? (week.totals.quantity - stats.lastWeekQuantity) / stats.lastWeekQuantity
              : null,
          ),
        },
      },
    ],
  });
  canvas.y += SPACE.block;

  if (stats.byType.length) {
    heading(canvas, "Output by towel type");
    drawTable(canvas, {
      bordered: true,
      continuedLabel: "Output by towel type, continued",
      columns: [
        { key: "swatch", header: "", width: 14 },
        { key: "name", header: "Towel type", flex: true, weight: "bold" },
        { key: "qty", header: "Towels", align: "right" },
        { key: "wage", header: "Wage", align: "right" },
        { key: "share", header: "Share of wage", align: "right" },
      ],
      rows: stats.byType.map((type) => ({
        cells: {
          swatch: "",
          name: type.name,
          qty: type.quantity ? formatCount(type.quantity) : "—",
          wage: formatINR(type.wage),
          share: week.totals.wage
            ? `${Math.round((type.wage / week.totals.wage) * 100)}%`
            : "—",
        },
        swatch: fromHex(type.color),
      })),
    });
    canvas.y += SPACE.block;
  }

  const owing = stats.balances.filter(
    (b) =>
      b.creditOutstanding > 0 || b.debitOutstanding > 0 || b.advanceOutstanding > 0,
  );

  if (owing.length) {
    heading(canvas, "Carried into next week");
    drawTable(canvas, {
      bordered: true,
      continuedLabel: "Carried into next week, continued",
      columns: [
        { key: "name", header: "Worker", flex: true, weight: "bold" },
        { key: "advance", header: "Advance owed", align: "right" },
        { key: "credit", header: "Owes you", align: "right" },
        { key: "debit", header: "You owe", align: "right" },
      ],
      rows: owing.map((balance) => ({
        cells: {
          name: balance.workerName,
          advance: balance.advanceOutstanding ? formatINR(balance.advanceOutstanding) : "—",
          credit: balance.creditOutstanding ? formatINR(balance.creditOutstanding) : "—",
          debit: balance.debitOutstanding ? formatINR(balance.debitOutstanding) : "—",
        },
        colors: {
          debit: COLORS.negative,
          advance: COLORS.negative,
          credit: COLORS.positive,
        },
      })),
    });
    canvas.y += SPACE.block;
  }
}

function percent(fraction: number | null): string {
  if (fraction === null) return "—";
  if (Math.abs(fraction) < 0.005) return "no change";
  return `${fraction > 0 ? "+" : "−"}${Math.abs(fraction * 100).toFixed(0)}%`;
}

/** The towel types in play this week, with the colours used on the sheet. */
function drawLegend(canvas: Canvas, workers: WorkerWeekResult[]): void {
  const types = new Map<number, { name: string; color: RGB }>();
  for (const worker of workers) {
    for (const item of worker.lineItems) {
      if (!types.has(item.workTypeId)) {
        types.set(item.workTypeId, { name: item.name, color: fromHex(item.color) });
      }
    }
  }
  if (types.size === 0) return;

  canvas.ensure(30);
  const top = canvas.y;
  let x = canvas.left;

  canvas.text("TOWEL TYPES", top + 1, {
    x,
    size: TYPE.micro,
    weight: "bold",
    tracking: 0.6,
    color: COLORS.ink3,
  });
  x += canvas.measure("TOWEL TYPES", TYPE.micro, "bold") + 6 * 0.6 + 12;

  for (const { name, color } of types.values()) {
    const width = canvas.measure(name, TYPE.label) + 16;
    if (x + width > canvas.right) break;
    canvas.dot(x + 3, top + 4.5, 3, color);
    canvas.text(name, top, { x: x + 9, size: TYPE.label, color: COLORS.ink2 });
    x += width;
  }

  canvas.y = top + 14 + SPACE.block;
}

// -- one worker -------------------------------------------------------------

/**
 * One worker's record.
 *
 * Two go on a page, so the second is placed against the page's half-way line
 * rather than flowing straight on from the first. Fixing the slot means every
 * sheet in the file has its records in the same two places, which is what makes
 * a stack of them quick to leaf through — and it stops a worker with three
 * towel types pushing the next one off the bottom.
 */
function drawWorker(
  canvas: Canvas,
  worker: WorkerWeekResult,
  week: WeekResult,
  slot: number,
): void {
  const usable = PAGE.height - SPACE.page.top - SPACE.page.bottom;
  const slotTop = SPACE.page.top + slot * (usable / WORKERS_PER_PAGE);

  if (slot > 0) {
    // A rule between the two records, so they never read as one long table.
    canvas.hairline(slotTop - 14, { color: COLORS.rule });
  }
  canvas.y = slotTop;

  const grid = buildWeekGrid(worker, week.weekStart);

  drawWorkerHead(canvas, worker, week);

  if (grid.columns.length === 0) {
    canvas.text("No work recorded this week.", canvas.y + 4, {
      size: TYPE.body,
      color: COLORS.ink3,
    });
    canvas.y += 20;
    drawWorkerTail(canvas, worker, grid.columns);
    return;
  }

  let from = 0;
  const chunks = chunkColumns(canvas, grid.columns);
  for (const chunk of chunks) {
    drawWorkerTable(canvas, worker, week.weekStart, chunk, {
      from,
      total: chunks.length,
      typeCount: grid.columns.length,
    });
    from += chunk.length;
    canvas.y += SPACE.tight;
  }

  canvas.y += SPACE.tight;
  drawWorkerTail(canvas, worker, grid.columns);
}

function drawWorkerHead(canvas: Canvas, worker: WorkerWeekResult, week: WeekResult): void {
  const top = canvas.y;

  canvas.rect(canvas.left, top, 2.5, 22, { fill: COLORS.ink });
  canvas.text(worker.workerName, top + 1, {
    x: canvas.left + 10,
    size: TYPE.worker,
    weight: "bold",
    maxWidth: canvas.width * 0.5,
  });

  canvas.text(formatWeekRange(week.weekStart), top + 12, {
    x: canvas.left + 10,
    size: TYPE.micro,
    color: COLORS.ink3,
  });

  canvas.text("NET PAID", top - 1, {
    align: "right",
    size: TYPE.micro,
    weight: "bold",
    tracking: 0.5,
    color: COLORS.ink3,
  });
  canvas.text(formatINR(worker.netPayable), top + 8, {
    align: "right",
    size: TYPE.figure,
    weight: "bold",
  });

  canvas.y = top + 28;
}

/**
 * Split the towel types across as many tables as it takes to fit the page.
 *
 * A worker on eight towel types would otherwise get sixteen columns squeezed
 * into 515 points, which reads as a grey smear. Better two honest tables than
 * one illegible one, so the columns are dealt into page-width chunks and each
 * chunk repeats the date column.
 */
function chunkColumns(canvas: Canvas, columns: GridColumn[]): GridColumn[][] {
  const available = canvas.width - DATE_WIDTH;
  const chunks: GridColumn[][] = [];
  let current: GridColumn[] = [];
  let used = 0;

  for (const column of columns) {
    const need = Math.max(
      canvas.measure(column.name, TYPE.label, "bold") + 12,
      MIN_PAIR_WIDTH,
    );
    if (current.length && used + need > available) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    current.push(column);
    used += need;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

const DATE_WIDTH = 82;
const MIN_PAIR_WIDTH = 104;

function drawWorkerTable(
  canvas: Canvas,
  worker: WorkerWeekResult,
  weekStart: ISODate,
  visible: GridColumn[],
  chunk: { from: number; total: number; typeCount: number },
): void {
  const grid = buildWeekGrid(worker, weekStart);

  // Which slice of the towel types this table covers, said before it is read
  // rather than after — "4 of 5" under a table is a correction, not a label.
  if (chunk.total > 1) {
    const range =
      visible.length === 1
        ? `Towel type ${chunk.from + 1}`
        : `Towel types ${chunk.from + 1}–${chunk.from + visible.length}`;
    canvas.text(`${range} of ${chunk.typeCount}`, canvas.y,
      { size: TYPE.micro, color: COLORS.ink3, tracking: 0.4 },
    );
    canvas.y += 11;
  }

  const columns: Column[] = [
    { key: "date", header: "Date", width: DATE_WIDTH, maxWidth: DATE_WIDTH },
  ];
  for (const column of visible) {
    columns.push({
      key: `q${column.workTypeId}`,
      header: "Towels",
      align: "right",
      flex: true,
      minWidth: 40,
      maxWidth: 82,
      groupStart: true,
      groupColor: fromHex(column.color),
      groupLabel: column.name,
      groupSpan: 2,
    });
    columns.push({
      key: `p${column.workTypeId}`,
      header: "Price",
      align: "right",
      flex: true,
      minWidth: 48,
      maxWidth: 92,
    });
  }

  const rows: Row[] = grid.rows.map((row) => {
    const cells: Record<string, string> = { date: printDate(row.date) };
    let worked = false;
    for (const column of visible) {
      const cell = row.cells.get(column.workTypeId);
      if (cell) worked = true;
      cells[`q${column.workTypeId}`] = formatCellCount(cell);
      cells[`p${column.workTypeId}`] = formatCellWage(cell, column.weeklyOnly);
    }
    return { cells, muted: !worked };
  });

  const totals: Record<string, string> = { date: "Total" };
  for (const column of visible) {
    totals[`q${column.workTypeId}`] =
      column.totalQuantity > 0 ? formatCount(column.totalQuantity) : "—";
    totals[`p${column.workTypeId}`] = formatINR(column.totalWage);
  }
  rows.push({ emphasis: true, cells: totals });

  drawTable(canvas, {
    columns,
    rows,
    bordered: true,
    continuedLabel: `${worker.workerName}, continued`,
    fontSize: visible.length > 3 ? TYPE.body - 0.5 : TYPE.body,
  });
}

/**
 * Measure the closing block without drawing it.
 *
 * Split out from the drawing because the page-break decision for a worker has
 * to be made before a single line is put down, and the settlement box is the
 * part whose height cannot be guessed — it grows a row per adjustment and the
 * notes beside it wrap.
 */
function tail(canvas: Canvas, worker: WorkerWeekResult, columns: GridColumn[]) {
  const lines = settlementLines(worker);
  const notes = noteLines(worker, columns);

  const boxWidth = 210;
  const notesWidth = canvas.width - boxWidth - 20;
  const lineHeight = canvas.lineHeight(TYPE.body, 1.5);
  const wrapped = notes.flatMap((note) => canvas.wrap(note, notesWidth, TYPE.label));

  return {
    lines,
    wrapped,
    boxWidth,
    notesWidth,
    lineHeight,
    height: Math.max(
      lines.length * lineHeight + 12,
      wrapped.length * canvas.lineHeight(TYPE.label, 1.45) + 4,
    ),
  };
}

/**
 * The closing block: what happened to the money.
 *
 * Notes sit left, the settlement figures right. The two are drawn as one block
 * with a shared height so the rule under them is straight whichever side runs
 * longer.
 */
function drawWorkerTail(canvas: Canvas, worker: WorkerWeekResult, columns: GridColumn[]): void {
  const { lines, wrapped, height, boxWidth, notesWidth, lineHeight } = tail(
    canvas,
    worker,
    columns,
  );

  const top = canvas.y;
  const boxX = canvas.right - boxWidth;

  canvas.rect(boxX, top, boxWidth, lines.length * lineHeight + 12, {
    fill: COLORS.linen,
    border: COLORS.ruleStrong,
    borderWidth: 0.7,
  });

  lines.forEach(({ label, value, strong, tone }, index) => {
    const y = top + 6 + index * lineHeight;
    if (strong) {
      canvas.hairline(y - 2, { from: boxX + 8, to: canvas.right - 8, color: COLORS.ruleStrong });
    }
    canvas.text(label, y, {
      x: boxX + 10,
      size: TYPE.body,
      weight: strong ? "bold" : "regular",
      color: strong ? COLORS.ink : COLORS.ink2,
    });
    canvas.text(value, y, {
      x: canvas.right - 10,
      align: "right",
      size: TYPE.body,
      weight: strong ? "bold" : "regular",
      color: tone ?? COLORS.ink,
    });
  });

  wrapped.forEach((line, index) => {
    canvas.text(line, top + index * canvas.lineHeight(TYPE.label, 1.45), {
      size: TYPE.label,
      color: COLORS.ink3,
      maxWidth: notesWidth,
    });
  });

  canvas.y = top + height + 8;
}

interface SettlementLine {
  label: string;
  value: string;
  strong?: boolean;
  tone?: RGB;
}

function settlementLines(worker: WorkerWeekResult): SettlementLine[] {
  const lines: SettlementLine[] = [{ label: "Wage", value: formatINR(worker.wage) }];
  const a = worker.adjustments;

  const add = (label: string, amount: number, direction: "+" | "−") => {
    if (amount <= 0) return;
    lines.push({
      label,
      value: `${direction}${formatINR(amount)}`,
      tone: direction === "+" ? COLORS.positive : COLORS.negative,
    });
  };

  add("Less advance", a.advanceRecovered, "−");
  add("Less earlier credit", a.deduct, "−");
  add("Plus balance repaid", a.addback, "+");
  add("Plus rounded up", a.credit, "+");
  add("Less held back", a.debit, "−");

  lines.push({ label: "Net paid", value: formatINR(worker.netPayable), strong: true });
  return lines;
}

function noteLines(worker: WorkerWeekResult, columns: GridColumn[]): string[] {
  const notes: string[] = [];

  const weekly = columns.filter((c) => c.weeklyOnly).map((c) => c.name);
  if (weekly.length) {
    notes.push(
      `${weekly.join(", ")} ${weekly.length === 1 ? "is" : "are"} paid on the week's total, so the daily prices are blank.`,
    );
  }

  if (worker.lineItems.some((item) => item.rateVaried)) {
    notes.push(
      "A rate changed during the week; each day is priced at the rate in force when it was recorded.",
    );
  }

  if (worker.advances.length) {
    notes.push(
      worker.advances
        .map(
          (advance) =>
            `${advance.kind === "advance" ? "Advance" : "Returned"} ${formatINR(advance.amount)} on ${formatDayMonth(advance.entryDate)}`,
        )
        .join(" · "),
    );
  }

  if (worker.manualWage !== null) notes.push("Old record: amount paid, entered from the notebook.");

  const closing = worker.closingBalance;
  if (closing.creditOutstanding > 0) {
    notes.push(`Carried forward: ${formatINR(closing.creditOutstanding)} owed back to you.`);
  }
  if (closing.debitOutstanding > 0) {
    notes.push(`Carried forward: ${formatINR(closing.debitOutstanding)} still owed to this worker.`);
  }
  if (closing.advanceOutstanding > 0) {
    notes.push(`Advance outstanding: ${formatINR(closing.advanceOutstanding)}.`);
  }

  if (worker.note) notes.push(worker.note);
  return notes;
}

// -- small helpers ----------------------------------------------------------

function heading(canvas: Canvas, title: string, description?: string): void {
  canvas.ensure(46);
  const top = canvas.y;
  canvas.text(title, top, { size: TYPE.section, weight: "bold" });
  if (description) {
    canvas.text(description, top + canvas.lineHeight(TYPE.section, 1.15), {
      size: TYPE.label,
      color: COLORS.ink3,
    });
    canvas.y = top + canvas.lineHeight(TYPE.section, 1.15) + 14;
  } else {
    canvas.y = top + canvas.lineHeight(TYPE.section, 1.6);
  }
}

/** "26 Jul Sun" — short enough for a narrow column, still unambiguous. */
function printDate(date: ISODate): string {
  const d = parseISO(date);
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${day} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })} ${shortDayName(date)}`;
}

function signed(paise: number): string {
  if (paise === 0) return formatINR(0);
  return `${paise > 0 ? "+" : "−"}${formatINR(Math.abs(paise))}`;
}
