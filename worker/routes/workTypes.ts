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
  const body = await readJson(c, baseSchema.partial().extend({ sortOrder: z.number().int().optional() }));

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
  return c.json(toWorkType(row));
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
