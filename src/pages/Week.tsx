import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  HandCoins,
  Lock,
  LockOpen,
  LogOut,
  PencilLine,
  Printer,
  Share2,
  Wallet,
  Wand2,
} from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { CalendarPopover } from "@/components/Calendar";
import { PayoutSheet } from "@/components/PayoutSheet";
import {
  Badge,
  Button,
  ConfirmSheet,
  EmptyState,
  ErrorState,
  Money,
  Spinner,
  useToast,
} from "@/components/ui";
import {
  useBootstrap,
  useFinalizeWeek,
  useSettleWeek,
  useSignOut,
  useToday,
  useWeek,
} from "@/lib/queries";
import { Toolbar } from "@/components/Toolbar";
import { addWeeks, formatWeekRange, relativeWeekLabel, weekStartOf } from "@shared/dates";
import { formatCount, formatINR } from "@shared/money";

export default function Week() {
  const params = useParams<{ weekStart: string }>();
  const navigate = useNavigate();
  const today = useToday();
  const weekStart = weekStartOf(params.weekStart ?? today);

  const week = useWeek(weekStart);
  const bootstrap = useBootstrap();
  const settle = useSettleWeek(weekStart);
  const finalize = useFinalizeWeek(weekStart);
  const logout = useSignOut();
  const { toast } = useToast();
  const signOut = () => logout.mutate();

  const [confirming, setConfirming] = useState<"finalize" | "reopen" | "settle" | null>(null);

  const roundingStep = bootstrap.data?.settings.roundingStep ?? 100;
  const roundingMode = bootstrap.data?.settings.roundingMode ?? "hold";
  const businessName = bootstrap.data?.settings.businessName ?? "Towel Wage";
  const isFinalized = week.data?.status === "finalized";
  const unsettled = week.data?.workers.filter((w) => !w.settlement.isNoop).length ?? 0;

  const goto = (date: string) => navigate(`/week/${weekStartOf(date)}`);

  const shareSummary = async () => {
    if (!week.data) return;
    const text = [
      `${businessName} — ${formatWeekRange(weekStart)}`,
      "",
      ...week.data.workers.map((w) => `${w.workerName}: ${formatINR(w.netPayable)}`),
      "",
      `Total: ${formatINR(week.data.totals.netPayable)}`,
    ].join("\n");
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        toast("Payout summary copied.", { tone: "success" });
      }
    } catch {
      /* the share sheet was dismissed */
    }
  };

  if (week.isLoading) return <Spinner label="Working out the wages" />;
  if (week.error) return <ErrorState error={week.error} onRetry={week.refetch} />;
  if (!week.data) return null;

  const t = week.data.totals;
  const paidCount = week.data.workers.filter((w) => w.paidAt).length;

  return (
    <>
      <PageHeader
        title="Wages"
        meta={
          <span className="flex items-center gap-2">
            <Badge tone={isFinalized ? "positive" : "accent"}>
              {isFinalized ? "Finalized" : "Open"}
            </Badge>
            {paidCount > 0 && (
              <span className="ink-3">
                {paidCount}/{week.data.workers.length} paid
              </span>
            )}
          </span>
        }
        action={
          <Toolbar
            items={[
              ...(!isFinalized && unsettled > 0
                ? [
                    {
                      label: "Settle all",
                      icon: <Wand2 size={15} />,
                      variant: "primary" as const,
                      keepVisible: true,
                      loading: settle.isPending,
                      hint: `${unsettled} still to settle`,
                      onClick: () => setConfirming("settle"),
                    },
                  ]
                : []),
              {
                label: "Jump to the week",
                icon: <PencilLine size={15} />,
                hint: "Daily entry, from the Sunday",
                onClick: () => navigate(`/entry/${weekStart}`),
              },
              {
                label: "Print payout sheet",
                icon: <Printer size={15} />,
                onClick: () => window.print(),
              },
              { label: "Share summary", icon: <Share2 size={15} />, onClick: shareSummary },
              isFinalized
                ? {
                    label: "Reopen week",
                    icon: <LockOpen size={15} />,
                    hint: "Unfreeze and recalculate",
                    onClick: () => setConfirming("reopen"),
                  }
                : {
                    label: "Finalize week",
                    icon: <Lock size={15} />,
                    hint: "Lock entries, freeze the payout",
                    disabled: week.data.workers.length === 0,
                    onClick: () => setConfirming("finalize"),
                  },
              {
                label: "Sign out",
                icon: <LogOut size={15} />,
                variant: "danger" as const,
                onClick: signOut,
              },
            ]}
          />
        }
      >
        <div className="flex items-center gap-2">
          <Button
            icon={<ChevronLeft size={13} />}
            onClick={() => goto(addWeeks(weekStart, -1))}
            aria-label="Previous week"
          />
          <CalendarPopover value={weekStart} today={today} onSelect={goto}>
            {({ open, isOpen }) => (
              <Button
                onClick={open}
                aria-expanded={isOpen}
                className="min-w-0 flex-1 justify-center sm:flex-none"
              >
                <span className="truncate">
                  {relativeWeekLabel(weekStart, today)} · {formatWeekRange(weekStart)}
                </span>
              </Button>
            )}
          </CalendarPopover>
          <Button
            icon={<ChevronRight size={13} />}
            onClick={() => goto(addWeeks(weekStart, 1))}
            aria-label="Next week"
          />
        </div>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-3 py-3 lg:px-5">
          {isFinalized && (
            <div
              className="mb-2 flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs"
              style={{
                background: "var(--pos-soft)",
                color: "var(--pos)",
                borderColor: "var(--line)",
              }}
            >
              <Lock size={12} className="shrink-0" />
              Frozen. Later price changes will not alter these figures.
            </div>
          )}

          {week.data.workers.length === 0 ? (
            <EmptyState
              icon={<Wallet size={22} />}
              title="Nothing recorded this week"
              description="Enter some daily counts and the wages appear here."
              action={
                <Button variant="primary" onClick={() => navigate("/entry")}>
                  Go to daily entry
                </Button>
              }
            />
          ) : (
            <div
              className="overflow-hidden rounded-md border"
              style={{ background: "var(--panel)", borderColor: "var(--line)" }}
            >
              {week.data.workers.map((worker) => {
                const adjustment = worker.netPayable - worker.wage;
                const advance = worker.openingBalance.advanceOutstanding;

                return (
                  <button
                    key={worker.workerId}
                    onClick={() => navigate(`/week/${weekStart}/${worker.workerId}`)}
                    className="flex w-full items-center gap-3 border-b px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-[color:var(--panel-2)]"
                    style={{ borderColor: "var(--line)" }}
                  >
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                      style={
                        worker.paidAt
                          ? { background: "var(--pos-soft)", color: "var(--pos)" }
                          : { background: "var(--panel-3)", color: "var(--ink-3)" }
                      }
                    >
                      {worker.paidAt ? <Check size={15} /> : worker.workerName.charAt(0)}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {worker.workerName}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] ink-3">
                        <span className="tnum">wage {formatINR(worker.wage)}</span>
                        {adjustment !== 0 && (
                          <span className="tnum">
                            {adjustment > 0 ? "+" : "−"}
                            {formatINR(Math.abs(adjustment))} adj
                          </span>
                        )}
                        {advance > 0 && (
                          <Badge tone="warning">
                            <HandCoins size={9} /> {formatINR(advance)}
                          </Badge>
                        )}
                        {!isFinalized && !worker.settlement.isNoop && (
                          <Badge tone="accent">
                            suggest {formatINR(worker.settlement.netPayable)}
                          </Badge>
                        )}
                      </span>
                    </span>

                    <span className="shrink-0 text-right">
                      <Money className="block text-base font-semibold" tone="positive">
                        {formatINR(worker.netPayable)}
                      </Money>
                      <span className="text-[10px] ink-4">to pay</span>
                    </span>
                    <ChevronRight size={15} style={{ color: "var(--ink-4)" }} />
                  </button>
                );
              })}
            </div>
          )}

          {week.data.workers.length > 0 && (
            <div
              className="mt-2 overflow-hidden rounded-md border"
              style={{ background: "var(--panel)", borderColor: "var(--line)" }}
            >
              <div className="eyebrow border-b px-3 py-2" style={{ borderColor: "var(--line)" }}>
                Week summary
              </div>
              <dl className="px-3 py-2 text-xs">
                <SummaryRow label="Wages earned" value={formatINR(t.wage)} />
                {t.advanceRecovered > 0 && (
                  <SummaryRow
                    label="Advances recovered"
                    value={`− ${formatINR(t.advanceRecovered)}`}
                  />
                )}
                {t.deduct > 0 && (
                  <SummaryRow label="Credits recovered" value={`− ${formatINR(t.deduct)}`} />
                )}
                {t.debit > 0 && (
                  <SummaryRow label="Held back (rounding)" value={`− ${formatINR(t.debit)}`} />
                )}
                {t.addback > 0 && (
                  <SummaryRow label="Balances repaid" value={`+ ${formatINR(t.addback)}`} />
                )}
                {t.credit > 0 && (
                  <SummaryRow label="Paid extra (rounding)" value={`+ ${formatINR(t.credit)}`} />
                )}
              </dl>
              <div
                className="flex items-baseline justify-between border-t px-3 py-2.5"
                style={{ background: "var(--panel-2)", borderColor: "var(--line-strong)" }}
              >
                <span className="text-xs font-semibold">
                  Total payout
                  <span className="ml-2 font-normal ink-3">
                    {formatCount(t.quantity)} pieces
                  </span>
                </span>
                <Money className="text-xl font-semibold" tone="positive">
                  {formatINR(t.netPayable)}
                </Money>
              </div>
            </div>
          )}
        </div>
      </div>

      <PayoutSheet week={week.data} businessName={businessName} />

      <ConfirmSheet
        open={confirming === "settle"}
        onClose={() => setConfirming(null)}
        loading={settle.isPending}
        confirmLabel={`Settle ${unsettled} ${unsettled === 1 ? "worker" : "workers"}`}
        title="Settle everyone?"
        description={
          <>
            For each worker this recovers earlier credits (never more than they earned this
            week), repays what you owe them, clears the paise, and rounds
            {roundingMode === "hold"
              ? ` down to the nearest ₹${roundingStep}, holding the difference for next week`
              : roundingMode === "give"
                ? ` up to the nearest ₹${roundingStep}`
                : ` to the nearest ₹${roundingStep}`}
            . <strong>Advances are never recovered automatically</strong> — enter those
            yourself. You can adjust any worker afterwards.
          </>
        }
        onConfirm={() =>
          settle.mutate(undefined, {
            onSuccess: (result) => {
              setConfirming(null);
              toast(`Settled — ${formatINR(result.totals.netPayable)} to pay out.`, {
                tone: "success",
              });
            },
            onError: (error) =>
              toast(error instanceof Error ? error.message : "Could not settle", {
                tone: "error",
              }),
          })
        }
      />

      <ConfirmSheet
        open={confirming === "finalize"}
        onClose={() => setConfirming(null)}
        loading={finalize.isPending}
        confirmLabel="Finalize"
        title="Finalize this week?"
        description={
          <>
            Locks this week's daily entries and freezes the payout at{" "}
            <strong>{formatINR(t.netPayable)}</strong>. Later price changes will not affect it.
            You can reopen the week if you need to correct something.
          </>
        }
        onConfirm={() =>
          finalize.mutate("finalize", {
            onSuccess: () => {
              setConfirming(null);
              toast("Week finalized.", { tone: "success" });
            },
            onError: (error) =>
              toast(error instanceof Error ? error.message : "Could not finalize", {
                tone: "error",
              }),
          })
        }
      />

      <ConfirmSheet
        open={confirming === "reopen"}
        onClose={() => setConfirming(null)}
        loading={finalize.isPending}
        confirmLabel="Reopen"
        title="Reopen this week?"
        description="The frozen figures are discarded and recalculated from the daily entries. Entries become editable again."
        onConfirm={() =>
          finalize.mutate("reopen", {
            onSuccess: () => {
              setConfirming(null);
              toast("Week reopened.");
            },
          })
        }
      />
    </>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-0.5">
      <dt className="ink-2">{label}</dt>
      <dd className="tnum font-medium">{value}</dd>
    </div>
  );
}
