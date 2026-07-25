/**
 * Calendar date handling.
 *
 * All dates in this app are plain 'YYYY-MM-DD' strings representing a calendar
 * day in the *business* timezone (Asia/Kolkata by default) — not instants.
 *
 * This matters because the Worker runs in UTC, which is 5h30m behind IST. A
 * naive `new Date().toISOString().slice(0,10)` on the server would report the
 * previous day for the first five and a half hours of every Indian day, so an
 * entry made at 9am Monday IST would land on Sunday and roll into the wrong
 * week. Everything below goes through Intl with an explicit timeZone instead.
 */

export const DEFAULT_TIMEZONE = "Asia/Kolkata";

/** ISO date string, 'YYYY-MM-DD'. */
export type ISODate = string;

const isoFormatterCache = new Map<string, Intl.DateTimeFormat>();

function isoFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = isoFormatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    isoFormatterCache.set(timeZone, fmt);
  }
  return fmt;
}

/** Today's calendar date in the business timezone. */
export function todayISO(timeZone: string = DEFAULT_TIMEZONE, now: Date = new Date()): ISODate {
  // en-CA formats as YYYY-MM-DD, which is exactly the shape we want.
  return isoFormatter(timeZone).format(now);
}

/**
 * Format a stored UTC timestamp as a clock time in the business timezone.
 *
 * SQLite's datetime('now') gives 'YYYY-MM-DD HH:MM:SS' with no zone marker, so
 * the Z has to be added back before it is parsed — without it the browser would
 * read the string as local time and show a figure five and a half hours out.
 */
export function formatTimeIn(timestamp: string, timeZone: string = DEFAULT_TIMEZONE): string {
  const normalised = timestamp.includes("T") ? timestamp : timestamp.replace(" ", "T");
  const withZone = /[Zz]|[+-]\d{2}:?\d{2}$/.test(normalised) ? normalised : `${normalised}Z`;
  const date = new Date(withZone);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** True if the string is a well-formed, real calendar date. */
export function isValidISODate(value: unknown): value is ISODate {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
  );
}

/**
 * Parse 'YYYY-MM-DD' into a UTC-noon Date.
 *
 * Noon rather than midnight so that any incidental timezone shift in downstream
 * formatting can't tip the value into the adjacent day.
 */
export function parseISO(date: ISODate): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

/** Serialise a UTC-noon Date back to 'YYYY-MM-DD'. */
export function toISO(date: Date): ISODate {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Shift a date by whole days. */
export function addDays(date: ISODate, days: number): ISODate {
  const d = parseISO(date);
  d.setUTCDate(d.getUTCDate() + days);
  return toISO(d);
}

/** Day of week, 0 = Sunday .. 6 = Saturday. */
export function dayOfWeek(date: ISODate): number {
  return parseISO(date).getUTCDay();
}

/** The Sunday that begins the pay week containing `date`. */
export function weekStartOf(date: ISODate): ISODate {
  return addDays(date, -dayOfWeek(date));
}

/** The Saturday that ends the pay week beginning at `weekStart`. */
export function weekEndOf(weekStart: ISODate): ISODate {
  return addDays(weekStart, 6);
}

/** All seven dates of a pay week, Sunday first. */
export function weekDays(weekStart: ISODate): ISODate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** Move `count` whole weeks from a week start. */
export function addWeeks(weekStart: ISODate, count: number): ISODate {
  return addDays(weekStart, count * 7);
}

/** Whole days between two dates (b - a). */
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86_400_000);
}

/** The last `count` week starts, oldest first, ending with the week containing `date`. */
export function recentWeekStarts(date: ISODate, count: number): ISODate[] {
  const current = weekStartOf(date);
  return Array.from({ length: count }, (_, i) => addWeeks(current, i - (count - 1)));
}

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LONG_DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function shortDayName(date: ISODate): string {
  return SHORT_DAYS[dayOfWeek(date)];
}

export function longDayName(date: ISODate): string {
  return LONG_DAYS[dayOfWeek(date)];
}

/** "24 Jul" */
export function formatDayMonth(date: ISODate): string {
  const d = parseISO(date);
  return `${d.getUTCDate()} ${SHORT_MONTHS[d.getUTCMonth()]}`;
}

/** "24 Jul 2026" */
export function formatFullDate(date: ISODate): string {
  return `${formatDayMonth(date)} ${parseISO(date).getUTCFullYear()}`;
}

/** "Sun 19 Jul" */
export function formatDayLabel(date: ISODate): string {
  return `${shortDayName(date)} ${formatDayMonth(date)}`;
}

/** "19–25 Jul 2026", collapsing the month/year when they match. */
export function formatWeekRange(weekStart: ISODate): string {
  const start = parseISO(weekStart);
  const end = parseISO(weekEndOf(weekStart));
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const startPart = sameMonth && sameYear
    ? String(start.getUTCDate())
    : `${start.getUTCDate()} ${SHORT_MONTHS[start.getUTCMonth()]}`;
  const endPart = `${end.getUTCDate()} ${SHORT_MONTHS[end.getUTCMonth()]}`;
  return `${startPart}–${endPart} ${end.getUTCFullYear()}`;
}

/** "Today" / "Yesterday" / "Sun 19 Jul" relative to the business today. */
export function relativeDayLabel(date: ISODate, today: ISODate): string {
  const diff = daysBetween(today, date);
  if (diff === 0) return "Today";
  if (diff === -1) return "Yesterday";
  if (diff === 1) return "Tomorrow";
  return formatDayLabel(date);
}

/** "This week" / "Last week" / "19–25 Jul 2026". */
export function relativeWeekLabel(weekStart: ISODate, today: ISODate): string {
  const diff = daysBetween(weekStartOf(today), weekStart) / 7;
  if (diff === 0) return "This week";
  if (diff === -1) return "Last week";
  if (diff === 1) return "Next week";
  return formatWeekRange(weekStart);
}
