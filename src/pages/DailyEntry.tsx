import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowUpDown,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Lock,
  Wallet,
} from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { CalendarPopover, WeekStrip } from "@/components/Calendar";
import { EntryRow } from "@/components/LoomInputs";
import {
  Badge,
  Button,
  ConfirmSheet,
  EmptyState,
  ErrorState,
  IconButton,
  Spinner,
  cx,
  useToast,
} from "@/components/ui";
import {
  useBootstrap,
  useCopyDay,
  useEntriesForDate,
  useReorderRates,
  useSaveDay,
  useToday,
  useWeek,
} from "@/lib/queries";
import { ENTRY_GRID_END } from "@/lib/gridNav";
import { api, type DayEntryInput } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import {
  addDays,
  formatFullDate,
  formatTimeIn,
  longDayName,
  relativeDayLabel,
  weekEndOf,
  weekStartOf,
} from "@shared/dates";
import { isEmployedOn } from "@shared/calc";
import { formatCount, formatINR, parseCountInput, parseRupeeInput } from "@shared/money";
import type { WorkKind, Worker, WorkType, WorkerRate } from "@shared/types";

/** Cell key: towel type, loom. Scoped to the worker being edited. */
const cellKey = (typeId: number, loom: number) => `${typeId}:${loom}`;

interface Line {
  rate: WorkerRate;
  workType: WorkType;
}

