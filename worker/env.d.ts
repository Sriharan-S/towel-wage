/**
 * Environment declared by hand rather than generated.
 *
 * APP_PIN is a Worker *secret*, so it is deliberately absent from
 * wrangler.jsonc — putting it in `vars` would commit it to the repository and
 * overwrite the real secret on every deploy. `wrangler types` only sees the
 * config file, so the declaration lives here and merges with the generated Env.
 *
 * Set it with:  npx wrangler secret put APP_PIN
 * Locally:      APP_PIN=1234 in .dev.vars
 */
interface Env {
  /** Four digits. Anything else is treated as "not configured" and locks the app. */
  APP_PIN?: string;
}
