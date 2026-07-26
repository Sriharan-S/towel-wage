import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  colorSchema,
  nameSchema,
  nonNegativePaiseSchema,
  readId,
  readJson,
  workKindSchema,
  type AppEnv,
} from "../lib/http";
import { nextSortOrder, toWorkType, type WorkTypeRow } from "../lib/db";
import { applyRateChange } from "../lib/rates";

const app = new Hono<AppEnv>();

const baseSchema = z.object({
  name: nameSchema,
  kind: workKindSchema,
  unitLabel: z.string().trim().min(1).max(24).default("towels"),
  defaultUnitPrice: nonNegativePaiseSchema.default(0),
  defaultDivisor: z.number().positive().max(1_000_000).default(75),
  defaultMultiplier: nonNegativePaiseSchema.default(3500),
  color: colorSchema.default("#6366f1"),
  isActive: z.boolean().default(true),
});

app.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM work_types ORDER BY sort_order, name",
  ).all<WorkTypeRow>();
  return c.json(results.map(toWorkType));
});

app.post("/", async (c) => {
  const body = await readJson(c, baseSchema);
  const sortOrder = await nextSortOrder(c.env.DB, "work_types");

  const row = await c.env.DB.prepare(
    `INSERT INTO work_types
       (name, kind, unit_label, default_unit_price, default_divisor,
        default_multiplier, color, is_active, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
  )
    .bind(
      body.name,
      body.kind,
      body.unitLabel,
      body.defaultUnitPrice,
      body.defaultDivisor,
      body.defaultMultiplier,
      body.color,
      body.isActive ? 1 : 0,
      sortOrder,
    )
    .first<WorkTypeRow>()
    .catch((err: Error) => {
      if (String(err).includes("UNIQUE")) {
        throw new HTTPException(409, {
          message: `A towel type called "${body.name}" already exists.`,
        });
      }
      throw err;
    });

  return c.json(toWorkType(row!), 201);
});

app.patch("/:id", async (c) => {
  const id = readId(c);
  const body = await readJson(
    c,
    baseSchema.partial().extend({
      sortOrder: z.number().int().optional(),
      /**
       * Push the new price out to everyone doing this towel type.
       *
       * Without this, editing the price here changed only the default used for
       * *new* assignments, and every existing worker carried on at their own
       * stored rate — which looked exactly like the edit being ignored.
       */
      applyToWorkers: z.boolean().optional(),
    }),
  );

  const columns: Record<string, unknown> = {
    name: body.name,
    kind: body.kind,
    unit_label: body.unitLabel,
    default_unit_price: body.defaultUnitPrice,
    default_divisor: body.defaultDivisor,
    default_multiplier: body.defaultMultiplier,
    color: body.color,
    is_active: body.isActive === undefined ? undefined : body.isActive ? 1 : 0,
    sort_order: body.sortOrder,
  };

  const sets = Object.entries(columns).filter(([, v]) => v !== undefined);
  if (sets.length === 0) throw new HTTPException(400, { message: "Nothing to update." });

  const row = await c.env.DB.prepare(
    `UPDATE work_types SET ${sets.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ? RETURNING *`,
  )
    .bind(...sets.map(([, v]) => v as never), id)
    .first<WorkTypeRow>();

  if (!row) throw new HTTPException(404, { message: "Towel type not found." });

  // Roll the new rate out to every worker doing this type, repricing the weeks
  // that have not been paid yet.
  let workersUpdated = 0;
  let entriesRepriced = 0;

  if (body.applyToWorkers) {
    const { results: assigned } = await c.env.DB.prepare(
      "SELECT * FROM worker_rates WHERE work_type_id = ?",
    )
      .bind(id)
      .all<{
        worker_id: number;
        work_type_id: number;
        unit_price: number;
        divisor: number;
        multiplier: number;
      }>();

    const after = {
      unitPrice: row.default_unit_price,
      divisor: row.default_divisor,
      multiplier: row.default_multiplier,
    };

    for (const rate of assigned) {
      await c.env.DB
        .prepare(
          `UPDATE worker_rates SET unit_price = ?, divisor = ?, multiplier = ?
            WHERE worker_id = ? AND work_type_id = ?`,
        )
        .bind(after.unitPrice, after.divisor, after.multiplier, rate.worker_id, id)
        .run();

      const change = await applyRateChange(c.env.DB, {
        workerId: rate.worker_id,
        workTypeId: id,
        before: {
          unitPrice: rate.unit_price,
          divisor: rate.divisor,
          multiplier: rate.multiplier,
        },
        after,
      });
      if (change) {
        workersUpdated += 1;
        entriesRepriced += change.entriesRepriced;
      }
    }
  }

  return c.json({ ...toWorkType(row), workersUpdated, entriesRepriced });
});

/**
 * Deleting a towel type that has entries would silently rewrite past payroll,
 * so that case deactivates instead. Only a genuinely unused type is removed.
 */
app.delete("/:id", async (c) => {
  const id = readId(c);
  const used = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM entries WHERE work_type_id = ?",
  )
    .bind(id)
    .first<{ n: number }>();

  if ((used?.n ?? 0) > 0) {
    const row = await c.env.DB.prepare(
      "UPDATE work_types SET is_active = 0 WHERE id = ? RETURNING *",
    )
      .bind(id)
      .first<WorkTypeRow>();
    if (!row) throw new HTTPException(404, { message: "Towel type not found." });
    return c.json({
      deactivated: true,
      entryCount: used!.n,
      workType: toWorkType(row),
      message: `Kept for history: this type has ${used!.n} entries. It has been hidden instead of deleted.`,
    });
  }

  const result = await c.env.DB.prepare("DELETE FROM work_types WHERE id = ?").bind(id).run();
  if (!result.meta.changes) throw new HTTPException(404, { message: "Towel type not found." });
  return c.json({ deleted: true });
});

/** Persist a drag-reorder in one batch. */
app.put("/reorder", async (c) => {
  const body = await readJson(c, z.object({ ids: z.array(z.number().int().positive()) }));
  await c.env.DB.batch(
    body.ids.map((id, index) =>
      c.env.DB.prepare("UPDATE work_types SET sort_order = ? WHERE id = ?").bind(index + 1, id),
    ),
  );
  return c.json({ ok: true });
});

export default app;
