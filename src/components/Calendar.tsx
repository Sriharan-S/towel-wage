import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton, cx } from "@/components/ui";
import {
  addDays,
  daysBetween,
  parseISO,
  toISO,
  weekStartOf,
} from "@shared/dates";
import type { ISODate } from "@shared/dates";

const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** First day of the month containing `date`. */
function monthStart(date: ISODate): ISODate {
  return `${date.slice(0, 7)}-01`;
}

function addMonths(date: ISODate, delta: number): ISODate {
  const d = parseISO(date);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return toISO(d);
}

/**
 * Month grid.
 *
 * Days with recorded work carry a dot, so you can see at a glance which days
 * still need entering — the main reason to open a calendar in this app.
 */
export function Calendar({
  value,
  onSelect,
  today,
  markedDays,
  maxDate,
}: {
  value: ISODate;
  onSelect: (date: ISODate) => void;
  today: ISODate;
  /** dates that already have entries */
  markedDays?: Set<ISODate>;
  maxDate?: ISODate;
}) {
  const [cursor, setCursor] = useState(() => monthStart(value));

  useEffect(() => setCursor(monthStart(value)), [value]);

  const cells = useMemo(() => {
    const first = parseISO(cursor);
    const gridStart = weekStartOf(cursor);
    const month = first.getUTCMonth();
    return Array.from({ length: 42 }, (_, i) => {
      const date = addDays(gridStart, i);
      return { date, inMonth: parseISO(date).getUTCMonth() === month };
    });
  }, [cursor]);

  // Trim a trailing all-blank week so short months don't leave a gap.
  const rows = cells.length === 42 && cells.slice(35).every((c) => !c.inMonth) ? 5 : 6;
  const visible = cells.slice(0, rows * 7);

  const label = `${MONTHS[parseISO(cursor).getUTCMonth()]} ${parseISO(cursor).getUTCFullYear()}`;

  return (
    <div className="w-64 select-none p-2">
      <div className="mb-1 flex items-center justify-between">
        <IconButton label="Previous month" size={24} onClick={() => setCursor(addMonths(cursor, -1))}>
          <ChevronLeft size={15} />
        </IconButton>
        <span className="text-xs font-semibold">{label}</span>
        <IconButton label="Next month" size={24} onClick={() => setCursor(addMonths(cursor, 1))}>
          <ChevronRight size={15} />
        </IconButton>
      </div>

      <div className="grid grid-cols-7 gap-px">
        {DOW.map((d, i) => (
          <div key={i} className="pb-1 text-center text-[10px] font-medium ink-4">
            {d}
          </div>
        ))}

        {visible.map(({ date, inMonth }) => {
          const selected = date === value;
          const isToday = date === today;
          const disabled = maxDate ? date > maxDate : false;
          const marked = markedDays?.has(date);

          return (
            <button
              key={date}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(date)}
              aria-current={selected ? "date" : undefined}
              className={cx(
                "relative flex h-7 items-center justify-center rounded text-xs tnum transition-colors",
                "disabled:pointer-events-none disabled:opacity-25",
                !selected && "hover:bg-[color:var(--panel-3)]",
              )}
              style={{
                background: selected ? "var(--accent)" : undefined,
                color: selected
                  ? "#fff"
                  : inMonth
                    ? isToday
                      ? "var(--accent)"
                      : "var(--ink)"
                    : "var(--ink-4)",
                fontWeight: selected || isToday ? 600 : 400,
              }}
            >
              {parseISO(date).getUTCDate()}
              {marked && !selected && (
                <span
                  className="absolute bottom-0.5 h-1 w-1 rounded-full"
                  style={{ background: "var(--accent)" }}
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex gap-1 border-t pt-2" style={{ borderColor: "var(--line)" }}>
        <button
          className="flex-1 rounded px-2 py-1 text-[11px] font-medium hover:bg-[color:var(--panel-3)]"
          onClick={() => onSelect(today)}
        >
          Today
        </button>
        <button
          className="flex-1 rounded px-2 py-1 text-[11px] font-medium hover:bg-[color:var(--panel-3)]"
          onClick={() => onSelect(addDays(today, -1))}
        >
          Yesterday
        </button>
      </div>
    </div>
  );
}

/**
 * True on a touch screen.
 *
 * Used to hand date picking to the operating system: on a phone the native
 * wheel is bigger, familiar and — unlike a floating panel — cannot end up half
 * off the edge of the screen.
 */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse)");
    const onChange = (e: MediaQueryListEvent) => setCoarse(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return coarse;
}

/**
 * Date picking, anchored to a trigger.
 *
 * On touch this is a transparent native date input laid over the trigger, so
 * tapping it opens the OS picker. On a mouse it is the custom month grid, which
 * can show which days already have entries — worth the panel there, because a
 * desktop has room for it and the pointer can hit small targets.
 */
export function CalendarPopover({
  value,
  onSelect,
  today,
  markedDays,
  maxDate,
  children,
}: {
  value: ISODate;
  onSelect: (date: ISODate) => void;
  today: ISODate;
  markedDays?: Set<ISODate>;
  maxDate?: ISODate;
  children: (props: { open: () => void; isOpen: boolean }) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const coarse = useCoarsePointer();

  useEffect(() => {
    if (!open || coarse) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, coarse]);

  if (coarse) {
    return (
      <div className="relative">
        {children({ open: () => {}, isOpen: false })}
        <input
          type="date"
          value={value}
          max={maxDate}
          aria-label="Pick a date"
          onChange={(e) => e.target.value && onSelect(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      {children({ open: () => setOpen((v) => !v), isOpen: open })}
      {open && (
        <div
          /*
            Pinned to the trigger's right edge and capped at the viewport width,
            so it can never run off the side of a narrow window.
          */
          className="absolute right-0 top-full z-50 mt-1 max-w-[calc(100vw-1.5rem)] overflow-auto rounded-md border shadow-xl"
          style={{ background: "var(--panel)", borderColor: "var(--line-strong)" }}
        >
          <Calendar
            value={value}
            today={today}
            markedDays={markedDays}
            maxDate={maxDate}
            onSelect={(date) => {
              onSelect(date);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The seven days of the current pay week as a strip.
 *
 * This is how the daily entry screen is actually navigated — you are almost
 * always moving between days of the week you are in, not jumping months.
 */
export function WeekStrip({
  value,
  onSelect,
  today,
  markedDays,
}: {
  value: ISODate;
  onSelect: (date: ISODate) => void;
  today: ISODate;
  markedDays?: Set<ISODate>;
}) {
  const start = weekStartOf(value);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  return (
    <div className="grid grid-cols-7 gap-1">
      {days.map((date, i) => {
        const selected = date === value;
        const isToday = date === today;
        const future = daysBetween(today, date) > 0;
        const marked = markedDays?.has(date);

        return (
          <button
            key={date}
            type="button"
            onClick={() => onSelect(date)}
            aria-current={selected ? "date" : undefined}
            className={cx(
              "flex flex-col items-center gap-0.5 rounded border py-1 transition-colors",
              !selected && "hover:bg-[color:var(--panel-3)]",
            )}
            style={{
              background: selected ? "var(--accent)" : "var(--panel)",
              borderColor: selected
                ? "var(--accent)"
                : isToday
                  ? "var(--accent-line)"
                  : "var(--line)",
              color: selected ? "#fff" : future ? "var(--ink-4)" : "var(--ink)",
            }}
          >
            <span className="text-[10px] leading-none opacity-70">{DOW[i]}</span>
            <span className="text-xs font-semibold leading-none tnum">
              {parseISO(date).getUTCDate()}
            </span>
            <span
              className="h-1 w-1 rounded-full"
              style={{
                background: marked
                  ? selected
                    ? "rgba(255,255,255,0.9)"
                    : "var(--accent)"
                  : "transparent",
              }}
            />
          </button>
        );
      })}
    </div>
  );
}
