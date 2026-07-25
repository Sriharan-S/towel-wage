import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartCard, DataTable, TooltipBox } from "./ChartCard";
import { useChartTheme } from "@/lib/palette";
import { formatCompactINR, formatCount, formatINR } from "@shared/money";
import { formatWeekRange, formatDayMonth } from "@shared/dates";
import type { DashboardStats } from "@/lib/api";

/**
 * Total wages per week. One series, so no legend box — the title says what is
 * plotted. The final point is direct-labelled; the axis carries the rest.
 */
export function WageTrend({ stats }: { stats: DashboardStats }) {
  const theme = useChartTheme();
  const color = theme.series(0);

  const data = stats.weeks.map((week) => ({
    weekStart: week.weekStart,
    label: formatDayMonth(week.weekStart),
    wage: week.wage / 100,
    quantity: week.quantity,
  }));

  const last = data.at(-1);

  return (
    <ChartCard
      title="Weekly wages"
      subtitle={`Last ${data.length} weeks${last ? ` · latest ${formatINR(last.wage * 100)}` : ""}`}
      table={
        <DataTable
          columns={["Week", "Wage", "Pieces"]}
          align={["left", "right", "right"]}
          rows={[...data]
            .reverse()
            .map((d) => [
              formatWeekRange(d.weekStart),
              formatINR(d.wage * 100),
              formatCount(d.quantity),
            ])}
        />
      }
    >
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="wageFill" x1="0" y1="0" x2="0" y2="1">
              {/* An area wash, never a saturated block. */}
              <stop offset="0%" stopColor={color} stopOpacity={0.18} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke={theme.grid}
            strokeWidth={1}
            vertical={false}
          />
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
            cursor={{ stroke: theme.axis, strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as (typeof data)[number];
              return (
                <TooltipBox
                  title={formatWeekRange(point.weekStart)}
                  rows={[
                    { label: "Wages", value: formatINR(point.wage * 100), color },
                    { label: "Pieces", value: formatCount(point.quantity) },
                  ]}
                />
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="wage"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="url(#wageFill)"
            // >= 8px marker, with a 2px ring in the surface colour.
            dot={false}
            activeDot={{ r: 4, fill: color, stroke: theme.surface, strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
