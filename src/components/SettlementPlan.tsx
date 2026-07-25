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
        className="rounded-xl px-3 py-2.5 text-xs"
        style={{ background: "var(--positive-soft)", color: "var(--positive)" }}
      >
        Already settled — {formatINR(settlement.netPayable)} to pay, nothing outstanding to
        apply.
      </div>
    );
  }

  return (
    <div
      className={cx("rounded-xl border p-3", compact && "text-xs")}
      style={{ background: "var(--accent-soft)", borderColor: "var(--accent)" }}
    >
      <div className="flex items-center gap-2">
        <Wand2 size={15} style={{ color: "var(--accent)" }} />
        <span className="text-sm font-semibold">Suggested payment</span>
        <span className="ml-auto text-lg font-bold">{formatINR(settlement.netPayable)}</span>
      </div>

      <ol className="mt-2 space-y-1 text-xs">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-1.5">
            <ArrowRight size={12} className="mt-0.5 shrink-0 opacity-50" />
            <span>{step}</span>
          </li>
        ))}
      </ol>

      {(settlement.carriedDebit > 0 || settlement.remainingCredit > 0) && (
        <p className="mt-2 border-t pt-2 text-xs" style={{ borderColor: "var(--accent)" }}>
          {settlement.carriedDebit > 0 && (
            <>
              Carries forward: you will owe {workerName}{" "}
              <strong>{formatINR(settlement.carriedDebit)}</strong>.
            </>
          )}
          {settlement.remainingCredit > 0 && (
            <>
              {settlement.carriedDebit > 0 && " "}
              {workerName} will still owe you{" "}
              <strong>{formatINR(settlement.remainingCredit)}</strong>.
            </>
          )}
        </p>
      )}

      <Button
        className="mt-3 w-full"
        variant="primary"
        size="sm"
        onClick={onApply}
        loading={applying}
        disabled={disabled}
      >
        Apply this
      </Button>
    </div>
  );
}

/** Turn the proposal's numbers into the sentences a bookkeeper would say. */
function describe(s: Settlement): string[] {
  const steps: string[] = [];
  const wage = s.settled + s.deduct - s.addback;

  steps.push(`Wage earned this week: ${formatINR(wage)}`);

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
  if (s.deduct > 0 || s.addback > 0) {
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
