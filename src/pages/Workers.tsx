import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, EyeOff, Settings2, Trash2, UserPlus, Users } from "lucide-react";
import { PageBody, PageHeader } from "@/components/layout/AppShell";
import {
  Badge,
  Button,
  Card,
  ConfirmSheet,
  EmptyState,
  Field,
  IconButton,
  Input,
  NumberInput,
  Sheet,
  Spinner,
  Switch,
  useToast,
} from "@/components/ui";
import {
  useBootstrap,
  useCreateWorker,
  useDeleteWorker,
  useSetRates,
  useUpdateWorker,
} from "@/lib/queries";
import type { RateInput } from "@/lib/api";
import { formatINR, parseRupeeInput, toRupees } from "@shared/money";
import { WORK_KIND_HELP } from "@shared/types";
import type { Worker } from "@shared/types";

export default function Workers() {
  const navigate = useNavigate();
  const bootstrap = useBootstrap();
  const createWorker = useCreateWorker();
  const updateWorker = useUpdateWorker();
  const deleteWorker = useDeleteWorker();
  const { toast } = useToast();

  const [editing, setEditing] = useState<Worker | "new" | null>(null);
  const [assigning, setAssigning] = useState<Worker | null>(null);
  const [deleting, setDeleting] = useState<Worker | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const workers = bootstrap.data?.workers ?? [];
  const visible = workers.filter((w) => showInactive || w.isActive);
  const inactiveCount = workers.filter((w) => !w.isActive).length;

  const rateCount = (workerId: number) =>
    (bootstrap.data?.rates ?? []).filter((r) => r.workerId === workerId && r.isActive).length;

  if (bootstrap.isLoading) return <Spinner label="Loading workers" />;

  return (
    <>
      <PageHeader
        title="Workers"
        subtitle={`${workers.filter((w) => w.isActive).length} active`}
        action={
          <Button
            size="sm"
            variant="primary"
            icon={<UserPlus size={15} />}
            onClick={() => setEditing("new")}
          >
            Add
          </Button>
        }
      />

      <PageBody className="space-y-3">
        {visible.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Users size={28} />}
              title="No workers yet"
              description="Add the people who process towels, then assign each of them the towel types they handle."
              action={
                <Button variant="primary" onClick={() => setEditing("new")}>
                  Add the first worker
                </Button>
              }
            />
          </Card>
        ) : (
          visible.map((worker) => (
            <Card key={worker.id} className="flex items-center gap-2 p-3">
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => navigate(`/workers/${worker.id}`)}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold">{worker.name}</span>
                  {!worker.isActive && <Badge>Inactive</Badge>}
                </div>
                <p className="mt-0.5 text-sm text-muted">
                  {rateCount(worker.id) === 0
                    ? "No towel types assigned yet"
                    : `${rateCount(worker.id)} towel ${rateCount(worker.id) === 1 ? "type" : "types"}`}
                  {worker.phone && ` · ${worker.phone}`}
                </p>
              </button>

              <IconButton label="Assign towel types" onClick={() => setAssigning(worker)}>
                <Settings2 size={18} />
              </IconButton>
              <IconButton label="Edit worker" onClick={() => setEditing(worker)}>
                <ChevronRight size={18} />
              </IconButton>
            </Card>
          ))
        )}

        {inactiveCount > 0 && (
          <Button className="w-full" onClick={() => setShowInactive((v) => !v)}>
            <EyeOff size={15} />
            {showInactive ? "Hide" : "Show"} {inactiveCount} inactive
          </Button>
        )}
      </PageBody>

      <WorkerSheet
        worker={editing}
        onClose={() => setEditing(null)}
        onDelete={(worker) => {
          setEditing(null);
          setDeleting(worker);
        }}
        onSubmit={async (values) => {
          if (editing === "new") {
            await createWorker.mutateAsync(values);
            toast("Worker added.", { tone: "success" });
          } else if (editing) {
            await updateWorker.mutateAsync({ id: editing.id, ...values });
            toast("Worker updated.", { tone: "success" });
          }
          setEditing(null);
        }}
        saving={createWorker.isPending || updateWorker.isPending}
      />

      {assigning && (
        <AssignRatesSheet worker={assigning} onClose={() => setAssigning(null)} />
      )}

      <ConfirmSheet
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const result = await deleteWorker.mutateAsync(deleting.id);
          toast(
            "deactivated" in result ? result.message : `${deleting.name} removed.`,
            { tone: "success" },
          );
          setDeleting(null);
        }}
        title={`Remove ${deleting?.name}?`}
        confirmLabel="Remove"
        destructive
        loading={deleteWorker.isPending}
        description="If this worker has any recorded work they will be marked inactive instead of deleted, so past weeks stay intact."
      />
    </>
  );
}

// ---------------------------------------------------------------------------

