/**
 * Money handling.
 *
 * Every rupee amount in this app is stored and passed around as an INTEGER
 * number of paise. Nothing is ever a floating-point rupee value.
 *
 * Why: the credit/debit balance ledger carries forward indefinitely, summing
 * across every week a worker has ever been paid. With float rupees those sums
 * accumulate representation error and eventually a balance that should read
 * ₹0.00 reads ₹0.0000000001 — which then renders as a phantom pending amount.
 * Integers make the ledger exact by construction.
 */

/** Convert a user-entered rupee value to integer paise. */
export function toPaise(rupees: number): number {
  if (!Number.isFinite(rupees)) return 0;
  return Math.round(rupees * 100);
}

/** Convert integer paise to a rupee number (for display/CSV only). */
export function toRupees(paise: number): number {
  return paise / 100;
}

/** Parse a free-text rupee input ("1,980.50", "₹20", "") into paise. */
export function parseRupeeInput(input: string): number {
  const cleaned = input.replace(/[^0-9.-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return 0;
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? toPaise(value) : 0;
}

/** Parse a free-text count input into a number, tolerating blanks. */
export function parseCountInput(input: string): number {
  const cleaned = input.replace(/[^0-9.-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return 0;
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : 0;
}

/** Format paise as "₹1,980.00". */
export function formatINR(paise: number, opts: { decimals?: boolean } = {}): string {
  const { decimals = true } = opts;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  }).format(toRupees(paise));
}

/** Format paise as "1,980.00" without the currency symbol. */
export function formatAmount(paise: number, decimals = 2): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(toRupees(paise));
}

/** Format a plain count with Indian digit grouping. */
export function formatCount(value: number): string {
  const decimals = Number.isInteger(value) ? 0 : 2;
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** Compact form for chart axes: 1.2L, 45.6k, 980. */
export function formatCompactINR(paise: number): string {
  const rupees = toRupees(paise);
  const abs = Math.abs(rupees);
  if (abs >= 10_000_000) return `₹${(rupees / 10_000_000).toFixed(1)}Cr`;
  if (abs >= 100_000) return `₹${(rupees / 100_000).toFixed(1)}L`;
  if (abs >= 1_000) return `₹${(rupees / 1_000).toFixed(1)}k`;
  return `₹${Math.round(rupees)}`;
}

/**
 * Round a paise amount to the nearest multiple of `stepRupees`.
 * Used by the "round the payment to ₹10/₹50/₹100" helper on the week screen.
 */
export function roundPaiseTo(
  paise: number,
  stepRupees: number,
  direction: "up" | "down" | "nearest",
): number {
  const step = Math.max(1, Math.round(stepRupees * 100));
  if (direction === "up") return Math.ceil(paise / step) * step;
  if (direction === "down") return Math.floor(paise / step) * step;
  return Math.round(paise / step) * step;
}
