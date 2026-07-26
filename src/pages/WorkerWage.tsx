import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, HandCoins, Lock, PencilLine, Printer } from "lucide-react";
import { Toolbar } from "@/components/Toolbar";
import { PageHeader } from "@/components/layout/AppShell";
import { SettlementPlan } from "@/components/SettlementPlan";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Money,
  NumberInput,
  Spinner,
  cx,
  useToast,
} from "@/components/ui";
import { useSetAdjustments, useSettleWeek, useToday, useWeek } from "@/lib/queries";
import {
  buildWeekGrid,
  formatCellCount,
  formatCellWage,
} from "@/components/WeekGrid";
import {
  formatDayLabel,
  formatWeekRange,
  relativeWeekLabel,
  weekStartOf,
} from "@shared/dates";
import { formatCount, formatINR, parseRupeeInput, toRupees } from "@shared/money";
import { computeRounding, computeTargetPayment } from "@shared/calc";
import type { Adjustments } from "@shared/types";

const ROUNDING_STEPS = [10, 50, 100];

type Field = keyof Adjustments;

const FIELDS: Array<{ key: Field; label: string; help: string }> = [
  {
    key: "advanceRecovered",
    label: "Advance taken back",
    help: "Recovered against an advance you gave. Never filled in automatically.",
  },
  { key: "deduct", label: "Deduct", help: "Recovering an earlier rounding credit." },
  { key: "addback", label: "Add back", help: "Repaying an earlier rounding debit." },
  { key: "credit", label: "Credit", help: "Paid extra to round up. The worker owes this back." },
  { key: "debit", label: "Debit", help: "Held back to round down. You owe this." },
];

/**
 * One worker's payout for one week, on its own page.
 *
 * This used to be a drawer inside the week list, which left no room for the
 * breakdown, the advances and the five adjustment fields to all be legible at
 * once. A page gives each of them space.
 */
