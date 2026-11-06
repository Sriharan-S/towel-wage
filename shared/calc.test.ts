import { bonusAmount, carriedAdvance, isEmployedOn } from "./calc";
import { describe, expect, it } from "vitest";
import {
  advanceDelta,
  applyToBalance,
  balanceBefore,
  buildLineItems,
  computeRounding,
  computeTargetPayment,
  lineItemWage,
  netBalance,
  netPayable,
  roundPayable,
  suggestFromBalance,
  suggestSettlement,
  sumLineItemWages,
  ZERO_ADJUSTMENTS,
  ZERO_BALANCE,
} from "./calc";
import { formatINR, parseRupeeInput, roundPaiseTo, toPaise } from "./money";
import {
  addDays,
  formatTimeIn,
  formatWeekRange,
  todayISO,
  weekDays,
  weekEndOf,
  weekStartOf,
} from "./dates";
import type { Balance, Entry, WorkType, WorkerRate } from "./types";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const WEEK = "2026-07-19"; // a Sunday

/** A Balance carrying only the fields a given test cares about. */
function balanceOf(over: Partial<Balance> = {}): Balance {
  return { ...ZERO_BALANCE, ...over };
}

/** A week's adjustment row for the balance-history helpers. */
function adj(over: Partial<typeof ZERO_ADJUSTMENTS> & { weekStart: string }) {
  return { ...ZERO_ADJUSTMENTS, ...over };
}

function workType(over: Partial<WorkType> & Pick<WorkType, "id" | "name" | "kind">): WorkType {
  return {
    unitLabel: "towels",
    defaultUnitPrice: 0,
    defaultDivisor: 75,
    defaultMultiplier: 3500,
    color: "#000",
    isActive: true,
    sortOrder: 0,
    ...over,
  };
}

function rate(over: Partial<WorkerRate> & Pick<WorkerRate, "workTypeId">): WorkerRate {
  return {
    id: over.workTypeId,
    workerId: 1,
    unitPrice: 0,
    divisor: 75,
    multiplier: 3500,
    looms: 1,
    isActive: true,
    sortOrder: 0,
    ...over,
  };
}

