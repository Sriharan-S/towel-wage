import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { toRupees } from "@shared/money";
import { todayISO, weekStartOf } from "@shared/dates";
import { loadSettings } from "../lib/db";
import { readJson, type AppEnv } from "../lib/http";
import { computeWeek } from "../lib/week";

const app = new Hono<AppEnv>();

const TABLES = [
  "work_types",
  "workers",
  "worker_rates",
  "entries",
  "weeks",
  "week_adjustments",
  "advances",
  "settings",
  "bonus_runs",
  "bonus_lines",
] as const;

/** Full JSON snapshot — the backup you can restore from. */
app.get("/export", async (c) => {
  const format = c.req.query("format") ?? "json";
  const settings = await loadSettings(c.env.DB);

  if (format === "csv") return exportCsv(c);

  const dumps = await c.env.DB.batch(
    TABLES.map((t) => c.env.DB.prepare(`SELECT * FROM ${t}`)),
  );

  const data = Object.fromEntries(
    TABLES.map((table, i) => [table, dumps[i].results]),
  );

  const filename = `towel-wage-backup-${todayISO(settings.timezone)}.json`;
  return new Response(
    JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), data }, null, 2),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    },
  );
});

/**
 * Week-by-week payroll as CSV, one row per worker per line item plus a summary
 * row per worker. Rupees here, not paise — this file is for spreadsheets.
 */
async function exportCsv(c: Context<AppEnv>) {
  const settings = await loadSettings(c.env.DB);
  const from = c.req.query("from");
  const to = c.req.query("to");

  const conditions: string[] = [];
  const binds: string[] = [];
  if (from) {
    conditions.push("week_start >= ?");
    binds.push(weekStartOf(from));
  }
  if (to) {
    conditions.push("week_start <= ?");
    binds.push(weekStartOf(to));
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  // A week that is only old records has no entries but still belongs in the file.
  const { results } = await c.env.DB.prepare(
    `SELECT week_start FROM entries ${where}
     UNION
     SELECT week_start FROM week_adjustments
       ${where ? `${where} AND` : "WHERE"} manual_wage IS NOT NULL
     ORDER BY week_start`,
  )
    .bind(...binds, ...binds)
    .all<{ week_start: string }>();

  const rows: string[][] = [
    [
      "Week start",
      "Week end",
      "Status",
      "Worker",
      "Line item",
      "Quantity",
      "Unit price",
      "Line wage",
      "Worker wage",
      "Credit",
      "Deduct",
      "Debit",
      "Add-back",
      "Net payable",
      "Paid at",
    ],
  ];

  for (const { week_start } of results) {
    const week = await computeWeek(c.env.DB, week_start);
    for (const worker of week.workers) {
      for (const item of worker.lineItems) {
        rows.push([
          week.weekStart,
          week.weekEnd,
          week.status,
          worker.workerName,
          item.name,
          item.kind === "direct_sum" ? "" : String(item.totalQuantity),
          item.kind === "count_x_price" ? toRupees(item.unitPrice).toFixed(2) : "",
          toRupees(item.wage).toFixed(2),
          "",
          "",
          "",
          "",
          "",
          "",
          "",
        ]);
      }
      rows.push([
        week.weekStart,
        week.weekEnd,
        week.status,
        worker.workerName,
        "TOTAL",
        "",
        "",
        "",
        toRupees(worker.wage).toFixed(2),
        toRupees(worker.adjustments.credit).toFixed(2),
        toRupees(worker.adjustments.deduct).toFixed(2),
        toRupees(worker.adjustments.debit).toFixed(2),
        toRupees(worker.adjustments.addback).toFixed(2),
        toRupees(worker.netPayable).toFixed(2),
        worker.paidAt ?? "",
      ]);
    }
  }

  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const filename = `towel-wage-${todayISO(settings.timezone)}.csv`;
  return new Response(`﻿${csv}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Restore from a JSON backup. Destructive by design — it replaces everything —
 * so the caller must pass `confirm: "replace-all"` to mean it.
 */
app.post("/import", async (c) => {
  const body = await readJson(
    c,
    z.object({
      confirm: z.literal("replace-all"),
      version: z.number().optional(),
      data: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
    }),
  );

  const statements: D1PreparedStatement[] = [];

  // Children first, so foreign keys never dangle mid-restore.
  for (const table of [...TABLES].reverse()) {
    statements.push(c.env.DB.prepare(`DELETE FROM ${table}`));
  }

  for (const table of TABLES) {
    const rows = body.data[table];
    if (!rows?.length) continue;
    for (const row of rows) {
      const columns = Object.keys(row);
      if (!columns.length) continue;
      statements.push(
        c.env.DB
          .prepare(
            `INSERT INTO ${table} (${columns.join(", ")})
             VALUES (${columns.map(() => "?").join(", ")})`,
          )
          .bind(...columns.map((col) => row[col] as never)),
      );
    }
  }

  try {
    await c.env.DB.batch(statements);
  } catch (err) {
    throw new HTTPException(400, {
      message: `Restore failed, nothing was changed: ${String(err)}`,
    });
  }

  return c.json({ restored: true, tables: TABLES.length });
});

export default app;
