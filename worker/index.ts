/**
 * Towel Wage Manager — API Worker.
 *
 * The same Worker serves the built React app (via the static assets binding,
 * see wrangler.jsonc) and this JSON API under /api. There is deliberately no
 * authentication here: the deployment is expected to sit behind Cloudflare
 * Access, which authenticates before a request ever reaches this code.
 */

import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { todayISO } from "@shared/dates";
import { SESSION_COOKIE, verifySession } from "./lib/auth";
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
import auth from "./routes/auth";

const app = new Hono<AppEnv>();

/**
 * Nothing but the sign-in routes and a health check is reachable without a
 * session.
 *
 * The static assets are still served publicly — they are just the empty shell
 * of the app and contain no business data. The gate that matters is this one,
 * in front of everything that touches the database.
 */
app.use("/api/*", async (c, next) => {
  const path = c.req.path;
  if (path.startsWith("/api/auth/") || path === "/api/health") return next();

  const settings = await loadSettings(c.env.DB);
  const token = getCookie(c, SESSION_COOKIE);
  const role = await verifySession(c.env.DB, c.env, settings.timezone, token);

  if (!role) {
    return c.json({ error: "Not signed in." }, 401);
  }

  /*
    Managers run the day to day — entry, wages, advances, stats — but not the
    configuration that decides what anyone is paid, nor the backup that would
    hand them the whole database.

    Enforced here rather than only in the UI: hiding a tab stops it being
    found, not being called. The role comes off the session row, never off the
    request, so it cannot be raised by editing one.
  */
  if (role === "manager" && !isManagerAllowed(c.req.method, path)) {
    return c.json(
      { error: "Your PIN does not have access to this.", forbidden: true },
      403,
    );
  }

  return next();
});

/** Paths a manager may reach, by method. */
function isManagerAllowed(method: string, path: string): boolean {
  // Configuration and backups are admin-only outright.
  const adminOnly = ["/api/settings", "/api/backup"];
  if (adminOnly.some((prefix) => path.startsWith(prefix))) return false;

  // Workers and towel types stay readable — the entry and wage screens cannot
  // render without them — but not editable.
  const readOnlyForManagers = ["/api/workers", "/api/work-types"];
  if (readOnlyForManagers.some((prefix) => path.startsWith(prefix))) {
    return method === "GET" || method === "HEAD";
  }

  return true;
}

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

app.route("/api/auth", auth);
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
