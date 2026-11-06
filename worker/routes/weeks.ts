import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { addWeeks, weekEndOf, weekStartOf } from "@shared/dates";
import { nonNegativePaiseSchema, readDate, readId, readJson, type AppEnv } from "../lib/http";
import { weeklyWages } from "../lib/earnings";
import { assertWeekOpen, computeWeek, ensureWeek } from "../lib/week";

const app = new Hono<AppEnv>();

const adjustmentsSchema = z.object({
  credit: nonNegativePaiseSchema.optional(),
  deduct: nonNegativePaiseSchema.optional(),
  debit: nonNegativePaiseSchema.optional(),
  addback: nonNegativePaiseSchema.optional(),
  advanceRecovered: nonNegativePaiseSchema.optional(),
  note: z.string().trim().max(200).nullish(),
  paid: z.boolean().optional(),
});

/**
 * GET /api/weeks — the history list.
 * Returns a summary row per week that has any activity, newest first.
 */
app.get("/", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 52) || 52, 260);
  const from = c.req.query("from");
  const to = c.req.query("to");

  const conditions: string[] = [];
  const binds: unknown[] = [];
  if (from) {
    conditions.push("week_start >= ?");
    binds.push(weekStartOf(readDate(from, "from")));
  }
  if (to) {
    conditions.push("week_start <= ?");
    binds.push(weekStartOf(readDate(to, "to")));
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  // Union of weeks that have entries and weeks that have adjustments, so a week
  // where someone was only paid back a balance still shows up.
  const { results } = await c.env.DB.prepare(
    `SELECT week_start FROM (
       SELECT week_start FROM entries ${where}
       UNION
       SELECT week_start FROM week_adjustments ${where}
     ) GROUP BY week_start ORDER BY week_start DESC LIMIT ?`,
  )
    .bind(...binds, ...binds, limit)
    .all<{ week_start: string }>();

  const weeks = await Promise.all(
    results.map((row) => computeWeek(c.env.DB, row.week_start)),
  );

  return c.json(
    weeks.map((week) => ({
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      status: week.status,
      finalizedAt: week.finalizedAt,
      totals: week.totals,
      workerCount: week.workers.length,
      paidCount: week.workers.filter((w) => w.paidAt).length,
      workers: week.workers.map((w) => ({
        workerId: w.workerId,
        workerName: w.workerName,
        wage: w.wage,
        netPayable: w.netPayable,
        paidAt: w.paidAt,
      })),
    })),
  );
});

/**
 * GET /api/weeks/calendar?year= — one line per week that has anything in it.
 * A week belongs to the year its Saturday, the payout day, falls in.
 */
app.get("/calendar", async (c) => {
  const year = Number(c.req.query("year"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new HTTPException(400, { message: "Invalid year." });
  }

  const startWeek = addWeeks(weekStartOf(`${year}-01-01`), -1);
  const endWeek = weekStartOf(`${year}-12-31`);
  const [{ wages }, finalized] = await Promise.all([
    weeklyWages(c.env.DB, startWeek, endWeek),
    c.env.DB.prepare(
      "SELECT week_start FROM weeks WHERE status = 'finalized' AND week_start >= ? AND week_start <= ?",
    )
      .bind(startWeek, endWeek)
      .all<{ week_start: string }>(),
  ]);

  const weeks = new Map<
    string,
    { weekStart: string; status: "finalized" | "paid" | "entered"; wage: number; workers: number }
  >();
  const line = (weekStart: string) => {
    const existing = weeks.get(weekStart);
    if (existing) return existing;
    const created = {
      weekStart,
      status: "entered" as "finalized" | "paid" | "entered",
      wage: 0,
      workers: 0,
    };
    weeks.set(weekStart, created);
    return created;
  };

  for (const { weekStart, wage, paid, markedPaid } of wages) {
    if (wage === 0 && paid === 0 && !markedPaid) continue;
    const week = line(weekStart);
    if (markedPaid) week.status = "paid";
    week.wage += wage;
    week.workers += 1;
  }
  for (const row of finalized.results) line(row.week_start).status = "finalized";

  return c.json([...weeks.values()].filter((w) => weekEndOf(w.weekStart).startsWith(`${year}-`)));
});

/** GET /api/weeks/:weekStart — the full computed payroll for one week. */
app.get("/:weekStart", async (c) => {
  // Accept any date in the week and snap it to the Sunday, so links are forgiving.
  const weekStart = weekStartOf(readDate(c.req.param("weekStart"), "weekStart"));
  const week = await computeWeek(c.env.DB, weekStart);
  return c.json(week);
});

/** PUT /api/weeks/:weekStart/adjustments/:workerId */
app.put("/:weekStart/adjustments/:workerId", async (c) => {
  const weekStart = weekStartOf(readDate(c.req.param("weekStart"), "weekStart"));
  const workerId = readId(c, "workerId");
  const body = await readJson(c, adjustmentsSchema);

  await assertWeekOpen(c.env.DB, weekStart);
  await ensureWeek(c.env.DB, weekStart);

  const worker = await c.env.DB.prepare("SELECT id FROM workers WHERE id = ?")
    .bind(workerId)
    .first<{ id: number }>();
  if (!worker) throw new HTTPException(404, { message: "Worker not found." });

  const existing = await c.env.DB.prepare(
    "SELECT manual_wage FROM week_adjustments WHERE week_start = ? AND worker_id = ?",
  )
    .bind(weekStart, workerId)
    .first<{ manual_wage: number | null }>();
  const movesMoney = [
    body.credit,
    body.deduct,
    body.debit,
    body.addback,
    body.advanceRecovered,
  ].some((value) => value !== undefined);
  if (existing?.manual_wage != null && movesMoney) {
    throw new HTTPException(409, {
      message: "This week is an old record. Remove the record before adjusting it.",
    });
  }

  // Create the row if this is the first adjustment of the week.
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO week_adjustments (week_start, worker_id) VALUES (?, ?)",
  )
    .bind(weekStart, workerId)
    .run();

  const columns: Record<string, unknown> = {
    credit: body.credit,
    deduct: body.deduct,
    debit: body.debit,
    addback: body.addback,
    advance_recovered: body.advanceRecovered,
    note: body.note,
    paid_at: body.paid === undefined ? undefined : body.paid ? new Date().toISOString() : null,
  };
  const sets = Object.entries(columns).filter(([, v]) => v !== undefined);

  if (sets.length) {
    await c.env.DB.prepare(
      `UPDATE week_adjustments SET ${sets.map(([k]) => `${k} = ?`).join(", ")}
       WHERE week_start = ? AND worker_id = ?`,
    )
      .bind(...sets.map(([, v]) => (v === null ? null : (v as never))), weekStart, workerId)
      .run();
  }

  const week = await computeWeek(c.env.DB, weekStart);
  return c.json(week);
});

