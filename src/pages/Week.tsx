import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Check,
  ChevronDown,
  Lock,
  LockOpen,
  Share2,
  Sparkles,
  Wallet,
} from "lucide-react";
import { PageBody, PageHeader } from "@/components/layout/AppShell";
import { DateNav } from "@/components/DateNav";
import {
  Badge,
  Button,
  Card,
  ConfirmSheet,
  EmptyState,
  ErrorState,
  NumberInput,
  Spinner,
  cx,
  useToast,
} from "@/components/ui";
import {
  useBootstrap,
  useFinalizeWeek,
  useSetAdjustments,
  useToday,
  useWeek,
} from "@/lib/queries";
import {
  addWeeks,
  formatWeekRange,
  relativeWeekLabel,
  weekStartOf,
} from "@shared/dates";
import { formatCount, formatINR, parseRupeeInput, toRupees } from "@shared/money";
import { computeRounding } from "@shared/calc";
import type { Adjustments, WorkerWeekResult } from "@shared/types";

const ROUNDING_STEPS = [10, 50, 100];

export default function Week() {
  const params = useParams<{ weekStart: string }>();
  const navigate = useNavigate();
  const today = useToday();
  const weekStart = weekStartOf(params.weekStart ?? today);

  const week = useWeek(weekStart);
  const bootstrap = useBootstrap();
  const setAdjustments = useSetAdjustments(weekStart);
  const finalize = useFinalizeWeek(weekStart);
  const { toast } = useToast();

  const [expanded, setExpanded] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<"finalize" | "reopen" | null>(null);

  const roundingStep = bootstrap.data?.settings.roundingStep ?? 100;
  const isFinalized = week.data?.status === "finalized";

  const goto = (date: string) => navigate(`/week/${weekStartOf(date)}`);

  const shareSummary = async () => {
    if (!week.data) return;
    const lines = [
      `${bootstrap.data?.settings.businessName ?? "Towel Wage"} — ${formatWeekRange(weekStart)}`,
      "",
      ...week.data.workers.map(
        (w) => `${w.workerName}: ${formatINR(w.netPayable)}`,
      ),
      "",
      `Total: ${formatINR(week.data.totals.netPayable)}`,
    ];
    const text = lines.join("\n");
    try {
      if (navigator.share) {
        await navigator.share({ text });
      } else {
        await navigator.clipboard.writeText(text);
        toast("Payout summary copied.", { tone: "success" });
      }
    } catch {
      // The user dismissed the share sheet; nothing to report.
    }
  };

  if (week.isLoading) return <Spinner label="Working out the wages" />;
  if (week.error) return <ErrorState error={week.error} onRetry={week.refetch} />;
  if (!week.data) return null;

  return (
    <>
      <PageHeader
        title={relativeWeekLabel(weekStart, today)}
        subtitle={`${formatWeekRange(weekStart)} · Sunday to Saturday`}
        action={
          <>
            <Button size="sm" icon={<Share2 size={15} />} onClick={shareSummary}>
              <span className="hidden sm:inline">Share</span>
            </Button>
            {isFinalized ? (
              <Button
                size="sm"
                icon={<LockOpen size={15} />}
                onClick={() => setConfirming("reopen")}
              >
                <span className="hidden sm:inline">Reopen</span>
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                icon={<Lock size={15} />}
                onClick={() => setConfirming("finalize")}
                disabled={week.data.workers.length === 0}
              >
                Finalize
              </Button>
            )}
          </>
        }
      />

      <PageBody className="space-y-3">
        <DateNav
          label={relativeWeekLabel(weekStart, today)}
          sublabel={formatWeekRange(weekStart)}
          value={weekStart}
          onChange={goto}
          onPrev={() => goto(addWeeks(weekStart, -1))}
          onNext={() => goto(addWeeks(weekStart, 1))}
          prevLabel="Previous week"
          nextLabel="Next week"
        />

        {isFinalized && (
          <div
            className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm"
            style={{ background: "var(--positive-soft)", color: "var(--positive)" }}
          >
            <Lock size={16} className="shrink-0" />
            <span>
              Finalized. These figures are frozen — later price changes will not alter them.
            </span>
          </div>
        )}

        {week.data.workers.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Wallet size={28} />}
              title="Nothing recorded this week"
              description="Enter some daily counts and the wages will appear here."
              action={
                <Button variant="primary" onClick={() => navigate("/entry")}>
                  Go to daily entry
                </Button>
              }
            />
          </Card>
        ) : (
          week.data.workers.map((worker) => (
            <WorkerCard
              key={worker.workerId}
              worker={worker}
              weekStart={weekStart}
              expanded={expanded === worker.workerId}
              onToggle={() =>
                setExpanded((current) =>
                  current === worker.workerId ? null : worker.workerId,
                )
              }
              readOnly={isFinalized}
              roundingStep={roundingStep}
              onSave={(body) =>
                setAdjustments.mutate(
                  { workerId: worker.workerId, ...body },
                  {
                    onError: (error) =>
                      toast(error instanceof Error ? error.message : "Could not save", {
                        tone: "error",
                      }),
                  },
                )
              }
            />
          ))
        )}

        {week.data.workers.length > 0 && (
          <Card className="p-4">
            <h2 className="font-semibold">Week total</h2>
            <dl className="mt-3 space-y-1.5 text-sm">
              <Row label="Wages earned" value={formatINR(week.data.totals.wage)} />
              {week.data.totals.credit > 0 && (
                <Row label="Credit given" value={`+ ${formatINR(week.data.totals.credit)}`} />
              )}
              {week.data.totals.deduct > 0 && (
                <Row label="Deducted" value={`− ${formatINR(week.data.totals.deduct)}`} />
              )}
              {week.data.totals.debit > 0 && (
                <Row label="Withheld" value={`− ${formatINR(week.data.totals.debit)}`} />
              )}
              {week.data.totals.addback > 0 && (
                <Row label="Paid back" value={`+ ${formatINR(week.data.totals.addback)}`} />
              )}
            </dl>
            <div className="mt-3 flex items-baseline justify-between border-t pt-3">
              <span className="font-semibold">Total to pay out</span>
              <span className="tnum text-2xl font-bold" style={{ color: "var(--positive)" }}>
                {formatINR(week.data.totals.netPayable)}
              </span>
            </div>
            <p className="mt-2 text-xs text-muted">
              {formatCount(week.data.totals.quantity)} pieces across{" "}
              {week.data.workers.length} workers.
            </p>
          </Card>
        )}
      </PageBody>

      <ConfirmSheet
        open={confirming === "finalize"}
        onClose={() => setConfirming(null)}
        onConfirm={() =>
          finalize.mutate("finalize", {
            onSuccess: () => {
              setConfirming(null);
              toast("Week finalized.", { tone: "success" });
            },
            onError: (error) =>
              toast(error instanceof Error ? error.message : "Could not finalize", {
                tone: "error",
              }),
          })
        }
        title="Finalize this week?"
        confirmLabel="Finalize"
        loading={finalize.isPending}
        description={
          <>
            This locks the week's daily entries and freezes each worker's wage at{" "}
            <strong>{formatINR(week.data.totals.netPayable)}</strong> total. Later price changes
            will not affect it. You can reopen the week if you need to correct something.
          </>
        }
      />

      <ConfirmSheet
        open={confirming === "reopen"}
        onClose={() => setConfirming(null)}
        onConfirm={() =>
          finalize.mutate("reopen", {
            onSuccess: () => {
              setConfirming(null);
              toast("Week reopened for editing.");
            },
          })
        }
        title="Reopen this week?"
        confirmLabel="Reopen"
        loading={finalize.isPending}
        description="The frozen wage figures will be discarded and recalculated from the daily entries. Entries become editable again."
      />
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="tnum font-medium">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-worker payment card
// ---------------------------------------------------------------------------

