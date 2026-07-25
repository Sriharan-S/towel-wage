import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronRight as Caret,
  HandCoins,
  Lock,
  LockOpen,
  Printer,
  Share2,
  Wallet,
  Wand2,
} from "lucide-react";
import { PageBody, PageHeader } from "@/components/layout/AppShell";
import { CalendarPopover } from "@/components/Calendar";
import { PayoutSheet } from "@/components/PayoutSheet";
import { SettlementPlan } from "@/components/SettlementPlan";
import {
  Badge,
  Button,
  ConfirmSheet,
  EmptyState,
  ErrorState,
  Money,
  NumberInput,
  Panel,
  Spinner,
  cx,
  useToast,
} from "@/components/ui";
import {
  useBootstrap,
  useFinalizeWeek,
  useSetAdjustments,
  useSettleWeek,
  useToday,
  useWeek,
} from "@/lib/queries";
import { addWeeks, formatWeekRange, relativeWeekLabel, weekStartOf } from "@shared/dates";
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
  const settle = useSettleWeek(weekStart);
  const finalize = useFinalizeWeek(weekStart);
  const { toast } = useToast();

  const [expanded, setExpanded] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<"finalize" | "reopen" | "settle" | null>(null);

  const roundingStep = bootstrap.data?.settings.roundingStep ?? 100;
  const roundingMode = bootstrap.data?.settings.roundingMode ?? "hold";
  const businessName = bootstrap.data?.settings.businessName ?? "Towel Wage";
  const isFinalized = week.data?.status === "finalized";
  const unsettled = week.data?.workers.filter((w) => !w.settlement.isNoop).length ?? 0;

  const goto = (date: string) => navigate(`/week/${weekStartOf(date)}`);

  const shareSummary = async () => {
    if (!week.data) return;
    const text = [
      `${businessName} — ${formatWeekRange(weekStart)}`,
      "",
      ...week.data.workers.map((w) => `${w.workerName}: ${formatINR(w.netPayable)}`),
      "",
      `Total: ${formatINR(week.data.totals.netPayable)}`,
    ].join("\n");
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        toast("Payout summary copied.", { tone: "success" });
      }
    } catch {
      /* the share sheet was dismissed */
    }
  };

  if (week.isLoading) return <Spinner label="Working out the wages" />;
  if (week.error) return <ErrorState error={week.error} onRetry={week.refetch} />;
  if (!week.data) return null;

  const t = week.data.totals;

  return (
    <>
      <PageHeader
        title="Wages"
        meta={
          <span className="flex items-center gap-2">
            {formatWeekRange(weekStart)}
            <Badge tone={isFinalized ? "positive" : "accent"}>
              {isFinalized ? "Finalized" : "Open"}
            </Badge>
            {unsettled > 0 && !isFinalized && (
              <span className="ink-3">{unsettled} to settle</span>
            )}
          </span>
        }
        action={
          <>
            {!isFinalized && unsettled > 0 && (
              <Button
                variant="primary"
                icon={<Wand2 size={13} />}
                onClick={() => setConfirming("settle")}
                loading={settle.isPending}
              >
                Settle all
              </Button>
            )}
            <Button icon={<Printer size={13} />} onClick={() => window.print()} title="Print the payout sheet">
              Print
            </Button>
            <Button icon={<Share2 size={13} />} onClick={shareSummary}>
              Share
            </Button>
            {isFinalized ? (
              <Button icon={<LockOpen size={13} />} onClick={() => setConfirming("reopen")}>
                Reopen
              </Button>
            ) : (
              <Button
                icon={<Lock size={13} />}
                onClick={() => setConfirming("finalize")}
                disabled={week.data.workers.length === 0}
              >
                Finalize
              </Button>
            )}
          </>
        }
      >
        <div className="flex items-center gap-2">
          <Button
            icon={<ChevronLeft size={13} />}
            onClick={() => goto(addWeeks(weekStart, -1))}
            aria-label="Previous week"
          />
          <CalendarPopover value={weekStart} today={today} onSelect={goto}>
            {({ open, isOpen }) => (
              <Button onClick={open} aria-expanded={isOpen} className="min-w-40 justify-center">
                {relativeWeekLabel(weekStart, today)} · {formatWeekRange(weekStart)}
              </Button>
            )}
          </CalendarPopover>
          <Button
            icon={<ChevronRight size={13} />}
            onClick={() => goto(addWeeks(weekStart, 1))}
            aria-label="Next week"
          />

          <div className="ml-auto flex items-center gap-4 text-xs">
            <Stat label="Wages" value={formatINR(t.wage)} />
            {t.advanceRecovered > 0 && (
              <Stat label="Advances" value={`−${formatINR(t.advanceRecovered)}`} negative />
            )}
            <Stat label="Payout" value={formatINR(t.netPayable)} strong />
          </div>
        </div>
      </PageHeader>

      <PageBody className="space-y-2">
        {isFinalized && (
          <div
            className="flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs"
            style={{
              background: "var(--pos-soft)",
              color: "var(--pos)",
              borderColor: "var(--line)",
            }}
          >
            <Lock size={12} className="shrink-0" />
            Frozen. Later price changes will not alter these figures.
          </div>
        )}

        {week.data.workers.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<Wallet size={22} />}
              title="Nothing recorded this week"
              description="Enter some daily counts and the wages appear here."
              action={
                <Button variant="primary" onClick={() => navigate("/entry")}>
                  Go to daily entry
                </Button>
              }
            />
          </Panel>
        ) : (
          <Panel className="overflow-hidden">
            {/* Column headings — this is a ledger, so it gets a header row. */}
            <div
              className="hidden h-7 items-center gap-3 border-b px-3 text-[11px] font-medium ink-3 sm:flex"
              style={{ background: "var(--panel-2)", borderColor: "var(--line)" }}
            >
              <span className="w-4" />
              <span className="min-w-0 flex-1">Worker</span>
              <span className="w-24 text-right">Wage</span>
              <span className="w-24 text-right">Adjustments</span>
              <span className="w-28 text-right">Net payable</span>
              <span className="w-16" />
            </div>

            <div className="hairline-y">
              {week.data.workers.map((worker) => (
                <WorkerRow
                  key={worker.workerId}
                  worker={worker}
                  expanded={expanded === worker.workerId}
                  onToggle={() =>
                    setExpanded((c) => (c === worker.workerId ? null : worker.workerId))
                  }
                  readOnly={isFinalized}
                  settling={settle.isPending}
                  onSettle={() =>
                    settle.mutate(worker.workerId, {
                      onSuccess: () =>
                        toast(`Settled ${worker.workerName}.`, { tone: "success" }),
                      onError: (error) =>
                        toast(error instanceof Error ? error.message : "Could not settle", {
                          tone: "error",
                        }),
                    })
                  }
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
              ))}
            </div>

            {/* Totals row */}
            <div
              className="flex items-center gap-3 border-t px-3 py-2 text-xs font-semibold"
              style={{ background: "var(--panel-2)", borderColor: "var(--line-strong)" }}
            >
              <span className="w-4" />
              <span className="min-w-0 flex-1">
                Total
                <span className="ml-2 font-normal ink-3">
                  {formatCount(t.quantity)} pieces
                </span>
              </span>
              <Money className="hidden w-24 text-right sm:block">{formatINR(t.wage)}</Money>
              <Money className="hidden w-24 text-right sm:block" tone="muted">
                {formatINR(t.netPayable - t.wage)}
              </Money>
              <Money className="w-28 text-right text-sm" tone="positive">
                {formatINR(t.netPayable)}
              </Money>
              <span className="w-16" />
            </div>
          </Panel>
        )}
      </PageBody>

      {/* Print-only sheet */}
      <PayoutSheet week={week.data} businessName={businessName} />

      <ConfirmSheet
        open={confirming === "settle"}
        onClose={() => setConfirming(null)}
        loading={settle.isPending}
        confirmLabel={`Settle ${unsettled} ${unsettled === 1 ? "worker" : "workers"}`}
        title="Settle everyone?"
        description={
          <>
            For each worker this recovers earlier credits (never more than they earned this
            week), repays what you owe them, clears the paise, and rounds
            {roundingMode === "hold"
              ? ` down to the nearest ₹${roundingStep}, holding the difference for next week`
              : roundingMode === "give"
                ? ` up to the nearest ₹${roundingStep}`
                : ` to the nearest ₹${roundingStep}`}
            . <strong>Advances are never recovered automatically</strong> — enter those
            yourself. You can adjust any worker afterwards.
          </>
        }
        onConfirm={() =>
          settle.mutate(undefined, {
            onSuccess: (result) => {
              setConfirming(null);
              toast(`Settled — ${formatINR(result.totals.netPayable)} to pay out.`, {
                tone: "success",
              });
            },
            onError: (error) =>
              toast(error instanceof Error ? error.message : "Could not settle", {
                tone: "error",
              }),
          })
        }
      />

      <ConfirmSheet
        open={confirming === "finalize"}
        onClose={() => setConfirming(null)}
        loading={finalize.isPending}
        confirmLabel="Finalize"
        title="Finalize this week?"
        description={
          <>
            Locks this week's daily entries and freezes the payout at{" "}
            <strong>{formatINR(t.netPayable)}</strong>. Later price changes will not affect it.
            You can reopen the week if you need to correct something.
          </>
        }
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
      />

      <ConfirmSheet
        open={confirming === "reopen"}
        onClose={() => setConfirming(null)}
        loading={finalize.isPending}
        confirmLabel="Reopen"
        title="Reopen this week?"
        description="The frozen figures are discarded and recalculated from the daily entries. Entries become editable again."
        onConfirm={() =>
          finalize.mutate("reopen", {
            onSuccess: () => {
              setConfirming(null);
              toast("Week reopened.");
            },
          })
        }
      />
    </>
  );
}

