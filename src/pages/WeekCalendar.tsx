import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronLeft, ChevronRight, Lock, RotateCcw, TriangleAlert, X } from "lucide-react";
import { PageBody, PageHeader } from "@/components/layout/AppShell";
import {
  Button,
  ConfirmSheet,
  ErrorState,
  Field,
  Input,
  Sheet,
  Spinner,
  useToast,
} from "@/components/ui";
import { useBulkWeekAction, useToday, useWeekCalendar } from "@/lib/queries";
import { useRole } from "@/lib/role";
import type { CalendarWeek } from "@/lib/api";
import { addDays, addWeeks, formatWeekRange, weekStartOf } from "@shared/dates";
import type { ISODate } from "@shared/dates";
import { formatINR } from "@shared/money";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const RESET_WORD = "RESET";

/** Every Sunday-to-Saturday week whose Saturday falls in the year, by month. */
function weeksByMonth(year: number): ISODate[][] {
  const months: ISODate[][] = MONTHS.map(() => []);
  let weekStart = addWeeks(weekStartOf(`${year}-01-01`), -1);
  while (true) {
    const saturday = addDays(weekStart, 6);
    const saturdayYear = Number(saturday.slice(0, 4));
    if (saturdayYear > year) break;
    if (saturdayYear === year) months[Number(saturday.slice(5, 7)) - 1].push(weekStart);
    weekStart = addWeeks(weekStart, 1);
  }
  return months;
}

/**
 * The year at a glance, a tile per pay week: green once finalized, blue once
 * someone is marked paid, blank otherwise. A blank week with wages entered can
 * still be selected, so it can be finalized or reset.
 */
