/**
 * PIN sign-in.
 *
 * The threat model is a link that leaks — someone finding the URL should not
 * see wage data. It is deliberately NOT a defence against a determined attacker
 * who knows the address and wants in: a four-digit PIN is 10,000 combinations.
 * What makes it hold up is the lockout below, which turns an instant brute
 * force into something that would take weeks and leave a trail in the table.
 *
 * Cloudflare Access is stronger, because it authenticates before a request ever
 * reaches this Worker.
 */

import { todayISO } from "@shared/dates";

export const SESSION_COOKIE = "tw_session";

/** Failures allowed from one address before it is locked out. */
const MAX_FAILURES = 5;
/** How long the lockout lasts, and the window failures are counted over. */
const LOCKOUT_MINUTES = 15;

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Compare without leaking where two strings diverge.
 *
 * Barely matters for four digits, but a timing-safe compare costs nothing and
 * means the habit is right if the PIN ever gets longer.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** A 256-bit session token, hex encoded. */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type Role = "admin" | "manager";

export interface PinCheck {
  ok: boolean;
  /** true when the server has no PIN configured at all */
  unconfigured: boolean;
  /** which PIN matched, or null if neither did */
  role: Role | null;
}

/**
 * The PIN must be exactly four digits, whatever else the environment holds.
 *
 * Read through a cast rather than off `Env` directly. APP_PIN is a Worker
 * secret, so whether `wrangler types` declares it depends on a local .dev.vars
 * file existing — true on a developer's machine, false on a CI runner. The cast
 * makes this compile either way, and the runtime check below is what actually
 * guards it.
 */
export function readConfiguredPin(env: Env): string | null {
  const pin = (env as { APP_PIN?: string }).APP_PIN?.trim();
  return pin && /^\d{4}$/.test(pin) ? pin : null;
}

/**
 * The manager PIN, if one is set.
 *
 * Optional: with no MANAGER_PIN the app simply has one level of access, which
 * is how it behaved before roles existed.
 */
export function readManagerPin(env: Env): string | null {
  const pin = (env as { MANAGER_PIN?: string }).MANAGER_PIN?.trim();
  if (!pin || !/^\d{4}$/.test(pin)) return null;
  // A manager PIN identical to the admin one would silently grant admin, which
  // is the opposite of what setting it was meant to do.
  return pin === readConfiguredPin(env) ? null : pin;
}

export function checkPin(env: Env, candidate: string): PinCheck {
  const admin = readConfiguredPin(env);
  const manager = readManagerPin(env);

  // Fail closed. An unset or malformed PIN locks the app rather than opening
  // it — the alternative would silently publish the data.
  if (!admin) return { ok: false, unconfigured: true, role: null };

  // Both are compared every time, so the response takes the same work whether
  // the first one matched or not.
  const isAdmin = timingSafeEqual(admin, candidate);
  const isManager = manager !== null && timingSafeEqual(manager, candidate);

  return {
    ok: isAdmin || isManager,
    unconfigured: false,
    role: isAdmin ? "admin" : isManager ? "manager" : null,
  };
}

/** The caller's address, as Cloudflare sees it. */
export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export interface Lockout {
  locked: boolean;
  failures: number;
  retryAfterMinutes: number;
}

/** How many recent failures this address has, and whether it is locked out. */
export async function checkLockout(db: D1Database, ip: string): Promise<Lockout> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS failures FROM auth_attempts
       WHERE ip = ? AND ok = 0 AND attempted_at > datetime('now', ?)`,
    )
    .bind(ip, `-${LOCKOUT_MINUTES} minutes`)
    .first<{ failures: number }>();

  const failures = row?.failures ?? 0;
  return {
    locked: failures >= MAX_FAILURES,
    failures,
    retryAfterMinutes: LOCKOUT_MINUTES,
  };
}

export async function recordAttempt(db: D1Database, ip: string, ok: boolean): Promise<void> {
  await db.batch([
    db.prepare("INSERT INTO auth_attempts (ip, ok) VALUES (?, ?)").bind(ip, ok ? 1 : 0),
    // A successful sign-in clears the address's record, so a few fat-fingered
    // tries followed by the right PIN don't count against the next session.
    ...(ok ? [db.prepare("DELETE FROM auth_attempts WHERE ip = ? AND ok = 0").bind(ip)] : []),
    // Keep the table from growing without bound.
    db.prepare("DELETE FROM auth_attempts WHERE attempted_at < datetime('now', '-7 days')"),
  ]);
}

/** Open a session good until the end of the business day. */
export async function createSession(
  db: D1Database,
  env: Env,
  timezone: string,
  userAgent: string | null,
  role: Role,
): Promise<{ token: string; validFor: string; role: Role }> {
  const token = newToken();
  const validFor = todayISO(timezone);
  // Hash the PIN this role actually signed in with, so changing either PIN
  // signs out only the sessions it opened.
  const pin = role === "manager" ? readManagerPin(env) : readConfiguredPin(env);

  await db.batch([
    db
      .prepare(
        `INSERT INTO auth_sessions (token_hash, pin_hash, valid_for, user_agent, role)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        await sha256Hex(token),
        await sha256Hex(pin ?? ""),
        validFor,
        userAgent?.slice(0, 200) ?? null,
        role,
      ),
    // Yesterday's sessions are dead by definition; clear them out.
    db.prepare("DELETE FROM auth_sessions WHERE valid_for < ?").bind(validFor),
  ]);

  return { token, validFor, role };
}

/**
 * Is this token good right now?
 *
 * Three things must hold: the session exists, it is for today, and it was
 * opened with the PIN that is currently configured. The last one means
 * changing the PIN signs everyone out.
 */
export async function verifySession(
  db: D1Database,
  env: Env,
  timezone: string,
  token: string | undefined,
): Promise<Role | null> {
  if (!token) return null;
  // No admin PIN means the app is unconfigured and nothing is valid.
  if (!readConfiguredPin(env)) return null;

  const row = await db
    .prepare("SELECT pin_hash, valid_for, role FROM auth_sessions WHERE token_hash = ?")
    .bind(await sha256Hex(token))
    .first<{ pin_hash: string; valid_for: string; role: string }>();

  if (!row) return null;
  if (row.valid_for !== todayISO(timezone)) return null;

  const role: Role = row.role === "manager" ? "manager" : "admin";
  const pin = role === "manager" ? readManagerPin(env) : readConfiguredPin(env);
  if (!pin) return null;

  // The session is only good while the PIN that opened it is still the one
  // configured — changing a PIN signs out the sessions it created.
  return timingSafeEqual(row.pin_hash, await sha256Hex(pin)) ? role : null;
}

export async function destroySession(db: D1Database, token: string | undefined): Promise<void> {
  if (!token) return;
  await db
    .prepare("DELETE FROM auth_sessions WHERE token_hash = ?")
    .bind(await sha256Hex(token))
    .run();
}
