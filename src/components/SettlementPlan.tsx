import { ArrowRight, Wand2 } from "lucide-react";
import { Button, cx } from "@/components/ui";
import { formatINR } from "@shared/money";
import type { Settlement } from "@shared/types";

/**
 * Explains, in plain language, exactly what the one-tap settlement will do
 * before it does it.
 *
 * The numbers are the point of this screen, so the proposal is never applied
 * silently — you see the steps and the resulting payment first.
 */
export function SettlementPlan({
  settlement,
  workerName,
  onApply,
  applying,
  disabled,
  compact = false,
}: {
  settlement: Settlement;
  workerName: string;
  onApply: () => void;
  applying?: boolean;
  disabled?: boolean;
  compact?: boolean;
}) {
  const steps = describe(settlement);

  if (settlement.isNoop) {
    return (
      <div
        className="rounded border px-2.5 py-1.5 text-[11px]"
        style={{
          background: "var(--pos-soft)",
          color: "var(--pos)",
          borderColor: "var(--line)",
        }}
      >
        Settled — {formatINR(settlement.netPayable)} to pay, nothing left to apply.
      </div>
    );
  }

  return (
    <div
      className={cx("rounded border p-2.5", compact && "text-[11px]")}
      style={{ background: "var(--accent-soft)", borderColor: "var(--accent-line)" }}
    >
      <div className="flex items-baseline gap-2">
        <Wand2 size={12} style={{ color: "var(--accent)" }} />
        <span className="eyebrow" style={{ color: "var(--accent)" }}>
          Suggested payment
        </span>
        <span className="tnum ml-auto text-base font-semibold">
          {formatINR(settlement.netPayable)}
        </span>
      </div>

      <ol className="mt-1.5 space-y-0.5 text-[11px]">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-1">
            <ArrowRight size={10} className="mt-1 shrink-0 opacity-40" />
            <span>{step}</span>
          </li>
        ))}
      </ol>

      {(settlement.carriedDebit > 0 ||
        settlement.remainingCredit > 0 ||
        settlement.advanceOutstanding > 0) && (
        <p
          className="mt-1.5 border-t pt-1.5 text-[11px]"
          style={{ borderColor: "var(--accent-line)" }}
        >
          Carries forward:
          {settlement.advanceOutstanding > 0 && (
            <>
              {" "}
              advance <strong>{formatINR(settlement.advanceOutstanding)}</strong>;
            </>
          )}
          {settlement.remainingCredit > 0 && (
            <>
              {" "}
              {workerName} owes <strong>{formatINR(settlement.remainingCredit)}</strong>;
            </>
          )}
          {settlement.carriedDebit > 0 && (
            <>
              {" "}
              you owe <strong>{formatINR(settlement.carriedDebit)}</strong>.
            </>
          )}
        </p>
      )}

      <Button
        className="mt-2 w-full"
        variant="primary"
        size="sm"
        onClick={onApply}
        loading={applying}
        disabled={disabled}
      >
        Apply
      </Button>
    </div>
  );
}

/** Turn the proposal's numbers into the sentences a bookkeeper would say. */
function describe(s: Settlement): string[] {
  const steps: string[] = [];
  const wage = s.settled + s.deduct - s.addback + s.advanceRecovered;

  steps.push(`Wage earned this week: ${formatINR(wage)}`);

  if (s.advanceRecovered > 0) {
    steps.push(`Take back ${formatINR(s.advanceRecovered)} against their advance`);
  }

  if (s.deduct > 0) {
    steps.push(
      s.remainingCredit > 0
        ? `Take back ${formatINR(s.deduct)} of what they owe you (all this week's wage covers)`
        : `Take back the ${formatINR(s.deduct)} they owed you`,
    );
  }
  if (s.addback > 0) {
    steps.push(`Pay back the ${formatINR(s.addback)} you owed them`);
  }
  if (s.deduct > 0 || s.addback > 0 || s.advanceRecovered > 0) {
    steps.push(`That leaves ${formatINR(s.settled)}`);
  }

  if (s.debit > 0) {
    steps.push(
      `Hand over the round ${formatINR(s.netPayable)} and hold ${formatINR(s.debit)} for next week`,
    );
  } else if (s.credit > 0) {
    steps.push(
      `Round up to ${formatINR(s.netPayable)}, giving ${formatINR(s.credit)} extra to recover next week`,
    );
  } else if (s.step > 1 && s.netPayable > 0 && s.netPayable % (s.step * 100) !== 0) {
    // The guard fired: rounding down to the step would have paid nothing at all.
    steps.push(
      `Too small to round down to ₹${s.step} — hand over the full ${formatINR(s.netPayable)}`,
    );
  } else {
    steps.push(`Already a round figure — hand over ${formatINR(s.netPayable)}`);
  }

  return steps;
}
