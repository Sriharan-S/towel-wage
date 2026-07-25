import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Download, History as HistoryIcon, Search } from "lucide-react";
import { PageBody, PageHeader } from "@/components/layout/AppShell";
import {
  Badge,
  Button,
  Panel,
  EmptyState,
  ErrorState,
  Input,
  Select,
  Spinner,
} from "@/components/ui";
import { useBootstrap, useWeekList } from "@/lib/queries";
import { formatCount, formatINR } from "@shared/money";
import { formatWeekRange } from "@shared/dates";

export default function HistoryPage() {
  const navigate = useNavigate();
  const bootstrap = useBootstrap();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [workerId, setWorkerId] = useState<number | "all">("all");

  const weeks = useWeekList({
    from: from || undefined,
    to: to || undefined,
    limit: 104,
  });

  const filtered = useMemo(() => {
    if (!weeks.data) return [];
    if (workerId === "all") return weeks.data;
    // Keep only weeks the chosen worker actually appears in, and narrow the
    // totals to that worker so the figures on screen match the filter.
    return weeks.data
      .map((week) => {
        const worker = week.workers.find((w) => w.workerId === workerId);
        if (!worker) return null;
        return {
          ...week,
          workers: [worker],
          totals: { ...week.totals, wage: worker.wage, netPayable: worker.netPayable },
        };
      })
      .filter((w): w is NonNullable<typeof w> => w !== null);
  }, [weeks.data, workerId]);

  const grandTotal = filtered.reduce((sum, w) => sum + w.totals.netPayable, 0);

  const download = (format: "json" | "csv") => {
    const search = new URLSearchParams({ format });
    if (from) search.set("from", from);
    if (to) search.set("to", to);
    // A plain navigation so the browser handles the Content-Disposition
    // download rather than buffering the file in memory.
    window.location.href = `/api/backup/export?${search}`;
  };

  if (weeks.isLoading) return <Spinner label="Loading history" />;
  if (weeks.error) return <ErrorState error={weeks.error} onRetry={weeks.refetch} />;

  return (
    <>
      <PageHeader
        title="History"
        meta={`${filtered.length} ${filtered.length === 1 ? "week" : "weeks"} · ${formatINR(grandTotal)} paid`}
        action={
          <>
            <Button size="sm" icon={<Download size={15} />} onClick={() => download("csv")}>
              CSV
            </Button>
            <Button size="sm" onClick={() => download("json")}>
              JSON
            </Button>
          </>
        }
      />

      <PageBody className="space-y-3">
        <Panel className="space-y-3 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Search size={15} style={{ color: "var(--ink-2)" }} />
            Filter
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-xs ink-2">From</span>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs ink-2">To</span>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <label className="col-span-2 block sm:col-span-1">
              <span className="mb-1 block text-xs ink-2">Worker</span>
              <Select
                value={String(workerId)}
                onChange={(e) =>
                  setWorkerId(e.target.value === "all" ? "all" : Number(e.target.value))
                }
              >
                <option value="all">All workers</option>
                {(bootstrap.data?.workers ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          {(from || to || workerId !== "all") && (
            <Button
              size="sm"
              className="w-full"
              onClick={() => {
                setFrom("");
                setTo("");
                setWorkerId("all");
              }}
            >
              Clear filters
            </Button>
          )}
        </Panel>

        {filtered.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<HistoryIcon size={28} />}
              title="No weeks match"
              description={
                weeks.data?.length
                  ? "Try widening the date range or choosing a different worker."
                  : "Once you record some daily entries, your weekly history will build up here."
              }
            />
          </Panel>
        ) : (
          filtered.map((week) => (
            <Panel key={week.weekStart} className="overflow-hidden">
              <button
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
                onClick={() => navigate(`/week/${week.weekStart}`)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{formatWeekRange(week.weekStart)}</span>
                    <Badge tone={week.status === "finalized" ? "positive" : "accent"}>
                      {week.status === "finalized" ? "Finalized" : "Open"}
                    </Badge>
                    {week.paidCount > 0 && (
                      <Badge>
                        {week.paidCount}/{week.workerCount} paid
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-sm ink-2">
                    {week.workers.map((w) => w.workerName).join(", ")}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="tnum font-bold" style={{ color: "var(--pos)" }}>
                    {formatINR(week.totals.netPayable)}
                  </div>
                  {week.totals.quantity > 0 && workerId === "all" && (
                    <div className="text-xs ink-2">
                      {formatCount(week.totals.quantity)} pieces
                    </div>
                  )}
                </div>
                <ChevronRight size={18} style={{ color: "var(--ink-4)" }} />
              </button>

              <div className="border-t px-4 py-2" style={{ background: "var(--panel-2)" }}>
                <div className="space-y-1">
                  {week.workers.map((worker) => (
                    <div key={worker.workerId} className="flex justify-between text-sm">
                      <span className="truncate ink-2">{worker.workerName}</span>
                      <span className="tnum shrink-0 font-medium">
                        {formatINR(worker.netPayable)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </Panel>
          ))
        )}
      </PageBody>
    </>
  );
}