/**
 * PUT /api/weeks/:weekStart/old-record/:workerId
 *
 * Record what a worker was paid for a week from before this app, or pass
 * `amount: null` to remove the record. Clears every adjustment on the week: the
 * money is already paid, so it must not move any balance.
 */
app.put("/:weekStart/old-record/:workerId", async (c) => {
  const weekStart = weekStartOf(readDate(c.req.param("weekStart"), "weekStart"));
  const workerId = readId(c, "workerId");
  const { amount } = await readJson(
    c,
    z.object({ amount: z.number().int().positive().max(100_000_000).nullable() }),
  );

  await assertWeekOpen(c.env.DB, weekStart);
  await ensureWeek(c.env.DB, weekStart);

  const worker = await c.env.DB.prepare("SELECT id FROM workers WHERE id = ?")
    .bind(workerId)
    .first<{ id: number }>();
  if (!worker) throw new HTTPException(404, { message: "Worker not found." });

  await c.env.DB.prepare(
    `INSERT INTO week_adjustments
       (week_start, worker_id, credit, deduct, debit, addback, advance_recovered, manual_wage, paid_at)
     VALUES (?1, ?2, 0, 0, 0, 0, 0, ?3, ?4)
     ON CONFLICT (week_start, worker_id) DO UPDATE SET
       credit = 0, deduct = 0, debit = 0, addback = 0, advance_recovered = 0,
       manual_wage = excluded.manual_wage,
       paid_at = excluded.paid_at`,
  )
    .bind(weekStart, workerId, amount, amount === null ? null : new Date().toISOString())
    .run();

  return c.json(await computeWeek(c.env.DB, weekStart));
});

/**
 * Apply the one-tap settlement — for one worker, or for everyone at once.
 *
 * The proposal is recomputed here rather than accepted from the request body,
 * so it can never be applied against a wage that has moved since the screen was
 * loaded. See suggestSettlement() for what it does and why.
 */
app.post("/:weekStart/settle/:workerId?", async (c) => {
  const weekStart = weekStartOf(readDate(c.req.param("weekStart"), "weekStart"));
  const workerParam = c.req.param("workerId");
  const workerId = workerParam ? readId(c, "workerId") : null;

  await assertWeekOpen(c.env.DB, weekStart);
  await ensureWeek(c.env.DB, weekStart);

  const week = await computeWeek(c.env.DB, weekStart);
  const targets = (
    workerId ? week.workers.filter((w) => w.workerId === workerId) : week.workers
  ).filter((w) => w.manualWage === null);

  if (targets.length === 0) {
    throw new HTTPException(404, {
      message: workerId ? "Worker has nothing to settle this week." : "Nothing to settle.",
    });
  }

  await c.env.DB.batch(
    targets.map((worker) =>
      c.env.DB
        .prepare(
          `INSERT INTO week_adjustments
             (week_start, worker_id, credit, deduct, debit, addback, advance_recovered)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (week_start, worker_id) DO UPDATE SET
             credit            = excluded.credit,
             deduct            = excluded.deduct,
             debit             = excluded.debit,
             addback           = excluded.addback,
             advance_recovered = excluded.advance_recovered`,
        )
        .bind(
          weekStart,
          worker.workerId,
          worker.settlement.credit,
          worker.settlement.deduct,
          worker.settlement.debit,
          worker.settlement.addback,
          // Echoed back unchanged — advances are never recovered automatically.
          worker.settlement.advanceRecovered,
        ),
    ),
  );

  return c.json(await computeWeek(c.env.DB, weekStart));
});

