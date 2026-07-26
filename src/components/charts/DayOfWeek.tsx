import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartCard, DataTable, TooltipBox } from "./ChartCard";
import { useChartTheme } from "@/lib/palette";
import { formatCount, formatINR } from "@shared/money";
import type { DashboardStats } from "@/lib/api";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Average towels per day of the week.
 *
 * One series, so every bar is slot 1 — colouring bars by their own height would
 * double-encode the value and burn the only free channel.
 */
export function DayOfWeek({ stats }: { stats: DashboardStats }) {
  const theme = useChartTheme();
  const color = theme.series(0);

  const data = stats.dayOfWeek.map((d) => ({
    ...d,
    label: DAYS[d.dayOfWeek],
  }));

  const busiest = [...data].sort((a, b) => b.avgQuantity - a.avgQuantity)[0];

  return (
    <ChartCard
      title="Busiest days"
      subtitle={
        busiest?.avgQuantity
          ? `${DAYS[busiest.dayOfWeek]} averages ${formatCount(Math.round(busiest.avgQuantity))} towels`
          : "Average towels per weekday"
      }
      table={
        <DataTable
          columns={["Day", "Avg towels", "Avg wage", "Days"]}
          align={["left", "right", "right", "right"]}
          rows={data.map((d) => [
            DAYS[d.dayOfWeek],
            formatCount(Math.round(d.avgQuantity)),
            formatINR(Math.round(d.avgWage)),
            String(d.daysRecorded),
          ])}
        />
      }
    >
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={theme.grid} strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: theme.textMuted }}
            tickLine={false}
            axisLine={{ stroke: theme.axis }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: theme.textMuted }}
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(value: number) =>
              value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value))
            }
          />
          <Tooltip
            cursor={{ fill: theme.grid, fillOpacity: 0.4 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as (typeof data)[number];
              return (
                <TooltipBox
                  title={DAYS[point.dayOfWeek]}
                  rows={[
                    {
                      label: "Avg towels",
                      value: formatCount(Math.round(point.avgQuantity)),
                      color,
                    },
                    { label: "Avg wage", value: formatINR(Math.round(point.avgWage)) },
                  ]}
                  footer={`${point.daysRecorded} days recorded`}
                />
              );
            }}
          />
          <Bar dataKey="avgQuantity" fill={color} maxBarSize={24} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
