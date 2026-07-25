import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton } from "@/components/ui";

/**
 * Previous / label / next stepper used by both the daily entry and week
 * screens. The centre acts as a hidden date picker so any date is one tap away
 * without spending screen space on a calendar.
 */
export function DateNav({
  label,
  sublabel,
  value,
  onChange,
  onPrev,
  onNext,
  nextDisabled = false,
  prevLabel = "Previous",
  nextLabel = "Next",
}: {
  label: string;
  sublabel?: string;
  value: string;
  onChange: (value: string) => void;
  onPrev: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
  prevLabel?: string;
  nextLabel?: string;
}) {
  return (
    <div
      className="flex items-center justify-between gap-1 rounded-2xl border p-1"
      style={{ background: "var(--surface)" }}
    >
      <IconButton label={prevLabel} onClick={onPrev}>
        <ChevronLeft size={22} />
      </IconButton>

      <div className="relative min-w-0 flex-1 text-center">
        <div className="truncate text-sm font-semibold leading-tight">{label}</div>
        {sublabel && <div className="truncate text-xs text-muted">{sublabel}</div>}
        {/* Transparent native picker layered over the label. */}
        <input
          type="date"
          value={value}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          aria-label="Pick a date"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>

      <IconButton label={nextLabel} onClick={onNext} disabled={nextDisabled}>
        <ChevronRight size={22} />
      </IconButton>
    </div>
  );
}
