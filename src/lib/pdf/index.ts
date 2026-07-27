import { formatWeekRange } from "@shared/dates";
import type { WeekResult } from "@shared/types";
import { buildWeekSheet, type SheetOptions } from "./weekSheet";

export { buildWeekSheet } from "./weekSheet";
export type { SheetOptions } from "./weekSheet";

/**
 * Where the PDF is built.
 *
 * In the browser, not in the Worker. The whole document is assembled from data
 * the page already holds, so a round trip would only add latency and put a
 * ~600KB font embed inside a Worker's CPU budget for no gain. Everything under
 * this folder is isomorphic all the same — pdf-lib and fontkit are pure JS with
 * no DOM or Node dependency — so if a server-rendered copy is ever wanted (an
 * emailed sheet, say), `buildWeekSheet` can be called from a route handler with
 * the font bytes read from the assets binding, unchanged.
 */

/** "Kandan Towels — wage sheet 20-26 Jul 2026.pdf" */
export function weekSheetFilename(week: WeekResult, businessName: string): string {
  const safe = businessName.replace(/[^\w\s-]/g, "").trim() || "Wage sheet";
  return `${safe} — wage sheet ${formatWeekRange(week.weekStart)}.pdf`.replace(/[/\\:*?"<>|]/g, "-");
}

/**
 * Build the sheet and hand it to the browser.
 *
 * A Blob URL rather than a data URL: a multi-page sheet with an embedded font
 * runs past the length some browsers accept in an href, and the object URL is
 * revoked on the next frame so nothing is held.
 */
export async function downloadWeekSheet(options: SheetOptions): Promise<void> {
  const bytes = await buildWeekSheet(options);
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = weekSheetFilename(options.week, options.businessName);
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Open the sheet in a new tab instead of saving it — for a quick look. */
export async function previewWeekSheet(options: SheetOptions): Promise<string> {
  const bytes = await buildWeekSheet(options);
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  return URL.createObjectURL(blob);
}
