import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { bonusAmount } from "@shared/calc";
import { weekStartOf } from "@shared/dates";
import type { ISODate } from "@shared/dates";
import type { BonusLine, BonusRun } from "@shared/types";
import { isoDateSchema, readDate, readJson, type AppEnv } from "../lib/http";
import { weeklyWages } from "../lib/earnings";

const app = new Hono<AppEnv>();

const runSchema = z.object({
  startWeek: isoDateSchema,
  endWeek: isoDateSchema,
  percent: z.number().positive().max(100),
  excluded: z.array(z.number().int().positive()).default([]),
});

interface RunRow {
  year: number;
  start_week: string;
  end_week: string;
  percent: number;
  excluded: string;
  finalized_at: string | null;
}

interface LineRow {
  worker_id: number;
  worker_name: string;
  earned: number;
  weeks_worked: number;
  bonus: number;
  included: number;
}

/** Every worker's total earnings across a range of weeks. */
async function earningsInRange(
  db: D1Database,
  startWeek: ISODate,
  endWeek: ISODate,
  percent: number,
  excluded: number[],
): Promise<BonusLine[]> {
  const { workers, wages } = await weeklyWages(db, startWeek, endWeek);

  const earned = new Map<number, { earned: number; weeksWorked: number }>();
  for (const { workerId, wage } of wages) {
    if (wage <= 0) continue;
    const total = earned.get(workerId) ?? { earned: 0, weeksWorked: 0 };
    total.earned += wage;
    total.weeksWorked += 1;
    earned.set(workerId, total);
  }

  return workers.flatMap((worker) => {
    const total = earned.get(worker.id);
    if (!total) return [];
    return [
      {
        workerId: worker.id,
        workerName: worker.name,
        earned: total.earned,
        weeksWorked: total.weeksWorked,
        bonus: bonusAmount(total.earned, percent),
        included: !excluded.includes(worker.id),
      },
    ];
  });
}

function toRun(row: RunRow, workers: BonusLine[]): BonusRun {
  const included = workers.filter((w) => w.included);
  return {
    year: row.year,
    startWeek: row.start_week,
    endWeek: row.end_week,
    percent: row.percent,
    status: row.finalized_at ? "finalized" : "draft",
    finalizedAt: row.finalized_at,
    workers,
    totals: {
      workers: included.length,
      earned: included.reduce((sum, w) => sum + w.earned, 0),
      bonus: included.reduce((sum, w) => sum + w.bonus, 0),
    },
  };
}

/** A finalized run reads its frozen lines; a draft is worked out afresh. */
async function buildRun(db: D1Database, row: RunRow): Promise<BonusRun> {
  if (row.finalized_at) {
    const { results } = await db
      .prepare("SELECT * FROM bonus_lines WHERE year = ? ORDER BY sort_order")
      .bind(row.year)
      .all<LineRow>();
    return toRun(
      row,
      results.map((line) => ({
        workerId: line.worker_id,
        workerName: line.worker_name,
        earned: line.earned,
        weeksWorked: line.weeks_worked,
        bonus: line.bonus,
        included: line.included === 1,
      })),
    );
  }
  const excluded = JSON.parse(row.excluded) as number[];
  return toRun(row, await earningsInRange(db, row.start_week, row.end_week, row.percent, excluded));
}

const loadRow = (db: D1Database, year: number) =>
  db.prepare("SELECT * FROM bonus_runs WHERE year = ?").bind(year).first<RunRow>();

function readYear(value: string): number {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new HTTPException(400, { message: "Invalid year." });
  }
  return year;
}

/** The bonus whose last week is this one, for the wages page. Null when none. */
app.get("/week/:weekStart", async (c) => {
  const weekStart = weekStartOf(readDate(c.req.param("weekStart"), "weekStart"));
  const row = await c.env.DB.prepare("SELECT * FROM bonus_runs WHERE end_week = ?")
    .bind(weekStart)
    .first<RunRow>();
  return c.json(row ? await buildRun(c.env.DB, row) : null);
});

app.get("/:year", async (c) => {
  const row = await loadRow(c.env.DB, readYear(c.req.param("year")));
  return c.json(row ? await buildRun(c.env.DB, row) : null);
});

/** Save the range and percentage. The year is the year the last week falls in. */
app.put("/:year", async (c) => {
  const year = readYear(c.req.param("year"));
  const body = await readJson(c, runSchema);
  const startWeek = weekStartOf(body.startWeek);
  const endWeek = weekStartOf(body.endWeek);

  if (startWeek > endWeek) {
    throw new HTTPException(400, { message: "The start week must not be after the end week." });
  }
  if (Number(endWeek.slice(0, 4)) !== year) {
    throw new HTTPException(400, { message: `The end week must fall in ${year}.` });
  }

  const existing = await loadRow(c.env.DB, year);
  if (existing?.finalized_at) {
    throw new HTTPException(409, { message: "This bonus is finalized. Reopen it to change it." });
  }

  await c.env.DB.prepare(
    `INSERT INTO bonus_runs (year, start_week, end_week, percent, excluded)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT (year) DO UPDATE SET
       start_week = excluded.start_week,
       end_week   = excluded.end_week,
       percent    = excluded.percent,
       excluded   = excluded.excluded`,
  )
    .bind(year, startWeek, endWeek, body.percent, JSON.stringify(body.excluded))
    .run();

  const row = await loadRow(c.env.DB, year);
  return c.json(await buildRun(c.env.DB, row!));
});

app.post("/:year/finalize", async (c) => {
  const year = readYear(c.req.param("year"));
  const row = await loadRow(c.env.DB, year);
  if (!row) throw new HTTPException(404, { message: "Save the bonus first." });
  if (row.finalized_at) throw new HTTPException(409, { message: "Already finalized." });

  const run = await buildRun(c.env.DB, row);
  if (run.workers.length === 0) {
    throw new HTTPException(400, { message: "Nobody earned anything in these weeks." });
  }

  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM bonus_lines WHERE year = ?").bind(year),
    ...run.workers.map((w, index) =>
      c.env.DB.prepare(
        `INSERT INTO bonus_lines
           (year, worker_id, worker_name, earned, weeks_worked, bonus, included, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(year, w.workerId, w.workerName, w.earned, w.weeksWorked, w.bonus, w.included ? 1 : 0, index),
    ),
    c.env.DB.prepare("UPDATE bonus_runs SET finalized_at = datetime('now') WHERE year = ?").bind(year),
  ]);

  return c.json(await buildRun(c.env.DB, (await loadRow(c.env.DB, year))!));
});

/** Reopen for correction, discarding the frozen figures. */
app.post("/:year/reopen", async (c) => {
  const year = readYear(c.req.param("year"));
  const row = await loadRow(c.env.DB, year);
  if (!row) throw new HTTPException(404, { message: "No bonus for this year." });

  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM bonus_lines WHERE year = ?").bind(year),
    c.env.DB.prepare("UPDATE bonus_runs SET finalized_at = NULL WHERE year = ?").bind(year),
  ]);

  return c.json(await buildRun(c.env.DB, (await loadRow(c.env.DB, year))!));
});

export default app;