type AdjustmentField = keyof Adjustments;

const FIELD_LABELS: Record<AdjustmentField, { label: string; help: string }> = {
  credit: {
    label: "Credit",
    help: "Extra paid to round the payment up. The worker owes this back.",
  },
  deduct: { label: "Deduct", help: "Taken off to recover an earlier credit." },
  debit: {
    label: "Debit",
    help: "Withheld to round the payment down. You owe this to the worker.",
  },
  addback: { label: "Add back", help: "Paying back an earlier debit." },
};

function WorkerCard({
  worker,
  expanded,
  onToggle,
  readOnly,
  roundingStep,
  onSave,
}: {
  worker: WorkerWeekResult;
  weekStart: string;
  expanded: boolean;
  onToggle: () => void;
  readOnly: boolean;
  roundingStep: number;
  onSave: (body: Partial<Adjustments> & { paid?: boolean }) => void;
}) {
  // Local text state so typing feels immediate; committed on blur.
  const [draft, setDraft] = useState<Record<AdjustmentField, string>>(() =>
    toDraft(worker.adjustments),
  );

  useEffect(() => {
    setDraft(toDraft(worker.adjustments));
  }, [worker.adjustments]);

  const parsed = useMemo(
    () => ({
      credit: parseRupeeInput(draft.credit),
      deduct: parseRupeeInput(draft.deduct),
      debit: parseRupeeInput(draft.debit),
      addback: parseRupeeInput(draft.addback),
    }),
    [draft],
  );

  const liveNet =
    worker.wage + parsed.credit - parsed.deduct - parsed.debit + parsed.addback;

  const commit = (field: AdjustmentField) => {
    if (readOnly) return;
    if (parsed[field] === worker.adjustments[field]) return;
    onSave({ [field]: parsed[field] });
  };

  const applyRounding = (step: number, direction: "up" | "down") => {
    const result = computeRounding(worker.wage, { ...parsed }, step, direction);
    setDraft((current) => ({
      ...current,
      credit: result.credit ? String(toRupees(result.credit)) : "",
      debit: result.debit ? String(toRupees(result.debit)) : "",
    }));
    onSave({ credit: result.credit, debit: result.debit });
  };

  const hasSuggestion =
    (worker.suggested.deduct > 0 && parsed.deduct !== worker.suggested.deduct) ||
    (worker.suggested.addback > 0 && parsed.addback !== worker.suggested.addback);

  return (
    <Card className="overflow-hidden">
      <button
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={`${worker.workerName}, ${expanded ? "hide" : "show"} wage breakdown and adjustments`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{worker.workerName}</span>
            {worker.paidAt && (
              <Badge tone="positive">
                <Check size={11} /> Paid
              </Badge>
            )}
            {hasSuggestion && !readOnly && (
              <Badge tone="warning">
                <Sparkles size={11} /> Pending
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted">
            Wage {formatINR(worker.wage)}
            {worker.lineItems.length > 0 && ` · ${worker.lineItems.length} items`}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <div className="tnum text-xl font-bold" style={{ color: "var(--positive)" }}>
            {formatINR(liveNet)}
          </div>
          <div className="text-xs text-muted">to pay</div>
        </div>

        <ChevronDown
          size={20}
          className={cx("shrink-0 transition-transform", expanded && "rotate-180")}
          style={{ color: "var(--text-subtle)" }}
        />
      </button>

      {expanded && (
        <div className="border-t px-4 py-4">
          {/* Line item breakdown */}
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
            How the wage is made up
          </h3>
          <div className="mt-2 space-y-1.5">
            {worker.lineItems.length === 0 && (
              <p className="text-sm text-muted">No work recorded this week.</p>
            )}
            {worker.lineItems.map((item) => (
              <div key={item.workTypeId} className="flex items-center gap-2 text-sm">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: item.color }}
                />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <span className="tnum shrink-0 text-xs text-muted">
                  {item.kind === "direct_sum"
                    ? `${item.daysWorked} days`
                    : item.kind === "formula_sum_ratio"
                      ? `${formatCount(item.totalQuantity)} ÷ ${formatCount(item.divisor)} × ${formatINR(item.multiplier, { decimals: false })}`
                      : `${formatCount(item.totalQuantity)} × ${formatINR(item.unitPrice)}`}
                </span>
                <span className="tnum w-20 shrink-0 text-right font-medium">
                  {formatINR(item.wage)}
                </span>
              </div>
            ))}
            <div className="flex justify-between border-t pt-2 text-sm font-semibold">
              <span>Wage</span>
              <span className="tnum">{formatINR(worker.wage)}</span>
            </div>
          </div>

          {/* Rounding shortcuts */}
          {!readOnly && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                Round the payment
              </h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {ROUNDING_STEPS.map((step) => (
                  <span key={step} className="inline-flex overflow-hidden rounded-xl border">
                    <button
                      className="px-2.5 py-1.5 text-xs font-medium"
                      onClick={() => applyRounding(step, "up")}
                      title={`Round up to the next ₹${step}`}
                    >
                      ↑ ₹{step}
                    </button>
                    <button
                      className="border-l px-2.5 py-1.5 text-xs font-medium"
                      onClick={() => applyRounding(step, "down")}
                      title={`Round down to the previous ₹${step}`}
                    >
                      ↓ ₹{step}
                    </button>
                  </span>
                ))}
                <button
                  className="rounded-xl border px-2.5 py-1.5 text-xs font-medium"
                  onClick={() => {
                    setDraft((c) => ({ ...c, credit: "", debit: "" }));
                    onSave({ credit: 0, debit: 0 });
                  }}
                >
                  Clear
                </button>
              </div>
              <p className="mt-1.5 text-xs text-muted">
                Default step is ₹{roundingStep}, changeable in Settings.
              </p>
            </div>
          )}

          {/* Adjustments */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            {(Object.keys(FIELD_LABELS) as AdjustmentField[]).map((field) => {
              const suggestion =
                field === "deduct"
                  ? worker.suggested.deduct
                  : field === "addback"
                    ? worker.suggested.addback
                    : 0;
              const showSuggestion = suggestion > 0 && parsed[field] !== suggestion && !readOnly;

              return (
                <div key={field}>
                  <label className="mb-1 block text-xs font-medium" title={FIELD_LABELS[field].help}>
                    {FIELD_LABELS[field].label}
                  </label>
                  <NumberInput
                    value={draft[field]}
                    placeholder="0"
                    disabled={readOnly}
                    aria-label={`${worker.workerName} ${FIELD_LABELS[field].label}`}
                    onChange={(e) =>
                      setDraft((current) => ({ ...current, [field]: e.target.value }))
                    }
                    onBlur={() => commit(field)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                  />
                  {showSuggestion && (
                    <button
                      className="mt-1 flex w-full items-center justify-center gap-1 rounded-lg px-2 py-1 text-xs font-medium"
                      style={{ background: "var(--warning-soft)", color: "var(--warning)" }}
                      onClick={() => {
                        setDraft((current) => ({
                          ...current,
                          [field]: String(toRupees(suggestion)),
                        }));
                        onSave({ [field]: suggestion });
                      }}
                    >
                      <Sparkles size={11} />
                      Apply {formatINR(suggestion)}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Carry-forward */}
          {(worker.openingBalance.creditOutstanding !== 0 ||
            worker.openingBalance.debitOutstanding !== 0 ||
            worker.closingBalance.creditOutstanding !== 0 ||
            worker.closingBalance.debitOutstanding !== 0) && (
            <div
              className="mt-4 rounded-xl px-3 py-2.5 text-xs"
              style={{ background: "var(--surface-2)" }}
            >
              <p className="font-semibold">Running balance</p>
              <div className="mt-1.5 space-y-1">
                {worker.openingBalance.creditOutstanding !== 0 && (
                  <p className="text-muted">
                    Brought forward: {worker.workerName} owes you{" "}
                    <strong>{formatINR(worker.openingBalance.creditOutstanding)}</strong>
                  </p>
                )}
                {worker.openingBalance.debitOutstanding !== 0 && (
                  <p className="text-muted">
                    Brought forward: you owe {worker.workerName}{" "}
                    <strong>{formatINR(worker.openingBalance.debitOutstanding)}</strong>
                  </p>
                )}
                <p className="text-muted">
                  After this week:{" "}
                  {worker.closingBalance.creditOutstanding === 0 &&
                  worker.closingBalance.debitOutstanding === 0 ? (
                    <strong>all square</strong>
                  ) : (
                    <>
                      {worker.closingBalance.creditOutstanding !== 0 && (
                        <>
                          owes you{" "}
                          <strong>{formatINR(worker.closingBalance.creditOutstanding)}</strong>
                        </>
                      )}
                      {worker.closingBalance.debitOutstanding !== 0 && (
                        <>
                          {worker.closingBalance.creditOutstanding !== 0 && ", "}
                          you owe{" "}
                          <strong>{formatINR(worker.closingBalance.debitOutstanding)}</strong>
                        </>
                      )}
                    </>
                  )}
                </p>
              </div>
            </div>
          )}

          {/* Net payable + paid toggle */}
          <div className="mt-4 flex items-center justify-between border-t pt-3">
            <div>
              <p className="text-xs text-muted">Net payable</p>
              <p className="tnum text-2xl font-bold" style={{ color: "var(--positive)" }}>
                {formatINR(liveNet)}
              </p>
            </div>
            <Button
              variant={worker.paidAt ? "success" : "secondary"}
              icon={worker.paidAt ? <Check size={16} /> : undefined}
              onClick={() => onSave({ paid: !worker.paidAt })}
              disabled={readOnly}
            >
              {worker.paidAt ? "Paid" : "Mark paid"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function toDraft(adj: Adjustments): Record<AdjustmentField, string> {
  const show = (paise: number) => (paise === 0 ? "" : String(toRupees(paise)));
  return {
    credit: show(adj.credit),
    deduct: show(adj.deduct),
    debit: show(adj.debit),
    addback: show(adj.addback),
  };
}
