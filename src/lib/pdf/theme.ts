import { rgb } from "pdf-lib";
import type { RGB } from "pdf-lib";

/**
 * The printed document's palette.
 *
 * Two families, kept deliberately apart:
 *
 *  - The *furniture* — rules, bands, labels, footers — is a warm neutral run,
 *    the colour of unbleached cotton. It is there to be read through, not
 *    looked at, and it stays the same on every sheet.
 *
 *  - The *towel types* keep their own colours, the same hues the app shows on
 *    screen, so a type is recognised by colour in both places. They appear only
 *    where they identify something: a column group, a swatch, a legend chip.
 *
 * Nothing else is coloured. On a mono laser printer the neutrals separate by
 * lightness alone, so the sheet still reads correctly with no colour at all.
 */

const hex = (value: string): RGB => {
  const clean = value.replace("#", "");
  return rgb(
    parseInt(clean.slice(0, 2), 16) / 255,
    parseInt(clean.slice(2, 4), 16) / 255,
    parseInt(clean.slice(4, 6), 16) / 255,
  );
};

export const COLORS = {
  /** Warm near-black. Slightly off true black so it sits with the neutrals. */
  ink: hex("#1c1a17"),
  ink2: hex("#57514a"),
  ink3: hex("#8b8279"),
  ink4: hex("#a9a096"),

  paper: hex("#ffffff"),
  /** Unbleached linen — table headers, the masthead band. */
  linen: hex("#f5f1ea"),
  linen2: hex("#ebe5db"),
  /** Every other body row, barely there. */
  zebra: hex("#faf8f4"),

  rule: hex("#ded7cb"),
  ruleStrong: hex("#b6ab9b"),

  /** Reserved for figures that mean money owed in the wrong direction. */
  negative: hex("#a33a2f"),
  positive: hex("#3f6b46"),
} as const;

/** Tint a colour towards paper. `amount` 0 = unchanged, 1 = white. */
export function tint(color: RGB, amount: number): RGB {
  const mix = (channel: number) => channel + (1 - channel) * amount;
  return rgb(mix(color.red), mix(color.green), mix(color.blue));
}

/** Darken a colour towards ink, for text that must sit on its own tint. */
export function shade(color: RGB, amount: number): RGB {
  return rgb(
    color.red * (1 - amount),
    color.green * (1 - amount),
    color.blue * (1 - amount),
  );
}

export function fromHex(value: string): RGB {
  return /^#?[0-9a-fA-F]{6}$/.test(value) ? hex(value) : COLORS.ink3;
}

/**
 * Paper-white or ink, whichever stays legible on a solid fill of `color`.
 *
 * Used where a towel type's own colour becomes a header band: a pale yellow
 * needs dark text and a deep indigo needs light, and picking by eye across
 * eight configurable hues is how a heading ends up unreadable on someone
 * else's setup.
 */
export function inkOn(color: RGB): RGB {
  const channel = (value: number) =>
    value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  const luminance =
    0.2126 * channel(color.red) + 0.7152 * channel(color.green) + 0.0722 * channel(color.blue);
  return luminance + 0.05 > Math.sqrt(0.05 * 1.05) ? COLORS.ink : COLORS.paper;
}

/**
 * The type scale, in points.
 *
 * A payout sheet is read across a table, so the scale is compressed: five
 * sizes, each clearly a step from the last, and no size used for two different
 * jobs. Hierarchy past that is carried by weight, colour and space.
 */
export const TYPE = {
  /** The business name on the cover, and the cover's dates. */
  cover: 24,
  coverDate: 21,
  title: 19,
  section: 12.5,
  worker: 12,
  figure: 11,
  body: 8.4,
  label: 7.2,
  micro: 6.6,
} as const;

/** Leading and gaps, in points. */
export const SPACE = {
  page: { top: 44, bottom: 46, left: 40, right: 40 },
  rowPad: 4.4,
  cellPad: 5,
  block: 16,
  tight: 5,
} as const;

/** A4 portrait. */
export const PAGE = { width: 595.28, height: 841.89 } as const;
