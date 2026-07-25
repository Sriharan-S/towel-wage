import { useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { cx } from "@/components/ui";
import { readableOn } from "@/lib/palette";
import { entryCellProps } from "@/lib/gridNav";

/**
 * One line of the daily entry form: a whole row, cut into cells.
 *
 * The towel type's name sits in a solid block of its own colour at the left,
 * which is what makes it findable at a glance while you're working down the
 * list. The value cells are attached to the right edge and fill their cell
 * outright — no little box floating inside a padded row.
 *
 * A worker can run the same type on more than one loom, so the value can be
 * several cells joined by "+". Adding a loom has two routes on purpose: the "+"
 * at the right edge (discoverable everywhere) and a left-swipe on the row
 * (fast, once you know it). Nothing is hidden behind the gesture alone.
 */
export function EntryRow({
  name,
  color,
  hint,
  values,
  onChange,
  onLoomCountChange,
  maxLooms = 6,
  disabled,
  total,
  totalLabel,
}: {
  name: string;
  color: string;
  /** the rate, shown between the name and the value cells */
  hint?: string;
  /** one string per loom, index 0 = loom 1 */
  values: string[];
  onChange: (loomIndex: number, value: string) => void;
  onLoomCountChange: (count: number) => void;
  maxLooms?: number;
  disabled?: boolean;
  /** what this line is worth today, shown under the hint */
  total?: string;
  totalLabel?: string;
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
      className="flex items-stretch overflow-hidden border-b"
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
      {/* Name, in a solid block of the type's own colour */}
      <div
        className="flex w-28 shrink-0 flex-col justify-center px-2.5 py-2 sm:w-36"
        style={{ background: color, color: ink }}
      >
        <span className="truncate text-[13px] font-semibold leading-tight" title={name}>
          {name}
        </span>
        {hint && (
          <span className="truncate text-[10px] leading-tight" style={{ opacity: 0.75 }}>
            {hint}
          </span>
        )}
      </div>

      {/* What it is worth so far */}
      <div className="flex min-w-0 flex-1 flex-col justify-center px-2.5">
        {total && (
          <>
            <span className="tnum text-[13px] font-medium leading-tight">{total}</span>
            {totalLabel && (
              <span className="truncate text-[10px] leading-tight ink-4">{totalLabel}</span>
            )}
          </>
        )}
      </div>

      {/* Value cells, attached to the right edge */}
      {values.map((value, index) => (
        <div
          key={index}
          className="flex shrink-0 items-stretch border-l"
          style={{ borderColor: "var(--line)" }}
        >
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={value}
            placeholder="0"
            disabled={disabled}
            aria-label={looms > 1 ? `${name}, loom ${index + 1}` : name}
            onChange={(e) => onChange(index, e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            className={cx(
              "tnum h-full bg-transparent px-2 text-right text-base font-semibold outline-none",
              "placeholder:font-normal placeholder:text-[color:var(--ink-4)]",
              "focus:bg-[color:var(--accent-soft)] disabled:opacity-50",
              looms > 1 ? "w-16" : "w-24",
            )}
            style={{ color: "var(--ink)" }}
            {...entryCellProps}
          />
        </div>
      ))}

      {/* Loom control, at the very edge */}
      <div
        className="flex w-7 shrink-0 flex-col border-l"
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
          <Plus size={13} />
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
            <Minus size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