/**
 * Finalize the week: lock entries against editing and freeze each worker's wage
 * and net payable. The freeze is belt-and-braces — entry-level rate snapshots
 * already keep history accurate — but it also captures the figure that was
 * actually handed over, which is what you'd want in a dispute.
 */
app.post("/:weekStart/finalize", async (c) => {
  const weekStart = weekStartOf(readDate(c.req.param("weekStart"), "weekStart"));
  await ensureWeek(c.env.DB, weekStart);

  const week = await computeWeek(c.env.DB, weekStart);
  if (week.status === "finalized") {
    throw new HTTPException(409, { message: "This week is already finalized." });
  }
  if (week.workers.length === 0) {
    throw new HTTPException(400, {
      message: "Nothing to finalize — no work recorded for this week.",
    });
  }

  await c.env.DB.batch([
    ...week.workers.map((w) =>
      c.env.DB.prepare(
        `INSERT INTO week_adjustments
           (week_start, worker_id, credit, deduct, debit, addback, advance_recovered, wage, net_payable)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (week_start, worker_id) DO UPDATE SET
           wage = excluded.wage,
           net_payable = excluded.net_payable`,
      ).bind(
        weekStart,
        w.workerId,
        w.adjustments.credit,
        w.adjustments.deduct,
        w.adjustments.debit,
        w.adjustments.addback,
        w.adjustments.advanceRecovered,
        w.wage,
        w.netPayable,
      ),
    ),
    c.env.DB.prepare(
      "UPDATE weeks SET status = 'finalized', finalized_at = datetime('now') WHERE week_start = ?",
    ).bind(weekStart),
  ]);

  return c.json(await computeWeek(c.env.DB, weekStart));
});

/** Reopen a finalized week for correction, discarding the frozen figures. */
app.post("/:weekStart/reopen", async (c) => {
  const weekStart = weekStartOf(readDate(c.req.param("weekStart"), "weekStart"));

  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE weeks SET status = 'open', finalized_at = NULL WHERE week_start = ?",
    ).bind(weekStart),
    // Drop the frozen wage so the week recomputes live again.
    c.env.DB.prepare(
      "UPDATE week_adjustments SET wage = NULL, net_payable = NULL WHERE week_start = ?",
    ).bind(weekStart),
  ]);

  return c.json(await computeWeek(c.env.DB, weekStart));
});

/**
 * Wipe a week: its entries, old records, adjustments and finalized state.
 * Advances stay, since that money changed hands whatever happens to the wages.
 * The caller must pass `confirm: "reset"` to mean it.
 */
app.delete("/:weekStart", async (c) => {
  const weekStart = weekStartOf(readDate(c.req.param("weekStart"), "weekStart"));
  await readJson(c, z.object({ confirm: z.literal("reset") }));

  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM entries WHERE week_start = ?").bind(weekStart),
    c.env.DB.prepare("DELETE FROM week_adjustments WHERE week_start = ?").bind(weekStart),
    c.env.DB.prepare("DELETE FROM weeks WHERE week_start = ?").bind(weekStart),
  ]);

  return c.json({ reset: true, weekStart });
});

/** A worker's week-by-week history, for the worker detail view. */
app.get("/worker/:workerId/history", async (c) => {
  const workerId = readId(c, "workerId");
  const limit = Math.min(Number(c.req.query("limit") ?? 26) || 26, 200);

  const { results } = await c.env.DB.prepare(
    `SELECT week_start FROM (
       SELECT week_start FROM entries WHERE worker_id = ?1
       UNION
       SELECT week_start FROM week_adjustments WHERE worker_id = ?1
     ) ORDER BY week_start DESC LIMIT ?2`,
  )
    .bind(workerId, limit)
    .all<{ week_start: string }>();

  const weeks = await Promise.all(
    results.map(async (row) => {
      const week = await computeWeek(c.env.DB, row.week_start);
      const worker = week.workers.find((w) => w.workerId === workerId);
      return worker
        ? {
            weekStart: week.weekStart,
            weekEnd: weekEndOf(week.weekStart),
            status: week.status,
            ...worker,
          }
        : null;
    }),
  );

  return c.json(weeks.filter(Boolean));
});

/** Convenience: which week a date belongs to, plus its neighbours. */
app.get("/resolve/:date", async (c) => {
  const date = readDate(c.req.param("date"));
  const weekStart = weekStartOf(date);
  return c.json({
    weekStart,
    weekEnd: weekEndOf(weekStart),
    previous: addWeeks(weekStart, -1),
    next: addWeeks(weekStart, 1),
  });
});

export default app;
