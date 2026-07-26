import { useState } from "react";
import { Link } from "react-router-dom";
import { ChartCard, DataTable } from "./ChartCard";
import { rampStep, useChartTheme } from "@/lib/palette";
import { formatCount, formatINR } from "@shared/money";
import { formatDayLabel, weekStartOf } from "@shared/dates";
import type { ISODate } from "@shared/dates";
import type { DashboardStats } from "@/lib/api";

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * A calendar grid of daily output, one column per week.
 *
 * A day with no entry at all is drawn as an outlined empty cell, not the palest
 * blue — a forgotten day and a slow day must not look alike, since spotting the
 * forgotten one is the whole point.
 */
export function DailyHeatmap({ stats }: { stats: DashboardStats }) {
  const theme = useChartTheme();
  const [hovered, setHovered] = useState<ISODate | null>(null);

  const byDate = new Map(stats.daily.map((d) => [d.date, d]));
  const max = Math.max(...stats.daily.map((d) => d.quantity), 1);

  // Group into columns of weeks.
  const weeks = new Map<ISODate, Array<(typeof stats.daily)[number] | null>>();
  for (const day of stats.daily) {
    const week = weekStartOf(day.date);
    if (!weeks.has(week)) weeks.set(week, Array(7).fill(null));
    const dow = new Date(`${day.date}T12:00:00Z`).getUTCDay();
    weeks.get(week)![dow] = day;
  }

  const columns = [...weeks.entries()];
  const missing = stats.kpis.missingDays;
  const hoveredDay = hovered ? byDate.get(hovered) : null;

  return (
    <ChartCard
      title="Daily activity"
      subtitle={
        missing.length > 0
          ? `${missing.length} day${missing.length === 1 ? "" : "s"} this week not recorded yet`
          : `Last ${columns.length} weeks — darker means more towels`
      }
      table={
        <DataTable
          columns={["Day", "Towels", "Wage"]}
          align={["left", "right", "right"]}
          rows={[...stats.daily]
            .reverse()
            .filter((d) => d.entryCount > 0)
            .slice(0, 60)
            .map((d) => [formatDayLabel(d.date), formatCount(d.quantity), formatINR(d.wage)])}
        />
      }
    >
      <div className="px-3">
        <div className="flex gap-2">
          {/* Day-of-week rail */}
          <div className="flex flex-col justify-around pt-4 text-[10px]" style={{ color: theme.textMuted }}>
            {DAYS.map((d, i) => (
              <span key={i} className="leading-none">
                {i % 2 === 1 ? d : ""}
              </span>
            ))}
          </div>

          <div className="min-w-0 flex-1 overflow-x-auto pb-1">
            <div className="flex gap-[3px]" style={{ minWidth: columns.length * 17 }}>
              {columns.map(([weekStart, days]) => (
                <div key={weekStart} className="flex flex-col gap-[3px]">
                  {/* Label the column only where a new month starts, so the
                      rail reads as "Jun … Jul" rather than a wall of dates. */}
                  <span
                    className="h-3 text-[9px] leading-none"
                    style={{ color: theme.textMuted }}
                  >
                    {weekStart.slice(8, 10) <= "07" ? MONTHS[Number(weekStart.slice(5, 7)) - 1] : ""}
                  </span>
                  {days.map((day, dow) => {
                    if (!day) return <span key={dow} className="h-3.5 w-3.5" />;
                    const fill = rampStep(day.quantity, max, theme.sequential);
                    const isMissing = day.entryCount === 0;
                    return (
                      <Link
                        key={dow}
                        to={`/entry/${day.date}`}
                        // The hit target is bigger than the 14px cell.
                        className="relative flex h-3.5 w-3.5 items-center justify-center"
                        onMouseEnter={() => setHovered(day.date)}
                        onMouseLeave={() => setHovered(null)}
                        onFocus={() => setHovered(day.date)}
                        onBlur={() => setHovered(null)}
                        aria-label={`${DAY_NAMES[dow]} ${day.date}: ${formatCount(day.quantity)} towels`}
                        title={`${formatDayLabel(day.date)} — ${
                          isMissing ? "nothing recorded" : `${formatCount(day.quantity)} towels`
                        }`}
                      >
                        <span
                          className="h-3.5 w-3.5 rounded-[3px]"
                          style={
                            fill
                              ? { background: fill }
                              : {
                                  background: "transparent",
                                  border: `1px ${isMissing ? "dashed" : "solid"} ${theme.axis}`,
                                }
                          }
                        />
                      </Link>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Scale legend — a continuous scale must never be colour-only. */}
        <div className="mt-3 flex items-center justify-between gap-3 text-[10px]" style={{ color: theme.textMuted }}>
          <span className="flex items-center gap-1">
            <span
              className="h-3 w-3 rounded-[3px]"
              style={{ border: `1px dashed ${theme.axis}` }}
            />
            not recorded
          </span>
          <span className="flex items-center gap-1">
            0
            {theme.sequential.map((step) => (
              <span key={step} className="h-3 w-3 rounded-[3px]" style={{ background: step }} />
            ))}
            {formatCount(max)}
          </span>
        </div>

        <div className="mt-2 h-8 text-xs">
          {hoveredDay ? (
            <p>
              <span className="font-medium">{formatDayLabel(hoveredDay.date)}</span>{" "}
              <span className="ink-2">
                {hoveredDay.entryCount === 0
                  ? "— nothing recorded"
                  : `— ${formatCount(hoveredDay.quantity)} towels · ${formatINR(hoveredDay.wage)}`}
              </span>
            </p>
          ) : (
            missing.length > 0 && (
              <p className="ink-2">
                Missing:{" "}
                {missing.map((date, i) => (
                  <span key={date}>
                    {i > 0 && ", "}
                    <Link to={`/entry/${date}`} className="underline underline-offset-2">
                      {formatDayLabel(date)}
                    </Link>
                  </span>
                ))}
              </p>
            )
          )}
        </div>
      </div>
    </ChartCard>
  );
}
