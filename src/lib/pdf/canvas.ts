import { PDFDocument } from "pdf-lib";
import type { PDFPage, RGB } from "pdf-lib";
import { COLORS, PAGE, SPACE, TYPE } from "./theme";
import { embedFonts, type DocFonts } from "./fonts";

/**
 * A small typesetting surface over pdf-lib.
 *
 * pdf-lib draws shapes at coordinates and nothing more: no flow, no page
 * breaks, no measuring. Everything above the raw drawing calls lives here, so
 * the sheet itself (weekSheet.ts) can be written as a sequence of blocks rather
 * than as arithmetic.
 *
 * Two conventions run through it:
 *
 *  - The cursor `y` is a *top* edge and moves downwards, because that is how
 *    the document reads. PDF's own origin is bottom-left, so every draw call
 *    flips at the last moment and nothing above this file has to think in
 *    upside-down coordinates.
 *
 *  - Blocks reserve their height before they draw (`ensure`), which is what
 *    keeps a worker's table from being orphaned two lines above a page break.
 */

export type Weight = "regular" | "bold";
export type Align = "left" | "right" | "center";

export interface TextOptions {
  x?: number;
  size?: number;
  weight?: Weight;
  color?: RGB;
  align?: Align;
  /** Truncate with an ellipsis past this width. */
  maxWidth?: number;
  /** Letter spacing, in points. Only worth it on small caps-style labels. */
  tracking?: number;
}

export class Canvas {
  readonly doc: PDFDocument;
  readonly fonts: DocFonts;
  readonly left = SPACE.page.left;
  readonly right = PAGE.width - SPACE.page.right;
  readonly width = PAGE.width - SPACE.page.left - SPACE.page.right;
  readonly bottom = SPACE.page.bottom;

  page!: PDFPage;
  /** Distance from the top of the page to the current baseline-to-be. */
  y = 0;

  private readonly pages: PDFPage[] = [];
  private footer: ((canvas: Canvas, page: number, total: number) => void) | null = null;

  private constructor(doc: PDFDocument, fonts: DocFonts) {
    this.doc = doc;
    this.fonts = fonts;
  }

  static async create(): Promise<Canvas> {
    const doc = await PDFDocument.create();
    const fonts = await embedFonts(doc);
    const canvas = new Canvas(doc, fonts);
    canvas.addPage();
    return canvas;
  }

  // -- pages ---------------------------------------------------------------

  /** Draw this on every page once the total page count is known. */
  onEveryPage(draw: (canvas: Canvas, page: number, total: number) => void): void {
    this.footer = draw;
  }

  addPage(): void {
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.pages.push(this.page);
    this.y = SPACE.page.top;
  }

  /** Space left between the cursor and the bottom margin. */
  get remaining(): number {
    return PAGE.height - this.bottom - this.y;
  }

  /** Start a new page unless `height` still fits. Returns true if it broke. */
  ensure(height: number): boolean {
    if (height <= this.remaining) return false;
    this.addPage();
    return true;
  }

  /** Convert a top-down y to pdf-lib's bottom-up y. */
  private flip(y: number): number {
    return PAGE.height - y;
  }

  // -- measuring -----------------------------------------------------------

  font(weight: Weight = "regular") {
    return weight === "bold" ? this.fonts.bold : this.fonts.regular;
  }

  measure(text: string, size: number = TYPE.body, weight: Weight = "regular"): number {
    return this.font(weight).widthOfTextAtSize(this.fonts.safe(text), size);
  }

  /** Cut a string to `maxWidth`, ending in an ellipsis when it had to. */
  fit(text: string, maxWidth: number, size: number, weight: Weight = "regular"): string {
    if (this.measure(text, size, weight) <= maxWidth) return text;
    let cut = text;
    while (cut.length > 1 && this.measure(`${cut}…`, size, weight) > maxWidth) {
      cut = cut.slice(0, -1);
    }
    return `${cut.trimEnd()}…`;
  }

  /** Break `text` into lines that each fit `maxWidth`. */
  wrap(text: string, maxWidth: number, size: number, weight: Weight = "regular"): string[] {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && this.measure(candidate, size, weight) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }

  // -- drawing -------------------------------------------------------------

