import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  nameSchema,
  nonNegativePaiseSchema,
  readId,
  readJson,
  type AppEnv,
} from "../lib/http";
import { applyRateChange } from "../lib/rates";
import {
  nextSortOrder,
  toWorker,
  toWorkerRate,
  type WorkerRateRow,
  type WorkerRow,
} from "../lib/db";

const app = new Hono<AppEnv>();

const workerSchema = z.object({
  name: nameSchema,
  phone: z.string().trim().max(24).nullish(),
  notes: z.string().trim().max(500).nullish(),
  isActive: z.boolean().default(true),
});

/** One work type assigned to this worker, with the rate they are paid for it. */
const rateSchema = z.object({
  workTypeId: z.number().int().positive(),
  unitPrice: nonNegativePaiseSchema.default(0),
  divisor: z.number().positive().max(1_000_000).default(75),
  multiplier: nonNegativePaiseSchema.default(3500),
  /** how many looms this worker runs on this type */
  looms: z.number().int().min(1).max(20).default(1),
  isActive: z.boolean().default(true),
});

app.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM workers ORDER BY sort_order, name",
  ).all<WorkerRow>();
  return c.json(results.map(toWorker));
});

app.post("/", async (c) => {
  const body = await readJson(c, workerSchema);
  const sortOrder = await nextSortOrder(c.env.DB, "workers");

  const row = await c.env.DB.prepare(
    `INSERT INTO workers (name, phone, notes, is_active, sort_order)
     VALUES (?, ?, ?, ?, ?) RETURNING *`,
  )
    .bind(body.name, body.phone ?? null, body.notes ?? null, body.isActive ? 1 : 0, sortOrder)
    .first<WorkerRow>();

  return c.json(toWorker(row!), 201);
});

app.patch("/:id", async (c) => {
  const id = readId(c);
  const body = await readJson(
    c,
    workerSchema.partial().extend({ sortOrder: z.number().int().optional() }),
  );

  const columns: Record<string, unknown> = {
    name: body.name,
    phone: body.phone,
    notes: body.notes,
    is_active: body.isActive === undefined ? undefined : body.isActive ? 1 : 0,
    sort_order: body.sortOrder,
  };
  const sets = Object.entries(columns).filter(([, v]) => v !== undefined);
  if (sets.length === 0) throw new HTTPException(400, { message: "Nothing to update." });

  const row = await c.env.DB.prepare(
    `UPDATE workers SET ${sets.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ? RETURNING *`,
  )
    .bind(...sets.map(([, v]) => (v === null ? null : (v as never))), id)
    .first<WorkerRow>();

  if (!row) throw new HTTPException(404, { message: "Worker not found." });
  return c.json(toWorker(row));
});

/**
 * A worker with recorded work is deactivated rather than deleted — removing
 * them would cascade their entries away and erase weeks already paid.
 */
app.delete("/:id", async (c) => {
  const id = readId(c);
  const used = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM entries WHERE worker_id = ?")
    .bind(id)
    .first<{ n: number }>();

  if ((used?.n ?? 0) > 0) {
    const row = await c.env.DB.prepare(
      "UPDATE workers SET is_active = 0 WHERE id = ? RETURNING *",
    )
      .bind(id)
      .first<WorkerRow>();
    if (!row) throw new HTTPException(404, { message: "Worker not found." });
    return c.json({
      deactivated: true,
      entryCount: used!.n,
      worker: toWorker(row),
      message: `Kept for history: this worker has ${used!.n} entries. They have been marked inactive instead of deleted.`,
    });
  }

  const result = await c.env.DB.prepare("DELETE FROM workers WHERE id = ?").bind(id).run();
  if (!result.meta.changes) throw new HTTPException(404, { message: "Worker not found." });
  return c.json({ deleted: true });
});

