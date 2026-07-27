import fontkit from "@pdf-lib/fontkit";
import type { PDFDocument, PDFFont } from "pdf-lib";

/**
 * The document's typeface.
 *
 * Noto Sans, in two weights, shipped as static TTFs from /public/fonts.
 *
 * Why not one of the PDF standard fonts (Helvetica and friends)? They are
 * encoded WinAnsi, which has no rupee sign. Every figure on this sheet is a
 * rupee figure, so "Rs." everywhere or an embedded font were the only choices.
 * Noto Sans also gives us uniform digit widths, which is what makes a column of
 * money line up on the decimal without any tracking tricks.
 *
 * The files are ~620KB each, so they are fetched only when a PDF is actually
 * asked for — never on app start — and then held for the session. pdf-lib
 * subsets them on embed, so the PDF itself carries only the glyphs it uses,
 * usually 15-25KB.
 */

export interface DocFonts {
  regular: PDFFont;
  bold: PDFFont;
  /** Replace code points the typeface cannot draw, so embedding never throws. */
  safe: (text: string) => string;
}

const SOURCES = {
  regular: "/fonts/NotoSans-Regular.ttf",
  bold: "/fonts/NotoSans-SemiBold.ttf",
} as const;

let cache: Promise<{ regular: ArrayBuffer; bold: ArrayBuffer; supports: Set<number> }> | null =
  null;

async function load() {
  if (!cache) {
    cache = (async () => {
      const [regular, bold] = await Promise.all(
        [SOURCES.regular, SOURCES.bold].map(async (url) => {
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`Could not load the PDF typeface (${url}).`);
          }
          return response.arrayBuffer();
        }),
      );
      return { regular, bold, supports: supportedCodePoints(regular) };
    })();
    // A failed fetch must not poison the cache — let the next attempt retry.
    cache.catch(() => {
      cache = null;
    });
  }
  return cache;
}

/**
 * The set of code points the regular weight can actually draw.
 *
 * Read once from the font's own character map rather than assumed, because the
 * consequence of guessing wrong is not a missing glyph but a thrown error
 * halfway through building the document. A worker's name typed in Tamil script
 * is the realistic case.
 */
function supportedCodePoints(bytes: ArrayBuffer): Set<number> {
  const font = fontkit.create(new Uint8Array(bytes) as never) as {
    characterSet?: number[];
  };
  return new Set(font.characterSet ?? []);
}

export async function embedFonts(doc: PDFDocument): Promise<DocFonts> {
  const { regular, bold, supports } = await load();
  doc.registerFontkit(fontkit);

  const [regularFont, boldFont] = await Promise.all([
    doc.embedFont(regular, { subset: true }),
    doc.embedFont(bold, { subset: true }),
  ]);

  return {
    regular: regularFont,
    bold: boldFont,
    safe: (text: string) => {
      let out = "";
      for (const char of text) {
        const code = char.codePointAt(0)!;
        // Newlines are handled by the layout, never passed to drawText.
        out += supports.has(code) || code === 10 ? char : "·";
      }
      return out;
    },
  };
}