  /**
   * Draw one line of text with its *top* at `top`.
   *
   * Positioning by cap height rather than baseline is what lets a row of mixed
   * sizes sit level: the caller aligns tops and the optical result is right,
   * which it would not be if each size hung off its own baseline.
   */
  text(text: string, top: number, options: TextOptions = {}): number {
    const {
      size = TYPE.body,
      weight = "regular",
      color = COLORS.ink,
      align = "left",
      maxWidth,
      tracking = 0,
      x = align === "right" ? this.right : this.left,
    } = options;

    let content = this.fonts.safe(text);
    if (maxWidth !== undefined) content = this.fit(content, maxWidth, size, weight);

    const font = this.font(weight);
    const width =
      font.widthOfTextAtSize(content, size) + tracking * Math.max(0, content.length - 1);
    const startX =
      align === "right" ? x - width : align === "center" ? x - width / 2 : x;
    // drawText places the baseline; sink it by the ascender to hang from the top.
    const baseline = this.flip(top + font.heightAtSize(size, { descender: false }));

    if (tracking === 0) {
      this.page.drawText(content, { x: startX, y: baseline, size, font, color });
    } else {
      // pdf-lib has no character-spacing option, so tracked text is set by hand.
      let pen = startX;
      for (const char of content) {
        this.page.drawText(char, { x: pen, y: baseline, size, font, color });
        pen += font.widthOfTextAtSize(char, size) + tracking;
      }
    }

    return width;
  }

  /** The height one line of `size` occupies, including its leading. */
  lineHeight(size: number = TYPE.body, leading = 1.35): number {
    return size * leading;
  }

  rect(
    x: number,
    top: number,
    width: number,
    height: number,
    options: { fill?: RGB; border?: RGB; borderWidth?: number } = {},
  ): void {
    this.page.drawRectangle({
      x,
      y: this.flip(top + height),
      width,
      height,
      ...(options.fill ? { color: options.fill } : {}),
      ...(options.border
        ? { borderColor: options.border, borderWidth: options.borderWidth ?? 0.5 }
        : {}),
    });
  }

  hairline(top: number, options: { from?: number; to?: number; color?: RGB; width?: number } = {}) {
    const { from = this.left, to = this.right, color = COLORS.rule, width = 0.5 } = options;
    this.page.drawLine({
      start: { x: from, y: this.flip(top) },
      end: { x: to, y: this.flip(top) },
      thickness: width,
      color,
    });
  }

  vrule(x: number, top: number, height: number, color: RGB = COLORS.rule, width = 0.5): void {
    this.page.drawLine({
      start: { x, y: this.flip(top) },
      end: { x, y: this.flip(top + height) },
      thickness: width,
      color,
    });
  }

  /** A small filled dot — the towel-type swatch. */
  dot(x: number, top: number, radius: number, color: RGB): void {
    this.page.drawCircle({ x, y: this.flip(top), size: radius, color });
  }

  /** A pill-shaped label: rounded ends drawn as a bar with two circles. */
  pill(
    text: string,
    x: number,
    top: number,
    options: { fill: RGB; color: RGB; size?: number } = {
      fill: COLORS.linen,
      color: COLORS.ink,
    },
  ): number {
    const size = options.size ?? TYPE.label;
    const padding = 5;
    const height = size + 6;
    const width = this.measure(text, size, "bold") + padding * 2;
    const radius = height / 2;

    this.page.drawRectangle({
      x: x + radius,
      y: this.flip(top + height),
      width: Math.max(0, width - height),
      height,
      color: options.fill,
    });
    this.dot(x + radius, top + radius, radius, options.fill);
    this.dot(x + width - radius, top + radius, radius, options.fill);
    this.text(text, top + 3.4, {
      x: x + padding,
      size,
      weight: "bold",
      color: options.color,
    });
    return width;
  }

  // -- output --------------------------------------------------------------

  async save(): Promise<Uint8Array> {
    if (this.footer) {
      const total = this.pages.length;
      const current = this.page;
      this.pages.forEach((page, index) => {
        this.page = page;
        this.footer!(this, index + 1, total);
      });
      this.page = current;
    }
    return this.doc.save();
  }
}
