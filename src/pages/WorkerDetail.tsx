import { useNavigate, useParams } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowLeft, Settings2 } from "lucide-react";
import { PageBody, PageHeader } from "@/components/layout/AppShell";
import { Badge, Button, Card, EmptyState, ErrorState, Spinner } from "@/components/ui";
import { ChartCard, DataTable, Legend, TooltipBox } from "@/components/charts/ChartCard";
import { StatTile } from "@/components/charts/StatTile";
import { useChartTheme } from "@/lib/palette";
import { useBootstrap, useWorkerStats } from "@/lib/queries";
import { formatCompactINR, formatCount, formatINR } from "@shared/money";
import { formatDayMonth, formatWeekRange } from "@shared/dates";

export default function WorkerDetail() {
  const { workerId } = useParams<{ workerId: string }>();
  const navigate = useNavigate();
  const id = Number(workerId);
  const theme = useChartTheme();

  const bootstrap = useBootstrap();
  const stats = useWorkerStats(id, 12);

  const worker = bootstrap.data?.workers.find((w) => w.id === id);
  const rates = (bootstrap.data?.rates ?? []).filter((r) => r.workerId === id);
  const typeById = new Map((bootstrap.data?.workTypes ?? []).map((t) => [t.id, t]));

  if (stats.isLoading || bootstrap.isLoading) return <Spinner label="Loading worker" />;
  if (stats.error) return <ErrorState error={stats.error} onRetry={stats.refetch} />;
  if (!worker) {
    return (
      <PageBody>
        <Card>
          <EmptyState
            title="Worker not found"
            description="They may have been removed."
            action={<Button onClick={() => navigate("/workers")}>Back to workers</Button>}
          />
        </Card>
      </PageBody>
    );
  }

  const weeks = stats.data?.weeks ?? [];
  const withWork = weeks.filter((w) => w.wage > 0);
  const totalWage = weeks.reduce((sum, w) => sum + w.wage, 0);
  const totalQuantity = weeks.reduce((sum, w) => sum + w.quantity, 0);
  const avgWage = withWork.length ? Math.round(totalWage / withWork.length) : 0;
  const blendedRate = totalQuantity > 0 ? Math.round(totalWage / totalQuantity) : 0;

  const trend = weeks.map((w) => ({
    weekStart: w.weekStart,
    label: formatDayMonth(w.weekStart),
    wage: w.wage / 100,
    quantity: w.quantity,
    effectiveRate: w.effectiveRate / 100,
  }));

  // Mix across the whole window, biggest earner first.
  const mix = new Map<number, { name: string; color: string; wage: number; quantity: number }>();
  for (const week of weeks) {
    for (const item of week.byWorkType) {
      const current = mix.get(item.workTypeId) ?? {
        name: item.name,
        color: theme.resolve(item.color),
        wage: 0,
        quantity: 0,
      };
      current.wage += item.wage;
      current.quantity += item.quantity;
      mix.set(item.workTypeId, current);
    }
  }
  const mixRows = [...mix.values()].sort((a, b) => b.wage - a.wage);
  const mixMax = Math.max(...mixRows.map((m) => m.wage), 1);

  return (
    <>
      <PageHeader
        title={worker.name}
        subtitle={`${rates.length} towel ${rates.length === 1 ? "type" : "types"} assigned`}
        action={
          <>
            <Button size="sm" icon={<ArrowLeft size={15} />} onClick={() => navigate("/workers")}>
              <span className="hidden sm:inline">Workers</span>
            </Button>
            <Button
              size="sm"
              icon={<Settings2 size={15} />}
              onClick={() => navigate("/workers")}
            >
              <span className="hidden sm:inline">Edit</span>
            </Button>
          </>
        }
      />

      <PageBody className="space-y-4">
        {!worker.isActive && (
          <div
            className="rounded-xl px-3 py-2.5 text-sm"
            style={{ background: "var(--surface-3)", color: "var(--text-muted)" }}
          >
            This worker is inactive. Their history is kept, but they no longer appear on the
            daily entry screen.
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Paid over 12 weeks"
            value={formatINR(totalWage, { decimals: false })}
          />
          <StatTile label="Average week" value={formatINR(avgWage, { decimals: false })} />
          <StatTile label="Pieces handled" value={formatCount(totalQuantity)} />
          <StatTile
            label="Blended rate"
            value={blendedRate ? formatINR(blendedRate) : "—"}
            hint="Per piece, all types"
          />
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <ChartCard
            title="Weekly wages"
            subtitle={`${worker.name} · last ${trend.length} weeks`}
            table={
              <DataTable
                columns={["Week", "Wage", "Pieces"]}
                align={["left", "right", "right"]}
                rows={[...trend]
                  .reverse()
                  .map((t) => [
                    formatWeekRange(t.weekStart),
                    formatINR(t.wage * 100),
                    formatCount(t.quantity),
                  ])}
              />
            }
          >
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={trend} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="workerWage" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={theme.series(0)} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={theme.series(0)} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
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
                  tickFormatter={(v: number) => formatCompactINR(v * 100)}
                />
                <Tooltip
                  cursor={{ stroke: theme.axis, strokeWidth: 1 }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const point = payload[0].payload as (typeof trend)[number];
                    return (
                      <TooltipBox
                        title={formatWeekRange(point.weekStart)}
                        rows={[
                          {
                            label: "Wage",
                            value: formatINR(point.wage * 100),
                            color: theme.series(0),
                          },
                          { label: "Pieces", value: formatCount(point.quantity) },
                          {
                            label: "Per piece",
                            value: point.effectiveRate
                              ? formatINR(point.effectiveRate * 100)
                              : "—",
                          },
                        ]}
                      />
                    );
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="wage"
                  stroke={theme.series(0)}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  fill="url(#workerWage)"
                  dot={false}
                  activeDot={{
                    r: 4,
                    fill: theme.series(0),
                    stroke: theme.surface,
                    strokeWidth: 2,
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="What they work on"
            subtitle="Share of wages by towel type"
            legend={
              mixRows.length > 1 ? (
                <Legend
                  items={mixRows.map((m) => ({ label: m.name, color: m.color }))}
                />
              ) : undefined
            }
            table={
              <DataTable
                columns={["Type", "Wage", "Pieces"]}
                align={["left", "right", "right"]}
                rows={mixRows.map((m) => [
                  m.name,
                  formatINR(m.wage),
                  m.quantity ? formatCount(m.quantity) : "—",
                ])}
              />
            }
          >
            <div className="space-y-2.5 px-3 pt-1">
              {mixRows.length === 0 && (
                <p className="py-6 text-center text-sm text-muted">
                  No work recorded in this period.
                </p>
              )}
              {mixRows.map((row) => (
                <div key={row.name}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{row.name}</span>
                    <span className="tnum shrink-0 text-xs font-semibold">
                      {formatINR(row.wage)}
                    </span>
                  </div>
                  <div
                    className="mt-1 h-2 w-full overflow-hidden rounded-full"
                    style={{ background: theme.grid }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(2, (row.wage / mixMax) * 100)}%`,
                        background: row.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </ChartCard>
        </div>

        <Card>
          <div className="px-4 pt-4">
            <h2 className="text-sm font-semibold">Assigned towel types</h2>
          </div>
          <div className="divide-y px-4 py-2">
            {rates.length === 0 && (
              <p className="py-4 text-sm text-muted">
                No towel types assigned yet — assign some from the Workers screen.
              </p>
            )}
            {rates.map((rate) => {
              const type = typeById.get(rate.workTypeId);
              if (!type) return null;
              return (
                <div key={rate.id} className="flex items-center gap-3 py-2.5">
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ background: type.color }}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{type.name}</span>
                  {!rate.isActive && <Badge>Paused</Badge>}
                  <span className="tnum shrink-0 text-sm">
                    {type.kind === "count_x_price" && `${formatINR(rate.unitPrice)} each`}
                    {type.kind === "direct_sum" && "Daily amount"}
                    {type.kind === "formula_sum_ratio" &&
                      `÷${formatCount(rate.divisor)} × ${formatINR(rate.multiplier)}`}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      </PageBody>
    </>
  );
}
