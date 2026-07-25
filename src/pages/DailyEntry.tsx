import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Lock,
} from "lucide-react";
import { PageBody, PageHeader } from "@/components/layout/AppShell";
import { CalendarPopover, WeekStrip } from "@/components/Calendar";
import { LoomInputs } from "@/components/LoomInputs";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Panel,
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
import { entryCellProps } from "@/lib/gridNav";
import type { DayEntryInput } from "@/lib/api";
import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import {
  addDays,
  formatFullDate,
  longDayName,
  relativeDayLabel,
  weekEndOf,
  weekStartOf,
} from "@shared/dates";
import { formatCount, formatINR, parseCountInput, parseRupeeInput } from "@shared/money";
import type { WorkKind } from "@shared/types";

/** Cell key: worker, towel type, loom. */
const key = (workerId: number, typeId: number, loom: number) =>
  `${workerId}:${typeId}:${loom}`;

export default function DailyEntry() {
  const params = useParams<{ date?: string }>();
  const navigate = useNavigate();
  const today = useToday();
  const date = params.date ?? today;
  const weekStart = weekStartOf(date);

  const bootstrap = useBootstrap();
  const entries = useEntriesForDate(date);
  const week = useWeek(weekStart);
  const saveDay = useSaveDay(date);
  const copyDay = useCopyDay();
  const { toast } = useToast();

  /** Which days of this week already have something recorded. */
  const weekEntries = useQuery({
    queryKey: ["entries", "range", weekStart],
    queryFn: () => api.entries.forRange(weekStart, weekEndOf(weekStart)),
  });
  const markedDays = useMemo(
    () => new Set((weekEntries.data ?? []).map((e) => e.entryDate)),
    [weekEntries.data],
  );

  const [values, setValues] = useState<Record<string, string>>({});
  /** Extra looms added on the fly, beyond the worker's configured count. */
  const [loomOverrides, setLoomOverrides] = useState<Record<string, number>>({});
  const savedRef = useRef<Record<string, string>>({});

  // Reload the form when the day's data arrives or the date changes.
  useEffect(() => {
    if (!entries.data) return;
    const next: Record<string, string> = {};
    const looms: Record<string, number> = {};
    for (const entry of entries.data) {
      const value = entry.kind === "direct_sum" ? entry.amount / 100 : entry.quantity;
      if (value !== 0) next[key(entry.workerId, entry.workTypeId, entry.loom)] = String(value);
      // A day recorded with three looms must come back with three boxes.
      const group = `${entry.workerId}:${entry.workTypeId}`;
      looms[group] = Math.max(looms[group] ?? 0, entry.loom);
    }
    setValues(next);
    setLoomOverrides(looms);
    savedRef.current = next;
  }, [entries.data, date]);

  const isFinalized = week.data?.status === "finalized";

  const rows = useMemo(() => {
    if (!bootstrap.data) return [];
    const typeById = new Map(bootstrap.data.workTypes.map((t) => [t.id, t]));
    return bootstrap.data.workers
      .filter((w) => w.isActive)
      .map((worker) => ({
        worker,
        items: bootstrap.data.rates
          .filter((r) => r.workerId === worker.id && r.isActive)
          .map((rate) => ({ rate, workType: typeById.get(rate.workTypeId)! }))
          .filter((row) => row.workType?.isActive),
      }))
      .filter((group) => group.items.length > 0);
  }, [bootstrap.data]);

  const loomsFor = (workerId: number, typeId: number, configured: number) =>
    Math.max(1, loomOverrides[`${workerId}:${typeId}`] ?? configured);

  /** Rupee value of one line today. Weekly-formula types have no daily wage. */
  const lineWage = (kind: WorkKind, workerId: number, typeId: number, looms: number, unitPrice: number) => {
    if (kind === "formula_sum_ratio") return null;
    let total = 0;
    for (let i = 1; i <= looms; i++) {
      const raw = values[key(workerId, typeId, i)] ?? "";
      total += kind === "direct_sum" ? parseRupeeInput(raw) : parseCountInput(raw) * unitPrice;
    }
    return Math.round(total);
  };

  const lineCount = (workerId: number, typeId: number, looms: number) => {
    let total = 0;
    for (let i = 1; i <= looms; i++) {
      total += parseCountInput(values[key(workerId, typeId, i)] ?? "");
    }
    return total;
  };

  const workerTotal = (workerId: number) => {
    const group = rows.find((g) => g.worker.id === workerId);
    if (!group) return 0;
    return group.items.reduce((sum, { rate, workType }) => {
      const looms = loomsFor(workerId, workType.id, rate.looms);
      return sum + (lineWage(workType.kind, workerId, workType.id, looms, rate.unitPrice) ?? 0);
    }, 0);
  };

  const dayTotal = rows.reduce((sum, g) => sum + workerTotal(g.worker.id), 0);
  const workersEntered = rows.filter((g) =>
    g.items.some(({ rate, workType }) => {
      const looms = loomsFor(g.worker.id, workType.id, rate.looms);
      for (let i = 1; i <= looms; i++) {
        if (parseCountInput(values[key(g.worker.id, workType.id, i)] ?? "") !== 0) return true;
      }
      return false;
    }),
  ).length;

  /** Persist the whole day. Called on blur, only when something changed. */
  const commit = () => {
    if (isFinalized) return;
    const changed = Object.keys({ ...values, ...savedRef.current }).some(
      (k) => (values[k] ?? "") !== (savedRef.current[k] ?? ""),
    );
    if (!changed) return;

    const payload: DayEntryInput[] = [];
    for (const { worker, items } of rows) {
      for (const { rate, workType } of items) {
        const looms = loomsFor(worker.id, workType.id, rate.looms);
        for (let loom = 1; loom <= looms; loom++) {
          const raw = values[key(worker.id, workType.id, loom)] ?? "";
          payload.push({
            workerId: worker.id,
            workTypeId: workType.id,
            loom,
            quantity: workType.kind === "direct_sum" ? 0 : parseCountInput(raw),
            amount: workType.kind === "direct_sum" ? parseRupeeInput(raw) : 0,
          });
        }
      }
    }

    savedRef.current = { ...values };
    saveDay.mutate(payload, {
      onError: (error) => {
        toast(error instanceof Error ? error.message : "Could not save", { tone: "error" });
        savedRef.current = {}; // let the next blur retry
      },
    });
  };

  const goto = (next: string) => {
    commit();
    navigate(`/entry/${next}`);
  };

  const copyYesterday = () => {
    const from = addDays(date, -1);
    copyDay.mutate(
      { from, to: date },
      {
        onSuccess: (result) =>
          toast(
            result.copied
              ? `Copied ${result.copied} figures from ${relativeDayLabel(from, today)}.`
              : (result.message ?? "Nothing to copy."),
            { tone: result.copied ? "success" : "info" },
          ),
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
        title="Daily entry"
        meta={
          <span className="flex items-center gap-2">
            {longDayName(date)}, {formatFullDate(date)}
            <span className="ink-4">·</span>
            <span className={workersEntered === rows.length ? "" : "ink-3"}>
              {workersEntered}/{rows.length} entered
            </span>
            {saveDay.isPending && <span className="ink-4">saving…</span>}
            {!saveDay.isPending && saveDay.isSuccess && (
              <span className="flex items-center gap-0.5" style={{ color: "var(--pos)" }}>
                <Check size={11} /> saved
              </span>
            )}
          </span>
        }
        action={
          <>
            <Button
              icon={<Copy size={13} />}
              onClick={copyYesterday}
              loading={copyDay.isPending}
              disabled={isFinalized}
              title="Copy yesterday's figures onto this day"
            >
              Copy yesterday
            </Button>
          </>
        }
      >
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            icon={<ChevronLeft size={13} />}
            onClick={() => goto(addDays(date, -1))}
            aria-label="Previous day"
          />
          <div className="min-w-0 flex-1">
            <WeekStrip
              value={date}
              today={today}
              markedDays={markedDays}
              onSelect={goto}
            />
          </div>
          <Button
            size="sm"
            icon={<ChevronRight size={13} />}
            onClick={() => goto(addDays(date, 1))}
            aria-label="Next day"
          />
          <CalendarPopover value={date} today={today} markedDays={markedDays} onSelect={goto}>
            {({ open, isOpen }) => (
              <Button
                size="sm"
                icon={<CalendarDays size={13} />}
                onClick={open}
                aria-expanded={isOpen}
                aria-label="Open calendar"
                title="Pick any date"
              />
            )}
          </CalendarPopover>
        </div>
      </PageHeader>

      <PageBody className="space-y-2 pb-20">
        {isFinalized && (
          <div
            className="flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs"
            style={{
              background: "var(--warn-soft)",
              color: "var(--warn)",
              borderColor: "var(--line)",
            }}
          >
            <Lock size={12} className="shrink-0" />
            This week is finalized. Reopen it from Wages to make corrections.
          </div>
        )}

        {rows.length === 0 ? (
          <Panel>
            <EmptyState
              title="No workers set up"
              description="Add a worker and assign the towel types they handle, then record the day here."
              action={
                <Button variant="primary" onClick={() => navigate("/workers")}>
                  Set up workers
                </Button>
              }
            />
          </Panel>
        ) : (
          rows.map(({ worker, items }) => (
            <Panel key={worker.id} className="overflow-hidden">
              <div
                className="flex h-8 items-center justify-between gap-3 border-b px-3"
                style={{ background: "var(--panel-2)", borderColor: "var(--line)" }}
              >
                <span className="truncate text-xs font-semibold">{worker.name}</span>
                <span className="tnum text-xs font-medium" style={{ color: "var(--pos)" }}>
                  {formatINR(workerTotal(worker.id))}
                </span>
              </div>

              <div className="hairline-y">
                {items.map(({ rate, workType }) => {
                  const looms = loomsFor(worker.id, workType.id, rate.looms);
                  const wage = lineWage(workType.kind, worker.id, workType.id, looms, rate.unitPrice);
                  const count = lineCount(worker.id, workType.id, looms);

                  return (
                    <div
                      key={workType.id}
                      className="flex items-center gap-3 px-3 py-1.5"
                      style={{ borderColor: "var(--line)" }}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: workType.color }}
                        />
                        <span className="truncate text-xs font-medium">{workType.name}</span>
                        <span className="shrink-0 text-[11px] ink-4 tnum">
                          {workType.kind === "count_x_price" && formatINR(rate.unitPrice)}
                          {workType.kind === "direct_sum" && "₹ / day"}
                          {workType.kind === "formula_sum_ratio" &&
                            `${formatCount(rate.divisor)} = ${formatINR(rate.multiplier)}`}
                        </span>
                        {looms > 1 && (
                          <Badge className="shrink-0">
                            {looms} looms · {formatCount(count)}
                          </Badge>
                        )}
                      </div>

                      <LoomInputs
                        ariaLabel={`${worker.name}, ${workType.name}`}
                        disabled={isFinalized}
                        values={Array.from(
                          { length: looms },
                          (_, i) => values[key(worker.id, workType.id, i + 1)] ?? "",
                        )}
                        onChange={(index, value) =>
                          setValues((c) => ({
                            ...c,
                            [key(worker.id, workType.id, index + 1)]: value,
                          }))
                        }
                        onLoomCountChange={(count) => {
                          setLoomOverrides((c) => ({
                            ...c,
                            [`${worker.id}:${workType.id}`]: count,
                          }));
                          // Dropping a loom must also clear its stored figure.
                          if (count < looms) {
                            setValues((c) => {
                              const next = { ...c };
                              for (let i = count + 1; i <= looms; i++) {
                                delete next[key(worker.id, workType.id, i)];
                              }
                              return next;
                            });
                          }
                        }}
                        cellProps={{ ...entryCellProps, onBlur: commit }}
                      />

                      <div className="w-16 shrink-0 text-right text-xs tnum ink-3">
                        {wage !== null && wage > 0 && formatINR(wage)}
                        {wage === null && count > 0 && "weekly"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          ))
        )}

        <p className="px-1 text-[11px] ink-4">
          Press <kbd className="font-mono">Enter</kbd> to jump to the next box,{" "}
          <kbd className="font-mono">Shift+Enter</kbd> to go back. Swipe a row left, or press{" "}
          <kbd className="font-mono">+</kbd>, to add a second loom.
        </p>
      </PageBody>

      {/* Day total, pinned above the tab bar */}
      <div
        className="no-print safe-bottom fixed inset-x-0 bottom-14 z-30 border-t lg:bottom-0 lg:ml-52"
        style={{ background: "var(--panel)", borderColor: "var(--line)" }}
      >
        <div className="mx-auto flex h-10 max-w-[1400px] items-center justify-between px-3 lg:px-5">
          <span className="text-xs ink-3">
            Day total
            {week.data && (
              <span className="ml-2 ink-4">
                week so far {formatINR(week.data.totals.wage)}
              </span>
            )}
          </span>
          <span className="tnum text-base font-semibold" style={{ color: "var(--pos)" }}>
            {formatINR(dayTotal)}
          </span>
        </div>
      </div>
    </>
  );
}