export default function WeekCalendar() {
  const navigate = useNavigate();
  const today = useToday();
  const { isAdmin } = useRole();
  const { toast } = useToast();

  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const calendar = useWeekCalendar(year);
  const bulk = useBulkWeekAction();

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<ISODate>>(new Set());
  const [confirming, setConfirming] = useState<"finalize" | "reset" | null>(null);
  const [resetWord, setResetWord] = useState("");

  const months = useMemo(() => weeksByMonth(year), [year]);
  const byWeek = useMemo(
    () => new Map((calendar.data ?? []).map((w) => [w.weekStart, w] as const)),
    [calendar.data],
  );
  const currentWeek = weekStartOf(today);

  const toFinalize = [...selected].filter((w) => {
    const status = byWeek.get(w)?.status;
    return status === "paid" || status === "entered";
  });
  const finalizedSelected = [...selected].filter((w) => byWeek.get(w)?.status === "finalized");
  const finalizedCount = (calendar.data ?? []).filter((w) => w.status === "finalized").length;
  const paidCount = (calendar.data ?? []).filter((w) => w.status === "paid").length;

  // A selection never outlives the year on screen: a reset must only touch weeks you can see.
  const changeYear = (next: number) => {
    setYear(next);
    setSelected(new Set());
  };

  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const toggle = (weekStart: ISODate) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(weekStart)) next.delete(weekStart);
      else next.add(weekStart);
      return next;
    });

  const run = (action: "finalize" | "reset", weeks: ISODate[]) =>
    bulk.mutate(
      { action, weeks },
      {
        onSuccess: ({ done, failed }) => {
          setConfirming(null);
          setResetWord("");
          const verb = action === "finalize" ? "finalized" : "reset";
          if (failed.length) {
            setSelected(new Set(failed));
            toast(
              `${done} ${verb}. Could not do: ${failed.map(formatWeekRange).join(", ")}.`,
              { tone: "error" },
            );
          } else {
            stopSelecting();
            toast(`${done} ${done === 1 ? "week" : "weeks"} ${verb}.`, { tone: "success" });
          }
        },
        onError: (error) =>
          toast(error instanceof Error ? error.message : "Something went wrong", { tone: "error" }),
      },
    );

  return (
    <>
      <PageHeader
        title="Week calendar"
        meta={`${finalizedCount} finalized · ${paidCount} paid, not finalized`}
        action={
          selecting ? (
            <Button icon={<X size={13} />} onClick={stopSelecting}>
              Cancel
            </Button>
          ) : (
            <Button icon={<Check size={13} />} onClick={() => setSelecting(true)}>
              Select
            </Button>
          )
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <Button
              icon={<ChevronLeft size={13} />}
              onClick={() => changeYear(year - 1)}
              aria-label="Previous year"
            />
            <span className="tnum min-w-12 text-center text-sm font-semibold">{year}</span>
            <Button
              icon={<ChevronRight size={13} />}
              onClick={() => changeYear(year + 1)}
              aria-label="Next year"
            />
          </div>
          <div className="flex items-center gap-3 text-[11px] ink-2">
            <LegendSwatch status="finalized" label="Finalized" />
            <LegendSwatch status="paid" label="Paid, not finalized" />
            <LegendSwatch label="Not paid" />
          </div>
        </div>
      </PageHeader>

      <PageBody className="mx-auto max-w-5xl">
        {calendar.isLoading ? (
          <Spinner label="Filling in the calendar" />
        ) : calendar.error ? (
          <ErrorState error={calendar.error} onRetry={calendar.refetch} />
        ) : (
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
            {months.map((weeks, index) => (
              <section key={MONTHS[index]}>
                <h2 className="eyebrow mb-1.5">{MONTHS[index]}</h2>
                <div className="grid grid-cols-5 gap-1.5">
                  {weeks.map((weekStart) => (
                    <WeekTile
                      key={weekStart}
                      weekStart={weekStart}
                      week={byWeek.get(weekStart)}
                      isCurrent={weekStart === currentWeek}
                      selecting={selecting}
                      selected={selected.has(weekStart)}
                      onClick={() =>
                        selecting ? toggle(weekStart) : navigate(`/week/${weekStart}`)
                      }
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </PageBody>

      {selecting && (
        <div
          className="no-print shrink-0 border-t"
          style={{ background: "var(--panel)", borderColor: "var(--line)" }}
        >
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-3 py-2.5 lg:px-5">
            <span className="min-w-0 flex-1 text-xs ink-2">
              {selected.size === 0
                ? "Tap the weeks you want. They can be in different months."
                : `${selected.size} ${selected.size === 1 ? "week" : "weeks"} selected`}
            </span>
            {isAdmin && (
              <Button
                variant="danger"
                icon={<RotateCcw size={13} />}
                disabled={selected.size === 0}
                onClick={() => setConfirming("reset")}
              >
                Reset
              </Button>
            )}
            <Button
              variant="primary"
              icon={<Lock size={13} />}
              disabled={toFinalize.length === 0}
              onClick={() => setConfirming("finalize")}
            >
              Finalize{toFinalize.length > 0 && ` ${toFinalize.length}`}
            </Button>
          </div>
        </div>
      )}

      <ConfirmSheet
        open={confirming === "finalize"}
        onClose={() => setConfirming(null)}
        loading={bulk.isPending}
        confirmLabel={`Finalize ${toFinalize.length}`}
        title={`Finalize ${toFinalize.length} ${toFinalize.length === 1 ? "week" : "weeks"}?`}
        description={
          <>
            Locks the daily entries and freezes the payout for{" "}
            <strong>{toFinalize.map(formatWeekRange).join(", ")}</strong>. You can reopen a week
            from its wages page.
            {toFinalize.length < selected.size &&
              " Selected weeks that are already finalized are skipped."}
          </>
        }
        onConfirm={() => run("finalize", toFinalize)}
      />

      <Sheet
        open={confirming === "reset"}
        onClose={() => {
          setConfirming(null);
          setResetWord("");
        }}
        title={`Reset ${selected.size} ${selected.size === 1 ? "week" : "weeks"}?`}
        footer={
          <Button
            className="flex-1"
            variant="danger"
            icon={<RotateCcw size={14} />}
            loading={bulk.isPending}
            disabled={resetWord !== RESET_WORD}
            onClick={() => run("reset", [...selected])}
          >
            Permanently reset
          </Button>
        }
      >
        <div className="space-y-3 text-sm">
          <div
            className="flex gap-2 rounded border px-3 py-2.5"
            style={{ background: "var(--neg-soft)", color: "var(--neg)", borderColor: "var(--neg)" }}
          >
            <TriangleAlert size={16} className="mt-0.5 shrink-0" />
            <span className="font-medium">This cannot be undone from the app.</span>
          </div>
          <p className="font-medium">{[...selected].map(formatWeekRange).join(", ")}</p>
          <ul className="list-disc space-y-1 pl-5 ink-2">
            <li>Every daily entry and old record in these weeks is deleted.</li>
            <li>Their credits, debits, advance recoveries and paid marks are deleted.</li>
            <li>Balances carried into later weeks will change.</li>
            {finalizedSelected.length > 0 && (
              <li>
                <strong>
                  {finalizedSelected.length} of these{" "}
                  {finalizedSelected.length === 1 ? "is" : "are"} finalized
                </strong>{" "}
                and their frozen payouts are lost too.
              </li>
            )}
            <li>Advances given or returned stay as they are.</li>
          </ul>
          <p className="ink-2">Download a backup from Settings first if you may want this back.</p>
          <Field label={`Type ${RESET_WORD} to confirm`}>
            <Input
              value={resetWord}
              autoComplete="off"
              aria-label="Type RESET to confirm"
              onChange={(e) => setResetWord(e.target.value)}
            />
          </Field>
        </div>
      </Sheet>
    </>
  );
}

const STATUS_STYLE = {
  finalized: { background: "var(--pos-soft)", borderColor: "var(--pos)", color: "var(--pos)" },
  paid: {
    background: "var(--accent-soft)",
    borderColor: "var(--accent)",
    color: "var(--accent)",
  },
};

function WeekTile({
  weekStart,
  week,
  isCurrent,
  selecting,
  selected,
  onClick,
}: {
  weekStart: ISODate;
  week: CalendarWeek | undefined;
  isCurrent: boolean;
  selecting: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const saturday = addDays(weekStart, 6);
  const state = week
    ? week.status === "finalized"
      ? "Finalized"
      : week.status === "paid"
        ? "Paid, not finalized"
        : "Wages entered, not paid"
    : "Nothing recorded";

  return (
    <button
      onClick={onClick}
      disabled={selecting && !week}
      aria-pressed={selecting ? selected : undefined}
      aria-label={`${formatWeekRange(weekStart)}, ${state}${week ? `, ${formatINR(week.wage)}` : ""}`}
      title={`${formatWeekRange(weekStart)} · ${state}${week ? ` · ${formatINR(week.wage)} · ${week.workers} workers` : ""}`}
      className="relative flex aspect-square min-w-0 flex-col items-center justify-center rounded-md border transition-transform enabled:hover:-translate-y-px disabled:opacity-40"
      style={{
        ...(week && week.status !== "entered"
          ? STATUS_STYLE[week.status]
          : { background: "var(--panel)", borderColor: "var(--line)", color: "var(--ink-3)" }),
        ...(isCurrent ? { boxShadow: "0 0 0 1px var(--ink-2)" } : {}),
        ...(selected ? { outline: "2px solid var(--ink)", outlineOffset: 1 } : {}),
      }}
    >
      <span className="tnum text-base font-semibold leading-none">{Number(saturday.slice(8))}</span>
      <span className="mt-1 text-[9px] uppercase leading-none tracking-wide opacity-75">Sat</span>
      {selected && (
        <span
          className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full"
          style={{ background: "var(--ink)", color: "var(--panel)" }}
        >
          <Check size={10} />
        </span>
      )}
    </button>
  );
}

function LegendSwatch({ status, label }: { status?: keyof typeof STATUS_STYLE; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="h-3 w-3 rounded-sm border"
        style={
          status
            ? STATUS_STYLE[status]
            : { background: "var(--panel)", borderColor: "var(--line-strong)" }
        }
      />
      {label}
    </span>
  );
}