function entry(over: Partial<Entry> & Pick<Entry, "entryDate" | "workTypeId" | "kind">): Entry {
  return {
    id: Math.random(),
    weekStart: weekStartOf(over.entryDate),
    workerId: 1,
    loom: 1,
    quantity: 0,
    amount: 0,
    unitPrice: 0,
    divisor: 75,
    multiplier: 3500,
    note: null,
    updatedAt: "2026-07-20 09:00:00",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// money
// ---------------------------------------------------------------------------

describe("money", () => {
  it("converts rupees to paise without float drift", () => {
    expect(toPaise(3.7)).toBe(370);
    expect(toPaise(3.65)).toBe(365);
    expect(toPaise(2.3)).toBe(230);
    expect(toPaise(1980)).toBe(198000);
  });

  it("survives repeated accumulation exactly", () => {
    // The float version of this (0.1 + 0.2 style) drifts; paise must not.
    let total = 0;
    for (let i = 0; i < 1000; i++) total += toPaise(3.7);
    expect(total).toBe(370000);
    expect(formatINR(total)).toBe("₹3,700.00");
  });

  it("parses messy rupee input", () => {
    expect(parseRupeeInput("₹1,980.50")).toBe(198050);
    expect(parseRupeeInput("")).toBe(0);
    expect(parseRupeeInput("20")).toBe(2000);
  });

  it("rounds to a step in the requested direction", () => {
    expect(roundPaiseTo(198000, 100, "up")).toBe(200000);
    expect(roundPaiseTo(201000, 100, "down")).toBe(200000);
    expect(roundPaiseTo(200000, 100, "up")).toBe(200000);
  });

  it("leaves an amount alone when it already sits on the step", () => {
    // ₹1,980 is already a multiple of ₹10, so a ₹10 step is a no-op. Only a
    // ₹100 step moves it to ₹2,000.
    expect(roundPaiseTo(198000, 10, "up")).toBe(198000);
    expect(roundPaiseTo(198000, 50, "up")).toBe(200000);
  });
});

// ---------------------------------------------------------------------------
// dates — Sunday-to-Saturday pay weeks, in the business timezone
// ---------------------------------------------------------------------------

describe("dates", () => {
  it("anchors weeks on Sunday", () => {
    expect(weekStartOf("2026-07-19")).toBe("2026-07-19"); // Sunday itself
    expect(weekStartOf("2026-07-22")).toBe("2026-07-19"); // Wednesday
    expect(weekStartOf("2026-07-25")).toBe("2026-07-19"); // Saturday
    expect(weekStartOf("2026-07-26")).toBe("2026-07-26"); // next Sunday
    expect(weekEndOf("2026-07-19")).toBe("2026-07-25");
    expect(weekDays("2026-07-19")).toHaveLength(7);
  });

  it("uses the business timezone, not UTC, to decide 'today'", () => {
    // 00:30 IST on 20 Jul is still 19:00 UTC on 19 Jul. A UTC-based app would
    // file this entry under the wrong day — and, on a Sunday, the wrong week.
    const lateNightIST = new Date("2026-07-19T19:00:00Z");
    expect(todayISO("Asia/Kolkata", lateNightIST)).toBe("2026-07-20");
    expect(todayISO("UTC", lateNightIST)).toBe("2026-07-19");
  });

  it("reads a stored timestamp as UTC, not as local time", () => {
    // SQLite's datetime('now') has no zone marker. Without adding the Z back,
    // the browser would treat it as local and show a figure hours out.
    expect(formatTimeIn("2026-07-25 13:12:19", "Asia/Kolkata")).toBe("18:42");
    expect(formatTimeIn("2026-07-25 13:12:19", "UTC")).toBe("13:12");
    // An ISO string that already carries a zone is left alone.
    expect(formatTimeIn("2026-07-25T13:12:19Z", "Asia/Kolkata")).toBe("18:42");
  });

  it("crosses month and year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekStartOf("2027-01-01")).toBe("2026-12-27");
    expect(formatWeekRange("2026-07-19")).toBe("19–25 Jul 2026");
  });
});

// ---------------------------------------------------------------------------
// line item wages — the three kinds
// ---------------------------------------------------------------------------

describe("lineItemWage", () => {
  it("multiplies count by price", () => {
    // Nallamuthu: 500 Drill towels at ₹3.70
    expect(
      lineItemWage({
        kind: "count_x_price",
        totalQuantity: 500,
        totalAmount: 0,
        unitPrice: 370,
        divisor: 75,
        multiplier: 3500,
      }),
    ).toBe(185000); // ₹1,850.00
  });

  it("sums direct amounts", () => {
    // Seerangam's Paavu: daily rupee amounts added up
    expect(
      lineItemWage({
        kind: "direct_sum",
        totalQuantity: 0,
        totalAmount: 120000,
        unitPrice: 0,
        divisor: 75,
        multiplier: 3500,
      }),
    ).toBe(120000);
  });

  it("applies the Kurai Cone ratio to the week's total, not per day", () => {
    // 150 cones over the week => (150 / 75) x ₹35 = ₹70.00
    expect(
      lineItemWage({
        kind: "formula_sum_ratio",
        totalQuantity: 150,
        totalAmount: 0,
        unitPrice: 0,
        divisor: 75,
        multiplier: 3500,
      }),
    ).toBe(7000);
  });

  it("handles a partial ratio week", () => {
    // 100 cones => (100 / 75) x ₹35 = ₹46.666… -> ₹46.67
    expect(
      lineItemWage({
        kind: "formula_sum_ratio",
        totalQuantity: 100,
        totalAmount: 0,
        unitPrice: 0,
        divisor: 75,
        multiplier: 3500,
      }),
    ).toBe(4667);
  });

  it("treats a zero divisor as unconfigured rather than dividing by zero", () => {
    expect(
      lineItemWage({
        kind: "formula_sum_ratio",
        totalQuantity: 150,
        totalAmount: 0,
        unitPrice: 0,
        divisor: 0,
        multiplier: 3500,
      }),
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// weekly rollup
// ---------------------------------------------------------------------------

describe("buildLineItems", () => {
  const types = new Map<number, WorkType>([
    [1, workType({ id: 1, name: "Drill", kind: "count_x_price", defaultUnitPrice: 370 })],
    [2, workType({ id: 2, name: "x30", kind: "count_x_price", defaultUnitPrice: 365 })],
    [3, workType({ id: 3, name: "Kurai Cone", kind: "formula_sum_ratio" })],
  ]);

  it("rolls a week of daily counts into per-type wages", () => {
    const rates = [
      rate({ workTypeId: 1, unitPrice: 370, sortOrder: 1 }),
      rate({ workTypeId: 2, unitPrice: 365, sortOrder: 2 }),
    ];
    const entries = [
      entry({ entryDate: "2026-07-20", workTypeId: 1, kind: "count_x_price", quantity: 100, unitPrice: 370 }),
      entry({ entryDate: "2026-07-21", workTypeId: 1, kind: "count_x_price", quantity: 120, unitPrice: 370 }),
      entry({ entryDate: "2026-07-20", workTypeId: 2, kind: "count_x_price", quantity: 200, unitPrice: 365 }),
    ];

    const items = buildLineItems({ weekStart: WEEK, entries, rates, workTypes: types });

    expect(items).toHaveLength(2);
    expect(items[0].name).toBe("Drill");
    expect(items[0].totalQuantity).toBe(220);
    expect(items[0].wage).toBe(81400); // 220 x ₹3.70 = ₹814.00
    expect(items[0].daysWorked).toBe(2);
    expect(items[1].wage).toBe(73000); // 200 x ₹3.65 = ₹730.00
    expect(sumLineItemWages(items)).toBe(154400); // ₹1,544.00
  });

  it("ignores entries outside the week", () => {
    const rates = [rate({ workTypeId: 1, unitPrice: 370 })];
    const entries = [
      entry({ entryDate: "2026-07-20", workTypeId: 1, kind: "count_x_price", quantity: 100, unitPrice: 370 }),
      // the following Sunday — belongs to the next pay week
      entry({ entryDate: "2026-07-26", workTypeId: 1, kind: "count_x_price", quantity: 999, unitPrice: 370 }),
    ];

    const items = buildLineItems({ weekStart: WEEK, entries, rates, workTypes: types });
    expect(items[0].totalQuantity).toBe(100);
  });

  it("keeps past weeks accurate when the price changes later", () => {
    // The entry snapshotted ₹3.70. The worker's rate has since risen to ₹4.00.
    const entries = [
      entry({ entryDate: "2026-07-20", workTypeId: 1, kind: "count_x_price", quantity: 100, unitPrice: 370 }),
    ];
    const ratesAfterRaise = [rate({ workTypeId: 1, unitPrice: 400 })];

    const items = buildLineItems({
      weekStart: WEEK,
      entries,
      rates: ratesAfterRaise,
      workTypes: types,
    });

    // Historical accuracy: the old week must still pay ₹370.00, not ₹400.00.
    expect(items[0].unitPrice).toBe(370);
    expect(items[0].wage).toBe(37000);
  });

  it("still pays a work type that was unassigned after the entries were made", () => {
    const entries = [
      entry({ entryDate: "2026-07-20", workTypeId: 2, kind: "count_x_price", quantity: 50, unitPrice: 365 }),
    ];
    // Worker is no longer assigned x30 at all.
    const items = buildLineItems({ weekStart: WEEK, entries, rates: [], workTypes: types });
    expect(items).toHaveLength(1);
    expect(items[0].wage).toBe(18250);
  });

  it("prices each day at its own rate when the price changes mid-week", () => {
    // The price rose from ₹3.70 to ₹4.00 on Wednesday. Monday and Tuesday must
    // still be paid at ₹3.70 — summing the week and multiplying once would
    // silently reprice them at Wednesday's rate.
    const rates = [rate({ workTypeId: 1, unitPrice: 400 })];
    const entries = [
      entry({ entryDate: "2026-07-20", workTypeId: 1, kind: "count_x_price", quantity: 100, unitPrice: 370 }),
      entry({ entryDate: "2026-07-21", workTypeId: 1, kind: "count_x_price", quantity: 100, unitPrice: 370 }),
      entry({ entryDate: "2026-07-22", workTypeId: 1, kind: "count_x_price", quantity: 100, unitPrice: 400 }),
    ];

    const items = buildLineItems({ weekStart: WEEK, entries, rates, workTypes: types });

    expect(items[0].totalQuantity).toBe(300);
    // 100x3.70 + 100x3.70 + 100x4.00 = 370 + 370 + 400 = ₹1,140
    expect(items[0].wage).toBe(114000);
    expect(items[0].wage).not.toBe(120000); // not all at the new rate
    expect(items[0].wage).not.toBe(111000); // not all at the old rate
    expect(items[0].rateVaried).toBe(true);
  });

  it("records what each day earned, at that day's own rate", () => {
    const rates = [rate({ workTypeId: 1, unitPrice: 400 })];
    const entries = [
      entry({ entryDate: "2026-07-20", workTypeId: 1, kind: "count_x_price", quantity: 100, unitPrice: 370 }),
      entry({ entryDate: "2026-07-22", workTypeId: 1, kind: "count_x_price", quantity: 100, unitPrice: 400 }),
    ];

    const items = buildLineItems({ weekStart: WEEK, entries, rates, workTypes: types });

    expect(items[0].dailyWage["2026-07-20"]).toBe(37000); // 100 x ₹3.70
    expect(items[0].dailyWage["2026-07-22"]).toBe(40000); // 100 x ₹4.00
    expect(items[0].dailyWage["2026-07-21"]).toBe(0); // nothing recorded
    // The days add up to the line's wage.
    const summed = Object.values(items[0].dailyWage).reduce((a, b) => a + b, 0);
    expect(summed).toBe(items[0].wage);
  });

  it("sums both looms into the same day's earnings", () => {
    const rates = [rate({ workTypeId: 1, unitPrice: 370, looms: 2 })];
    const entries = [
      entry({ entryDate: "2026-07-20", workTypeId: 1, kind: "count_x_price", quantity: 60, unitPrice: 370, loom: 1 }),
      entry({ entryDate: "2026-07-20", workTypeId: 1, kind: "count_x_price", quantity: 40, unitPrice: 370, loom: 2 }),
    ];
    const items = buildLineItems({ weekStart: WEEK, entries, rates, workTypes: types });
    expect(items[0].dailyWage["2026-07-20"]).toBe(37000); // 100 x ₹3.70
  });

  it("leaves a weekly ratio out of the daily earnings", () => {
    // (150 / 75) x ₹35 is defined over the week; splitting it across days would
    // be inventing a figure.
    const rates = [rate({ workTypeId: 3, divisor: 75, multiplier: 3500 })];
    const entries = [50, 50, 50].map((quantity, i) =>
      entry({
        entryDate: addDays(WEEK, i + 1),
        workTypeId: 3,
        kind: "formula_sum_ratio",
        quantity,
        divisor: 75,
        multiplier: 3500,
      }),
    );

    const items = buildLineItems({ weekStart: WEEK, entries, rates, workTypes: types });
    expect(items[0].wage).toBe(7000);
    expect(Object.values(items[0].dailyWage).every((v) => v === 0)).toBe(true);
    // The counts are still there day by day.
    expect(items[0].daily["2026-07-20"]).toBe(50);
  });

  it("does not flag a rate change when the price held steady", () => {
    const rates = [rate({ workTypeId: 1, unitPrice: 370 })];
    const entries = [
      entry({ entryDate: "2026-07-20", workTypeId: 1, kind: "count_x_price", quantity: 100, unitPrice: 370 }),
      entry({ entryDate: "2026-07-21", workTypeId: 1, kind: "count_x_price", quantity: 100, unitPrice: 370 }),
    ];
    const items = buildLineItems({ weekStart: WEEK, entries, rates, workTypes: types });
    expect(items[0].rateVaried).toBe(false);
    expect(items[0].wage).toBe(74000);
  });

  it("sums two looms of one towel type into a single wage, keeping both figures", () => {
    const rates = [rate({ workTypeId: 1, unitPrice: 370, looms: 2 })];
    const entries = [
      entry({ entryDate: "2026-07-20", workTypeId: 1, kind: "count_x_price", quantity: 60, unitPrice: 370, loom: 1 }),
      entry({ entryDate: "2026-07-20", workTypeId: 1, kind: "count_x_price", quantity: 40, unitPrice: 370, loom: 2 }),
      entry({ entryDate: "2026-07-21", workTypeId: 1, kind: "count_x_price", quantity: 50, unitPrice: 370, loom: 1 }),
      entry({ entryDate: "2026-07-21", workTypeId: 1, kind: "count_x_price", quantity: 50, unitPrice: 370, loom: 2 }),
    ];

    const items = buildLineItems({ weekStart: WEEK, entries, rates, workTypes: types });

    expect(items[0].totalQuantity).toBe(200);
    expect(items[0].wage).toBe(74000); // 200 x ₹3.70
    expect(items[0].looms).toBe(2);
    // The per-loom split survives for the record: 110 and 90.
    expect(items[0].loomTotals).toEqual([110, 90]);
    // Two looms on one day is still one day worked, and the day totals combine.
    expect(items[0].daysWorked).toBe(2);
    expect(items[0].daily["2026-07-20"]).toBe(100);
  });

  it("sums Kurai Cone counts across the week before applying the ratio", () => {
    const rates = [rate({ workTypeId: 3, divisor: 75, multiplier: 3500 })];
    const entries = [50, 50, 50].map((quantity, i) =>
      entry({
        entryDate: addDays(WEEK, i + 1),
        workTypeId: 3,
        kind: "formula_sum_ratio",
        quantity,
        divisor: 75,
        multiplier: 3500,
      }),
    );

    const items = buildLineItems({ weekStart: WEEK, entries, rates, workTypes: types });
    expect(items[0].totalQuantity).toBe(150);
    expect(items[0].wage).toBe(7000); // ₹70.00, not 3 x (50/75 x 35)
  });
});

// ---------------------------------------------------------------------------
// adjustments, net payable and the carry-forward ledger
// ---------------------------------------------------------------------------

describe("net payable", () => {
  it("rounds a payment up with a credit", () => {
    // wage ₹1,980, hand over ₹2,000 -> credit ₹20
    const adj = { ...ZERO_ADJUSTMENTS, credit: 2000 };
    expect(netPayable(198000, adj)).toBe(200000);
  });

  it("rounds a payment down with a debit", () => {
    // wage ₹2,010, hand over ₹2,000 -> debit ₹10
    const adj = { ...ZERO_ADJUSTMENTS, debit: 1000 };
    expect(netPayable(201000, adj)).toBe(200000);
  });

  it("applies every adjustment together", () => {
    const adjustments = {
      ...ZERO_ADJUSTMENTS,
      credit: 500,
      deduct: 2000,
      debit: 300,
      addback: 1000,
    };
    // 200000 + 500 - 2000 - 300 + 1000
    expect(netPayable(200000, adjustments)).toBe(199200);
  });

  it("takes an advance recovery off the payment", () => {
    // wage ₹2,000 less a ₹500 advance recovery
    expect(netPayable(200000, { ...ZERO_ADJUSTMENTS, advanceRecovered: 50000 })).toBe(150000);
  });
});

describe("rounding helper", () => {
  it("produces the credit that rounds ₹1,980 up to ₹2,000", () => {
    const result = computeRounding(198000, ZERO_ADJUSTMENTS, 100, "up");
    expect(result.credit).toBe(2000);
    expect(result.debit).toBe(0);
    expect(result.netPayable).toBe(200000);
  });

  it("produces the debit that rounds ₹2,010 down to ₹2,000", () => {
    const result = computeRounding(201000, ZERO_ADJUSTMENTS, 100, "down");
    expect(result.debit).toBe(1000);
    expect(result.credit).toBe(0);
    expect(result.netPayable).toBe(200000);
  });

  it("accounts for an already-applied deduct when choosing the rounding", () => {
    // wage ₹1,990 less a ₹20 deduct = ₹1,970 -> round up to ₹2,000 needs ₹30
    const adj = { ...ZERO_ADJUSTMENTS, deduct: 2000 };
    const result = computeRounding(199000, adj, 100, "up");
    expect(result.credit).toBe(3000);
    expect(netPayable(199000, { ...adj, credit: result.credit })).toBe(200000);
  });

  it("does nothing when the amount is already round", () => {
    const result = computeRounding(200000, ZERO_ADJUSTMENTS, 100, "up");
    expect(result.credit).toBe(0);
    expect(result.debit).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// paise handling — nobody hands over 56 paise
// ---------------------------------------------------------------------------

describe("roundPayable", () => {
  it("resolves paise to the nearest rupee", () => {
    expect(roundPayable(210956, 1, "down")).toBe(211000); // ₹2,109.56 -> ₹2,110
    expect(roundPayable(210940, 1, "down")).toBe(210900); // ₹2,109.40 -> ₹2,109
    expect(roundPayable(210950, 1, "nearest")).toBe(211000); // exact half rounds up
  });

  it("clears the paise before applying a larger step", () => {
    // ₹2,109.56 -> ₹2,110 -> floor to ₹100 -> ₹2,100
    expect(roundPayable(210956, 100, "down")).toBe(210000);
    expect(roundPayable(210956, 100, "up")).toBe(220000);
    expect(roundPayable(210956, 10, "down")).toBe(211000);
  });

  it("never rounds a payment down to nothing", () => {
    // ₹21 floored to the nearest ₹100 would be ₹0 — pay nothing and still owe
    // ₹21. The whole-rupee figure stands instead.
    expect(roundPayable(2100, 100, "down")).toBe(2100);
    expect(roundPayable(2156, 100, "down")).toBe(2200); // ₹21.56 -> ₹22
  });
});

// ---------------------------------------------------------------------------
// the one-tap settlement proposal
// ---------------------------------------------------------------------------

describe("suggestSettlement", () => {
  const step = 100;

  it("offers to pay back what you owe the worker", () => {
    // "if I owe 21 rs to worker, it should automatically suggest to apply this"
    const result = suggestSettlement({
      wage: 200000, // ₹2,000
      opening: balanceOf({ debitOutstanding: 2100 }), // you owe ₹21
      step: 1,
      mode: "hold",
    });
    expect(result.addback).toBe(2100);
    expect(result.settled).toBe(202100); // ₹2,021
    expect(result.netPayable).toBe(202100);
    expect(result.carriedDebit).toBe(0); // fully repaid
  });

  it("settles the carry-forward first, then rounds", () => {
    // You owe ₹21; wage ₹2,000 -> ₹2,021 -> hold back to ₹2,000, carrying ₹21.
    const result = suggestSettlement({
      wage: 200000,
      opening: balanceOf({ debitOutstanding: 2100 }),
      step,
      mode: "hold",
    });
    expect(result.addback).toBe(2100);
    expect(result.debit).toBe(2100);
    expect(result.credit).toBe(0);
    expect(result.netPayable).toBe(200000);
    // The old debit was repaid and an equal one taken back on — still ₹21 owed.
    expect(result.carriedDebit).toBe(2100);
  });

  it("prefers holding money back over paying extra", () => {
    const result = suggestSettlement({
      wage: 210956, // ₹2,109.56
      opening: ZERO_BALANCE,
      step,
      mode: "hold",
    });
    expect(result.credit).toBe(0); // never fronts money
    // ₹2,109.56 -> ₹2,110 -> floor to ₹100 -> ₹2,100, holding ₹9.56 back
    expect(result.debit).toBe(956);
    expect(result.netPayable).toBe(210000);
    expect(result.carriedDebit).toBe(956);
  });

  it("still allows paying extra when asked", () => {
    const result = suggestSettlement({
      wage: 210956,
      opening: ZERO_BALANCE,
      step,
      mode: "give",
    });
    expect(result.debit).toBe(0);
    expect(result.credit).toBe(9044); // ₹90.44 extra
    expect(result.netPayable).toBe(220000);
  });

  it("just clears the paise at a ₹1 step", () => {
    expect(
      suggestSettlement({ wage: 210956, opening: ZERO_BALANCE, step: 1, mode: "hold" })
        .netPayable,
    ).toBe(211000); // ₹2,110
    expect(
      suggestSettlement({ wage: 210940, opening: ZERO_BALANCE, step: 1, mode: "hold" })
        .netPayable,
    ).toBe(210900); // ₹2,109
  });

  it("recovers an outstanding credit from this week's wage", () => {
    const result = suggestSettlement({
      wage: 200000,
      opening: balanceOf({ creditOutstanding: 8500 }), // owes you ₹85
      step: 1,
      mode: "hold",
    });
    expect(result.deduct).toBe(8500);
    expect(result.remainingCredit).toBe(0);
    expect(result.netPayable).toBe(191500); // ₹1,915
  });

  it("never claws back more than the worker earned this week", () => {
    // Owes ₹500 but only earned ₹300 — recover ₹300, leave ₹200 outstanding.
    const result = suggestSettlement({
      wage: 30000,
      opening: balanceOf({ creditOutstanding: 50000 }),
      step: 1,
      mode: "hold",
    });
    expect(result.deduct).toBe(30000);
    expect(result.remainingCredit).toBe(20000);
    expect(result.netPayable).toBe(0);
    expect(netPayable(30000, result)).toBe(0); // never negative
  });

  it("recovers nothing from a week with no work", () => {
    const result = suggestSettlement({
      wage: 0,
      opening: balanceOf({ creditOutstanding: 8500 }),
      step,
      mode: "hold",
    });
    expect(result.deduct).toBe(0);
    expect(result.remainingCredit).toBe(8500);
    expect(result.netPayable).toBe(0);
  });

  it("does not round a small payment away to nothing", () => {
    // Wage ₹0, you owe ₹21 — flooring to ₹100 would pay nothing and still owe.
    const result = suggestSettlement({
      wage: 0,
      opening: balanceOf({ debitOutstanding: 2100 }),
      step,
      mode: "hold",
    });
    expect(result.netPayable).toBe(2100);
    expect(result.debit).toBe(0);
  });

  it("nets a two-way balance into a single recovery", () => {
    // They owe ₹50 and you owe ₹21 — that is simply them owing ₹29. One
    // deduct, no add-back that partly undoes it.
    const result = suggestSettlement({
      wage: 200000,
      opening: balanceOf({ creditOutstanding: 5000, debitOutstanding: 2100 }),
      step: 1,
      mode: "hold",
    });
    expect(result.deduct).toBe(2900);
    expect(result.addback).toBe(0);
    // The payment is the same either way — only the bookkeeping is simpler.
    expect(result.netPayable).toBe(197100); // ₹1,971
    expect(result.remainingCredit).toBe(0);
    expect(result.carriedDebit).toBe(0);
  });

  it("agrees with netPayable on the figures it proposes", () => {
    const result = suggestSettlement({
      wage: 210956,
      opening: balanceOf({ creditOutstanding: 5000, debitOutstanding: 2100 }),
      step,
      mode: "hold",
    });
    expect(netPayable(210956, result)).toBe(result.netPayable);
  });

  it("reports a no-op when the adjustments already match", () => {
    const opening = balanceOf({ creditOutstanding: 8500 });
    const first = suggestSettlement({ wage: 200000, opening, step, mode: "hold" });
    const second = suggestSettlement({
      wage: 200000,
      opening,
      step,
      mode: "hold",
      current: first,
    });
    expect(second.isNoop).toBe(true);
  });

  it("settles fully over two weeks when holding back", () => {
    // Week N: wage ₹2,109.56, hand over ₹2,100, hold ₹9.56.
    const weekN = suggestSettlement({
      wage: 210956,
      opening: ZERO_BALANCE,
      step,
      mode: "hold",
    });
    expect(weekN.netPayable).toBe(210000);

    const afterN = applyToBalance(ZERO_BALANCE, weekN);
    expect(afterN.debitOutstanding).toBe(956); // you owe ₹9.56

    // Week N+1: that ₹9.56 is repaid on top of the new wage.
    const weekNext = suggestSettlement({
      wage: 200000,
      opening: afterN,
      step,
      mode: "hold",
    });
    expect(weekNext.addback).toBe(956);
    expect(weekNext.settled).toBe(200956); // ₹2,009.56
    expect(weekNext.netPayable).toBe(200000); // ₹2,010 -> floor ₹100 -> ₹2,000
    // The old debt is cleared and a fresh ₹9.56 held back — the worker is never
    // cumulatively short-changed, the balance just rolls.
    expect(weekNext.carriedDebit).toBe(956);
  });
});

// ---------------------------------------------------------------------------
// advances — money lent mid-week, and money handed back
// ---------------------------------------------------------------------------

describe("advances", () => {
  it("nets advances against repayments", () => {
    expect(
      advanceDelta([
        { kind: "advance", amount: 100000 }, // lent ₹1,000
        { kind: "repayment", amount: 30000 }, // got ₹300 back
      ]),
    ).toBe(70000);
  });

  it("carries an unrecovered advance into the opening balance", () => {
    const opening = balanceBefore([], WEEK, [
      { weekStart: "2026-07-12", kind: "advance", amount: 100000 },
    ]);
    expect(opening.advanceOutstanding).toBe(100000);
  });

  it("excludes advances taken during the current week from the opening balance", () => {
    const opening = balanceBefore([], WEEK, [
      { weekStart: "2026-07-12", kind: "advance", amount: 100000 },
      { weekStart: WEEK, kind: "advance", amount: 50000 },
    ]);
    expect(opening.advanceOutstanding).toBe(100000);
  });

  it("never recovers an advance automatically", () => {
    // Deliberate: how much of a loan comes off a given week is a conversation,
    // not arithmetic. The figure is surfaced, never pre-filled.
    const result = suggestSettlement({
      wage: 252875, // ₹2,528.75
      opening: balanceOf({ advanceOutstanding: 100000 }), // owes ₹1,000
      step: 100,
      mode: "hold",
    });
    expect(result.advanceRecovered).toBe(0);
    expect(result.netPayable).toBe(250000); // full wage, only rounded down
    expect(result.advanceOutstanding).toBe(100000); // still flagged
  });

  it("rounds correctly around a recovery you typed in yourself", () => {
    const result = suggestSettlement({
      wage: 252875,
      opening: balanceOf({ advanceOutstanding: 100000 }),
      step: 100,
      mode: "hold",
      current: { ...ZERO_ADJUSTMENTS, advanceRecovered: 50000 }, // take ₹500 off
    });
    expect(result.advanceRecovered).toBe(50000);
    expect(result.settled).toBe(202875); // ₹2,028.75
    expect(result.netPayable).toBe(200000); // -> ₹2,029 -> floor ₹100 -> ₹2,000
    expect(result.advanceOutstanding).toBe(50000); // ₹500 still owed
    expect(netPayable(252875, result)).toBe(result.netPayable);
  });

  it("clears the advance once fully recovered", () => {
    const after = applyToBalance(balanceOf({ advanceOutstanding: 100000 }), {
      ...ZERO_ADJUSTMENTS,
      advanceRecovered: 100000,
    });
    expect(after.advanceOutstanding).toBe(0);
  });

  it("treats a mid-week repayment as reducing what is owed", () => {
    const after = applyToBalance(
      ZERO_BALANCE,
      ZERO_ADJUSTMENTS,
      advanceDelta([
        { kind: "advance", amount: 100000 },
        { kind: "repayment", amount: 100000 },
      ]),
    );
    expect(after.advanceOutstanding).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// naming the payment yourself
// ---------------------------------------------------------------------------

describe("computeTargetPayment", () => {
  const WAGE = 222900; // ₹2,229

  it("books the excess as a credit when you pay over the wage", () => {
    // Hand over ₹2,260 against a ₹2,229 wage -> the worker owes you ₹31.
    const result = computeTargetPayment(WAGE, ZERO_ADJUSTMENTS, 226000);
    expect(result.credit).toBe(3100);
    expect(result.debit).toBe(0);
    expect(result.netPayable).toBe(226000);
    expect(netPayable(WAGE, { ...ZERO_ADJUSTMENTS, credit: result.credit })).toBe(226000);
  });

  it("books the shortfall as a debit when you pay under the wage", () => {
    // Hand over ₹2,220 -> you owe the worker ₹9.
    const result = computeTargetPayment(WAGE, ZERO_ADJUSTMENTS, 222000);
    expect(result.debit).toBe(900);
    expect(result.credit).toBe(0);
    expect(netPayable(WAGE, { ...ZERO_ADJUSTMENTS, debit: result.debit })).toBe(222000);
  });

  it("books nothing when the amount already matches", () => {
    const result = computeTargetPayment(WAGE, ZERO_ADJUSTMENTS, WAGE);
    expect(result.credit).toBe(0);
    expect(result.debit).toBe(0);
  });

  it("measures against the adjustments already entered, not the raw wage", () => {
    // ₹2,229 wage, ₹500 advance recovered -> ₹1,729 is what would change hands.
    // Naming ₹1,700 should hold back ₹29, not ₹529.
    const adj = { ...ZERO_ADJUSTMENTS, advanceRecovered: 50000 };
    const result = computeTargetPayment(WAGE, adj, 170000);
    expect(result.settled).toBe(172900);
    expect(result.debit).toBe(2900);
    expect(result.credit).toBe(0);
    expect(netPayable(WAGE, { ...adj, debit: result.debit })).toBe(170000);
  });

  it("accounts for a deduct and an add-back together", () => {
    const adj = { ...ZERO_ADJUSTMENTS, deduct: 8500, addback: 2100 };
    // 222900 - 8500 + 2100 = 216500
    const result = computeTargetPayment(WAGE, adj, 220000);
    expect(result.settled).toBe(216500);
    expect(result.credit).toBe(3500);
    expect(netPayable(WAGE, { ...adj, credit: result.credit })).toBe(220000);
  });

  it("leaves the worker owing the excess on the running balance", () => {
    const result = computeTargetPayment(WAGE, ZERO_ADJUSTMENTS, 226000);
    const after = applyToBalance(ZERO_BALANCE, {
      ...ZERO_ADJUSTMENTS,
      credit: result.credit,
    });
    expect(after.creditOutstanding).toBe(3100);
  });
});

// ---------------------------------------------------------------------------
// a balance never runs both ways at once
// ---------------------------------------------------------------------------

describe("netBalance", () => {
  it("cancels the smaller side", () => {
    // They owe ₹10, you owe ₹30 -> you owe ₹20.
    expect(
      netBalance(balanceOf({ creditOutstanding: 1000, debitOutstanding: 3000 })),
    ).toEqual(balanceOf({ debitOutstanding: 2000 }));

    // They owe ₹30, you owe ₹10 -> they owe ₹20.
    expect(
      netBalance(balanceOf({ creditOutstanding: 3000, debitOutstanding: 1000 })),
    ).toEqual(balanceOf({ creditOutstanding: 2000 }));
  });

  it("clears both sides when they match", () => {
    expect(
      netBalance(balanceOf({ creditOutstanding: 2500, debitOutstanding: 2500 })),
    ).toEqual(ZERO_BALANCE);
  });

  it("leaves an advance out of the netting", () => {
    // A loan is a separate arrangement from rounding change.
    const result = netBalance(
      balanceOf({
        creditOutstanding: 1000,
        debitOutstanding: 3000,
        advanceOutstanding: 100000,
      }),
    );
    expect(result.advanceOutstanding).toBe(100000);
    expect(result.debitOutstanding).toBe(2000);
  });

  it("never leaves a balance owed in both directions", () => {
    // The case from a real screenshot: ₹318.67 owed to you and ₹273.67 owed
    // by you, which is really ₹45 owed to you.
    let running = applyToBalance(ZERO_BALANCE, {
      ...ZERO_ADJUSTMENTS,
      credit: 31867,
    });
    running = applyToBalance(running, { ...ZERO_ADJUSTMENTS, debit: 27367 });

    expect(running.creditOutstanding).toBe(4500);
    expect(running.debitOutstanding).toBe(0);
  });

  it("keeps netting as weeks accumulate", () => {
    const history = [
      adj({ weekStart: "2026-06-28", credit: 5000 }),
      adj({ weekStart: "2026-07-05", debit: 8000 }),
      adj({ weekStart: "2026-07-12", credit: 1000 }),
    ];
    // +50, -80, +10 => you owe ₹20, and nothing is owed the other way.
    const opening = balanceBefore(history, WEEK);
    expect(opening.debitOutstanding).toBe(2000);
    expect(opening.creditOutstanding).toBe(0);
    expect(suggestFromBalance(opening)).toEqual({ deduct: 0, addback: 2000 });
  });
});

describe("carry-forward balance", () => {
  it("turns this week's credit into next week's suggested deduct", () => {
    const history = [
      adj({ weekStart: "2026-07-12", credit: 2000 }),
    ];
    const opening = balanceBefore(history, WEEK);
    expect(opening.creditOutstanding).toBe(2000);
    expect(suggestFromBalance(opening).deduct).toBe(2000);
  });

  it("turns this week's debit into next week's suggested add-back", () => {
    const history = [
      adj({ weekStart: "2026-07-12", debit: 1000 }),
    ];
    const opening = balanceBefore(history, WEEK);
    expect(opening.debitOutstanding).toBe(1000);
    expect(suggestFromBalance(opening).addback).toBe(1000);
  });

  it("clears the balance once recovered, suggesting nothing further", () => {
    const history = [
      adj({ weekStart: "2026-07-05", credit: 2000 }),
      adj({ weekStart: "2026-07-12", deduct: 2000 }),
    ];
    const opening = balanceBefore(history, WEEK);
    expect(opening.creditOutstanding).toBe(0);
    expect(suggestFromBalance(opening)).toEqual({ deduct: 0, addback: 0 });
  });

  it("accumulates unrecovered credits across several weeks", () => {
    const history = [
      adj({ weekStart: "2026-06-28", credit: 2000 }),
      adj({ weekStart: "2026-07-05", credit: 1500 }),
      adj({ weekStart: "2026-07-12", deduct: 1000 }),
    ];
    expect(balanceBefore(history, WEEK).creditOutstanding).toBe(2500);
  });

  it("excludes the current week and anything after it from the opening balance", () => {
    const history = [
      adj({ weekStart: "2026-07-12", credit: 2000 }),
      adj({ weekStart: WEEK, credit: 9900 }),
      adj({ weekStart: "2026-07-26", credit: 8800 }),
    ];
    expect(balanceBefore(history, WEEK).creditOutstanding).toBe(2000);
  });

  it("keeps the running balance to a single figure", () => {
    // A credit and a debit in the same week cancel: +20 and -10 is just +10.
    let running = applyToBalance(ZERO_BALANCE, {
      ...ZERO_ADJUSTMENTS,
      credit: 2000,
      debit: 1000,
    });
    expect(running).toEqual(balanceOf({ creditOutstanding: 1000 }));

    // Recovering more than was outstanding flips the direction rather than
    // leaving a negative figure on one side.
    running = applyToBalance(running, {
      ...ZERO_ADJUSTMENTS,
      deduct: 2000,
      addback: 400,
    });
    expect(running).toEqual(balanceOf({ debitOutstanding: 600 }));
  });

  it("round up in week N then accept the suggestion in week N+1 nets out", () => {
    // Week N: wage ₹1,980, paid ₹2,000.
    const weekN = computeRounding(198000, ZERO_ADJUSTMENTS, 100, "up");
    expect(netPayable(198000, { ...ZERO_ADJUSTMENTS, credit: weekN.credit })).toBe(200000);

    // Week N+1: the ₹20 credit comes back as a suggested deduct.
    const opening = balanceBefore(
      [adj({ weekStart: WEEK, credit: weekN.credit })],
      "2026-07-26",
    );
    const suggestion = suggestFromBalance(opening);
    expect(suggestion.deduct).toBe(2000);

    // Accepting it leaves the worker square.
    const settled = applyToBalance(opening, { ...ZERO_ADJUSTMENTS, deduct: suggestion.deduct });
    expect(settled.creditOutstanding).toBe(0);
  });
});

describe("carriedAdvance", () => {
  it("shows nothing once the advance is returned in a later week", () => {
    expect(carriedAdvance(50_000, [{ date: "2026-08-12", delta: -50_000 }])).toBe(0);
  });

  it("shows what remains after a part return", () => {
    expect(carriedAdvance(50_000, [{ date: "2026-08-12", delta: -20_000 }])).toBe(30_000);
  });

  it("does not count a fresh loan after the return as carried", () => {
    expect(
      carriedAdvance(50_000, [
        { date: "2026-08-19", delta: 30_000 },
        { date: "2026-08-12", delta: -50_000 },
      ]),
    ).toBe(0);
  });

  it("is never negative", () => {
    expect(carriedAdvance(-50_000, [])).toBe(0);
  });
});

describe("bonusAmount", () => {
  it("takes the percentage of what was earned", () => {
    expect(bonusAmount(1_000_000, 8)).toBe(80_000);
  });

  it("rounds to the nearest rupee", () => {
    expect(bonusAmount(230_200, 8)).toBe(18_400); // 184.16
    expect(bonusAmount(230_700, 8)).toBe(18_500); // 184.56
  });
});

describe("isEmployedOn", () => {
  const worker = { joinDate: "2026-08-05", endDate: "2026-09-30" };

  it("includes the first and last day", () => {
    expect(isEmployedOn(worker, "2026-08-05")).toBe(true);
    expect(isEmployedOn(worker, "2026-09-30")).toBe(true);
  });

  it("excludes days outside the dates", () => {
    expect(isEmployedOn(worker, "2026-08-04")).toBe(false);
    expect(isEmployedOn(worker, "2026-10-01")).toBe(false);
  });

  it("treats a missing date as open-ended", () => {
    expect(isEmployedOn({ joinDate: null, endDate: null }, "2020-01-01")).toBe(true);
  });
});
