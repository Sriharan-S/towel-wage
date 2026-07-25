import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartCard, DataTable, Legend, TooltipBox } from "./ChartCard";
import { useChartTheme } from "@/lib/palette";
import { formatCompactINR, formatINR } from "@shared/money";
import { formatDayMonth, formatWeekRange } from "@shared/dates";
import type { DashboardStats } from "@/lib/api";

const MAX_SERIES = 8;

/**
 * Wage per worker per week, stacked.
 *
 * Colour follows the worker, fixed by their position in the worker list — not
 * by how much they earned — so a quiet week never repaints anyone. Past eight
 * workers the tail folds into a single "Other" series rather than generating a
 * ninth hue.
 */
export function WagesByWorker({ stats }: { stats: DashboardStats }) {
  const theme = useChartTheme();

  const named = stats.workers.slice(0, MAX_SERIES);
  const overflow = stats.workers.slice(MAX_SERIES);

  const series = [
    ...named.map((worker, index) => ({
      key: `w${worker.id}`,
      label: worker.name,
      color: theme.series(index),
      workerIds: [worker.id],
    })),
    ...(overflow.length
      ? [
          {
            key: "other",
            label: `Other (${overflow.length})`,
            color: theme.textMuted,
            workerIds: overflow.map((w) => w.id),
          },
        ]
      : []),
  ];

  const data = stats.weeks.map((week) => {
    const row: Record<string, number | string> = {
      weekStart: week.weekStart,
      label: formatDayMonth(week.weekStart),
    };
    for (const s of series) {
      row[s.key] = s.workerIds.reduce((sum, id) => sum + (week.byWorker[id] ?? 0), 0) / 100;
    }
    return row;
  });

  const totals = series.map((s) => ({
    ...s,
    total: data.reduce((sum, row) => sum + (row[s.key] as number), 0),
  }));

  return (
    <ChartCard
      title="Wages by worker"
      subtitle={`Last ${data.length} weeks, stacked`}
      legend={
        <Legend
          items={totals.map((s) => ({
            label: s.label,
            color: s.color,
            value: formatINR(s.total * 100),
          }))}
        />
      }
      table={
        <DataTable
          columns={["Week", ...series.map((s) => s.label)]}
          align={["left", ...series.map(() => "right" as const)]}
          rows={[...data]
            .reverse()
            .map((row) => [
              formatWeekRange(row.weekStart as string),
              ...series.map((s) => formatINR((row[s.key] as number) * 100)),
            ])}
        />
      }
    >
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={theme.grid} strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: theme.textMuted }}
            tickLine={false}
            axisLine={{ stroke: theme.axis }}
            minTickGap={16}
          />
          <YAxis
            tick={{ fontSize: 11, fill: theme.textMuted }}
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={(value: number) => formatCompactINR(value * 100)}
          />
          <Tooltip
            cursor={{ fill: theme.grid, fillOpacity: 0.4 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload as Record<string, number | string>;
              const rows = series
                .filter((s) => (row[s.key] as number) > 0)
                .map((s) => ({
                  label: s.label,
                  value: formatINR((row[s.key] as number) * 100),
                  color: s.color,
                }));
              const total = series.reduce((sum, s) => sum + (row[s.key] as number), 0);
              return (
                <TooltipBox
                  title={formatWeekRange(row.weekStart as string)}
                  rows={rows}
                  footer={`Total ${formatINR(total * 100)}`}
                />
              );
            }}
          />
          {series.map((s, index) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              stackId="wage"
              fill={s.color}
              maxBarSize={24}
              // A 2px panel gap separates stacked segments — never a stroke.
              stroke={theme.panel}
              strokeWidth={2}
              // 4px rounded cap on the topmost segment only; square at the baseline.
              radius={index === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
