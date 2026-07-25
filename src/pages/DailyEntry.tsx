import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CalendarCheck, Copy, Lock, TrendingUp } from "lucide-react";
import { PageBody, PageHeader } from "@/components/layout/AppShell";
import { DateNav } from "@/components/DateNav";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  NumberInput,
  Spinner,
  useToast,
} from "@/components/ui";
import {
  useBootstrap,
  useCopyDay,
  useEntriesForDate,
  useSaveDay,
  useToday,
  useWeek,
} from "@/lib/queries";
import type { DayEntryInput } from "@/lib/api";
import {
  addDays,
  formatFullDate,
  longDayName,
  relativeDayLabel,
  weekStartOf,
} from "@shared/dates";
import { formatCount, formatINR, parseCountInput, parseRupeeInput } from "@shared/money";
import { lineItemWage } from "@shared/calc";
import type { WorkKind } from "@shared/types";

/** One editable cell, keyed by worker + towel type. */
type ValueMap = Record<string, string>;

const cellKey = (workerId: number, workTypeId: number) => `${workerId}:${workTypeId}`;

export default function DailyEntry() {
  const params = useParams<{ date?: string }>();
  const navigate = useNavigate();
  const today = useToday();
  const date = params.date ?? today;

  const bootstrap = useBootstrap();
  const entries = useEntriesForDate(date);
  const week = useWeek(weekStartOf(date));
  const saveDay = useSaveDay(date);
  const copyDay = useCopyDay();
  const { toast } = useToast();

  const [values, setValues] = useState<ValueMap>({});
  /** Snapshot of what the server last confirmed, so we only save real changes. */
  const savedRef = useRef<ValueMap>({});

  // Reset the form whenever the day's data arrives or the date changes.
  useEffect(() => {
    if (!entries.data) return;
    const next: ValueMap = {};
    for (const entry of entries.data) {
      const value = entry.kind === "direct_sum" ? entry.amount / 100 : entry.quantity;
      if (value !== 0) next[cellKey(entry.workerId, entry.workTypeId)] = String(value);
    }
    setValues(next);
    savedRef.current = next;
  }, [entries.data, date]);

  const isFinalized = week.data?.status === "finalized";

  const workersWithRates = useMemo(() => {
    if (!bootstrap.data) return [];
    const typeById = new Map(bootstrap.data.workTypes.map((t) => [t.id, t]));
    return bootstrap.data.workers
      .filter((w) => w.isActive)
      .map((worker) => ({
        worker,
        rows: bootstrap.data.rates
          .filter((r) => r.workerId === worker.id && r.isActive)
          .map((rate) => ({ rate, workType: typeById.get(rate.workTypeId)! }))
          .filter((row) => row.workType && row.workType.isActive),
      }))
      .filter((entry) => entry.rows.length > 0);
  }, [bootstrap.data]);

  /** Rupee value of a single cell today. Weekly-formula types have no daily wage. */
  const cellWage = (kind: WorkKind, raw: string, unitPrice: number) => {
    if (kind === "formula_sum_ratio") return null;
    if (kind === "direct_sum") return parseRupeeInput(raw);
    return lineItemWage({
      kind: "count_x_price",
      totalQuantity: parseCountInput(raw),
      totalAmount: 0,
      unitPrice,
      divisor: 1,
      multiplier: 0,
    });
  };

  const workerTotal = (workerId: number) => {
    const group = workersWithRates.find((g) => g.worker.id === workerId);
    if (!group) return 0;
    return group.rows.reduce((total, { rate, workType }) => {
      const wage = cellWage(workType.kind, values[cellKey(workerId, workType.id)] ?? "", rate.unitPrice);
      return total + (wage ?? 0);
    }, 0);
  };

  const dayTotal = workersWithRates.reduce((sum, g) => sum + workerTotal(g.worker.id), 0);

  const workersEntered = workersWithRates.filter((g) =>
    g.rows.some(({ workType }) => {
      const raw = values[cellKey(g.worker.id, workType.id)];
      return raw !== undefined && raw !== "" && parseCountInput(raw) !== 0;
    }),
  ).length;

  /** Persist the whole day. Called on blur, and only when something changed. */
  const commit = () => {
    if (isFinalized) return;
    const changed = Object.keys({ ...values, ...savedRef.current }).some(
      (key) => (values[key] ?? "") !== (savedRef.current[key] ?? ""),
    );
    if (!changed) return;

    const payload: DayEntryInput[] = [];
    for (const { worker, rows } of workersWithRates) {
      for (const { workType } of rows) {
        const raw = values[cellKey(worker.id, workType.id)] ?? "";
        payload.push({
          workerId: worker.id,
          workTypeId: workType.id,
          quantity: workType.kind === "direct_sum" ? 0 : parseCountInput(raw),
          amount: workType.kind === "direct_sum" ? parseRupeeInput(raw) : 0,
        });
      }
    }

    savedRef.current = { ...values };
    saveDay.mutate(payload, {
      onError: (error) => {
        toast(error instanceof Error ? error.message : "Could not save", { tone: "error" });
        // Let the next blur retry rather than silently dropping the change.
        savedRef.current = {};
      },
    });
  };

  const goto = (nextDate: string) => {
    commit();
    navigate(`/entry/${nextDate}`);
  };

  const copyYesterday = () => {
    const from = addDays(date, -1);
    copyDay.mutate(
      { from, to: date },
      {
        onSuccess: (result) => {
          toast(
            result.copied
              ? `Copied ${result.copied} entries from ${relativeDayLabel(from, today)}.`
              : (result.message ?? "Nothing to copy."),
            { tone: result.copied ? "success" : "info" },
          );
        },
        onError: (error) =>
          toast(error instanceof Error ? error.message : "Could not copy", { tone: "error" }),
      },
    );
  };

  if (bootstrap.isLoading || entries.isLoading) return <Spinner label="Loading the day" />;
  if (bootstrap.error) return <ErrorState error={bootstrap.error} onRetry={bootstrap.refetch} />;

  return (
    <>
      <PageHeader
        title={relativeDayLabel(date, today)}
        subtitle={`${longDayName(date)}, ${formatFullDate(date)}`}
        action={
          <Button
            size="sm"
            icon={<Copy size={15} />}
            onClick={copyYesterday}
            loading={copyDay.isPending}
            disabled={isFinalized}
          >
            <span className="hidden sm:inline">Copy yesterday</span>
          </Button>
        }
      />

      <PageBody className="space-y-3">
        <DateNav
          label={relativeDayLabel(date, today)}
          sublabel={formatFullDate(date)}
          value={date}
          onChange={goto}
          onPrev={() => goto(addDays(date, -1))}
          onNext={() => goto(addDays(date, 1))}
          prevLabel="Previous day"
          nextLabel="Next day"
        />

        {isFinalized && (
          <div
            className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm"
            style={{ background: "var(--warning-soft)", color: "var(--warning)" }}
          >
            <Lock size={16} className="shrink-0" />
            <span>
              This week has been finalized and paid. Reopen it from the Wages screen to make
              corrections.
            </span>
          </div>
        )}

        <div className="flex items-center justify-between px-1 text-sm">
          <span className="text-muted">
            {workersEntered} of {workersWithRates.length} workers entered
          </span>
          {saveDay.isPending && <span className="text-muted">Saving…</span>}
          {!saveDay.isPending && saveDay.isSuccess && (
            <span className="flex items-center gap-1" style={{ color: "var(--positive)" }}>
              <CalendarCheck size={14} /> Saved
            </span>
          )}
        </div>

        {workersWithRates.length === 0 ? (
          <Card>
            <EmptyState
              title="No workers set up yet"
              description="Add a worker and assign the towel types they handle, then come back here to record the day."
              action={
                <Button variant="primary" onClick={() => navigate("/workers")}>
                  Set up workers
                </Button>
              }
            />
          </Card>
        ) : (
          workersWithRates.map(({ worker, rows }) => (
            <Card key={worker.id} className="overflow-hidden">
              <div
                className="flex items-baseline justify-between gap-3 border-b px-4 py-3"
                style={{ background: "var(--surface-2)" }}
              >
                <h2 className="truncate font-semibold">{worker.name}</h2>
                <span className="tnum shrink-0 text-sm font-semibold" style={{ color: "var(--positive)" }}>
                  {formatINR(workerTotal(worker.id))}
                </span>
              </div>

              <div className="divide-y">
                {rows.map(({ rate, workType }) => {
                  const key = cellKey(worker.id, workType.id);
                  const raw = values[key] ?? "";
                  const wage = cellWage(workType.kind, raw, rate.unitPrice);

                  return (
                    <div key={workType.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ background: workType.color }}
                          />
                          <span className="truncate font-medium">{workType.name}</span>
                        </div>
                        <div className="mt-0.5 pl-4.5 text-xs text-muted">
                          {workType.kind === "count_x_price" && (
                            <>
                              {formatINR(rate.unitPrice)} per {workType.unitLabel.replace(/s$/, "")}
                            </>
                          )}
                          {workType.kind === "direct_sum" && "Amount in ₹ for the day"}
                          {workType.kind === "formula_sum_ratio" && (
                            <>
                              Paid weekly · every {formatCount(rate.divisor)} {workType.unitLabel}{" "}
                              = {formatINR(rate.multiplier)}
                            </>
                          )}
                        </div>
                      </div>

                      <div className="w-28 shrink-0">
                        <NumberInput
                          value={raw}
                          placeholder="0"
                          disabled={isFinalized}
                          aria-label={`${worker.name} — ${workType.name}`}
                          onChange={(e) =>
                            setValues((current) => ({ ...current, [key]: e.target.value }))
                          }
                          onBlur={commit}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                          }}
                        />
                        <div className="mt-1 h-4 text-right text-xs tnum text-muted">
                          {wage !== null && wage > 0 && formatINR(wage)}
                          {wage === null && raw !== "" && "weekly"}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          ))
        )}

        {week.data && (
          <Card className="p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <TrendingUp size={16} style={{ color: "var(--accent)" }} />
              Week so far
              <Badge tone={week.data.status === "finalized" ? "positive" : "accent"}>
                {week.data.status === "finalized" ? "Finalized" : "Open"}
              </Badge>
            </div>
            <div className="tnum mt-2 text-2xl font-bold">{formatINR(week.data.totals.wage)}</div>
            <Button
              className="mt-3 w-full"
              onClick={() => navigate(`/week/${weekStartOf(date)}`)}
            >
              Open the week's wages
            </Button>
          </Card>
        )}
      </PageBody>

      {/* Sticky day total, always visible while typing. */}
      <div
        className="no-print safe-bottom fixed inset-x-0 bottom-16 z-30 border-t px-4 py-2.5 lg:bottom-0 lg:ml-60"
        style={{ background: "var(--surface)" }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between lg:px-8">
          <span className="text-sm text-muted">Day total</span>
          <span className="tnum text-xl font-bold" style={{ color: "var(--positive)" }}>
            {formatINR(dayTotal)}
          </span>
        </div>
      </div>
    </>
  );
}
