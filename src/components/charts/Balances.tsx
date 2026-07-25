import { Link } from "react-router-dom";
import { ChartCard, DataTable, Legend } from "./ChartCard";
import { useChartTheme } from "@/lib/palette";
import { formatINR } from "@shared/money";
import type { DashboardStats } from "@/lib/api";

/**
 * Outstanding carry-forward per worker, as a diverging bar around a zero line.
 *
 * Two poles that read as opposite (cool = they owe you, warm = you owe them)
 * with a neutral centre, so "square" reads as nothing rather than as a colour.
 */
export function Balances({ stats }: { stats: DashboardStats }) {
  const theme = useChartTheme();
  const rows = stats.balances;

  if (rows.length === 0) {
    return (
      <ChartCard
        title="Outstanding balances"
        subtitle="Everyone is square"
        table={<DataTable columns={["Worker", "Balance"]} rows={[]} />}
      >
        <p className="px-4 py-8 text-center text-sm ink-2">
          No credits or debits are carrying forward. Nothing to chase, nothing owed.
        </p>
      </ChartCard>
    );
  }

  const max = Math.max(...rows.map((r) => Math.abs(r.net)), 1);

  return (
    <ChartCard
      title="Outstanding balances"
      subtitle="Carried forward from earlier weeks"
      legend={
        <Legend
          items={[
            { label: "Worker owes you", color: theme.diverging.positive },
            { label: "You owe worker", color: theme.diverging.negative },
          ]}
        />
      }
      table={
        <DataTable
          columns={["Worker", "Owes you", "You owe"]}
          align={["left", "right", "right"]}
          rows={rows.map((r) => [
            r.workerName,
            r.creditOutstanding > 0 ? formatINR(r.creditOutstanding) : "—",
            r.debitOutstanding > 0 ? formatINR(r.debitOutstanding) : "—",
          ])}
        />
      }
    >
      <div className="space-y-3 px-3 pt-2">
        {rows.map((row) => {
          const owesYou = row.net > 0;
          const width = (Math.abs(row.net) / max) * 50;
          return (
            <Link
              key={row.workerId}
              to={`/workers/${row.workerId}`}
              className="block rounded-lg px-1 py-0.5 transition hover:bg-black/5 dark:hover:bg-white/5"
            >
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate font-medium">{row.workerName}</span>
                <span className="tnum shrink-0 text-xs">
                  {owesYou ? "owes you " : "you owe "}
                  <span className="font-semibold">{formatINR(Math.abs(row.net))}</span>
                </span>
              </div>
              {/* Diverging bar: neutral track, zero at the centre. */}
              <div
                className="relative mt-1 h-2 w-full rounded-full"
                style={{ background: theme.diverging.neutral }}
              >
                <span
                  className="absolute inset-y-0 h-full rounded-full"
                  style={{
                    width: `${Math.max(1.5, width)}%`,
                    background: owesYou
                      ? theme.diverging.positive
                      : theme.diverging.negative,
                    left: owesYou ? "50%" : undefined,
                    right: owesYou ? undefined : "50%",
                  }}
                />
                <span
                  className="absolute inset-y-0 left-1/2 w-px"
                  style={{ background: theme.axis }}
                />
              </div>
            </Link>
          );
        })}
      </div>
    </ChartCard>
  );
}
