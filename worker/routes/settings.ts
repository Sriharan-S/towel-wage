import { Hono } from "hono";
import { z } from "zod";
import { loadSettings } from "../lib/db";
import { readJson, type AppEnv } from "../lib/http";

const app = new Hono<AppEnv>();

const settingsSchema = z.object({
  businessName: z.string().trim().min(1).max(80).optional(),
  businessAddress: z.string().trim().max(300).optional(),
  timezone: z
    .string()
    .trim()
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en-CA", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "unknown timezone")
    .optional(),
  roundingStep: z.number().int().positive().max(10_000).optional(),
  roundingMode: z.enum(["hold", "nearest", "give"]).optional(),
  currency: z.string().trim().length(3).optional(),
});

app.get("/", async (c) => c.json(await loadSettings(c.env.DB)));

app.patch("/", async (c) => {
  const body = await readJson(c, settingsSchema);

  const pairs: Array<[string, string]> = [];
  if (body.businessName !== undefined) pairs.push(["business_name", body.businessName]);
  if (body.businessAddress !== undefined)
    pairs.push(["business_address", body.businessAddress]);
  if (body.timezone !== undefined) pairs.push(["timezone", body.timezone]);
  if (body.roundingStep !== undefined) pairs.push(["rounding_step", String(body.roundingStep)]);
  if (body.roundingMode !== undefined) pairs.push(["rounding_mode", body.roundingMode]);
  if (body.currency !== undefined) pairs.push(["currency", body.currency]);

  if (pairs.length) {
    await c.env.DB.batch(
      pairs.map(([key, value]) =>
        c.env.DB
          .prepare(
            `INSERT INTO settings (key, value) VALUES (?, ?)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
          )
          .bind(key, value),
      ),
    );
  }

  return c.json(await loadSettings(c.env.DB));
});

export default app;
