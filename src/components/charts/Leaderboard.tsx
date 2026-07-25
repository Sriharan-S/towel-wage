import { Link } from "react-router-dom";
import { ChartCard, DataTable } from "./ChartCard";
import { useChartTheme } from "@/lib/palette";
import { formatINR } from "@shared/money";
import type { DashboardStats } from "@/lib/api";

/**
 * This week's wages per worker, as a horizontal bar list.
 *
 * Built with plain divs rather than a chart library: at four to eight rows the
 * value belongs at the tip of every bar, which is exactly the case where a
 * chart component's label machinery gets in the way.
 */
export function Leaderboard({ stats }: { stats: DashboardStats }) {
  const theme = useChartTheme();

  const thisWeek = stats.weeks.at(-1);
  const workerIndex = new Map(stats.workers.map((w, i) => [w.id, i]));

  const rows = stats.workers
    .map((worker) => ({
      worker,
      wage: thisWeek?.byWorker[worker.id] ?? 0,
      // Colour follows the worker's fixed position, never their rank this week.
      color: theme.series(workerIndex.get(worker.id) ?? 0),
    }))
    .filter((row) => row.wage > 0)
    .sort((a, b) => b.wage - a.wage);

  const max = Math.max(...rows.map((r) => r.wage), 1);

  return (
    <ChartCard
      title="This week so far"
      subtitle={
        rows.length === 0 ? "Nothing recorded yet this week" : `${rows.length} workers`
      }
      table={
        <DataTable
          columns={["Worker", "Wage"]}
          align={["left", "right"]}
          rows={rows.map((r) => [r.worker.name, formatINR(r.wage)])}
        />
      }
    >
      <div className="space-y-2.5 px-3 pt-1">
        {rows.length === 0 && (
          <p className="py-6 text-center text-sm text-muted">
            Record today's counts and this fills in.
          </p>
        )}
        {rows.map((row) => (
          <Link
            key={row.worker.id}
            to={`/workers/${row.worker.id}`}
            className="block rounded-lg px-1 py-0.5 transition hover:bg-black/5 dark:hover:bg-white/5"
          >
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate font-medium">{row.worker.name}</span>
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
                  width: `${Math.max(2, (row.wage / max) * 100)}%`,
                  background: row.color,
                }}
              />
            </div>
          </Link>
        ))}
      </div>
    </ChartCard>
  );
}