function WorkerSheet({
  worker,
  onClose,
  onSubmit,
  onDelete,
  saving,
}: {
  worker: Worker | "new" | null;
  onClose: () => void;
  onSubmit: (values: {
    name: string;
    phone: string | null;
    notes: string | null;
    isActive: boolean;
  }) => Promise<void>;
  onDelete: (worker: Worker) => void;
  saving: boolean;
}) {
  const isNew = worker === "new";
  const existing = worker && worker !== "new" ? worker : null;

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState("");

  // Reset the form each time a different worker is opened.
  const formKey = isNew ? "new" : (existing?.id ?? 0);
  const [lastKey, setLastKey] = useState<string | number>("");
  if (worker && formKey !== lastKey) {
    setLastKey(formKey);
    setName(existing?.name ?? "");
    setPhone(existing?.phone ?? "");
    setNotes(existing?.notes ?? "");
    setIsActive(existing?.isActive ?? true);
    setError("");
  }

  const submit = async () => {
    if (!name.trim()) {
      setError("Please enter a name.");
      return;
    }
    await onSubmit({
      name: name.trim(),
      phone: phone.trim() || null,
      notes: notes.trim() || null,
      isActive,
    });
  };

  return (
    <Sheet
      open={worker !== null}
      onClose={onClose}
      title={isNew ? "Add worker" : "Edit worker"}
      footer={
        <>
          {existing && (
            <Button variant="danger" icon={<Trash2 size={16} />} onClick={() => onDelete(existing)}>
              Remove
            </Button>
          )}
          <Button className="flex-1" variant="primary" onClick={submit} loading={saving}>
            {isNew ? "Add worker" : "Save changes"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" error={error}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Nallamuthu"
            autoFocus
          />
        </Field>
        <Field label="Phone" hint="Optional">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
        </Field>
        <Field label="Notes" hint="Optional">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {existing && (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Active</p>
              <p className="text-xs text-muted">
                Inactive workers are hidden from daily entry but keep their history.
              </p>
            </div>
            <Switch checked={isActive} onChange={setIsActive} label="Active" />
          </div>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

/**
 * Assign any number of towel types to a worker, each at that worker's own rate.
 * Changing a price here only affects future entries — every entry snapshots the
 * rate it was recorded at.
 */
function AssignRatesSheet({ worker, onClose }: { worker: Worker; onClose: () => void }) {
  const bootstrap = useBootstrap();
  const setRates = useSetRates();
  const { toast } = useToast();

  const workTypes = (bootstrap.data?.workTypes ?? []).filter((t) => t.isActive);
  const currentRates = useMemo(
    () => (bootstrap.data?.rates ?? []).filter((r) => r.workerId === worker.id),
    [bootstrap.data, worker.id],
  );

  const [draft, setDraft] = useState<Record<number, RateInput | undefined>>(() =>
    Object.fromEntries(
      currentRates.map((r) => [
        r.workTypeId,
        {
          workTypeId: r.workTypeId,
          unitPrice: r.unitPrice,
          divisor: r.divisor,
          multiplier: r.multiplier,
          isActive: r.isActive,
        },
      ]),
    ),
  );

  const toggle = (workTypeId: number) => {
    setDraft((current) => {
      if (current[workTypeId]) {
        const { [workTypeId]: _removed, ...rest } = current;
        return rest;
      }
      const type = workTypes.find((t) => t.id === workTypeId)!;
      return {
        ...current,
        [workTypeId]: {
          workTypeId,
          unitPrice: type.defaultUnitPrice,
          divisor: type.defaultDivisor,
          multiplier: type.defaultMultiplier,
          isActive: true,
        },
      };
    });
  };

  const patch = (workTypeId: number, changes: Partial<RateInput>) =>
    setDraft((current) => ({
      ...current,
      [workTypeId]: { ...current[workTypeId]!, ...changes },
    }));

  const save = async () => {
    await setRates.mutateAsync({
      workerId: worker.id,
      rates: Object.values(draft).filter(Boolean) as RateInput[],
    });
    toast(`Towel types updated for ${worker.name}.`, { tone: "success" });
    onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      wide
      title={`${worker.name}'s towel types`}
      description="Tick every type this worker handles and set their rate for it."
      footer={
        <>
          <Button className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-1" variant="primary" onClick={save} loading={setRates.isPending}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        {workTypes.length === 0 && (
          <EmptyState
            title="No towel types yet"
            description="Create a towel type first, then assign it here."
          />
        )}

        {workTypes.map((type) => {
          const assigned = draft[type.id];
          return (
            <div
              key={type.id}
              className="rounded-xl border p-3"
              style={{ background: assigned ? "var(--surface)" : "var(--surface-2)" }}
            >
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={Boolean(assigned)}
                  onChange={() => toggle(type.id)}
                  className="h-5 w-5 shrink-0 rounded"
                />
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ background: type.color }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{type.name}</span>
                  <span className="block text-xs text-muted">{WORK_KIND_HELP[type.kind]}</span>
                </span>
              </label>

              {assigned && type.kind === "count_x_price" && (
                <div className="mt-3 pl-8">
                  <Field label="Price per piece">
                    <NumberInput
                      value={assigned.unitPrice === 0 ? "" : String(toRupees(assigned.unitPrice))}
                      placeholder="0.00"
                      onChange={(e) =>
                        patch(type.id, { unitPrice: parseRupeeInput(e.target.value) })
                      }
                    />
                  </Field>
                </div>
              )}

              {assigned && type.kind === "formula_sum_ratio" && (
                <div className="mt-3 grid grid-cols-2 gap-3 pl-8">
                  <Field label="Divide by" hint="Week's total count">
                    <NumberInput
                      value={String(assigned.divisor)}
                      onChange={(e) =>
                        patch(type.id, { divisor: Number(e.target.value) || 1 })
                      }
                    />
                  </Field>
                  <Field label="Times ₹">
                    <NumberInput
                      value={String(toRupees(assigned.multiplier))}
                      onChange={(e) =>
                        patch(type.id, { multiplier: parseRupeeInput(e.target.value) })
                      }
                    />
                  </Field>
                  <p className="col-span-2 -mt-1 text-xs text-muted">
                    A week totalling {assigned.divisor} {type.unitLabel} pays{" "}
                    {formatINR(assigned.multiplier)}.
                  </p>
                </div>
              )}

              {assigned && type.kind === "direct_sum" && (
                <p className="mt-2 pl-8 text-xs text-muted">
                  No rate needed — you type the rupee amount each day.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
