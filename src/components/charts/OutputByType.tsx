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
import { formatCount, formatINR } from "@shared/money";
import { formatDayMonth, formatWeekRange } from "@shared/dates";
import type { DashboardStats } from "@/lib/api";

/**
 * Pieces handled per towel type per week.
 *
 * Counts, not rupees — this answers "what are we actually processing", which
 * the wage charts can't, since a cheap type can dominate volume without
 * dominating cost. Colour comes from each type's own configured swatch,
 * resolved to the right step for light or dark.
 */
export function OutputByType({ stats }: { stats: DashboardStats }) {
  const theme = useChartTheme();

  // direct_sum types record a rupee amount, not a count, so they have no place
  // on a volume chart.
  const types = stats.workTypes.filter((t) => t.kind !== "direct_sum").slice(0, 8);

  const data = stats.weeks.map((week) => {
    const row: Record<string, number | string> = {
      weekStart: week.weekStart,
      label: formatDayMonth(week.weekStart),
    };
    for (const type of types) {
      row[`t${type.id}`] = week.byWorkType[type.id]?.quantity ?? 0;
    }
    return row;
  });

  // A type with nothing recorded in this window is legend noise, not a series.
  const totals = types
    .map((type) => ({
      type,
      color: theme.resolve(type.color),
      total: data.reduce((sum, row) => sum + (row[`t${type.id}`] as number), 0),
    }))
    .filter((t) => t.total > 0);

  const grandTotal = totals.reduce((sum, t) => sum + t.total, 0);

  return (
    <ChartCard
      title="Output by towel type"
      subtitle={`${formatCount(grandTotal)} pieces over ${data.length} weeks`}
      legend={
        <Legend
          items={totals.map((t) => ({
            label: t.type.name,
            color: t.color,
            value: formatCount(t.total),
          }))}
        />
      }
      table={
        <DataTable
          columns={["Week", ...totals.map((t) => t.type.name)]}
          align={["left", ...totals.map(() => "right" as const)]}
          rows={[...data]
            .reverse()
            .map((row) => [
              formatWeekRange(row.weekStart as string),
              ...totals.map((t) => formatCount(row[`t${t.type.id}`] as number)),
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
            width={44}
            tickFormatter={(value: number) =>
              value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value)
            }
          />
          <Tooltip
            cursor={{ fill: theme.grid, fillOpacity: 0.4 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload as Record<string, number | string>;
              const weekStart = row.weekStart as string;
              const week = stats.weeks.find((w) => w.weekStart === weekStart);
              const rows = totals
                .filter((t) => (row[`t${t.type.id}`] as number) > 0)
                .map((t) => ({
                  label: t.type.name,
                  value: formatCount(row[`t${t.type.id}`] as number),
                  color: t.color,
                }));
              return (
                <TooltipBox
                  title={formatWeekRange(weekStart)}
                  rows={rows}
                  footer={week ? `Wages ${formatINR(week.wage)}` : undefined}
                />
              );
            }}
          />
          {totals.map((t, index) => (
            <Bar
              key={t.type.id}
              dataKey={`t${t.type.id}`}
              stackId="output"
              fill={t.color}
              maxBarSize={24}
              stroke={theme.panel}
              strokeWidth={2}
              radius={index === totals.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
