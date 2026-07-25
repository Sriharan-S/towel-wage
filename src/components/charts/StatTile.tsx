import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Card } from "@/components/ui";

/**
 * Stat tile: label, value, optional delta against a named period.
 *
 * Values use the font's default proportional figures — tabular-nums gives every
 * digit the width of a zero, which makes a number like 121 look loose at
 * display sizes. Tabular figures are for columns that align vertically.
 */
export function StatTile({
  label,
  value,
  delta,
  deltaLabel,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  /** Fractional change, e.g. 0.12 for +12%. */
  delta?: number | null;
  deltaLabel?: string;
  hint?: ReactNode;
  tone?: "neutral" | "positive" | "negative";
}) {
  const showDelta = delta !== undefined && delta !== null && Number.isFinite(delta);
  const direction = !showDelta ? 0 : delta > 0.005 ? 1 : delta < -0.005 ? -1 : 0;

  return (
    <Card className="p-3.5">
      <p className="text-xs text-muted">{label}</p>
      <p
        className="mt-1 text-2xl font-semibold leading-tight"
        style={{
          color:
            tone === "positive"
              ? "var(--positive)"
              : tone === "negative"
                ? "var(--negative)"
                : undefined,
        }}
      >
        {value}
      </p>
      {showDelta && (
        <p className="mt-1 flex items-center gap-1 text-xs">
          <span
            className="flex items-center gap-0.5 font-medium"
            style={{
              color:
                direction === 0
                  ? "var(--text-muted)"
                  : direction > 0
                    ? "var(--positive)"
                    : "var(--negative)",
            }}
          >
            {direction > 0 ? (
              <ArrowUp size={12} />
            ) : direction < 0 ? (
              <ArrowDown size={12} />
            ) : (
              <Minus size={12} />
            )}
            {Math.abs(delta * 100).toFixed(0)}%
          </span>
          {deltaLabel && <span className="text-muted">{deltaLabel}</span>}
        </p>
      )}
      {hint && !showDelta && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  );
}
