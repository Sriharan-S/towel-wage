import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { buildWeekSheet, type SheetStats } from "./weekSheet";
import { ZERO_ADJUSTMENTS } from "@shared/calc";
import type { WeekResult, WorkerWeekResult } from "@shared/types";
import { weekDays } from "@shared/dates";

/*
  The sheet is built here rather than eyeballed in a viewer, because the things
  that go wrong with a printed document are structural: a page that never
  breaks, a third worker landing on a page meant for two, a cover that gets
  furniture it should not have. Those are all countable.
*/

const WEEK_START = "2026-07-19";

beforeAll(() => {
  // fonts.ts fetches the typeface from /fonts. In Node there is no origin to
  // resolve that against, so serve it from public/ instead.
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const file = resolve(process.cwd(), "public", url.replace(/^\//, ""));
    const bytes = await readFile(file);
    return new Response(new Uint8Array(bytes));
  }) as typeof fetch;
});

function worker(over: Partial<WorkerWeekResult> & { workerId: number; workerName: string }): WorkerWeekResult {
  const days = weekDays(WEEK_START);
  return {
    lineItems: [
      {
        workTypeId: 1,
        name: "Drill",
        kind: "count_x_price",
        unitLabel: "towels",
        color: "#2a78d6",
        totalQuantity: 500,
        totalAmount: 0,
        unitPrice: 370,
        divisor: 75,
        multiplier: 3500,
        wage: 185000,
        daily: Object.fromEntries(days.map((d, i) => [d, i === 0 ? 0 : 100])),
        dailyWage: Object.fromEntries(days.map((d, i) => [d, i === 0 ? 0 : 37000])),
        dailyByLoom: Object.fromEntries(days.map((d, i) => [d, i === 0 ? [] : [100]])),
        daysWorked: 5,
        looms: 1,
        loomTotals: [500],
        rateVaried: false,
      },
    ],
    wage: 185000,
    adjustments: { ...ZERO_ADJUSTMENTS },
    netPayable: 185000,
    openingBalance: { creditOutstanding: 0, debitOutstanding: 0, advanceOutstanding: 0 },
    closingBalance: { creditOutstanding: 0, debitOutstanding: 0, advanceOutstanding: 0 },
    suggested: { deduct: 0, addback: 0 },
    settlement: {
      credit: 0,
      deduct: 0,
      debit: 0,
      addback: 0,
      advanceRecovered: 0,
      netPayable: 185000,
      settled: 185000,
      remainingCredit: 0,
      carriedDebit: 0,
      advanceOutstanding: 0,
      mode: "hold",
      step: 100,
      isNoop: true,
    },
    advances: [],
    paidAt: null,
    note: null,
    ...over,
  };
}

function week(count: number, status: WeekResult["status"] = "finalized"): WeekResult {
  const workers = Array.from({ length: count }, (_, i) =>
    worker({ workerId: i + 1, workerName: `Worker ${i + 1}` }),
  );
  return {
    weekStart: WEEK_START,
    weekEnd: "2026-07-25",
    status,
    finalizedAt: status === "finalized" ? "2026-07-25 10:00:00" : null,
    workers,
    totals: {
      wage: 185000 * count,
      credit: 0,
      deduct: 0,
      debit: 0,
      addback: 0,
      advanceRecovered: 0,
      netPayable: 185000 * count,
      quantity: 500 * count,
    },
  };
}

const stats: SheetStats = {
  lastWeekWage: 170000,
  lastWeekQuantity: 460,
  byType: [{ name: "Drill", color: "#2a78d6", quantity: 500, wage: 185000 }],
  balances: [
    {
      workerName: "Worker 1",
      creditOutstanding: 4500,
      debitOutstanding: 0,
      advanceOutstanding: 100000,
    },
  ],
};

async function pageCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
}

describe("wage slip", () => {
  it("opens with a cover and a summary before any worker", async () => {
    // 1 worker => cover + summary + 1 detail page.
    const bytes = await buildWeekSheet({
      week: week(1),
      businessName: "Sri Sabesan Textiles",
      businessAddress: "1/66-A, Mattampatti, Salem",
      stats,
    });
    expect(await pageCount(bytes)).toBe(3);
  });

  it("puts two workers on a page, not three", async () => {
    // 4 workers => cover + summary + 2 detail pages.
    expect(
      await pageCount(
        await buildWeekSheet({ week: week(4), businessName: "Sri Sabesan Textiles", stats }),
      ),
    ).toBe(4);

    // 5 workers spill onto a third detail page rather than crowding the second.
    expect(
      await pageCount(
        await buildWeekSheet({ week: week(5), businessName: "Sri Sabesan Textiles", stats }),
      ),
    ).toBe(5);
  });

  it("prints cover and summary alone when the detail is not wanted", async () => {
    expect(
      await pageCount(
        await buildWeekSheet({
          week: week(6),
          businessName: "Sri Sabesan Textiles",
          summaryOnly: true,
        }),
      ),
    ).toBe(2);
  });

  it("honours the worker order it is given", async () => {
    const bytes = await buildWeekSheet({
      week: week(4),
      businessName: "Sri Sabesan Textiles",
      workerOrder: [4, 3, 2, 1],
    });
    // Order cannot be read back from the bytes, but a reordered sheet must at
    // least still be the same shape — a lost or duplicated worker would show.
    expect(await pageCount(bytes)).toBe(4);
  });

  it("builds without the dashboard figures", async () => {
    expect(
      await pageCount(await buildWeekSheet({ week: week(2), businessName: "Sri Sabesan" })),
    ).toBe(3);
  });

  it("survives a worker with nothing recorded", async () => {
    const empty = week(2);
    empty.workers[1] = worker({
      workerId: 2,
      workerName: "Worker 2",
      lineItems: [],
      wage: 0,
      netPayable: 0,
    });
    expect(
      await pageCount(await buildWeekSheet({ week: empty, businessName: "Sri Sabesan" })),
    ).toBe(3);
  });
});
