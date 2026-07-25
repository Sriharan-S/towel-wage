import { z } from "zod";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { isValidISODate } from "@shared/dates";
import { WORK_KINDS } from "@shared/types";

export type AppEnv = { Bindings: Env };

/** Parse and validate a JSON body, turning Zod errors into a 400. */
export async function readJson<T extends z.ZodTypeAny>(
  c: Context<AppEnv>,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Request body must be valid JSON." });
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    throw new HTTPException(400, { message: detail });
  }
  return result.data;
}

/** A route param that must be a positive integer id. */
export function readId(c: Context<AppEnv>, name = "id"): number {
  const value = Number(c.req.param(name));
  if (!Number.isInteger(value) || value <= 0) {
    throw new HTTPException(400, { message: `Invalid ${name}.` });
  }
  return value;
}

/** A route param or query value that must be a 'YYYY-MM-DD' calendar date. */
export function readDate(value: string | undefined, label = "date"): string {
  if (!isValidISODate(value)) {
    throw new HTTPException(400, { message: `${label} must be a YYYY-MM-DD date.` });
  }
  return value;
}

export const isoDateSchema = z
  .string()
  .refine(isValidISODate, "must be a YYYY-MM-DD date");

/** Money, in whole paise. Rejects fractional paise outright. */
export const paiseSchema = z
  .number()
  .int("must be a whole number of paise")
  .min(-1_000_000_000)
  .max(1_000_000_000);

export const nonNegativePaiseSchema = paiseSchema.min(0);

export const quantitySchema = z.number().finite().min(0).max(10_000_000);

export const workKindSchema = z.enum(
  WORK_KINDS as [(typeof WORK_KINDS)[number], ...(typeof WORK_KINDS)[number][]],
);

export const nameSchema = z.string().trim().min(1, "cannot be empty").max(80);

export const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "must be a hex colour like #4f46e5");
