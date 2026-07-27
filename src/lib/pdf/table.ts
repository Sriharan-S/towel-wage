import type { RGB } from "pdf-lib";
import { Canvas, type Align, type Weight } from "./canvas";
import { COLORS, PAGE, SPACE, TYPE, inkOn, tint } from "./theme";

/**
 * The table.
 *
 * One renderer for every table on the sheet, because a payout sheet whose
 * tables each look slightly different is a payout sheet nobody trusts. It does
 * four things a hand-drawn table would get wrong:
 *
 *  - allocates column widths from measured content, not from guessed fractions,
 *    so a long towel-type name widens its own column instead of being clipped;
 *  - breaks across pages at a row boundary and repeats the header, with the
 *    header carrying a "continued" marker so a stray second page is never
 *    mistaken for a second table;
 *  - keeps at least two body rows with the header, since a header alone at the
 *    foot of a page is worse than a slightly shorter page;
 *  - draws rules only where they do work — under the header, above the totals,
 *    and between column groups. Row separation is carried by a tint.
 */

export interface Column {
  key: string;
  /** Header text. Use `\n` for a second header line. */
  header: string;
  align?: Align;
  /** Fixed width in points. Omit to size from content. */
  width?: number;
  /** Lower bound when sizing from content. */
  minWidth?: number;
  /**
   * Upper bound when taking a share of the leftover width.
   *
   * A table with two data columns should not stretch a number across half a
   * page just because the page is that wide; past a point the eye stops being
   * able to carry a figure back to its heading.
   */
  maxWidth?: number;
  /** Take any width left over after every other column is satisfied. */
  flex?: boolean;
  /** Rule under every body cell — a column meant to be written in by hand. */
  underline?: boolean;
  weight?: Weight;
  color?: RGB;
  /** Draws a group rule down the left edge of this column. */
  groupStart?: boolean;
  /** A colour band above the header — the towel type this column belongs to. */
  groupColor?: RGB;
  /** Header text spanning this column and the ones that follow it in the group. */
  groupLabel?: string;
  groupSpan?: number;
}

export type Row = {
  cells: Record<string, string>;
  /** Renders in the heavier weight with a rule above — the totals line. */
  emphasis?: boolean;
  /** Per-cell colour override. */
  colors?: Record<string, RGB>;
  muted?: boolean;
  /**
   * Fills the row's first column with this colour — the towel-type swatch.
   * Carried on the row rather than the cell because the colour identifies the
   * whole line, not one figure on it.
   */
  swatch?: RGB;
};

export interface TableOptions {
  columns: Column[];
  rows: Row[];
  /** Repeated above the header when the table breaks onto a new page. */
  continuedLabel?: string;
  /** Draw the pale tint on alternate rows. */
  zebra?: boolean;
  /**
   * Rule every cell, not just the structural lines.
   *
   * A screen can separate rows with a tint, but a printed sheet that will be
   * read across at arm's length, photocopied and filed wants a real grid — the
   * eye follows a ruled row across eight columns far more reliably than a band
   * of pale colour.
   */
  bordered?: boolean;
  fontSize?: number;
  x?: number;
  width?: number;
}

interface Resolved extends Column {
  x: number;
  w: number;
}

/** Give every column a width and an x, filling exactly `width`. */
function resolve(canvas: Canvas, options: TableOptions): Resolved[] {
  const x0 = options.x ?? canvas.left;
  const total = options.width ?? canvas.width;
  const size = options.fontSize ?? TYPE.body;
  const pad = SPACE.cellPad * 2;

  const intrinsic = options.columns.map((column) => {
    if (column.width !== undefined) return column.width;
    // Headers are set in tracked capitals, so they must be measured that way —
    // measuring the source string is how a heading ends up clipped to "TOW…".
    const header = Math.max(
      ...column.header
        .split("\n")
        .map(
          (line) =>
            canvas.measure(line.toUpperCase(), TYPE.label, "bold") +
            HEADER_TRACKING * line.length,
        ),
    );
    const body = options.rows.reduce((widest, row) => {
      const text = row.cells[column.key] ?? "";
      return Math.max(widest, canvas.measure(text, size, row.emphasis ? "bold" : "regular"));
    }, 0);
    return Math.max(header, body, column.minWidth ?? 0) + pad;
  });

  // Hand the slack to the flexible columns, in rounds, so a column that hits
  // its cap passes what it cannot use on to the others. If a round leaves slack
  // nobody will take, the table simply ends short of the right margin — a
  // narrow table is easier to read than a stretched one.
  const sum = intrinsic.reduce((a, b) => a + b, 0);
  let slack = total - sum;

  if (slack > 0) {
    let takers = options.columns
      .map((c, i) => (c.flex ? i : -1))
      .filter((i) => i >= 0);

    while (slack > 0.5 && takers.length) {
      const share = slack / takers.length;
      const next: number[] = [];
      for (const i of takers) {
        const cap = options.columns[i].maxWidth ?? Infinity;
        const room = cap - intrinsic[i];
        const taken = Math.min(share, room);
        intrinsic[i] += taken;
        slack -= taken;
        if (room > taken) next.push(i);
      }
      if (next.length === takers.length) break;
      takers = next;
    }
  } else if (slack < 0) {
    // Over-wide: give it back proportionally rather than clipping one column.
    const scale = total / sum;
    for (let i = 0; i < intrinsic.length; i++) intrinsic[i] *= scale;
  }

  let pen = x0;
  return options.columns.map((column, i) => {
    const resolved = { ...column, x: pen, w: intrinsic[i] };
    pen += intrinsic[i];
    return resolved;
  });
}

