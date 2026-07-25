/**
 * Towel Wage Manager — API Worker.
 *
 * The same Worker serves the built React app (via the static assets binding,
 * see wrangler.jsonc) and this JSON API under /api. There is deliberately no
 * authentication here: the deployment is expected to sit behind Cloudflare
 * Access, which authenticates before a request ever reaches this code.
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { todayISO } from "@shared/dates";
import type { AppEnv } from "./lib/http";
import {
  loadSettings,
  toWorkType,
  toWorker,
  toWorkerRate,
  type WorkTypeRow,
  type WorkerRateRow,
  type WorkerRow,
} from "./lib/db";
import workers from "./routes/workers";
import workTypes from "./routes/workTypes";
import entries from "./routes/entries";
import weeks from "./routes/weeks";
import stats from "./routes/stats";
import settings from "./routes/settings";
import backup from "./routes/backup";
import advances from "./routes/advances";

const app = new Hono<AppEnv>();

/**
 * Everything the app needs to render its first screen, in a single round trip.
 * Saves a cold-start waterfall of four separate requests on a phone.
 */
app.get("/api/bootstrap", async (c) => {
  const [workerRes, typeRes, rateRes] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM workers ORDER BY sort_order, name"),
    c.env.DB.prepare("SELECT * FROM work_types ORDER BY sort_order, name"),
    c.env.DB.prepare("SELECT * FROM worker_rates ORDER BY sort_order, id"),
  ]);
  const appSettings = await loadSettings(c.env.DB);

  return c.json({
    workers: (workerRes.results as unknown as WorkerRow[]).map(toWorker),
    workTypes: (typeRes.results as unknown as WorkTypeRow[]).map(toWorkType),
    rates: (rateRes.results as unknown as WorkerRateRow[]).map(toWorkerRate),
    settings: appSettings,
    today: todayISO(appSettings.timezone),
  });
});

app.get("/api/health", (c) => c.json({ ok: true }));

app.route("/api/workers", workers);
app.route("/api/work-types", workTypes);
app.route("/api/entries", entries);
app.route("/api/weeks", weeks);
app.route("/api/stats", stats);
app.route("/api/advances", advances);
app.route("/api/settings", settings);
app.route("/api/backup", backup);

app.notFound((c) => c.json({ error: `No API route for ${c.req.path}` }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error("Unhandled error", err);
  return c.json({ error: "Something went wrong. Please try again." }, 500);
});

export default app;
