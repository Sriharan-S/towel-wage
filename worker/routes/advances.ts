import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { advanceDelta } from "@shared/calc";
import { weekStartOf } from "@shared/dates";
import {
  isoDateSchema,
  readDate,
  readId,
  readJson,
  type AppEnv,
} from "../lib/http";
import { toAdvance, type AdvanceRow, type WeekAdjustmentRow } from "../lib/db";

const app = new Hono<AppEnv>();

const advanceSchema = z.object({
  workerId: z.number().int().positive(),
  entryDate: isoDateSchema,
  kind: z.enum(["advance", "repayment"]),
  /** paise, always positive — `kind` carries the direction */
  amount: z.number().int().positive().max(100_000_000),
  note: z.string().trim().max(200).nullish(),
});

/**
 * GET /api/advances?workerId=&from=&to=&week=
 * Without filters, returns everything, newest first.
 */
app.get("/", async (c) => {
  const workerId = c.req.query("workerId");
  const week = c.req.query("week");
  const from = c.req.query("from");
  const to = c.req.query("to");

  const conditions: string[] = [];
  const binds: unknown[] = [];
  if (workerId) {
    conditions.push("worker_id = ?");
    binds.push(Number(workerId));
  }
  if (week) {
    conditions.push("week_start = ?");
    binds.push(weekStartOf(readDate(week, "week")));
  }
  if (from) {
    conditions.push("entry_date >= ?");
    binds.push(readDate(from, "from"));
  }
  if (to) {
    conditions.push("entry_date <= ?");
    binds.push(readDate(to, "to"));
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM advances ${where} ORDER BY entry_date DESC, id DESC`,
  )
    .bind(...(binds as never[]))
    .all<AdvanceRow>();

  return c.json(results.map(toAdvance));
});

/**
 * Outstanding advance per worker.
 *
 * What is still owed = everything lent, minus everything handed back, minus
 * everything already recovered from a wage.
 */
app.get("/outstanding", async (c) => {
  const [advanceRes, recoveredRes] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT worker_id, kind, amount FROM advances"),
    c.env.DB.prepare(
      "SELECT worker_id, SUM(advance_recovered) AS recovered FROM week_adjustments GROUP BY worker_id",
    ),
  ]);

  const rows = advanceRes.results as unknown as Array<{
    worker_id: number;
    kind: "advance" | "repayment";
    amount: number;
  }>;

  const byWorker = new Map<number, number>();
  for (const row of rows) {
    byWorker.set(
      row.worker_id,
      (byWorker.get(row.worker_id) ?? 0) + advanceDelta([row]),
    );
  }

  for (const row of recoveredRes.results as unknown as Array<{
    worker_id: number;
    recovered: number;
  }>) {
    byWorker.set(row.worker_id, (byWorker.get(row.worker_id) ?? 0) - (row.recovered ?? 0));
  }

  return c.json(
    [...byWorker.entries()]
      .map(([workerId, outstanding]) => ({ workerId, outstanding }))
      .filter((row) => row.outstanding !== 0),
  );
});

app.post("/", async (c) => {
  const body = await readJson(c, advanceSchema);

  const worker = await c.env.DB.prepare("SELECT id FROM workers WHERE id = ?")
    .bind(body.workerId)
    .first<{ id: number }>();
  if (!worker) throw new HTTPException(404, { message: "Worker not found." });

  const row = await c.env.DB.prepare(
    `INSERT INTO advances (worker_id, entry_date, week_start, kind, amount, note)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
  )
    .bind(
      body.workerId,
      body.entryDate,
      weekStartOf(body.entryDate),
      body.kind,
      body.amount,
      body.note ?? null,
    )
    .first<AdvanceRow>();

  return c.json(toAdvance(row!), 201);
});

app.patch("/:id", async (c) => {
  const id = readId(c);
  const body = await readJson(c, advanceSchema.partial());

  const columns: Record<string, unknown> = {
    entry_date: body.entryDate,
    week_start: body.entryDate ? weekStartOf(body.entryDate) : undefined,
    kind: body.kind,
    amount: body.amount,
    note: body.note,
  };
  const sets = Object.entries(columns).filter(([, v]) => v !== undefined);
  if (sets.length === 0) throw new HTTPException(400, { message: "Nothing to update." });

  const row = await c.env.DB.prepare(
    `UPDATE advances SET ${sets.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ? RETURNING *`,
  )
    .bind(...sets.map(([, v]) => (v === null ? null : (v as never))), id)
    .first<AdvanceRow>();

  if (!row) throw new HTTPException(404, { message: "Entry not found." });
  return c.json(toAdvance(row));
});

app.delete("/:id", async (c) => {
  const id = readId(c);
  const result = await c.env.DB.prepare("DELETE FROM advances WHERE id = ?").bind(id).run();
  if (!result.meta.changes) throw new HTTPException(404, { message: "Entry not found." });
  return c.json({ deleted: true });
});

/** A worker's full advance ledger, with a running outstanding figure. */
app.get("/worker/:workerId/ledger", async (c) => {
  const workerId = readId(c, "workerId");

  const [advanceRes, adjRes] = await c.env.DB.batch([
    c.env.DB
      .prepare("SELECT * FROM advances WHERE worker_id = ? ORDER BY entry_date, id")
      .bind(workerId),
    c.env.DB
      .prepare(
        `SELECT week_start, advance_recovered FROM week_adjustments
         WHERE worker_id = ? AND advance_recovered > 0 ORDER BY week_start`,
      )
      .bind(workerId),
  ]);

  type Row = {
    date: string;
    kind: "advance" | "repayment" | "recovered";
    amount: number;
    note: string | null;
    running: number;
  };

  const events: Array<Omit<Row, "running">> = [
    ...(advanceRes.results as unknown as AdvanceRow[]).map((r) => ({
      date: r.entry_date,
      kind: r.kind as "advance" | "repayment",
      amount: r.amount,
      note: r.note,
    })),
    ...(adjRes.results as unknown as WeekAdjustmentRow[]).map((r) => ({
      date: r.week_start,
      kind: "recovered" as const,
      amount: r.advance_recovered,
      note: "Taken off that week's wage",
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  let running = 0;
  const ledger: Row[] = events.map((event) => {
    running += event.kind === "advance" ? event.amount : -event.amount;
    return { ...event, running };
  });

  return c.json({ workerId, outstanding: running, ledger });
});

export default app;