const GROUP_BAND = 2.6;
/** Letter spacing on the small-caps column headings. */
const HEADER_TRACKING = 0.35;

function headerHeight(canvas: Canvas, columns: Resolved[]): number {
  const lines = Math.max(...columns.map((c) => c.header.split("\n").length));
  const grouped = columns.some((c) => c.groupLabel);
  return (
    (grouped ? canvas.lineHeight(TYPE.label, 1.5) + GROUP_BAND : 0) +
    lines * canvas.lineHeight(TYPE.label, 1.35) +
    SPACE.rowPad
  );
}

function drawHeader(
  canvas: Canvas,
  columns: Resolved[],
  top: number,
  continued: string | null,
): number {
  const height = headerHeight(canvas, columns);
  const x0 = columns[0].x;
  const totalWidth = columns.reduce((sum, c) => sum + c.w, 0);

  canvas.rect(x0, top, totalWidth, height, { fill: COLORS.linen });

  let y = top + SPACE.rowPad / 2;

  /*
    The group row: a towel type's name set *in* its own colour rather than over
    a thin band above it. On a printed sheet the band was too slight to identify
    anything at arm's length; a filled cell is unmistakable, and the ink is
    chosen by luminance so it holds up whatever hue the type is set to.
  */
  if (columns.some((c) => c.groupLabel)) {
    const bandHeight = canvas.lineHeight(TYPE.label, 1.5) + GROUP_BAND;
    for (const column of columns) {
      if (!column.groupLabel) continue;
      const span = columns.slice(
        columns.indexOf(column),
        columns.indexOf(column) + (column.groupSpan ?? 1),
      );
      const width = span.reduce((sum, c) => sum + c.w, 0);
      const color = column.groupColor ?? COLORS.ink3;

      canvas.rect(column.x, top, width, bandHeight, { fill: color });
      canvas.text(column.groupLabel, top + bandHeight / 2 - TYPE.label * 0.62, {
        x: column.x + width / 2,
        align: "center",
        size: TYPE.label,
        weight: "bold",
        color: inkOn(color),
        maxWidth: width - 6,
      });
    }
    y += bandHeight;
  }

  for (const column of columns) {
    const lines = column.header.split("\n");
    lines.forEach((line, index) => {
      const align = column.align ?? "left";
      canvas.text(line.toUpperCase(), y + index * canvas.lineHeight(TYPE.label, 1.35), {
        x:
          align === "right"
            ? column.x + column.w - SPACE.cellPad
            : align === "center"
              ? column.x + column.w / 2
              : column.x + SPACE.cellPad,
        align,
        size: TYPE.label,
        weight: "bold",
        color: COLORS.ink2,
        tracking: HEADER_TRACKING,
        maxWidth: column.w - SPACE.cellPad * 2,
      });
    });
  }

  if (continued) {
    canvas.text(continued, top - canvas.lineHeight(TYPE.micro) - 1, {
      x: x0 + totalWidth,
      align: "right",
      size: TYPE.micro,
      color: COLORS.ink3,
      tracking: 0.3,
    });
  }

  canvas.hairline(top + height, { from: x0, to: x0 + totalWidth, color: COLORS.ruleStrong, width: 0.7 });
  return height;
}

/**
 * Draw the table, breaking pages as needed. Returns the cursor's new position.
 */