export default function DailyEntry() {
  const params = useParams<{ date?: string }>();
  const navigate = useNavigate();
  const today = useToday();
  const date = params.date ?? today;
  const weekStart = weekStartOf(date);

  const bootstrap = useBootstrap();
  const entries = useEntriesForDate(date);
  const week = useWeek(weekStart);
  const copyDay = useCopyDay();
  const { toast } = useToast();

  /** Which worker is being edited; null shows the list. */
  const [editing, setEditing] = useState<number | null>(null);

  const weekEntries = useQuery({
    queryKey: ["entries", "range", weekStart],
    queryFn: () => api.entries.forRange(weekStart, weekEndOf(weekStart)),
  });
  const markedDays = useMemo(
    () => new Set((weekEntries.data ?? []).map((e) => e.entryDate)),
    [weekEntries.data],
  );

  const isFinalized = week.data?.status === "finalized";

  const roster = useMemo(() => {
    if (!bootstrap.data) return [];
    const typeById = new Map(bootstrap.data.workTypes.map((t) => [t.id, t]));
    return bootstrap.data.workers
      // Anyone with figures saved that day stays, so they can still be corrected.
      .filter(
        (w) =>
          w.isActive &&
          (isEmployedOn(w, date) || (entries.data ?? []).some((e) => e.workerId === w.id)),
      )
      .map((worker) => ({
        worker,
        lines: bootstrap.data.rates
          .filter((r) => r.workerId === worker.id && r.isActive)
          .map((rate) => ({ rate, workType: typeById.get(rate.workTypeId)! }))
          .filter((l): l is Line => Boolean(l.workType?.isActive)),
      }))
      .filter((g) => g.lines.length > 0);
  }, [bootstrap.data, date, entries.data]);

  /** Today's saved figures, grouped by worker. */
  const savedByWorker = useMemo(() => {
    const map = new Map<number, Map<string, number>>();
    for (const entry of entries.data ?? []) {
      if (!map.has(entry.workerId)) map.set(entry.workerId, new Map());
      map
        .get(entry.workerId)!
        .set(
          cellKey(entry.workTypeId, entry.loom),
          entry.kind === "direct_sum" ? entry.amount / 100 : entry.quantity,
        );
    }
    return map;
  }, [entries.data]);

  /** When each worker's figures were last written, in the business timezone. */
  const recordedByWorker = useMemo(() => {
    const map = new Map<number, string>();
    const tz = bootstrap.data?.settings.timezone;
    for (const entry of entries.data ?? []) {
      const latest = map.get(entry.workerId);
      if (!latest || entry.updatedAt > latest) map.set(entry.workerId, entry.updatedAt);
    }
    return new Map(
      [...map].map(([workerId, stamp]) => [workerId, formatTimeIn(stamp, tz)] as const),
    );
  }, [entries.data, bootstrap.data]);

  const workerTotal = (workerId: number, lines: Line[]) => {
    const saved = savedByWorker.get(workerId);
    if (!saved) return 0;
    let total = 0;
    for (const { rate, workType } of lines) {
      if (workType.kind === "formula_sum_ratio") continue;
      for (const [k, v] of saved) {
        if (!k.startsWith(`${workType.id}:`)) continue;
        total += workType.kind === "direct_sum" ? v * 100 : v * rate.unitPrice;
      }
    }
    return Math.round(total);
  };

  const hasEntered = (workerId: number) => (savedByWorker.get(workerId)?.size ?? 0) > 0;

  const dayTotal = roster.reduce((s, g) => s + workerTotal(g.worker.id, g.lines), 0);
  const enteredCount = roster.filter((g) => hasEntered(g.worker.id)).length;

  const goto = (next: string) => {
    setEditing(null);
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

  const current = roster.find((g) => g.worker.id === editing);

  // --- one worker at a time -------------------------------------------------
  if (current) {
    return (
      <WorkerEntry
        key={`${current.worker.id}:${date}`}
        date={date}
        today={today}
        worker={current.worker}
        lines={current.lines}
        saved={savedByWorker.get(current.worker.id) ?? new Map()}
        recordedAt={recordedByWorker.get(current.worker.id)}
        readOnly={isFinalized}
        onClose={() => setEditing(null)}
      />
    );
  }

  // --- who to enter ---------------------------------------------------------
  return (
    <>
      <PageHeader
        title="Daily entry"
        meta={
          <span className="flex items-center gap-2">
            {longDayName(date)}, {formatFullDate(date)}
            <span className="ink-4">·</span>
            <span className={enteredCount === roster.length ? "" : "ink-3"}>
              {enteredCount}/{roster.length} done
            </span>
          </span>
        }
        action={
          <>
            <Button
              icon={<Wallet size={13} />}
              onClick={() => navigate(`/week/${weekStart}`)}
              title="Open this week's wages"
            >
              Jump to this week
            </Button>
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
          {/* The strip handles days; the arrows jump whole weeks. */}
          <Button
            icon={<ChevronLeft size={13} />}
            onClick={() => goto(addDays(date, -7))}
            aria-label="Previous week"
            title="Previous week"
          />
          <div className="min-w-0 flex-1">
            <WeekStrip value={date} today={today} markedDays={markedDays} onSelect={goto} />
          </div>
          <Button
            icon={<ChevronRight size={13} />}
            onClick={() => goto(addDays(date, 7))}
            aria-label="Next week"
            title="Next week"
          />
          <CalendarPopover value={date} today={today} markedDays={markedDays} onSelect={goto}>
            {({ open, isOpen }) => (
              <Button
                icon={<CalendarDays size={13} />}
                onClick={open}
                aria-expanded={isOpen}
                aria-label="Open calendar"
              />
            )}
          </CalendarPopover>
        </div>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-3 py-3 lg:px-5">
          {isFinalized && (
            <div
              className="mb-2 flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs"
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

          {roster.length === 0 ? (
            <EmptyState
              title="No workers set up"
              description="Add a worker and assign the towel types they handle, then record the day here."
              action={
                <Button variant="primary" onClick={() => navigate("/workers")}>
                  Set up workers
                </Button>
              }
            />
          ) : (
            <div
              className="overflow-hidden rounded-md border"
              style={{ background: "var(--panel)", borderColor: "var(--line)" }}
            >
              {roster.map(({ worker, lines }) => {
                const done = hasEntered(worker.id);
                return (
                  <button
                    key={worker.id}
                    onClick={() => setEditing(worker.id)}
                    className="flex w-full items-center gap-3 border-b px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-[color:var(--panel-2)]"
                    style={{ borderColor: "var(--line)" }}
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                      style={
                        done
                          ? { background: "var(--pos-soft)", color: "var(--pos)" }
                          : { background: "var(--panel-3)", color: "var(--ink-4)" }
                      }
                    >
                      {done ? <Check size={14} /> : worker.name.charAt(0)}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{worker.name}</span>
                      <span className="block truncate text-[11px] ink-3">
                        {lines.map((l) => l.workType.name).join(" · ")}
                      </span>
                    </span>

                    {done ? (
                      <span
                        className="tnum shrink-0 text-sm font-semibold"
                        style={{ color: "var(--pos)" }}
                      >
                        {formatINR(workerTotal(worker.id, lines))}
                      </span>
                    ) : (
                      <Badge>Not entered</Badge>
                    )}
                    <ChevronRight size={15} style={{ color: "var(--ink-4)" }} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Day total — always in view, above the tab bar */}
      <div
        className="shrink-0 border-t"
        style={{ background: "var(--panel)", borderColor: "var(--line)" }}
      >
        <div className="mx-auto flex h-11 max-w-2xl items-center justify-between px-3 lg:px-5">
          <span className="text-xs ink-3">
            Day total
            {week.data && (
              <span className="ml-2 ink-4">week {formatINR(week.data.totals.wage)}</span>
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

// ---------------------------------------------------------------------------
// One worker's figures for one day
// ---------------------------------------------------------------------------

function WorkerEntry({
  date,
  today,
  worker,
  lines,
  saved,
  recordedAt,
  readOnly,
  onClose,
}: {
  date: string;
  today: string;
  worker: Worker;
  lines: Line[];
  saved: Map<string, number>;
  /** clock time this worker's day was last written, if it has been */
  recordedAt?: string;
  readOnly: boolean;
  onClose: () => void;
}) {
  const saveDay = useSaveDay(date);
  const { toast } = useToast();

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries([...saved].map(([k, v]) => [k, v === 0 ? "" : String(v)])),
  );
  const [looms, setLooms] = useState<Record<number, number>>(() => {
    const map: Record<number, number> = {};
    for (const { rate, workType } of lines) map[workType.id] = Math.max(1, rate.looms);
    for (const k of saved.keys()) {
      const [typeId, loom] = k.split(":").map(Number);
      map[typeId] = Math.max(map[typeId] ?? 1, loom);
    }
    return map;
  });
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [order, setOrder] = useState<number[]>(() => lines.map((l) => l.workType.id));
  const reorderRates = useReorderRates();

  /**
   * Pressing Enter on the last box means "that's the lot" — offer to save
   * rather than leaving the cursor stranded at the bottom of the form.
   */
  useEffect(() => {
    const onEnd = () => {
      if (!readOnly) setConfirmSave(true);
    };
    document.addEventListener(ENTRY_GRID_END, onEnd);
    return () => document.removeEventListener(ENTRY_GRID_END, onEnd);
  }, [readOnly]);

  const ordered = useMemo(() => {
    const byId = new Map(lines.map((l) => [l.workType.id, l]));
    const known = order.map((id) => byId.get(id)).filter((l): l is Line => Boolean(l));
    // Anything assigned since the order was captured goes on the end.
    const extra = lines.filter((l) => !order.includes(l.workType.id));
    return [...known, ...extra];
  }, [lines, order]);

  const moveLine = (index: number, delta: number) => {
    const next = [...ordered.map((l) => l.workType.id)];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
    // Persist straight away: the order is a setting, not part of the day's
    // figures, so it should not wait on Save.
    reorderRates.mutate({ workerId: worker.id, workTypeIds: next });
  };

  const initial = useRef(values);
  const dirty = useMemo(
    () =>
      Object.keys({ ...values, ...initial.current }).some(
        (k) => (values[k] ?? "") !== (initial.current[k] ?? ""),
      ),
    [values],
  );

  // Put the cursor in the first box so entry can start straight away.
  const firstCell = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (readOnly) return;
    firstCell.current?.querySelector("input")?.focus();
  }, [readOnly]);

  const lineValue = (kind: WorkKind, typeId: number, unitPrice: number) => {
    if (kind === "formula_sum_ratio") return null;
    let total = 0;
    for (let i = 1; i <= (looms[typeId] ?? 1); i++) {
      const raw = values[cellKey(typeId, i)] ?? "";
      total += kind === "direct_sum" ? parseRupeeInput(raw) : parseCountInput(raw) * unitPrice;
    }
    return Math.round(total);
  };

  const lineCount = (typeId: number) => {
    let total = 0;
    for (let i = 1; i <= (looms[typeId] ?? 1); i++) {
      total += parseCountInput(values[cellKey(typeId, i)] ?? "");
    }
    return total;
  };

  const total = lines.reduce(
    (s, { rate, workType }) =>
      s + (lineValue(workType.kind, workType.id, rate.unitPrice) ?? 0),
    0,
  );

  const save = () => {
    const payload: DayEntryInput[] = [];
    for (const { workType } of lines) {
      for (let loom = 1; loom <= (looms[workType.id] ?? 1); loom++) {
        const raw = values[cellKey(workType.id, loom)] ?? "";
        payload.push({
          workerId: worker.id,
          workTypeId: workType.id,
          loom,
          quantity: workType.kind === "direct_sum" ? 0 : parseCountInput(raw),
          amount: workType.kind === "direct_sum" ? parseRupeeInput(raw) : 0,
        });
      }
    }

    saveDay.mutate(payload, {
      onSuccess: () => {
        toast(`${worker.name} — ${formatINR(total)} saved.`, { tone: "success" });
        onClose();
      },
      onError: (error) =>
        toast(error instanceof Error ? error.message : "Could not save", { tone: "error" }),
    });
  };

  const cancel = () => {
    if (dirty && !readOnly) setConfirmDiscard(true);
    else onClose();
  };

  return (
    <>
      {/* Save/Cancel live in the bar at the foot of the screen, not up here too. */}
      <PageHeader
        title={worker.name}
        meta={`${lines.length} towel types`}
        action={
          lines.length > 1 && !readOnly ? (
            <Button
              icon={<ArrowUpDown size={13} />}
              onClick={() => setReordering((v) => !v)}
              title="Change the order these are entered in"
            >
              {reordering ? "Done" : "Reorder"}
            </Button>
          ) : undefined
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-3 py-3 lg:px-5" ref={firstCell}>
          <div
            className="overflow-hidden rounded-md border"
            style={{ background: "var(--panel)", borderColor: "var(--line)" }}
          >
            {ordered.map(({ rate, workType }, index) => {
              const count = looms[workType.id] ?? 1;
              const value = lineValue(workType.kind, workType.id, rate.unitPrice);
              const towels = lineCount(workType.id);

              if (reordering) {
                return (
                  <div
                    key={workType.id}
                    className="flex items-center gap-2 border-b px-3 py-2 last:border-b-0"
                    style={{ borderColor: "var(--line)" }}
                  >
                    <span
                      className="h-8 w-1.5 shrink-0 rounded-full"
                      style={{ background: workType.color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {workType.name}
                    </span>
                    <span className="tnum text-[11px] ink-4">{index + 1}</span>
                    <IconButton
                      label={`Move ${workType.name} up`}
                      disabled={index === 0}
                      onClick={() => moveLine(index, -1)}
                    >
                      <ChevronUp size={15} />
                    </IconButton>
                    <IconButton
                      label={`Move ${workType.name} down`}
                      disabled={index === ordered.length - 1}
                      onClick={() => moveLine(index, 1)}
                    >
                      <ChevronDown size={15} />
                    </IconButton>
                  </div>
                );
              }

              return (
                <EntryRow
                  key={workType.id}
                  name={workType.name}
                  color={workType.color}
                  disabled={readOnly}
                  hint={
                    workType.kind === "count_x_price"
                      ? `${formatINR(rate.unitPrice)} each`
                      : workType.kind === "direct_sum"
                        ? "amount in ₹"
                        : `${formatCount(rate.divisor)} = ${formatINR(rate.multiplier)}`
                  }
                  /*
                    The running tally for this line: how many towels, and what
                    they come to. Shown as soon as anything is typed, so the
                    figure can be checked against the floor count without
                    waiting for the day total.
                  */
                  value={
                    workType.kind === "formula_sum_ratio"
                      ? towels > 0
                        ? `${formatCount(towels)} towels · weekly`
                        : undefined
                      : workType.kind === "direct_sum"
                        ? undefined
                        : towels > 0
                          ? `${formatCount(towels)} towels`
                          : undefined
                  }
                  subValue={value ? formatINR(value) : undefined}
                  values={Array.from(
                    { length: count },
                    (_, i) => values[cellKey(workType.id, i + 1)] ?? "",
                  )}
                  onChange={(index, next) =>
                    setValues((c) => ({ ...c, [cellKey(workType.id, index + 1)]: next }))
                  }
                  onLoomCountChange={(next) => {
                    setLooms((c) => ({ ...c, [workType.id]: next }));
                    if (next < count) {
                      setValues((c) => {
                        const copy = { ...c };
                        for (let i = next + 1; i <= count; i++) {
                          delete copy[cellKey(workType.id, i)];
                        }
                        return copy;
                      });
                    }
                  }}
                />
              );
            })}
          </div>

          <p className="mt-2 px-1 text-[11px] ink-4">
            {reordering ? (
              <>The order set here is the order you'll enter them in from now on.</>
            ) : (
              <>
                <kbd className="font-mono">Enter</kbd> moves to the next box, and again on the
                last one to finish. Swipe a row left, or press{" "}
                <kbd className="font-mono">+</kbd>, for another loom.
              </>
            )}
          </p>

          {/*
            Which day this is, stated plainly and large. It sits below the
            figures because that is where the eye ends up, and because getting
            the day wrong is the one mistake that is expensive to unpick.
          */}
          <div
            className="mt-4 flex items-center gap-3 rounded-md border px-4 py-3"
            style={{ background: "var(--panel)", borderColor: "var(--line)" }}
          >
            <CalendarDays size={20} style={{ color: "var(--accent)" }} />
            <div className="min-w-0 flex-1">
              <div className="text-lg font-semibold leading-tight">
                {relativeDayLabel(date, today)}
              </div>
              <div className="text-sm ink-2">
                {longDayName(date)}, {formatFullDate(date)}
              </div>
            </div>
            {recordedAt && (
              <div className="shrink-0 text-right">
                <div className="text-[10px] uppercase tracking-wide ink-4">Recorded</div>
                <div className="tnum text-sm font-medium ink-2">{recordedAt}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Worker total + the two actions, always in view */}
      <div
        className="shrink-0 border-t"
        style={{ background: "var(--panel)", borderColor: "var(--line)" }}
      >
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-3 px-3 lg:px-5">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] ink-3">{worker.name}'s day</div>
            <div className="tnum text-lg font-semibold" style={{ color: "var(--pos)" }}>
              {formatINR(total)}
            </div>
          </div>
          <Button size="md" onClick={cancel}>
            Cancel
          </Button>
          <Button
            size="md"
            variant="primary"
            className={cx("min-w-24", dirty && "font-semibold")}
            onClick={save}
            loading={saveDay.isPending}
            disabled={readOnly}
          >
            Save
          </Button>
        </div>
      </div>

      <ConfirmSheet
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        onConfirm={onClose}
        title="Discard these changes?"
        confirmLabel="Discard"
        destructive
        description={`${worker.name}'s figures have been changed but not saved. Going back now will lose them.`}
      />

      <ConfirmSheet
        open={confirmSave}
        onClose={() => setConfirmSave(false)}
        loading={saveDay.isPending}
        confirmOnEnter
        confirmLabel={`Save ${formatINR(total)}`}
        title={`Finished with ${worker.name}?`}
        description={
          <>
            That's the last box. Saving records{" "}
            <strong>{formatINR(total)}</strong> for {worker.name} on{" "}
            {formatFullDate(date)} and takes you back to the list.
          </>
        }
        onConfirm={() => {
          setConfirmSave(false);
          save();
        }}
      />
    </>
  );
}
