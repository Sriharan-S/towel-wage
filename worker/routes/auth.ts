import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { loadSettings } from "../lib/db";
import { readJson, type AppEnv } from "../lib/http";
import {
  SESSION_COOKIE,
  checkLockout,
  checkPin,
  clientIp,
  createSession,
  destroySession,
  readConfiguredPin,
  recordAttempt,
  verifySession,
} from "../lib/auth";

const app = new Hono<AppEnv>();

const loginSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, "must be four digits"),
});

/**
 * Cookie settings.
 *
 * httpOnly keeps the token out of reach of any script on the page, so an
 * injected script cannot lift the session. SameSite=Strict means it is never
 * sent from another site, which removes CSRF without a token dance.
 *
 * Secure follows the actual protocol rather than being hard-coded: production
 * is always HTTPS and gets it, while the local dev server over plain HTTP would
 * otherwise have the cookie dropped and never be able to sign in.
 */
function cookieOptions(url: string) {
  return {
    httpOnly: true,
    secure: new URL(url).protocol === "https:",
    sameSite: "Strict",
    path: "/",
    // A day is the most it can ever be worth; the server checks the real expiry.
    maxAge: 60 * 60 * 24,
  } as const;
}

app.get("/session", async (c) => {
  const settings = await loadSettings(c.env.DB);
  const token = getCookie(c, SESSION_COOKIE);
  const authenticated = await verifySession(c.env.DB, c.env, settings.timezone, token);

  return c.json({
    authenticated,
    configured: readConfiguredPin(c.env) !== null,
    businessName: settings.businessName,
  });
});

app.post("/login", async (c) => {
  const ip = clientIp(c.req.raw);
  const settings = await loadSettings(c.env.DB);

  // Check the lockout before looking at the PIN at all, so a locked-out
  // address learns nothing from the response.
  const lockout = await checkLockout(c.env.DB, ip);
  if (lockout.locked) {
    return c.json(
      {
        error: `Too many wrong PINs. Try again in ${lockout.retryAfterMinutes} minutes.`,
        lockedOut: true,
      },
      429,
    );
  }

  const body = await readJson(c, loginSchema);
  const result = checkPin(c.env, body.pin);

  if (result.unconfigured) {
    return c.json(
      {
        error:
          "No PIN is set on the server. Add an APP_PIN secret to the Worker, then reload.",
        unconfigured: true,
      },
      503,
    );
  }

  await recordAttempt(c.env.DB, ip, result.ok);

  if (!result.ok) {
    const after = await checkLockout(c.env.DB, ip);
    const left = Math.max(0, 5 - after.failures);
    return c.json(
      {
        error: left > 0 ? `Wrong PIN. ${left} attempts left.` : "Wrong PIN.",
        attemptsLeft: left,
      },
      401,
    );
  }

  const session = await createSession(
    c.env.DB,
    c.env,
    settings.timezone,
    c.req.header("user-agent") ?? null,
  );
  setCookie(c, SESSION_COOKIE, session.token, cookieOptions(c.req.url));

  return c.json({ authenticated: true, validFor: session.validFor });
});

app.post("/logout", async (c) => {
  await destroySession(c.env.DB, getCookie(c, SESSION_COOKIE));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ authenticated: false });
});

export default app;
