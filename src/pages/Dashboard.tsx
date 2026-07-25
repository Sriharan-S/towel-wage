import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, PencilLine } from "lucide-react";
import { PageBody, PageHeader } from "@/components/layout/AppShell";
import { Badge, Button, Panel, EmptyState, ErrorState, Select, Spinner } from "@/components/ui";
import { StatTile } from "@/components/charts/StatTile";
import { WageTrend } from "@/components/charts/WageTrend";
import { WagesByWorker } from "@/components/charts/WagesByWorker";
import { OutputByType } from "@/components/charts/OutputByType";
import { DayOfWeek } from "@/components/charts/DayOfWeek";
import { DailyHeatmap } from "@/components/charts/DailyHeatmap";
import { Leaderboard } from "@/components/charts/Leaderboard";
import { Balances } from "@/components/charts/Balances";
import { useBootstrap, useStats } from "@/lib/queries";
import { formatCount, formatINR } from "@shared/money";
import { formatDayLabel, formatWeekRange } from "@shared/dates";

const RANGES = [8, 12, 26, 52];

export default function Dashboard() {
  // One filter row scopes every chart on the page — never per-chart filters.
  const [weeks, setWeeks] = useState(12);
  const stats = useStats(weeks);
  const bootstrap = useBootstrap();

  if (stats.isLoading) return <Spinner label="Crunching the numbers" />;
  if (stats.error) return <ErrorState error={stats.error} onRetry={stats.refetch} />;
  if (!stats.data) return null;

  const { kpis, currentWeek, today } = stats.data;
  const hasData = stats.data.weeks.some((w) => w.wage > 0);

  const wageDelta =
    kpis.lastWeekWage > 0 ? (kpis.thisWeekWage - kpis.lastWeekWage) / kpis.lastWeekWage : null;
  const quantityDelta =
    kpis.lastWeekQuantity > 0
      ? (kpis.thisWeekQuantity - kpis.lastWeekQuantity) / kpis.lastWeekQuantity
      : null;

  return (
    <>
      <PageHeader
        title={bootstrap.data?.settings.businessName ?? "Dashboard"}
        meta={formatWeekRange(currentWeek)}
        action={
          <Button size="sm" variant="primary" icon={<PencilLine size={15} />}>
            <Link to="/entry">Enter today</Link>
          </Button>
        }
      />

      <PageBody className="space-y-4">
        {!hasData ? (
          <Panel>
            <EmptyState
              title="No wages recorded yet"
              description="Record a day of towel counts and this dashboard fills in — weekly trends, per-worker splits, busiest days and outstanding balances."
              action={
                <Button variant="primary">
                  <Link to="/entry">Record today's counts</Link>
                </Button>
              }
            />
          </Panel>
        ) : (
          <>
            {/* Missing days are the thing most worth surfacing: a forgotten day
                silently understates someone's pay on Saturday. */}
            {kpis.missingDays.length > 0 && (
              <div
                className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm"
                style={{ background: "var(--warn-soft)", color: "var(--warn)" }}
              >
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <p>
                  Not recorded yet this week:{" "}
                  {kpis.missingDays.map((date, i) => (
                    <span key={date}>
                      {i > 0 && ", "}
                      <Link
                        to={`/entry/${date}`}
                        className="font-medium underline underline-offset-2"
                      >
                        {formatDayLabel(date)}
                      </Link>
                    </span>
                  ))}
                </p>
              </div>
            )}

            {/* Hero figure — exactly one per view. */}
            <Panel className="p-5">
              <p className="text-sm ink-2">Wages this week</p>
              <p className="mt-1 text-5xl font-semibold leading-none">
                {formatINR(kpis.thisWeekWage, { decimals: false })}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {wageDelta !== null && (
                  <Badge tone={wageDelta >= 0 ? "positive" : "negative"}>
                    {wageDelta >= 0 ? "▲" : "▼"} {Math.abs(wageDelta * 100).toFixed(0)}% vs last
                    week
                  </Badge>
                )}
                <Badge tone="accent">{formatCount(kpis.thisWeekQuantity)} pieces</Badge>
                <Badge>{kpis.activeWorkers} workers</Badge>
                <Link
                  to={`/week/${currentWeek}`}
                  className="text-sm font-medium underline underline-offset-2"
                  style={{ color: "var(--accent)" }}
                >
                  Open wages
                </Link>
              </div>
            </Panel>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile
                label="Last week"
                value={formatINR(kpis.lastWeekWage, { decimals: false })}
                hint="Full Sun–Sat week"
              />
              <StatTile
                label="Pieces this week"
                value={formatCount(kpis.thisWeekQuantity)}
                delta={quantityDelta}
                deltaLabel="vs last week"
              />
              <StatTile
                label="Workers owe you"
                value={formatINR(kpis.totalCreditOutstanding, { decimals: false })}
                hint="Unrecovered credits"
                tone={kpis.totalCreditOutstanding > 0 ? "neutral" : "neutral"}
              />
              <StatTile
                label="You owe workers"
                value={formatINR(kpis.totalDebitOutstanding, { decimals: false })}
                hint="Unpaid debits"
                tone={kpis.totalDebitOutstanding > 0 ? "negative" : "neutral"}
              />
            </div>

            {/* The one filter row, above everything it scopes. */}
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">Trends</h2>
              <label className="flex items-center gap-2 text-xs ink-2">
                Range
                <Select
                  className="h-9 w-28 text-sm"
                  value={String(weeks)}
                  onChange={(e) => setWeeks(Number(e.target.value))}
                >
                  {RANGES.map((r) => (
                    <option key={r} value={r}>
                      {r} weeks
                    </option>
                  ))}
                </Select>
              </label>
            </div>

            <div
              className="grid gap-3 lg:grid-cols-2"
              // Hold the previous render while refetching rather than flashing a
              // skeleton and jumping the layout.
              style={{ opacity: stats.isFetching ? 0.6 : 1, transition: "opacity 150ms" }}
            >
              <WageTrend stats={stats.data} />
              <Leaderboard stats={stats.data} />
              <WagesByWorker stats={stats.data} />
              <OutputByType stats={stats.data} />
              <DailyHeatmap stats={stats.data} />
              <DayOfWeek stats={stats.data} />
              <Balances stats={stats.data} />
            </div>

            <p className="pt-1 text-center text-xs ink-2">
              Week of {formatWeekRange(currentWeek)} · today is {formatDayLabel(today)}
            </p>
          </>
        )}
      </PageBody>
    </>
  );
}