export function drawTable(canvas: Canvas, options: TableOptions): number {
  const columns = resolve(canvas, options);
  const size = options.fontSize ?? TYPE.body;
  const rowHeight = canvas.lineHeight(size) + SPACE.rowPad;
  const head = headerHeight(canvas, columns);
  const x0 = columns[0].x;
  const totalWidth = columns.reduce((sum, c) => sum + c.w, 0);

  // Never strand a header: it must arrive with at least two rows under it.
  canvas.ensure(head + rowHeight * Math.min(2, options.rows.length));

  let top = canvas.y;
  const headTop = top;
  top += drawHeader(canvas, columns, top, null);
  let bandStart = top;
  let gridTop = headTop;
  let index = 0;

  for (const row of options.rows) {
    if (top + rowHeight > PAGE.height - canvas.bottom) {
      drawGroupRules(canvas, columns, bandStart, top);
      if (options.bordered) drawGrid(canvas, columns, gridTop, top);
      canvas.y = top;
      canvas.addPage();
      top = canvas.y;
      gridTop = top;
      top += drawHeader(canvas, columns, top, options.continuedLabel ?? "Continued");
      bandStart = top;
    }

    if (row.emphasis) {
      canvas.hairline(top, { from: x0, to: x0 + totalWidth, color: COLORS.ruleStrong, width: 0.7 });
    } else if (options.zebra !== false && index % 2 === 1) {
      canvas.rect(x0, top, totalWidth, rowHeight, { fill: COLORS.zebra });
    }

    // A ruled row line, drawn under every row rather than relying on the tint.
    if (options.bordered && !row.emphasis) {
      canvas.hairline(top + rowHeight, {
        from: x0,
        to: x0 + totalWidth,
        color: COLORS.rule,
        width: 0.4,
      });
    }

    if (row.swatch) {
      const first = columns[0];
      canvas.rect(first.x + 3, top + 3, first.w - 6, rowHeight - 6, { fill: row.swatch });
    }

    for (const column of columns) {
      if (column.underline && !row.emphasis) {
        canvas.hairline(top + rowHeight - 3, {
          from: column.x + SPACE.cellPad,
          to: column.x + column.w - SPACE.cellPad,
          color: tint(COLORS.ruleStrong, 0.35),
        });
      }

      const text = row.cells[column.key];
      if (!text) continue;
      const align = column.align ?? "left";
      canvas.text(text, top + SPACE.rowPad / 2, {
        x:
          align === "right"
            ? column.x + column.w - SPACE.cellPad
            : align === "center"
              ? column.x + column.w / 2
              : column.x + SPACE.cellPad,
        align,
        size,
        weight: row.emphasis ? "bold" : (column.weight ?? "regular"),
        color:
          row.colors?.[column.key] ??
          (row.muted ? COLORS.ink3 : (column.color ?? COLORS.ink)),
        maxWidth: column.w - SPACE.cellPad * 2,
      });
    }

    top += rowHeight;
    index += 1;
  }

  drawGroupRules(canvas, columns, bandStart, top);
  if (options.bordered) drawGrid(canvas, columns, gridTop, top);
  canvas.hairline(top, { from: x0, to: x0 + totalWidth, color: COLORS.ruleStrong, width: 0.7 });

  canvas.y = top;
  return top;
}

/**
 * The full grid: an outer box and a rule down every column boundary.
 *
 * Drawn once per page-slice rather than per cell, so a fifty-row table is a
 * handful of lines instead of hundreds of overlapping strokes.
 */
function drawGrid(canvas: Canvas, columns: Resolved[], from: number, to: number): void {
  if (to <= from) return;
  const x0 = columns[0].x;
  const totalWidth = columns.reduce((sum, c) => sum + c.w, 0);

  canvas.rect(x0, from, totalWidth, to - from, {
    border: COLORS.ruleStrong,
    borderWidth: 0.7,
  });

  for (const column of columns) {
    if (column.x === x0) continue;
    canvas.vrule(column.x, from, to - from, COLORS.rule, 0.4);
  }
}

/** The faint verticals that keep one towel type's two columns together. */
function drawGroupRules(canvas: Canvas, columns: Resolved[], from: number, to: number): void {
  if (to <= from) return;
  for (const column of columns) {
    if (!column.groupStart || column.x === columns[0].x) continue;
    canvas.vrule(column.x, from, to - from, tint(COLORS.ruleStrong, 0.45), 0.5);
  }
}