function Stat({
  label,
  value,
  strong,
  negative,
}: {
  label: string;
  value: string;
  strong?: boolean;
  negative?: boolean;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="ink-3">{label}</span>
      <Money
        className={strong ? "text-sm font-semibold" : "font-medium"}
        tone={strong ? "positive" : negative ? "negative" : undefined}
      >
        {value}
      </Money>
    </span>
  );
}

// ---------------------------------------------------------------------------

type Field = keyof Adjustments;

const FIELDS: Array<{ key: Field; label: string; help: string }> = [
  {
    key: "advanceRecovered",
    label: "Advance taken back",
    help: "Money recovered against an advance you gave. Never filled in automatically.",
  },
  { key: "deduct", label: "Deduct", help: "Recovering an earlier rounding credit." },
  { key: "addback", label: "Add back", help: "Repaying an earlier rounding debit." },
  { key: "credit", label: "Credit", help: "Paid extra to round up. The worker owes this back." },
  { key: "debit", label: "Debit", help: "Held back to round down. You owe this." },
];

function WorkerRow({
  worker,
  expanded,
  onToggle,
  readOnly,
  settling,
  onSettle,
  onSave,
}: {
  worker: WorkerWeekResult;
  expanded: boolean;
  onToggle: () => void;
  readOnly: boolean;
  settling: boolean;
  onSettle: () => void;
  onSave: (body: Partial<Adjustments> & { paid?: boolean }) => void;
}) {
  const [draft, setDraft] = useState<Record<Field, string>>(() => toDraft(worker.adjustments));

  useEffect(() => setDraft(toDraft(worker.adjustments)), [worker.adjustments]);

  const parsed = useMemo(
    () =>
      Object.fromEntries(
        (Object.keys(draft) as Field[]).map((f) => [f, parseRupeeInput(draft[f])]),
      ) as Record<Field, number>,
    [draft],
  );

  const liveNet =
    worker.wage +
    parsed.credit -
    parsed.deduct -
    parsed.debit +
    parsed.addback -
    parsed.advanceRecovered;

  const adjustmentTotal = liveNet - worker.wage;
  const owedAdvance = worker.openingBalance.advanceOutstanding;

  const commit = (field: Field) => {
    if (readOnly || parsed[field] === worker.adjustments[field]) return;
    onSave({ [field]: parsed[field] });
  };

  const applyRounding = (step: number, direction: "up" | "down") => {
    const result = computeRounding(worker.wage, { ...parsed }, step, direction);
    setDraft((c) => ({
      ...c,
      credit: result.credit ? String(toRupees(result.credit)) : "",
      debit: result.debit ? String(toRupees(result.debit)) : "",
    }));
    onSave({ credit: result.credit, debit: result.debit });
  };

  return (
    <div>
      <button
        className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[color:var(--panel-2)]"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={`${worker.workerName}, ${expanded ? "hide" : "show"} breakdown`}
      >
        <Caret
          size={13}
          className={cx("shrink-0 transition-transform", expanded && "rotate-90")}
          style={{ color: "var(--ink-4)" }}
        />

        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-xs font-medium">{worker.workerName}</span>
          {worker.paidAt && (
            <Badge tone="positive">
              <Check size={10} /> Paid
            </Badge>
          )}
          {owedAdvance > 0 && (
            <Badge tone="warning">
              <HandCoins size={10} /> {formatINR(owedAdvance)} advance
            </Badge>
          )}
          {!readOnly && !worker.settlement.isNoop && (
            <Badge tone="accent">→ {formatINR(worker.settlement.netPayable)}</Badge>
          )}
        </span>

        <Money className="hidden w-24 text-right text-xs sm:block">
          {formatINR(worker.wage)}
        </Money>
        <Money
          className="hidden w-24 text-right text-xs sm:block"
          tone={adjustmentTotal === 0 ? "muted" : adjustmentTotal > 0 ? "positive" : "negative"}
        >
          {adjustmentTotal === 0
            ? "—"
            : `${adjustmentTotal > 0 ? "+" : "−"}${formatINR(Math.abs(adjustmentTotal))}`}
        </Money>
        <Money className="w-28 text-right text-sm font-semibold" tone="positive">
          {formatINR(liveNet)}
        </Money>
        <span className="hidden w-16 text-right text-[11px] ink-4 sm:block">
          {worker.lineItems.filter((i) => i.wage > 0).length} items
        </span>
      </button>

      {expanded && (
        <div
          className="border-t px-3 py-3"
          style={{ background: "var(--panel-2)", borderColor: "var(--line)" }}
        >
          <div className="grid gap-3 lg:grid-cols-2">
            {/* Breakdown */}
            <div>
              <p className="eyebrow mb-1.5">Wage breakdown</p>
              <div className="hairline-y rounded border" style={{ background: "var(--panel)" }}>
                {worker.lineItems.length === 0 && (
                  <p className="px-2.5 py-2 text-xs ink-3">No work recorded this week.</p>
                )}
                {worker.lineItems.map((item) => (
                  <div key={item.workTypeId} className="flex items-center gap-2 px-2.5 py-1.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: item.color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-xs">
                      {item.name}
                      {item.looms > 1 && (
                        <span className="ml-1 ink-4">
                          ({item.loomTotals.map((v) => formatCount(v)).join(" + ")})
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-[11px] ink-3 tnum">
                      {item.kind === "direct_sum"
                        ? `${item.daysWorked} days`
                        : item.kind === "formula_sum_ratio"
                          ? `${formatCount(item.totalQuantity)} ÷ ${formatCount(item.divisor)} × ${formatINR(item.multiplier, { decimals: false })}`
                          : item.rateVaried
                            ? `${formatCount(item.totalQuantity)} · mixed rates`
                            : `${formatCount(item.totalQuantity)} × ${formatINR(item.unitPrice)}`}
                    </span>
                    <Money className="w-20 shrink-0 text-right text-xs font-medium">
                      {formatINR(item.wage)}
                    </Money>
                  </div>
                ))}
                <div className="flex justify-between px-2.5 py-1.5 text-xs font-semibold">
                  <span>Wage</span>
                  <Money>{formatINR(worker.wage)}</Money>
                </div>
              </div>

              {worker.lineItems.some((i) => i.rateVaried) && (
                <p className="mt-1 text-[11px] ink-3">
                  A rate changed part-way through this week. Each day is paid at the rate that
                  was in force when it was recorded.
                </p>
              )}

              {worker.advances.length > 0 && (
                <>
                  <p className="eyebrow mb-1.5 mt-3">Advances this week</p>
                  <div
                    className="hairline-y rounded border"
                    style={{ background: "var(--panel)" }}
                  >
                    {worker.advances.map((advance) => (
                      <div key={advance.id} className="flex items-center gap-2 px-2.5 py-1.5">
                        <Badge tone={advance.kind === "advance" ? "negative" : "positive"}>
                          {advance.kind === "advance" ? "Given" : "Returned"}
                        </Badge>
                        <span className="min-w-0 flex-1 truncate text-[11px] ink-3">
                          {advance.note ?? advance.entryDate}
                        </span>
                        <Money
                          className="text-xs"
                          tone={advance.kind === "advance" ? "negative" : "positive"}
                        >
                          {formatINR(advance.amount)}
                        </Money>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Settlement + adjustments */}
            <div className="space-y-3">
              {!readOnly && (
                <SettlementPlan
                  settlement={worker.settlement}
                  workerName={worker.workerName}
                  onApply={onSettle}
                  applying={settling}
                />
              )}

              {owedAdvance > 0 && !readOnly && (
                <div
                  className="rounded border px-2.5 py-2"
                  style={{ background: "var(--warn-soft)", borderColor: "var(--line)" }}
                >
                  <p className="text-xs font-medium" style={{ color: "var(--warn)" }}>
                    {worker.workerName} owes {formatINR(owedAdvance)} in advances
                  </p>
                  <p className="mt-0.5 text-[11px] ink-2">
                    Decide how much to take back this week — nothing is applied automatically.
                  </p>
                  <div className="mt-2 flex gap-1">
                    <Button
                      size="xs"
                      onClick={() => {
                        const take = Math.min(owedAdvance, Math.max(0, worker.wage));
                        setDraft((c) => ({ ...c, advanceRecovered: String(toRupees(take)) }));
                        onSave({ advanceRecovered: take });
                      }}
                    >
                      Take {formatINR(Math.min(owedAdvance, Math.max(0, worker.wage)))}
                    </Button>
                    {[25, 50].map((pct) => {
                      const take = Math.min(
                        Math.round((owedAdvance * pct) / 100),
                        Math.max(0, worker.wage),
                      );
                      return (
                        <Button
                          key={pct}
                          size="xs"
                          onClick={() => {
                            setDraft((c) => ({
                              ...c,
                              advanceRecovered: String(toRupees(take)),
                            }));
                            onSave({ advanceRecovered: take });
                          }}
                        >
                          {pct}%
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <p className="eyebrow mb-1.5">Adjustments</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {FIELDS.map((field) => (
                    <label key={field.key} title={field.help}>
                      <span className="mb-0.5 block text-[11px] ink-2">{field.label}</span>
                      <NumberInput
                        value={draft[field.key]}
                        placeholder="0"
                        disabled={readOnly}
                        aria-label={`${worker.workerName} ${field.label}`}
                        onChange={(e) =>
                          setDraft((c) => ({ ...c, [field.key]: e.target.value }))
                        }
                        onBlur={() => commit(field.key)}
                        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                      />
                    </label>
                  ))}
                </div>
              </div>

              {!readOnly && (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-[11px] ink-3">Round:</span>
                  {ROUNDING_STEPS.map((step) => (
                    <span key={step} className="inline-flex overflow-hidden rounded border">
                      <button
                        className="px-1.5 py-1 text-[11px] font-medium hover:bg-[color:var(--panel-3)]"
                        onClick={() => applyRounding(step, "up")}
                        title={`Round up to the next ₹${step}`}
                      >
                        ↑{step}
                      </button>
                      <button
                        className="border-l px-1.5 py-1 text-[11px] font-medium hover:bg-[color:var(--panel-3)]"
                        onClick={() => applyRounding(step, "down")}
                        title={`Round down to the previous ₹${step}`}
                      >
                        ↓{step}
                      </button>
                    </span>
                  ))}
                  <Button
                    size="xs"
                    onClick={() => {
                      setDraft((c) => ({ ...c, credit: "", debit: "" }));
                      onSave({ credit: 0, debit: 0 });
                    }}
                  >
                    Clear
                  </Button>
                </div>
              )}

              {/* Carry-forward */}
              <div
                className="rounded border px-2.5 py-2 text-[11px]"
                style={{ background: "var(--panel)", borderColor: "var(--line)" }}
              >
                <p className="eyebrow mb-1">Carried forward</p>
                <BalanceLine
                  label="Advance owed to you"
                  value={worker.closingBalance.advanceOutstanding}
                />
                <BalanceLine
                  label="Credit owed to you"
                  value={worker.closingBalance.creditOutstanding}
                />
                <BalanceLine
                  label="You owe the worker"
                  value={worker.closingBalance.debitOutstanding}
                  positive
                />
                {worker.closingBalance.advanceOutstanding === 0 &&
                  worker.closingBalance.creditOutstanding === 0 &&
                  worker.closingBalance.debitOutstanding === 0 && (
                    <p className="ink-3">All square.</p>
                  )}
              </div>

              <div className="flex items-center justify-between border-t pt-2">
                <span className="text-xs ink-3">Net payable</span>
                <div className="flex items-center gap-2">
                  <Money className="text-base font-semibold" tone="positive">
                    {formatINR(liveNet)}
                  </Money>
                  <Button
                    size="sm"
                    variant={worker.paidAt ? "primary" : "default"}
                    icon={worker.paidAt ? <Check size={12} /> : undefined}
                    onClick={() => onSave({ paid: !worker.paidAt })}
                    disabled={readOnly}
                  >
                    {worker.paidAt ? "Paid" : "Mark paid"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BalanceLine({
  label,
  value,
  positive,
}: {
  label: string;
  value: number;
  positive?: boolean;
}) {
  if (value === 0) return null;
  return (
    <div className="flex justify-between">
      <span className="ink-2">{label}</span>
      <Money tone={positive ? "positive" : "negative"} className="font-medium">
        {formatINR(value)}
      </Money>
    </div>
  );
}

function toDraft(adj: Adjustments): Record<Field, string> {
  const show = (p: number) => (p === 0 ? "" : String(toRupees(p)));
  return {
    credit: show(adj.credit),
    deduct: show(adj.deduct),
    debit: show(adj.debit),
    addback: show(adj.addback),
    advanceRecovered: show(adj.advanceRecovered),
  };
}
