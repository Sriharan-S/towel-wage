import { Hono } from "hono";
import { z } from "zod";
import { weekStartOf } from "@shared/dates";
import {
  isoDateSchema,
  paiseSchema,
  quantitySchema,
  readDate,
  readJson,
  type AppEnv,
} from "../lib/http";
import { toEntry, type EntryRow, type WorkTypeRow, type WorkerRateRow } from "../lib/db";
import { assertWeekOpen, ensureWeek } from "../lib/week";

const app = new Hono<AppEnv>();

const dayEntrySchema = z.object({
  workerId: z.number().int().positive(),
  workTypeId: z.number().int().positive(),
  /** which loom this figure came off, 1-based */
  loom: z.number().int().min(1).max(20).default(1),
  /** count, for count_x_price and formula_sum_ratio */
  quantity: quantitySchema.default(0),
  /** paise, for direct_sum */
  amount: paiseSchema.default(0),
  note: z.string().trim().max(200).nullish(),
});

/** GET /api/entries?date=YYYY-MM-DD  or  ?from=…&to=… */
app.get("/", async (c) => {
  const date = c.req.query("date");
  const from = c.req.query("from");
  const to = c.req.query("to");

  if (date) {
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM entries WHERE entry_date = ? ORDER BY worker_id, work_type_id, loom",
    )
      .bind(readDate(date))
      .all<EntryRow>();
    return c.json(results.map(toEntry));
  }

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM entries
     WHERE entry_date >= ? AND entry_date <= ?
     ORDER BY entry_date, worker_id, work_type_id`,
  )
    .bind(readDate(from, "from"), readDate(to, "to"))
    .all<EntryRow>();
  return c.json(results.map(toEntry));
});

/**
 * Replace a whole day's numbers in one request.
 *
 * The rate snapshot is resolved server-side from the worker's current rate
 * (falling back to the towel type's default) so the client can never write a
 * price the business hasn't actually configured. Rows whose value is zero are
 * deleted rather than stored, which keeps "days worked" honest and stops blank
 * rows accumulating for every worker every day.
 */
app.put("/:date", async (c) => {
  const entryDate = readDate(c.req.param("date"));
  const weekStart = weekStartOf(entryDate);
  const body = await readJson(c, z.object({ entries: z.array(dayEntrySchema) }));

  await assertWeekOpen(c.env.DB, weekStart);
  await ensureWeek(c.env.DB, weekStart);

  const [typeRes, rateRes] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM work_types"),
    c.env.DB.prepare("SELECT * FROM worker_rates"),
  ]);
  const workTypes = new Map(
    (typeRes.results as unknown as WorkTypeRow[]).map((t) => [t.id, t] as const),
  );
  const rates = new Map(
    (rateRes.results as unknown as WorkerRateRow[]).map(
      (r) => [`${r.worker_id}:${r.work_type_id}`, r] as const,
    ),
  );

  const statements: D1PreparedStatement[] = [];

  for (const item of body.entries) {
    const workType = workTypes.get(item.workTypeId);
    if (!workType) continue;

    const rate = rates.get(`${item.workerId}:${item.workTypeId}`);
    const unitPrice = rate?.unit_price ?? workType.default_unit_price;
    const divisor = rate?.divisor ?? workType.default_divisor;
    const multiplier = rate?.multiplier ?? workType.default_multiplier;

    const isDirect = workType.kind === "direct_sum";
    const quantity = isDirect ? 0 : item.quantity;
    const amount = isDirect ? item.amount : 0;
    const isEmpty = quantity === 0 && amount === 0 && !item.note;

    if (isEmpty) {
      statements.push(
        c.env.DB.prepare(
          "DELETE FROM entries WHERE entry_date = ? AND worker_id = ? AND work_type_id = ? AND loom = ?",
        ).bind(entryDate, item.workerId, item.workTypeId, item.loom),
      );
      continue;
    }

    statements.push(
      c.env.DB.prepare(
        `INSERT INTO entries
           (entry_date, week_start, worker_id, work_type_id, loom, kind, quantity, amount,
            unit_price, divisor, multiplier, note, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT (entry_date, worker_id, work_type_id, loom) DO UPDATE SET
           kind       = excluded.kind,
           quantity   = excluded.quantity,
           amount     = excluded.amount,
           unit_price = excluded.unit_price,
           divisor    = excluded.divisor,
           multiplier = excluded.multiplier,
           note       = excluded.note,
           updated_at = datetime('now')`,
      ).bind(
        entryDate,
        weekStart,
        item.workerId,
        item.workTypeId,
        item.loom,
        workType.kind,
        quantity,
        amount,
        unitPrice,
        divisor,
        multiplier,
        item.note ?? null,
      ),
    );
  }

  if (statements.length) await c.env.DB.batch(statements);

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM entries WHERE entry_date = ? ORDER BY worker_id, work_type_id, loom",
  )
    .bind(entryDate)
    .all<EntryRow>();

  return c.json({ date: entryDate, weekStart, entries: results.map(toEntry) });
});

/**
 * Copy one day's numbers onto another — the "same as yesterday" shortcut.
 * Rates are re-resolved for the target date rather than copied, so a price
 * change since the source day is picked up.
 */
app.post("/copy", async (c) => {
  const body = await readJson(
    c,
    z.object({ from: isoDateSchema, to: isoDateSchema, workerId: z.number().int().positive().optional() }),
  );

  const targetWeek = weekStartOf(body.to);
  await assertWeekOpen(c.env.DB, targetWeek);
  await ensureWeek(c.env.DB, targetWeek);

  // Nobody is copied onto a day outside their join and end dates.
  const source = await c.env.DB.prepare(
    `SELECT e.* FROM entries e JOIN workers w ON w.id = e.worker_id
     WHERE e.entry_date = ?
       AND (w.join_date IS NULL OR w.join_date <= ?)
       AND (w.end_date IS NULL OR w.end_date >= ?)
       ${body.workerId ? "AND e.worker_id = ?" : ""}`,
  )
    .bind(
      body.from,
      body.to,
      body.to,
      ...(body.workerId ? [body.workerId] : []),
    )
    .all<EntryRow>();

  if (!source.results.length) {
    return c.json({ copied: 0, message: `Nothing recorded on ${body.from}.` });
  }

  const { results: rateRows } = await c.env.DB.prepare(
    "SELECT * FROM worker_rates",
  ).all<WorkerRateRow>();
  const rates = new Map(rateRows.map((r) => [`${r.worker_id}:${r.work_type_id}`, r] as const));

  await c.env.DB.batch(
    source.results.map((row) => {
      const rate = rates.get(`${row.worker_id}:${row.work_type_id}`);
      return c.env.DB.prepare(
        `INSERT INTO entries
           (entry_date, week_start, worker_id, work_type_id, loom, kind, quantity, amount,
            unit_price, divisor, multiplier, note, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, datetime('now'))
         ON CONFLICT (entry_date, worker_id, work_type_id, loom) DO UPDATE SET
           quantity   = excluded.quantity,
           amount     = excluded.amount,
           unit_price = excluded.unit_price,
           divisor    = excluded.divisor,
           multiplier = excluded.multiplier,
           updated_at = datetime('now')`,
      ).bind(
        body.to,
        targetWeek,
        row.worker_id,
        row.work_type_id,
        row.loom,
        row.kind,
        row.quantity,
        row.amount,
        rate?.unit_price ?? row.unit_price,
        rate?.divisor ?? row.divisor,
        rate?.multiplier ?? row.multiplier,
      );
    }),
  );

  return c.json({ copied: source.results.length });
});

export default app;
