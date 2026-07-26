import { useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { cx } from "@/components/ui";
import { readableOn } from "@/lib/palette";
import { entryCellProps } from "@/lib/gridNav";

/**
 * One line of the daily entry form: a whole row, cut into cells.
 *
 * The towel type's name sits in a solid block of its own colour at the left,
 * which is what makes it findable at a glance while working down the list. The
 * value cells fill the rest of the row outright — no little box floating inside
 * a padded row.
 *
 * A worker can run the same type on several looms, so the value may be more
 * than one cell. Cells wrap onto a second line rather than shrinking, and the
 * name block stretches to cover the whole group, so the type is never repeated.
 *
 * Adding a loom has two routes on purpose: the "+" at the right edge
 * (discoverable everywhere) and a left-swipe on the row (fast, once you know
 * it). Nothing is hidden behind the gesture alone.
 */
export function EntryRow({
  name,
  color,
  hint,
  value,
  subValue,
  values,
  onChange,
  onLoomCountChange,
  maxLooms = 6,
  disabled,
}: {
  name: string;
  color: string;
  /** the rate, shown under the name */
  hint?: string;
  /** the running towel count, shown under the rate */
  value?: string;
  /** what those towels come to, shown under the count */
  subValue?: string;
  /** one string per loom, index 0 = loom 1 */
  values: string[];
  onChange: (loomIndex: number, next: string) => void;
  onLoomCountChange: (count: number) => void;
  maxLooms?: number;
  disabled?: boolean;
}) {
  const looms = Math.max(1, values.length);
  const ink = readableOn(color);

  const [dragX, setDragX] = useState(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);

  const canAdd = looms < maxLooms && !disabled;
  const canRemove = looms > 1 && !disabled && !values[looms - 1];

  const onTouchStart = (e: React.TouchEvent) => {
    if (disabled) return;
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    swiped.current = false;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const dx = e.touches[0].clientX - touchStart.current.x;
    const dy = e.touches[0].clientY - touchStart.current.y;
    // Only once it is clearly horizontal, so scrolling the list still works.
    if (Math.abs(dy) > Math.abs(dx)) return;
    setDragX(Math.max(-56, Math.min(56, dx)));

    if (dx < -44 && canAdd && !swiped.current) {
      swiped.current = true;
      onLoomCountChange(looms + 1);
      navigator.vibrate?.(8);
    } else if (dx > 44 && canRemove && !swiped.current) {
      // Swiping back only drops an empty trailing loom — never a figure.
      swiped.current = true;
      onLoomCountChange(looms - 1);
    }
  };

  const endTouch = () => {
    touchStart.current = null;
    setDragX(0);
  };

  return (
    <div
      className="flex items-stretch overflow-hidden border-b last:border-b-0"
      style={{
        borderColor: "var(--line)",
        transform: dragX ? `translateX(${dragX * 0.3}px)` : undefined,
        transition: dragX ? "none" : "transform 160ms",
      }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={endTouch}
      onTouchCancel={endTouch}
    >
      {/* Name block — stretches over however many rows of cells there are */}
      <div
        className="flex w-28 shrink-0 flex-col justify-center gap-0.5 px-2.5 py-2.5 sm:w-36"
        style={{ background: color, color: ink }}
      >
        <span className="truncate text-sm font-semibold leading-tight" title={name}>
          {name}
        </span>
        {hint && (
          <span className="truncate text-[10px] leading-tight" style={{ opacity: 0.8 }}>
            {hint}
          </span>
        )}
        {value && (
          <span className="tnum truncate text-xs font-semibold leading-tight">{value}</span>
        )}
        {subValue && (
          <span className="tnum truncate text-xs font-bold leading-tight">{subValue}</span>
        )}
      </div>

      {/*
        Value cells. Two per row on a phone, three once there is room; more
        looms wrap to a new line instead of squeezing every box thinner.
      */}
      <div className="grid min-w-0 flex-1 grid-cols-2 sm:grid-cols-3">
        {values.map((cell, index) => (
          <div
            key={index}
            className="flex items-stretch border-b border-l last:border-b-0"
            style={{ borderColor: "var(--line)" }}
          >
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={cell}
              placeholder="0"
              disabled={disabled}
              aria-label={looms > 1 ? `${name}, loom ${index + 1}` : name}
              onChange={(e) => onChange(index, e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              className={cx(
                "tnum w-full min-w-0 bg-transparent px-1 py-3 text-center text-lg font-semibold outline-none",
                "placeholder:font-normal placeholder:text-[color:var(--ink-4)]",
                "focus:bg-[color:var(--accent-soft)] disabled:opacity-50",
              )}
              style={{ color: "var(--ink)" }}
              {...entryCellProps}
            />
          </div>
        ))}

        {/* Fill the tail of the last line so the grid keeps its rule pattern */}
        {values.length % (values.length > 4 ? 3 : 2) !== 0 && <span aria-hidden />}
      </div>

      {/* Loom control, at the very edge */}
      <div
        className="flex w-8 shrink-0 flex-col border-l"
        style={{ borderColor: "var(--line)" }}
      >
        <button
          type="button"
          disabled={!canAdd}
          onClick={() => onLoomCountChange(looms + 1)}
          aria-label={`Add a loom for ${name}`}
          title="Add another loom (or swipe the row left)"
          className={cx(
            "flex flex-1 items-center justify-center transition-colors",
            "hover:bg-[color:var(--panel-3)] disabled:opacity-20",
          )}
          style={{ color: "var(--ink-3)" }}
        >
          <Plus size={15} />
        </button>
        {canRemove && (
          <button
            type="button"
            onClick={() => onLoomCountChange(looms - 1)}
            aria-label={`Remove the empty loom from ${name}`}
            title="Remove the empty loom"
            className="flex flex-1 items-center justify-center border-t transition-colors hover:bg-[color:var(--panel-3)]"
            style={{ color: "var(--ink-3)", borderColor: "var(--line)" }}
          >
            <Minus size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