app.put("/reorder", async (c) => {
  const body = await readJson(c, z.object({ ids: z.array(z.number().int().positive()) }));
  await c.env.DB.batch(
    body.ids.map((id, index) =>
      c.env.DB.prepare("UPDATE workers SET sort_order = ? WHERE id = ?").bind(index + 1, id),
    ),
  );
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// rate assignment — which towel types this worker does, and at what price
// ---------------------------------------------------------------------------

app.get("/:id/rates", async (c) => {
  const id = readId(c);
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM worker_rates WHERE worker_id = ? ORDER BY sort_order, id",
  )
    .bind(id)
    .all<WorkerRateRow>();
  return c.json(results.map(toWorkerRate));
});

/**
 * Reorder a worker's towel types.
 *
 * The order is the order they are entered in each day, so it wants to match
 * however the work actually comes off the floor. Changing it here affects every
 * future day; past entries are untouched, since order is presentation only.
 */
app.put("/:id/rates/order", async (c) => {
  const id = readId(c);
  const body = await readJson(
    c,
    z.object({ workTypeIds: z.array(z.number().int().positive()).min(1) }),
  );

  await c.env.DB.batch(
    body.workTypeIds.map((workTypeId, index) =>
      c.env.DB
        .prepare(
          "UPDATE worker_rates SET sort_order = ? WHERE worker_id = ? AND work_type_id = ?",
        )
        .bind(index + 1, id, workTypeId),
    ),
  );

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM worker_rates WHERE worker_id = ? ORDER BY sort_order, id",
  )
    .bind(id)
    .all<WorkerRateRow>();
  return c.json(results.map(toWorkerRate));
});

/**
 * Replace the worker's whole assignment list in one shot.
 *
 * Rates are only ever read for *future* entries: every entry snapshots the rate
 * it was created with, so changing prices here can never alter a past week.
 */
app.put("/:id/rates", async (c) => {
  const id = readId(c);
  const body = await readJson(c, z.object({ rates: z.array(rateSchema) }));

  const seen = new Set<number>();
  for (const rate of body.rates) {
    if (seen.has(rate.workTypeId)) {
      throw new HTTPException(400, {
        message: "The same towel type is assigned twice.",
      });
    }
    seen.add(rate.workTypeId);
  }

  const worker = await c.env.DB.prepare("SELECT id FROM workers WHERE id = ?")
    .bind(id)
    .first<{ id: number }>();
  if (!worker) throw new HTTPException(404, { message: "Worker not found." });

  // Captured before the write, so a price change can be detected afterwards.
  const { results: existing } = await c.env.DB.prepare(
    "SELECT * FROM worker_rates WHERE worker_id = ?",
  )
    .bind(id)
    .all<WorkerRateRow>();
  const existingByType = new Map(existing.map((r) => [r.work_type_id, r] as const));

  const keepIds = body.rates.map((r) => r.workTypeId);
  const statements = [
    keepIds.length
      ? c.env.DB.prepare(
          `DELETE FROM worker_rates
           WHERE worker_id = ? AND work_type_id NOT IN (${keepIds.map(() => "?").join(",")})`,
        ).bind(id, ...keepIds)
      : c.env.DB.prepare("DELETE FROM worker_rates WHERE worker_id = ?").bind(id),
    ...body.rates.map((rate, index) =>
      c.env.DB.prepare(
        `INSERT INTO worker_rates
           (worker_id, work_type_id, unit_price, divisor, multiplier, looms, is_active, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (worker_id, work_type_id) DO UPDATE SET
           unit_price = excluded.unit_price,
           divisor    = excluded.divisor,
           multiplier = excluded.multiplier,
           looms      = excluded.looms,
           is_active  = excluded.is_active,
           sort_order = excluded.sort_order`,
      ).bind(
        id,
        rate.workTypeId,
        rate.unitPrice,
        rate.divisor,
        rate.multiplier,
        rate.looms,
        rate.isActive ? 1 : 0,
        index + 1,
      ),
    ),
  ];

  await c.env.DB.batch(statements);

  /*
    A changed price is not just a setting: every week that has not been paid
    yet should reflect it. Reprice those, leave finalized weeks frozen, and
    record what moved.
  */
  let repriced = 0;
  for (const rate of body.rates) {
    const was = existingByType.get(rate.workTypeId);
    if (!was) continue;
    const change = await applyRateChange(c.env.DB, {
      workerId: id,
      workTypeId: rate.workTypeId,
      before: {
        unitPrice: was.unit_price,
        divisor: was.divisor,
        multiplier: was.multiplier,
      },
      after: {
        unitPrice: rate.unitPrice,
        divisor: rate.divisor,
        multiplier: rate.multiplier,
      },
    });
    if (change) repriced += change.entriesRepriced;
  }

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM worker_rates WHERE worker_id = ? ORDER BY sort_order, id",
  )
    .bind(id)
    .all<WorkerRateRow>();
  return c.json({ rates: results.map(toWorkerRate), entriesRepriced: repriced });
});

export default app;