export default function WorkerWage() {
  const params = useParams<{ weekStart: string; workerId: string }>();
  const navigate = useNavigate();
  const today = useToday();
  const weekStart = weekStartOf(params.weekStart ?? today);
  const workerId = Number(params.workerId);

  const week = useWeek(weekStart);
  const setAdjustments = useSetAdjustments(weekStart);
  const settle = useSettleWeek(weekStart);
  const { toast } = useToast();

  const worker = week.data?.workers.find((w) => w.workerId === workerId);
  const readOnly = week.data?.status === "finalized";
  const back = () => navigate(`/week/${weekStart}`);

  const [draft, setDraft] = useState<Record<Field, string>>({
    credit: "",
    deduct: "",
    debit: "",
    addback: "",
    advanceRecovered: "",
  });
  /** The "pay exactly this" box, kept separate from the adjustment fields. */
  const [payDraft, setPayDraft] = useState("");

  useEffect(() => {
    if (!worker) return;
    const show = (p: number) => (p === 0 ? "" : String(toRupees(p)));
    setDraft({
      credit: show(worker.adjustments.credit),
      deduct: show(worker.adjustments.deduct),
      debit: show(worker.adjustments.debit),
      addback: show(worker.adjustments.addback),
      advanceRecovered: show(worker.adjustments.advanceRecovered),
    });
  }, [worker?.adjustments]);

  const parsed = useMemo(
    () =>
      Object.fromEntries(
        (Object.keys(draft) as Field[]).map((f) => [f, parseRupeeInput(draft[f])]),
      ) as Record<Field, number>,
    [draft],
  );

  if (week.isLoading) return <Spinner label="Loading the payout" />;
  if (week.error) return <ErrorState error={week.error} onRetry={week.refetch} />;

  if (!worker) {
    return (
      <>
        <PageHeader
          title="Not found"
          action={
            <Button icon={<ArrowLeft size={13} />} onClick={back}>
              Back
            </Button>
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <EmptyState
            title="No payout for this worker"
            description="They have nothing recorded in this week."
            action={<Button onClick={back}>Back to the week</Button>}
          />
        </div>
      </>
    );
  }

  const liveNet =
    worker.wage +
    parsed.credit -
    parsed.deduct -
    parsed.debit +
    parsed.addback -
    parsed.advanceRecovered;

  const owedAdvance = worker.openingBalance.advanceOutstanding;

  /**
   * What this worker did on each day of the week.
   *
   * Counts exclude direct_sum lines, which record a rupee amount rather than a
   * quantity. Earnings come from each line's per-day figures, so a rate change
   * part-way through the week lands on the right days.
   */
  const grid = buildWeekGrid(worker, weekStart);
  const daysWorked = grid.rows.filter((r) => r.cells.size > 0).length;

  const commit = (field: Field) => {
    if (readOnly || parsed[field] === worker.adjustments[field]) return;
    setAdjustments.mutate(
      { workerId, [field]: parsed[field] },
      {
        onError: (error) =>
          toast(error instanceof Error ? error.message : "Could not save", { tone: "error" }),
      },
    );
  };

  const save = (body: Partial<Adjustments> & { paid?: boolean }) =>
    setAdjustments.mutate(
      { workerId, ...body },
      {
        onError: (error) =>
          toast(error instanceof Error ? error.message : "Could not save", { tone: "error" }),
      },
    );

  /** Live read-out of what naming this amount would book, before applying it. */
  const payPreview = useMemo(() => {
    const target = parseRupeeInput(payDraft);
    if (target <= 0) return null;
    return computeTargetPayment(worker.wage, { ...parsed }, target);
  }, [payDraft, parsed, worker.wage]);

  /** True once the typed figure is what the worker is actually set to be paid. */
  const payApplied = payPreview !== null && payPreview.netPayable === liveNet;

  const applyTarget = () => {
    if (!payPreview) return;
    setDraft((c) => ({
      ...c,
      credit: payPreview.credit ? String(toRupees(payPreview.credit)) : "",
      debit: payPreview.debit ? String(toRupees(payPreview.debit)) : "",
    }));
    save({ credit: payPreview.credit, debit: payPreview.debit });
    // The box keeps what was typed. Clearing it would fall back to showing the
    // suggested figure as a placeholder, which reads as if the entry was lost.
    toast(`Set to pay ${formatINR(payPreview.netPayable)}.`, { tone: "success" });
  };

  const applyRounding = (step: number, direction: "up" | "down") => {
    const result = computeRounding(worker.wage, { ...parsed }, step, direction);
    setDraft((c) => ({
      ...c,
      credit: result.credit ? String(toRupees(result.credit)) : "",
      debit: result.debit ? String(toRupees(result.debit)) : "",
    }));
    save({ credit: result.credit, debit: result.debit });
  };

  const takeAdvance = (amount: number) => {
    setDraft((c) => ({ ...c, advanceRecovered: amount ? String(toRupees(amount)) : "" }));
    save({ advanceRecovered: amount });
  };

  return (
    <>
      <PageHeader
        title={worker.workerName}
        meta={
          <span className="flex items-center gap-2">
            {relativeWeekLabel(weekStart, today)} · {formatWeekRange(weekStart)}
            {worker.paidAt && (
              <Badge tone="positive">
                <Check size={10} /> Paid
              </Badge>
            )}
          </span>
        }
        action={
          <Toolbar
            items={[
              {
                label: "All workers",
                icon: <ArrowLeft size={15} />,
                keepVisible: true,
                onClick: back,
              },
              {
                label: "Jump to the week",
                icon: <PencilLine size={15} />,
                hint: "Daily entry, from the Sunday",
                onClick: () => navigate(`/entry/${weekStart}`),
              },
              {
                label: "Print payout sheet",
                icon: <Printer size={15} />,
                onClick: () => window.print(),
              },
            ]}
          />
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-3 px-3 py-3 lg:px-5">
          {readOnly && (
            <div
              className="flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs"
              style={{
                background: "var(--pos-soft)",
                color: "var(--pos)",
                borderColor: "var(--line)",
              }}
            >
              <Lock size={12} className="shrink-0" />
              This week is finalized — these figures are frozen.
            </div>
          )}

          {/* What the wage is made of */}
          <Section title="Wage breakdown" meta={formatINR(worker.wage)}>
            {worker.lineItems.length === 0 ? (
              <p className="px-3 py-3 text-xs ink-3">No work recorded this week.</p>
            ) : (
              worker.lineItems.map((item) => (
                <div
                  key={item.workTypeId}
                  className="flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0"
                  style={{ borderColor: "var(--line)" }}
                >
                  <span
                    className="h-8 w-1 shrink-0 rounded-full"
                    style={{ background: item.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{item.name}</div>
                    <div className="truncate text-[11px] ink-3 tnum">
                      {item.kind === "direct_sum"
                        ? `${item.daysWorked} days`
                        : item.kind === "formula_sum_ratio"
                          ? `${formatCount(item.totalQuantity)} ÷ ${formatCount(item.divisor)} × ${formatINR(item.multiplier, { decimals: false })}`
                          : item.rateVaried
                            ? `${formatCount(item.totalQuantity)} towels · rate changed mid-week`
                            : `${formatCount(item.totalQuantity)} × ${formatINR(item.unitPrice)}`}
                      {item.looms > 1 &&
                        ` · ${item.loomTotals.map((v) => formatCount(v)).join(" + ")}`}
                    </div>
                  </div>
                  <Money className="shrink-0 text-sm font-medium">{formatINR(item.wage)}</Money>
                </div>
              ))
            )}
          </Section>

          {/*
            Naming the payment sits straight under the breakdown: you read what
            was earned, then say what you will hand over.
          */}
          {!readOnly && (
            <Section title="Pay a specific amount">
              <div className="p-3">
                <p className="text-xs ink-2">
                  Type what you intend to hand over and the difference is booked for you —
                  over the wage and {worker.workerName} owes you the excess, under it and you
                  owe them the shortfall.
                </p>
                <div className="mt-2 flex items-end gap-2">
                  <label className="min-w-0 flex-1">
                    <span className="mb-1 block text-[11px] font-medium ink-2">
                      Amount to pay
                    </span>
                    <NumberInput
                      value={payDraft}
                      placeholder={String(toRupees(worker.settlement.netPayable))}
                      aria-label={`Amount to pay ${worker.workerName}`}
                      onChange={(e) => setPayDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") applyTarget();
                      }}
                    />
                  </label>
                  <Button
                    size="md"
                    variant="primary"
                    onClick={applyTarget}
                    disabled={parseRupeeInput(payDraft) <= 0 || payApplied}
                  >
                    {payApplied ? "Applied" : "Apply"}
                  </Button>
                </div>

                {payPreview && (
                  <p
                    className="mt-2 rounded border px-2.5 py-1.5 text-xs"
                    style={
                      payApplied
                        ? { background: "var(--pos-soft)", borderColor: "var(--line)" }
                        : {
                            background: "var(--accent-soft)",
                            borderColor: "var(--accent-line)",
                          }
                    }
                  >
                    {payApplied ? "Set to pay " : "Pay "}
                    <strong>{formatINR(payPreview.netPayable)}</strong> —{" "}
                    {payPreview.credit > 0 && (
                      <>
                        {worker.workerName} {payApplied ? "owes" : "will owe"} you{" "}
                        <strong>{formatINR(payPreview.credit)}</strong>, recovered next week.
                      </>
                    )}
                    {payPreview.debit > 0 && (
                      <>
                        you {payApplied ? "owe" : "will owe"} {worker.workerName}{" "}
                        <strong>{formatINR(payPreview.debit)}</strong>, carried to next week.
                      </>
                    )}
                    {payPreview.credit === 0 &&
                      payPreview.debit === 0 &&
                      "exactly what is due, nothing carried."}
                  </p>
                )}
              </div>
            </Section>
          )}

          {/* Day by day, one column pair per towel type */}
          <Section
            title="Day by day"
            meta={`${daysWorked} ${daysWorked === 1 ? "day" : "days"} worked`}
          >
            {grid.columns.length === 0 ? (
              <p className="px-3 py-3 text-xs ink-3">Nothing recorded this week.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-max text-xs">
                  <thead>
                    <tr style={{ background: "var(--panel-2)" }}>
                      <th
                        className="sticky left-0 border-b px-3 py-1.5 text-left text-[10px] font-medium uppercase tracking-wide ink-4"
                        style={{ background: "var(--panel-2)", borderColor: "var(--line)" }}
                      >
                        Day
                      </th>
                      {grid.columns.map((column) => (
                        <th
                          key={column.workTypeId}
                          colSpan={2}
                          className="border-b border-l px-3 py-1.5 text-center text-[11px] font-semibold"
                          style={{ borderColor: "var(--line)" }}
                        >
                          <span className="flex items-center justify-center gap-1.5">
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ background: column.color }}
                            />
                            {column.name}
                          </span>
                        </th>
                      ))}
                    </tr>
                    <tr style={{ background: "var(--panel-2)" }}>
                      <th
                        className="sticky left-0 border-b px-3 pb-1.5 text-left text-[10px] ink-4"
                        style={{ background: "var(--panel-2)", borderColor: "var(--line)" }}
                      />
                      {grid.columns.map((column) => (
                        <Fragment key={column.workTypeId}>
                          <th
                            key={`${column.workTypeId}-q`}
                            className="border-b border-l px-2 pb-1.5 text-right text-[10px] font-medium uppercase tracking-wide ink-4"
                            style={{ borderColor: "var(--line)" }}
                          >
                            Towels
                          </th>
                          <th
                            key={`${column.workTypeId}-p`}
                            className="border-b px-2 pb-1.5 text-right text-[10px] font-medium uppercase tracking-wide ink-4"
                            style={{ borderColor: "var(--line)" }}
                          >
                            Price
                          </th>
                        </Fragment>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {grid.rows.map((row) => (
                      <tr
                        key={row.date}
                        style={{
                          background:
                            row.date === today ? "var(--accent-soft)" : undefined,
                        }}
                      >
                        <td
                          className="sticky left-0 whitespace-nowrap border-b px-3 py-1.5"
                          style={{
                            borderColor: "var(--line)",
                            background:
                              row.date === today
                                ? "var(--accent-soft)"
                                : "var(--panel)",
                          }}
                        >
                          {formatDayLabel(row.date)}
                        </td>
                        {grid.columns.map((column) => {
                          const cell = row.cells.get(column.workTypeId);
                          return (
                            <Fragment key={column.workTypeId}>
                              <td
                                key={`${column.workTypeId}-q`}
                                className="tnum border-b border-l px-2 py-1.5 text-right"
                                style={{ borderColor: "var(--line)" }}
                              >
                                {formatCellCount(cell)}
                              </td>
                              <td
                                key={`${column.workTypeId}-p`}
                                className="tnum border-b px-2 py-1.5 text-right"
                                style={{ borderColor: "var(--line)" }}
                              >
                                {formatCellWage(cell, column.weeklyOnly)}
                              </td>
                            </Fragment>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>

                  <tfoot>
                    <tr
                      className="font-semibold"
                      style={{ background: "var(--panel-2)" }}
                    >
                      <td
                        className="sticky left-0 border-t px-3 py-2"
                        style={{
                          background: "var(--panel-2)",
                          borderColor: "var(--line-strong)",
                        }}
                      >
                        Total
                      </td>
                      {grid.columns.map((column) => (
                        <Fragment key={column.workTypeId}>
                          <td
                            key={`${column.workTypeId}-q`}
                            className="tnum border-l border-t px-2 py-2 text-right"
                            style={{ borderColor: "var(--line-strong)" }}
                          >
                            {column.totalQuantity > 0
                              ? formatCount(column.totalQuantity)
                              : "—"}
                          </td>
                          <td
                            key={`${column.workTypeId}-p`}
                            className="tnum border-t px-2 py-2 text-right"
                            style={{ borderColor: "var(--line-strong)" }}
                          >
                            {formatINR(column.totalWage)}
                          </td>
                        </Fragment>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {grid.columns.some((c) => c.weeklyOnly) && (
              <p
                className="border-t px-3 py-1.5 text-[11px] ink-3"
                style={{ borderColor: "var(--line)" }}
              >
                {grid.columns
                  .filter((c) => c.weeklyOnly)
                  .map((c) => c.name)
                  .join(", ")}{" "}
                {grid.columns.filter((c) => c.weeklyOnly).length === 1 ? "is" : "are"} paid on
                the week's total, so the daily prices are blank.
              </p>
            )}
          </Section>

          {/* Advances */}
          {(owedAdvance > 0 || worker.advances.length > 0) && (
            <Section
              title="Advances"
              meta={owedAdvance > 0 ? `${formatINR(owedAdvance)} outstanding` : undefined}
            >
              {worker.advances.map((advance) => (
                <div
                  key={advance.id}
                  className="flex items-center gap-3 border-b px-3 py-2 last:border-b-0"
                  style={{ borderColor: "var(--line)" }}
                >
                  <Badge tone={advance.kind === "advance" ? "negative" : "positive"}>
                    {advance.kind === "advance" ? "Given" : "Returned"}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-xs ink-2">
                    {advance.note ?? advance.entryDate}
                  </span>
                  <Money
                    className="shrink-0 text-sm"
                    tone={advance.kind === "advance" ? "negative" : "positive"}
                  >
                    {formatINR(advance.amount)}
                  </Money>
                </div>
              ))}

              {owedAdvance > 0 && !readOnly && (
                <div className="px-3 py-3">
                  <p className="text-xs ink-2">
                    <strong>{worker.workerName}</strong> owes{" "}
                    <strong>{formatINR(owedAdvance)}</strong>. Decide how much to take off this
                    week — nothing is applied automatically.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button
                      size="sm"
                      onClick={() =>
                        takeAdvance(Math.min(owedAdvance, Math.max(0, worker.wage)))
                      }
                    >
                      Take {formatINR(Math.min(owedAdvance, Math.max(0, worker.wage)))}
                    </Button>
                    {[50, 25].map((pct) => (
                      <Button
                        key={pct}
                        size="sm"
                        onClick={() =>
                          takeAdvance(
                            Math.min(
                              Math.round((owedAdvance * pct) / 100),
                              Math.max(0, worker.wage),
                            ),
                          )
                        }
                      >
                        {pct}%
                      </Button>
                    ))}
                    {parsed.advanceRecovered > 0 && (
                      <Button size="sm" onClick={() => takeAdvance(0)}>
                        None
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </Section>
          )}

          {/* The proposal */}
          {!readOnly && (
            <SettlementPlan
              settlement={worker.settlement}
              workerName={worker.workerName}
              applying={settle.isPending}
              onApply={() =>
                settle.mutate(workerId, {
                  onSuccess: () =>
                    toast(`Settled ${worker.workerName}.`, { tone: "success" }),
                  onError: (error) =>
                    toast(error instanceof Error ? error.message : "Could not settle", {
                      tone: "error",
                    }),
                })
              }
            />
          )}

          {/* Adjustments */}
          <Section title="Adjustments">
            <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3">
              {FIELDS.map((field) => (
                <label key={field.key} title={field.help}>
                  <span className="mb-1 block text-[11px] font-medium ink-2">
                    {field.label}
                  </span>
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

            {!readOnly && (
              <div
                className="flex flex-wrap items-center gap-1.5 border-t px-3 py-2.5"
                style={{ borderColor: "var(--line)" }}
              >
                <span className="text-[11px] ink-3">Round the payment:</span>
                {ROUNDING_STEPS.map((step) => (
                  <span
                    key={step}
                    className="inline-flex overflow-hidden rounded border"
                    style={{ borderColor: "var(--line-strong)" }}
                  >
                    <button
                      className="px-2 py-1 text-[11px] font-medium hover:bg-[color:var(--panel-3)]"
                      onClick={() => applyRounding(step, "up")}
                      title={`Round up to the next ₹${step}`}
                    >
                      ↑ ₹{step}
                    </button>
                    <button
                      className="border-l px-2 py-1 text-[11px] font-medium hover:bg-[color:var(--panel-3)]"
                      style={{ borderColor: "var(--line-strong)" }}
                      onClick={() => applyRounding(step, "down")}
                      title={`Round down to the previous ₹${step}`}
                    >
                      ↓ ₹{step}
                    </button>
                  </span>
                ))}
                <Button
                  size="xs"
                  onClick={() => {
                    setDraft((c) => ({ ...c, credit: "", debit: "" }));
                    save({ credit: 0, debit: 0 });
                  }}
                >
                  Clear
                </Button>
              </div>
            )}
          </Section>

          {/* Carried forward */}
          <Section title="Carried into next week">
            <div className="space-y-1 px-3 py-2.5 text-xs">
              <BalanceLine
                label={`${worker.workerName} owes you (advance)`}
                value={worker.closingBalance.advanceOutstanding}
              />
              <BalanceLine
                label={`${worker.workerName} owes you (credit)`}
                value={worker.closingBalance.creditOutstanding}
              />
              <BalanceLine
                label={`You owe ${worker.workerName}`}
                value={worker.closingBalance.debitOutstanding}
                positive
              />
              {worker.closingBalance.advanceOutstanding === 0 &&
                worker.closingBalance.creditOutstanding === 0 &&
                worker.closingBalance.debitOutstanding === 0 && (
                  <p className="ink-3">All square — nothing carries forward.</p>
                )}
            </div>
          </Section>

          {worker.lineItems.some((i) => i.rateVaried) && (
            <p className="px-1 text-[11px] ink-3">
              A rate changed part-way through this week. Each day is paid at the rate that was
              in force when it was recorded.
            </p>
          )}
        </div>
      </div>

      {/* Net payable, always in view */}
      <div
        className="shrink-0 border-t"
        style={{ background: "var(--panel)", borderColor: "var(--line)" }}
      >
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-3 px-3 lg:px-5">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] ink-3">Net payable</div>
            <Money className="text-xl font-semibold" tone="positive">
              {formatINR(liveNet)}
            </Money>
          </div>
          {owedAdvance > 0 && (
            <Badge tone="warning">
              <HandCoins size={10} /> {formatINR(owedAdvance)} owed
            </Badge>
          )}
          <Button
            size="md"
            variant={worker.paidAt ? "primary" : "default"}
            icon={worker.paidAt ? <Check size={14} /> : undefined}
            onClick={() => save({ paid: !worker.paidAt })}
            disabled={readOnly}
            className={cx("min-w-24")}
          >
            {worker.paidAt ? "Paid" : "Mark paid"}
          </Button>
        </div>
      </div>
    </>
  );
}

function Section({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="overflow-hidden rounded-md border"
      style={{ background: "var(--panel)", borderColor: "var(--line)" }}
    >
      <div
        className="flex items-center justify-between gap-3 border-b px-3 py-2"
        style={{ background: "var(--panel-2)", borderColor: "var(--line)" }}
      >
        <span className="eyebrow">{title}</span>
        {meta && <span className="tnum text-xs font-medium">{meta}</span>}
      </div>
      {children}
    </section>
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
    <div className="flex justify-between gap-3">
      <span className="ink-2">{label}</span>
      <Money tone={positive ? "positive" : "negative"} className="font-medium">
        {formatINR(value)}
      </Money>
    </div>
  );
}
