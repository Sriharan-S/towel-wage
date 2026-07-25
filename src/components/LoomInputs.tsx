import { useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { NumberInput, cx } from "@/components/ui";

/**
 * The value cell for one worker × one towel type.
 *
 * A worker can run the same towel type on more than one loom, so this renders
 * one box per loom joined by "+" — the wage is the sum, but each loom's figure
 * is recorded and kept separately.
 *
 * Adding a loom has two routes, deliberately:
 *   • a "+" button at the end of the row (discoverable, works everywhere)
 *   • swiping the row left on a touch screen (fast, once you know it)
 * Both do the same thing, so nothing is hidden behind a gesture alone.
 */
export function LoomInputs({
  values,
  onChange,
  onLoomCountChange,
  maxLooms = 6,
  disabled,
  ariaLabel,
  cellProps,
}: {
  /** one string per loom, index 0 = loom 1 */
  values: string[];
  onChange: (loomIndex: number, value: string) => void;
  onLoomCountChange: (count: number) => void;
  maxLooms?: number;
  disabled?: boolean;
  ariaLabel: string;
  /** shared props for keyboard navigation between cells */
  cellProps?: React.InputHTMLAttributes<HTMLInputElement>;
}) {
  const looms = Math.max(1, values.length);
  const [dragX, setDragX] = useState(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);

  const canAdd = looms < maxLooms && !disabled;
  const canRemove = looms > 1 && !disabled;

  const onTouchStart = (e: React.TouchEvent) => {
    if (!canAdd && !canRemove) return;
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    swiped.current = false;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const dx = e.touches[0].clientX - touchStart.current.x;
    const dy = e.touches[0].clientY - touchStart.current.y;
    // Only treat it as a swipe once it is clearly horizontal, so vertical
    // scrolling through the worker list is never hijacked.
    if (Math.abs(dy) > Math.abs(dx)) return;
    setDragX(Math.max(-64, Math.min(64, dx)));

    if (dx < -48 && canAdd && !swiped.current) {
      swiped.current = true;
      onLoomCountChange(looms + 1);
      if (navigator.vibrate) navigator.vibrate(8);
    } else if (dx > 48 && canRemove && !swiped.current && !values[looms - 1]) {
      // Swiping back only removes an empty trailing loom — never data.
      swiped.current = true;
      onLoomCountChange(looms - 1);
    }
  };

  const onTouchEnd = () => {
    touchStart.current = null;
    setDragX(0);
  };

  return (
    <div className="flex items-center justify-end gap-1 overflow-hidden">
      <div
        className="flex items-center gap-1"
        style={{
          transform: dragX ? `translateX(${dragX * 0.4}px)` : undefined,
          transition: dragX ? "none" : "transform 160ms",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {values.map((value, index) => (
          <div key={index} className="flex items-center gap-1">
            {index > 0 && (
              <span className="text-xs font-medium ink-4" aria-hidden>
                +
              </span>
            )}
            <NumberInput
              value={value}
              placeholder="0"
              disabled={disabled}
              className={cx(looms > 1 ? "w-14" : "w-20")}
              aria-label={looms > 1 ? `${ariaLabel}, loom ${index + 1}` : ariaLabel}
              onChange={(e) => onChange(index, e.target.value)}
              {...cellProps}
            />
          </div>
        ))}
      </div>

      <div className="flex w-5 shrink-0 flex-col items-center">
        {canAdd && (
          <button
            type="button"
            onClick={() => onLoomCountChange(looms + 1)}
            aria-label={`Add a loom for ${ariaLabel}`}
            title="Add another loom (or swipe the row left)"
            className="flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-[color:var(--panel-3)]"
            style={{ color: "var(--ink-4)" }}
          >
            <Plus size={13} />
          </button>
        )}
        {canRemove && !values[looms - 1] && (
          <button
            type="button"
            onClick={() => onLoomCountChange(looms - 1)}
            aria-label={`Remove the last loom for ${ariaLabel}`}
            title="Remove the empty loom"
            className="flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-[color:var(--panel-3)]"
            style={{ color: "var(--ink-4)" }}
          >
            <Minus size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
