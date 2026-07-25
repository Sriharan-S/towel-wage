# Towel Wage

Weekly wage tracking for a towel business, running on Cloudflare Workers + D1.

Record how many towels of each type each worker did per day; on Saturday the app
works out each worker's wage for the Sunday–Saturday week, handles the rounding
credits and debits, and carries the balance forward to next week automatically.

- **No landing page, no login** — put Cloudflare Access in front of it.
- **Fully editable** — add towel types, add workers, assign any number of types to
  any worker, each at that worker's own rate.
- **Historically accurate** — every entry stores the price it was recorded at, so
  changing a rate never rewrites a week you have already paid.

---

## Running it locally

```bash
npm install
```

Create the local database and load the schema and seed data:

```bash
npx wrangler d1 migrations apply towel-wage --local
```

Start the dev server (Vite serves the React app and the Worker together, against
a local D1):

```bash
npm run dev
```

Open http://localhost:5173.

### Other commands

| Command | What it does |
|---|---|
| `npm test` | Runs the wage-engine unit tests |
| `npm run build` | Type-checks and builds for production |
| `npm run deploy` | Builds and deploys to Cloudflare |
| `npm run cf-typegen` | Regenerates Worker types after editing `wrangler.jsonc` |
| `npm run db:migrate` | Applies migrations to the local database |
| `npm run db:migrate:remote` | Applies migrations to the deployed database |

To wipe the local database and start again from the seed data:

```bash
rm -rf .wrangler/state && npx wrangler d1 migrations apply towel-wage --local
```

---

## Deploying

```bash
npx wrangler login
npx wrangler d1 create towel-wage
```

Copy the `database_id` it prints into `wrangler.jsonc`, replacing
`REPLACE_WITH_DATABASE_ID`. Then:

```bash
npx wrangler d1 migrations apply towel-wage --remote
npm run deploy
```

### Secure it before entering real data

The app has **no authentication of its own** — anyone who knows the URL can read
and edit your wage records. Lock it down immediately after deploying:

1. Cloudflare dashboard → **Zero Trust** → **Access** → **Applications** → **Add an
   application** → **Self-hosted**.
2. Set the domain to your Worker's hostname (`towel-wage.<your-subdomain>.workers.dev`).
3. Add a policy: **Allow**, with an **Emails** rule listing the addresses that
   should have access.
4. Save, then open the URL in a private window to confirm you are challenged for
   a login.

---

## How the wage rules work

Each towel type is one of three kinds:

| Kind | You enter | Weekly wage |
|---|---|---|
| **Count × price** | a count each day | count × the worker's price per piece |
| **Direct amount** | a rupee amount each day | the week's amounts added up |
| **Ratio formula** | a count each day | (the week's total count ÷ divisor) × multiplier |

The ratio formula is deliberately a *weekly* calculation. Kurai Cone at ÷75 × ₹35
means 150 cones over a week pays ₹70 — not seven separate daily divisions, which
would round differently.

### The four adjustments

Net payable = **wage + credit − deduct − debit + add-back**

| Field | Meaning |
|---|---|
| **Credit** | Extra paid to round the payment **up** (wage ₹1,980, you hand over ₹2,000 → credit ₹20). The worker now owes you this. |
| **Deduct** | Taken off this week to recover an earlier credit. |
| **Debit** | Withheld to round the payment **down** (wage ₹2,010, you hand over ₹2,000 → debit ₹10). You now owe the worker this. |
| **Add back** | Paid this week to settle an earlier debit. |

### Suggested payment — the one-tap settlement

Rather than filling four fields by hand, each worker on the Wages screen shows a
**suggested payment** that does the whole thing in the right order, and explains
itself before you apply it:

> **Suggested payment ₹2,400.00**
> - Wage earned this week: ₹2,528.75
> - Take back the ₹85.00 they owed you
> - That leaves ₹2,443.75
> - Hand over the round ₹2,400.00 and hold ₹43.75 for next week
>
> *Carries forward: you will owe Nallamuthu ₹43.75.*

The algorithm:

1. **Recover what the worker owes you** — capped at what they earned this week.
   Clawing ₹500 back from a ₹300 wage would mean handing over a negative amount;
   the shortfall simply stays outstanding for next week.
2. **Pay back what you owe them**, in full.
3. **Clear the paise to the nearest rupee.** ₹2,109.56 → ₹2,110; ₹2,109.40 → ₹2,109.
   Nobody hands over 56 paise.
4. **Round to the chosen step**, preferring to **hold money back** rather than
   front it. Rounding down leaves a debit that carries to next week and costs you
   nothing; rounding up puts your own money on loan until you remember to claw it
   back. Rounding up is still available — it's a preference, not a rule.

One guard: rounding down never wipes a payment out. A ₹41 payment with a ₹100
step would floor to ₹0 — pay nothing and still owe ₹41 — so the whole-rupee
figure stands instead.

**Settle all** in the header applies this to every worker at once, which is the
normal Saturday routine. Re-running it changes nothing.

Set the step and the preference in **Settings → Round payments to** and **When it
isn't a round figure** (`Hold back` / `Nearest` / `Give extra`; default *Hold
back*).

The manual **↑/↓ ₹10 / ₹50 / ₹100** buttons and the four fields are still there
for anything the suggestion doesn't cover.

### Finalizing a week

**Finalize** locks the week's daily entries and freezes every wage figure. Later
price changes cannot alter it. Reopen the week if you need to correct something.

---

## Backups

Settings → Backup downloads either a full JSON snapshot (restorable from the same
screen) or a CSV of every week's payroll for a spreadsheet. The History screen can
export a filtered date range.

---

## Project layout

```
migrations/        D1 schema (0001) and seed data (0002)
shared/            Wage engine, money and date helpers — imported by BOTH sides,
                   so the number on screen always matches the one in the database
worker/            Hono API: routes/ per resource, lib/ for D1 mapping and week assembly
src/               React app: pages/, components/charts/, components/ui/
```

Two implementation notes worth knowing before changing anything:

- **Money is integer paise everywhere**, never floating-point rupees. The balance
  ledger accumulates across every week forever, and float drift would eventually
  show up as phantom ₹0.01 balances.
- **Dates are plain `YYYY-MM-DD` strings in the business timezone** (Asia/Kolkata
  by default), never UTC instants. The Worker runs in UTC, which is 5½ hours
  behind IST — a naive `new Date()` would file the first 5½ hours of every Indian
  day under the previous day, and on a Sunday that means the wrong pay week.
