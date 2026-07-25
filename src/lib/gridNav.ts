import type { KeyboardEvent } from "react";

/**
 * Keyboard navigation across the daily entry grid.
 *
 * Entry happens every day and is almost entirely numeric, so the keyboard has
 * to behave like a spreadsheet: type a number, press Enter, land on the next
 * box. Cells are found by a data attribute in DOM order, which means looms,
 * towel types and workers are all traversed correctly without any of them
 * having to know about the others.
 */
export const ENTRY_CELL_ATTR = "data-entry-cell";

function cells(): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>(`[${ENTRY_CELL_ATTR}]`),
  ).filter((el) => !el.disabled);
}

function move(current: HTMLElement, delta: number) {
  const all = cells();
  const index = all.indexOf(current as HTMLInputElement);
  if (index === -1) return;

  const next = all[index + delta];
  if (!next) {
    // At the end of the grid, commit the last value rather than trapping focus.
    (current as HTMLInputElement).blur();
    return;
  }
  next.focus();
  next.select();
  // Keep the target clear of the sticky header and footer bars.
  next.scrollIntoView({ block: "center", behavior: "smooth" });
}

/**
 * Handler for every numeric cell.
 *
 *   Enter / ArrowDown        next cell
 *   Shift+Enter / ArrowUp    previous cell
 *   Escape                   finish editing
 *
 * Left and right arrows are left alone so they still move the caret inside a
 * number, which matters when correcting a typo.
 */
export function onEntryKeyDown(e: KeyboardEvent<HTMLInputElement>) {
  const el = e.currentTarget;

  if (e.key === "Enter") {
    e.preventDefault();
    move(el, e.shiftKey ? -1 : 1);
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    move(el, 1);
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    move(el, -1);
    return;
  }
  if (e.key === "Escape") {
    el.blur();
  }
}

/** Spread onto every numeric cell so the grid can find and traverse it. */
export const entryCellProps = {
  [ENTRY_CELL_ATTR]: "",
  onKeyDown: onEntryKeyDown,
} as const;
