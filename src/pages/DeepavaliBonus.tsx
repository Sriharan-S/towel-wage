import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Lock, LockOpen, Sparkles } from "lucide-react";
import { CalendarPopover } from "@/components/Calendar";
import { PageBody, PageHeader } from "@/components/layout/AppShell";
import {
  Badge,
  Button,
  ConfirmSheet,
  EmptyState,
  ErrorState,
  Money,
  NumberInput,
  Spinner,
  useToast,
} from "@/components/ui";
import { useBonus, useBonusAction, useToday } from "@/lib/queries";
import { addWeeks, formatWeekRange, weekStartOf } from "@shared/dates";
import type { ISODate } from "@shared/dates";
import { formatINR } from "@shared/money";

/**
 * The year's Deepavali bonus: a percentage of what each worker earned across a
 * range of weeks. Earned means the wage itself, not the rounded cash handed over.
 */
export default function DeepavaliBonus() {
  const today = useToday();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const bonus = useBonus(year);
  const action = useBonusAction(year);
  const run = bonus.data;

  const [startWeek, setStartWeek] = useState<ISODate>(addWeeks(weekStartOf(today), -51));
  const [endWeek, setEndWeek] = useState<ISODate>(weekStartOf(today));
  const [percent, setPercent] = useState("8");
  const [confirming, setConfirming] = useState<"finalize" | "reopen" | null>(null);

  useEffect(() => {
    if (!run) return;
    setStartWeek(run.startWeek);
    setEndWeek(run.endWeek);
    setPercent(String(run.percent));
  }, [run?.startWeek, run?.endWeek, run?.percent]);

  const isFinalized = run?.status === "finalized";
  const percentValue = Number(percent);
  const percentValid = percentValue > 0 && percentValue <= 100;
  const excluded = (run?.workers ?? []).filter((w) => !w.included).map((w) => w.workerId);

  const fail = (error: unknown) =>
    toast(error instanceof Error ? error.message : "Could not save", { tone: "error" });

  const calculate = (nextExcluded = excluded) =>
    action.mutate(
      { startWeek, endWeek, percent: percentValue, excluded: nextExcluded },
      { onError: fail },
    );

  return (
    <>
      <PageHeader
        title="Deepavali bonus"
        meta={
          run && (
            <Badge tone={isFinalized ? "positive" : "accent"}>
              {isFinalized ? "Finalized" : "Draft"}
            </Badge>
          )
        }
      >
        <div className="flex items-center gap-2">
          <Button
            icon={<ChevronLeft size={13} />}
            onClick={() => setYear(year - 1)}
            aria-label="Previous year"
          />
          <span className="tnum min-w-12 text-center text-sm font-semibold">{year}</span>
          <Button
            icon={<ChevronRight size={13} />}
            onClick={() => setYear(year + 1)}
            aria-label="Next year"
          />
        </div>
      </PageHeader>

      <PageBody className="mx-auto max-w-3xl space-y-3">
        {bonus.isLoading ? (
          <Spinner label="Working out the bonus" />
        ) : bonus.error ? (
          <ErrorState error={bonus.error} onRetry={bonus.refetch} />
        ) : (
          <>
            <section
              className="rounded-md border p-3"
              style={{ background: "var(--panel)", borderColor: "var(--line)" }}
            >
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_6rem]">
                <WeekField
                  label="From week"
                  value={startWeek}
                  today={today}
                  disabled={isFinalized}
                  onSelect={setStartWeek}
                />
                <WeekField
                  label="To week"
                  value={endWeek}
                  today={today}
                  disabled={isFinalized}
                  onSelect={setEndWeek}
                />
                <label>
                  <span className="mb-1 block text-[11px] font-medium ink-2">Bonus %</span>
                  <NumberInput
                    value={percent}
                    disabled={isFinalized}
                    aria-label="Bonus percentage"
                    onChange={(e) => setPercent(e.target.value)}
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                {isFinalized ? (
                  <Button icon={<LockOpen size={13} />} onClick={() => setConfirming("reopen")}>
                    Reopen
                  </Button>
                ) : (
                  <>
                    {run && run.workers.length > 0 && (
                      <Button icon={<Lock size={13} />} onClick={() => setConfirming("finalize")}>
                        Finalize
                      </Button>
                    )}
                    <Button
                      variant="primary"
                      loading={action.isPending}
                      disabled={!percentValid}
                      onClick={() => calculate()}
                    >
                      Calculate
                    </Button>
                  </>
                )}
              </div>
            </section>

            {!run ? (
              <EmptyState
                icon={<Sparkles size={22} />}
                title={`No bonus worked out for ${year}`}
                description="Choose the weeks and percentage, then calculate."
              />
            ) : run.workers.length === 0 ? (
              <EmptyState
                icon={<Sparkles size={22} />}
                title="Nobody earned anything in these weeks"
                description="Choose a different range of weeks."
              />
            ) : (
              <>
                <section
                  className="overflow-hidden rounded-md border"
                  style={{ background: "var(--panel)", borderColor: "var(--line)" }}
                >
                  {run.workers.map((worker) => (
                    <div
                      key={worker.workerId}
                      className="flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0"
                      style={{
                        borderColor: "var(--line)",
                        opacity: worker.included ? 1 : 0.55,
                      }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {worker.workerName}
                        </span>
                        <span className="tnum block text-[11px] ink-3">
                          earned {formatINR(worker.earned)} · {worker.weeksWorked}{" "}
                          {worker.weeksWorked === 1 ? "week" : "weeks"}
                        </span>
                      </span>
                      {!isFinalized && (
                        <Button
                          size="xs"
                          disabled={action.isPending}
                          onClick={() =>
                            calculate(
                              worker.included
                                ? [...excluded, worker.workerId]
                                : excluded.filter((id) => id !== worker.workerId),
                            )
                          }
                        >
                          {worker.included ? "Leave out" : "Include"}
                        </Button>
                      )}
                      <Money className="w-20 shrink-0 text-right text-base font-semibold" tone="positive">
                        {worker.included ? formatINR(worker.bonus) : "—"}
                      </Money>
                    </div>
                  ))}
                </section>

                <section
                  className="overflow-hidden rounded-md border"
                  style={{ background: "var(--panel)", borderColor: "var(--line)" }}
                >
                  <dl className="px-3 py-2 text-xs">
                    <div className="flex justify-between py-0.5">
                      <dt className="ink-2">Workers</dt>
                      <dd className="tnum font-medium">{run.totals.workers}</dd>
                    </div>
                    <div className="flex justify-between py-0.5">
                      <dt className="ink-2">Total earned</dt>
                      <dd className="tnum font-medium">{formatINR(run.totals.earned)}</dd>
                    </div>
                  </dl>
                  <div
                    className="flex items-baseline justify-between border-t px-3 py-2.5"
                    style={{ background: "var(--panel-2)", borderColor: "var(--line-strong)" }}
                  >
                    <span className="text-xs font-semibold">Total bonus at {run.percent}%</span>
                    <Money className="text-xl font-semibold" tone="positive">
                      {formatINR(run.totals.bonus)}
                    </Money>
                  </div>
                </section>

                <p className="px-1 text-[11px] ink-3">
                  Also shown on the wages page for{" "}
                  <button
                    className="underline"
                    onClick={() => navigate(`/week/${run.endWeek}`)}
                  >
                    {formatWeekRange(run.endWeek)}
                  </button>
                  .
                </p>
              </>
            )}
          </>
        )}
      </PageBody>

      <ConfirmSheet
        open={confirming === "finalize"}
        onClose={() => setConfirming(null)}
        loading={action.isPending}
        confirmLabel="Finalize"
        title="Finalize this bonus?"
        description={
          <>
            Locks the bonus at <strong>{formatINR(run?.totals.bonus ?? 0)}</strong>. Later changes
            to these weeks will not alter it. You can reopen it to correct something.
          </>
        }
        onConfirm={() =>
          action.mutate("finalize", {
            onSuccess: () => {
              setConfirming(null);
              toast("Bonus finalized.", { tone: "success" });
            },
            onError: fail,
          })
        }
      />

      <ConfirmSheet
        open={confirming === "reopen"}
        onClose={() => setConfirming(null)}
        loading={action.isPending}
        confirmLabel="Reopen"
        title="Reopen this bonus?"
        description="The locked figures are discarded and worked out again from the current wages."
        onConfirm={() =>
          action.mutate("reopen", {
            onSuccess: () => {
              setConfirming(null);
              toast("Bonus reopened.");
            },
            onError: fail,
          })
        }
      />
    </>
  );
}

function WeekField({
  label,
  value,
  today,
  disabled,
  onSelect,
}: {
  label: string;
  value: ISODate;
  today: ISODate;
  disabled: boolean;
  onSelect: (weekStart: ISODate) => void;
}) {
  return (
    <div>
      <span className="mb-1 block text-[11px] font-medium ink-2">{label}</span>
      <CalendarPopover
        value={value}
        today={today}
        onSelect={(date) => onSelect(weekStartOf(date))}
      >
        {({ open, isOpen }) => (
          <Button
            onClick={open}
            disabled={disabled}
            aria-expanded={isOpen}
            aria-label={label}
            className="w-full justify-center"
          >
            <span className="truncate">{formatWeekRange(value)}</span>
          </Button>
        )}
      </CalendarPopover>
    </div>
  );
}
