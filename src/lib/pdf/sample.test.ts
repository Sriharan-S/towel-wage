/*
  Write a sample wage slip to disk so the layout can be looked at.

  Run with:  npx vitest run --config vitest.config.ts src/lib/pdf/preview.manual.ts
  It writes build/wage-slip-sample.pdf and asserts nothing beyond "it built" —
  the structural checks live in weekSheet.test.ts. This exists because page
  counts cannot tell you whether a table is beautiful or a column is squashed.
*/
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, it } from "vitest";
import { buildWeekSheet, type SheetStats } from "./weekSheet";
import { ZERO_ADJUSTMENTS } from "@shared/calc";
import type { WeekResult, WorkerWeekResult } from "@shared/types";
import { weekDays } from "@shared/dates";

const WEEK_START = "2026-07-19";
const days = weekDays(WEEK_START);

beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const file = resolve(process.cwd(), "public", String(input).replace(/^\//, ""));
    return new Response(new Uint8Array(await readFile(file)));
  }) as typeof fetch;
});

const TYPES = [
  { id: 1, name: "Drill", color: "#2a78d6", price: 370 },
  { id: 2, name: "x30", color: "#eb6834", price: 365 },
  { id: 3, name: "x27", color: "#1baf7a", price: 315 },
];

function lineItem(type: (typeof TYPES)[number], perDay: number, looms: number[]) {
  const quantity = perDay * 5;
  return {
    workTypeId: type.id,
    name: type.name,
    kind: "count_x_price" as const,
    unitLabel: "towels",
    color: type.color,
    totalQuantity: quantity,
    totalAmount: 0,
    unitPrice: type.price,
    divisor: 75,
    multiplier: 3500,
    wage: Math.round(quantity * type.price),
    daily: Object.fromEntries(days.map((d, i) => [d, i === 0 || i === 6 ? 0 : perDay])),
    dailyWage: Object.fromEntries(
      days.map((d, i) => [d, i === 0 || i === 6 ? 0 : Math.round(perDay * type.price)]),
    ),
    dailyByLoom: Object.fromEntries(
      days.map((d, i) => [d, i === 0 || i === 6 ? [] : looms]),
    ),
    daysWorked: 5,
    looms: looms.length,
    loomTotals: looms.map((v) => v * 5),
    rateVaried: false,
  };
}

function makeWorker(id: number, name: string, itemCount: number): WorkerWeekResult {
  const items = TYPES.slice(0, itemCount).map((type, i) =>
    lineItem(type, 80 + i * 17, i === 0 ? [50, 30] : [80 + i * 17]),
  );
  const wage = items.reduce((sum, item) => sum + item.wage, 0);
  const net = Math.floor(wage / 10000) * 10000;

  return {
    workerId: id,
    workerName: name,
    lineItems: items,
    wage,
    adjustments: { ...ZERO_ADJUSTMENTS, debit: wage - net },
    netPayable: net,
    manualWage: null,
    ignoredWage: 0,
    carriedAdvance: 0,
    openingBalance: { creditOutstanding: 0, debitOutstanding: 0, advanceOutstanding: 0 },
    closingBalance: {
      creditOutstanding: 0,
      debitOutstanding: wage - net,
      advanceOutstanding: id === 1 ? 100000 : 0,
    },
    suggested: { deduct: 0, addback: 0 },
    settlement: {
      credit: 0,
      deduct: 0,
      debit: wage - net,
      addback: 0,
      advanceRecovered: 0,
      netPayable: net,
      settled: wage,
      remainingCredit: 0,
      carriedDebit: wage - net,
      advanceOutstanding: 0,
      mode: "hold",
      step: 100,
      isNoop: true,
    },
    advances:
      id === 1
        ? [
            {
              id: 1,
              workerId: 1,
              entryDate: "2026-07-22",
              weekStart: WEEK_START,
              kind: "advance" as const,
              amount: 100000,
              note: "Hospital",
              createdAt: "2026-07-22 09:00:00",
            },
          ]
        : [],
    paidAt: null,
    note: null,
  };
}

it("writes a sample slip", async () => {
  const workers = [
    makeWorker(1, "Nallamuthu", 2),
    makeWorker(2, "Manikkam", 3),
    makeWorker(3, "Kannupaiyan", 2),
    makeWorker(4, "Seerangam", 1),
    makeWorker(5, "Nadesan", 3),
  ];

  const week: WeekResult = {
    weekStart: WEEK_START,
    weekEnd: "2026-07-25",
    status: "finalized",
    finalizedAt: "2026-07-25 18:00:00",
    workers,
    totals: {
      wage: workers.reduce((s, w) => s + w.wage, 0),
      credit: 0,
      deduct: 0,
      debit: workers.reduce((s, w) => s + w.adjustments.debit, 0),
      addback: 0,
      advanceRecovered: 0,
      netPayable: workers.reduce((s, w) => s + w.netPayable, 0),
      quantity: workers.reduce(
        (s, w) => s + w.lineItems.reduce((q, i) => q + i.totalQuantity, 0),
        0,
      ),
    },
  };

  const stats: SheetStats = {
    lastWeekWage: 620000,
    lastWeekQuantity: 1850,
    byType: TYPES.map((type) => ({
      name: type.name,
      color: type.color,
      quantity: 500,
      wage: 500 * type.price,
    })),
    balances: workers
      .filter((w) => w.closingBalance.debitOutstanding || w.closingBalance.advanceOutstanding)
      .map((w) => ({
        workerName: w.workerName,
        creditOutstanding: w.closingBalance.creditOutstanding,
        debitOutstanding: w.closingBalance.debitOutstanding,
        advanceOutstanding: w.closingBalance.advanceOutstanding,
      })),
  };

  const bytes = await buildWeekSheet({
    week,
    businessName: "Sri Sabesan Textiles",
    businessAddress:
      "1/66-A, Mattampatti, Erumaipatti (PO), Edappadi (TK), Salem (DT), Tamil Nadu - 637102",
    stats,
  });

  await mkdir("build", { recursive: true });
  await writeFile("build/wage-slip-sample.pdf", bytes);
  console.log(`wrote build/wage-slip-sample.pdf — ${(bytes.length / 1024).toFixed(0)}KB`);
});
