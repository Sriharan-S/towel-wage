import { useEffect, useState } from "react";

/**
 * Chart palette.
 *
 * These eight hues are a validated categorical set: run
 *   node scripts/validate_palette.js "<light hexes>" --mode light --panel "#ffffff"
 *   node scripts/validate_palette.js "<dark hexes>"  --mode dark  --panel "#0f172a"
 * and both pass the lightness band, chroma floor, colour-vision-deficiency
 * separation and normal-vision floor against this app's actual surfaces.
 *
 * The order is the safety mechanism, not decoration — slots are assigned in
 * sequence and never cycled. Past eight series the tail folds into "Other".
 */
export interface PaletteSlot {
  light: string;
  dark: string;
}

export const CATEGORICAL: PaletteSlot[] = [
  { light: "#2a78d6", dark: "#3987e5" }, // blue
  { light: "#eb6834", dark: "#d95926" }, // orange
  { light: "#1baf7a", dark: "#199e70" }, // aqua
  { light: "#eda100", dark: "#c98500" }, // yellow
  { light: "#e87ba4", dark: "#d55181" }, // magenta
  { light: "#008300", dark: "#008300" }, // green
  { light: "#4a3aa7", dark: "#9085e9" }, // violet
  { light: "#e34948", dark: "#e66767" }, // red
];

/** Single-hue ramp for magnitude (the daily heatmap). Light to dark. */
export const SEQUENTIAL_LIGHT = [
  "#cde2fb",
  "#9ec5f4",
  "#6da7ec",
  "#3987e5",
  "#256abf",
  "#184f95",
];

export const SEQUENTIAL_DARK = [
  "#184f95",
  "#1c5cab",
  "#256abf",
  "#2a78d6",
  "#5598e7",
  "#86b6ef",
];

/** Warm/cool poles for the balances chart, with a neutral (not hued) middle. */
export const DIVERGING = {
  positive: { light: "#2a78d6", dark: "#3987e5" }, // they owe you
  negative: { light: "#e34948", dark: "#e66767" }, // you owe them
  neutral: { light: "#f0efec", dark: "#383835" },
};

export interface ChartTheme {
  isDark: boolean;
  panel: string;
  grid: string;
  axis: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  series: (index: number) => string;
  sequential: string[];
  diverging: { positive: string; negative: string; neutral: string };
  /** Resolve a stored work-type hex to the right step for the current mode. */
  resolve: (hex: string) => string;
}

/** Look up a stored light hex and return its dark counterpart, if it is ours. */
const DARK_BY_LIGHT = new Map(CATEGORICAL.map((s) => [s.light.toLowerCase(), s.dark]));

export function useChartTheme(): ChartTheme {
  const [isDark, setIsDark] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setIsDark(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return {
    isDark,
    panel: isDark ? "#0f172a" : "#ffffff",
    grid: isDark ? "#1e293b" : "#e2e8f0",
    axis: isDark ? "#334155" : "#cbd5e1",
    textPrimary: isDark ? "#f1f5f9" : "#0f172a",
    textSecondary: isDark ? "#cbd5e1" : "#475569",
    textMuted: isDark ? "#94a3b8" : "#64748b",
    // Slots are assigned in order and never cycled; a 9th series folds to "Other".
    series: (index: number) => {
      const slot = CATEGORICAL[index];
      return slot ? (isDark ? slot.dark : slot.light) : isDark ? "#64748b" : "#94a3b8";
    },
    sequential: isDark ? SEQUENTIAL_DARK : SEQUENTIAL_LIGHT,
    diverging: {
      positive: isDark ? DIVERGING.positive.dark : DIVERGING.positive.light,
      negative: isDark ? DIVERGING.negative.dark : DIVERGING.negative.light,
      neutral: isDark ? DIVERGING.neutral.dark : DIVERGING.neutral.light,
    },
    resolve: (hex: string) =>
      isDark ? (DARK_BY_LIGHT.get(hex.toLowerCase()) ?? hex) : hex,
  };
}

/**
 * Bucket a value onto the sequential ramp.
 * Zero returns null so "no work recorded" is drawn as an empty cell rather than
 * the palest blue — an absent day and a quiet day must not look the same.
 */
export function rampStep(value: number, max: number, steps: string[]): string | null {
  if (value <= 0 || max <= 0) return null;
  const index = Math.min(steps.length - 1, Math.floor((value / max) * steps.length));
  return steps[index];
}
