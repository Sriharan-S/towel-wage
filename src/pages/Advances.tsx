import { useMemo, useState } from "react";
import { HandCoins, Plus, Trash2 } from "lucide-react";
import { PageBody, PageHeader } from "@/components/layout/AppShell";
import {
  Badge,
  Button,
  ConfirmSheet,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Money,
  NumberInput,
  Panel,
  PanelHeader,
  Segmented,
  Select,
  Sheet,
  Spinner,
  useToast,
} from "@/components/ui";
import {
  useAdvances,
  useBootstrap,
  useCreateAdvance,
  useDeleteAdvance,
  useToday,
} from "@/lib/queries";
import { formatINR, parseRupeeInput, toRupees } from "@shared/money";
import { formatDayLabel, formatFullDate } from "@shared/dates";
import type { Advance, AdvanceKind } from "@shared/types";

/**
 * The advance ledger: money handed to a worker between wage days, and money
 * they hand back. What is still owed shows up on the Wages screen so it can be
 * held off the payment — but never automatically.
 */
export default function Advances() {
  const bootstrap = useBootstrap();
  const today = useToday();
  const advances = useAdvances();
  const deleteAdvance = useDeleteAdvance();
  const { toast } = useToast();

  const [recording, setRecording] = useState<AdvanceKind | null>(null);
  const [deleting, setDeleting] = useState<Advance | null>(null);
  const [workerFilter, setWorkerFilter] = useState<number | "all">("all");

  const workerName = (id: number) =>
    bootstrap.data?.workers.find((w) => w.id === id)?.name ?? `#${id}`;

  /** Running outstanding per worker: lent − handed back − recovered from wages. */
  const outstanding = useMemo(() => {
    const map = new Map<number, number>();
    for (const row of advances.data ?? []) {
      map.set(
        row.workerId,
        (map.get(row.workerId) ?? 0) + (row.kind === "advance" ? row.amount : -row.amount),
      );
    }
    return map;
  }, [advances.data]);

  const rows = (advances.data ?? []).filter(
    (a) => workerFilter === "all" || a.workerId === workerFilter,
  );

  const totalOut = [...outstanding.values()].reduce((s, v) => s + Math.max(0, v), 0);

  if (advances.isLoading || bootstrap.isLoading) return <Spinner label="Loading advances" />;
  if (advances.error) return <ErrorState error={advances.error} onRetry={advances.refetch} />;

  return (
    <>
      <PageHeader
        title="Advances"
        meta={
          totalOut > 0 ? (
            <>
              <Money tone="negative">{formatINR(totalOut)}</Money> lent out and not yet
              recovered
            </>
          ) : (
            "Nothing outstanding"
          )
        }
        action={
          <>
            <Button icon={<Plus size={13} />} onClick={() => setRecording("advance")}>
              Give advance
            </Button>
            <Button onClick={() => setRecording("repayment")}>Record repayment</Button>
          </>
        }
      />

      <PageBody className="grid gap-3 lg:grid-cols-[20rem_1fr]">
        {/* Outstanding per worker */}
        <Panel className="h-fit overflow-hidden">
          <PanelHeader title="Outstanding" meta={formatINR(totalOut)} />
          {outstanding.size === 0 ? (
            <EmptyState title="All clear" description="No advances are outstanding." />
          ) : (
            <div className="hairline-y">
              {[...outstanding.entries()]
                .filter(([, amount]) => amount !== 0)
                .sort((a, b) => b[1] - a[1])
                .map(([workerId, amount]) => (
                  <button
                    key={workerId}
                    onClick={() =>
                      setWorkerFilter(workerFilter === workerId ? "all" : workerId)
                    }
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-[color:var(--panel-2)]"
                    style={{
                      background:
                        workerFilter === workerId ? "var(--accent-soft)" : undefined,
                    }}
                  >
                    <span className="truncate text-xs font-medium">
                      {workerName(workerId)}
                    </span>
                    <Money tone={amount > 0 ? "negative" : "positive"} className="text-xs font-semibold">
                      {formatINR(Math.abs(amount))}
                    </Money>
                  </button>
                ))}
            </div>
          )}
        </Panel>

        {/* Ledger */}
        <Panel className="overflow-hidden">
          <PanelHeader
            title="Ledger"
            meta={`${rows.length} entries`}
            action={
              <Select
                className="h-6 w-32 text-xs"
                value={String(workerFilter)}
                onChange={(e) =>
                  setWorkerFilter(e.target.value === "all" ? "all" : Number(e.target.value))
                }
              >
                <option value="all">All workers</option>
                {(bootstrap.data?.workers ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            }
          />

          {rows.length === 0 ? (
            <EmptyState
              icon={<HandCoins size={22} />}
              title="Nothing recorded"
              description="When someone borrows money mid-week, record it here and it will show up on wage day."
              action={
                <Button variant="primary" onClick={() => setRecording("advance")}>
                  Give an advance
                </Button>
              }
            />
          ) : (
            <div className="hairline-y">
              {rows.map((row) => (
                <div key={row.id} className="flex items-center gap-3 px-3 py-2">
                  <Badge tone={row.kind === "advance" ? "negative" : "positive"}>
                    {row.kind === "advance" ? "Given" : "Returned"}
                  </Badge>
                  <span className="w-28 shrink-0 truncate text-xs font-medium">
                    {workerName(row.workerId)}
                  </span>
                  <span className="w-20 shrink-0 text-xs ink-3 tnum">
                    {formatDayLabel(row.entryDate)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs ink-3">
                    {row.note}
                  </span>
                  <Money
                    tone={row.kind === "advance" ? "negative" : "positive"}
                    className="shrink-0 text-xs font-semibold"
                  >
                    {row.kind === "advance" ? "−" : "+"}
                    {formatINR(row.amount)}
                  </Money>
                  <IconButton label="Delete entry" size={22} onClick={() => setDeleting(row)}>
                    <Trash2 size={13} />
                  </IconButton>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </PageBody>

      <RecordSheet
        kind={recording}
        onClose={() => setRecording(null)}
        today={today}
        workers={bootstrap.data?.workers ?? []}
        outstanding={outstanding}
      />

      <ConfirmSheet
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        loading={deleteAdvance.isPending}
        destructive
        confirmLabel="Delete"
        title="Delete this entry?"
        description={
          deleting ? (
            <>
              {deleting.kind === "advance" ? "Advance of " : "Repayment of "}
              <strong>{formatINR(deleting.amount)}</strong> to{" "}
              {workerName(deleting.workerId)} on {formatFullDate(deleting.entryDate)}. The
              outstanding balance will be recalculated.
            </>
          ) : null
        }
        onConfirm={async () => {
          if (!deleting) return;
          await deleteAdvance.mutateAsync(deleting.id);
          toast("Entry deleted.", { tone: "success" });
          setDeleting(null);
        }}
      />
    </>
  );
}

function RecordSheet({
  kind,
  onClose,
  today,
  workers,
  outstanding,
}: {
  kind: AdvanceKind | null;
  onClose: () => void;
  today: string;
  workers: Array<{ id: number; name: string; isActive: boolean }>;
  outstanding: Map<number, number>;
}) {
  const createAdvance = useCreateAdvance();
  const { toast } = useToast();

  const active = workers.filter((w) => w.isActive);
  const [workerId, setWorkerId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<AdvanceKind>("advance");
  const [error, setError] = useState("");

  const [lastKind, setLastKind] = useState<AdvanceKind | null>(null);
  if (kind && kind !== lastKind) {
    setLastKind(kind);
    setMode(kind);
    setWorkerId(active[0]?.id ?? null);
    setAmount("");
    setDate(today);
    setNote("");
    setError("");
  }

  const owed = workerId ? Math.max(0, outstanding.get(workerId) ?? 0) : 0;

  const submit = async () => {
    const paise = parseRupeeInput(amount);
    if (!workerId) return setError("Pick a worker.");
    if (paise <= 0) return setError("Enter an amount.");
    if (mode === "repayment" && paise > owed) {
      return setError(`That's more than the ${formatINR(owed)} outstanding.`);
    }

    await createAdvance.mutateAsync({
      workerId,
      entryDate: date,
      kind: mode,
      amount: paise,
      note: note.trim() || null,
    });
    toast(
      mode === "advance"
        ? `Advance of ${formatINR(paise)} recorded.`
        : `Repayment of ${formatINR(paise)} recorded.`,
      { tone: "success" },
    );
    onClose();
  };

  return (
    <Sheet
      open={kind !== null}
      onClose={onClose}
      title={mode === "advance" ? "Give an advance" : "Record a repayment"}
      description={
        mode === "advance"
          ? "Money handed over between wage days. It will show on the Wages screen so you can hold it back."
          : "Money the worker has handed back, in part or in full."
      }
      footer={
        <>
          <Button className="flex-1" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            size="md"
            variant="primary"
            onClick={submit}
            loading={createAdvance.isPending}
          >
            Record
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Segmented
          className="w-full"
          value={mode}
          onChange={setMode}
          options={[
            { value: "advance" as const, label: "Money given" },
            { value: "repayment" as const, label: "Money returned" },
          ]}
        />

        <Field label="Worker">
          <Select
            value={String(workerId ?? "")}
            onChange={(e) => setWorkerId(Number(e.target.value))}
          >
            {active.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {(outstanding.get(w.id) ?? 0) > 0
                  ? ` — owes ${formatINR(outstanding.get(w.id)!)}`
                  : ""}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Amount"
          error={error}
          hint={
            mode === "repayment" && owed > 0
              ? `${formatINR(owed)} outstanding`
              : undefined
          }
        >
          <NumberInput
            value={amount}
            placeholder="0.00"
            autoFocus
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>

        {mode === "repayment" && owed > 0 && (
          <Button
            className="w-full"
            onClick={() => setAmount(String(toRupees(owed)))}
          >
            Repay the full {formatINR(owed)}
          </Button>
        )}

        <Field label="Date">
          <Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </Field>

        <Field label="Note" hint="Optional — what it was for">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}
