import { useState } from "react";
import { EyeOff, Layers, Plus, Trash2 } from "lucide-react";
import { PageBody, PageHeader } from "@/components/layout/AppShell";
import {
  Badge,
  Button,
  Panel,
  ConfirmSheet,
  EmptyState,
  Field,
  Input,
  NumberInput,
  Select,
  Sheet,
  Spinner,
  Switch,
  useToast,
} from "@/components/ui";
import {
  useBootstrap,
  useCreateWorkType,
  useDeleteWorkType,
  useUpdateWorkType,
} from "@/lib/queries";
import { CATEGORICAL } from "@/lib/palette";
import { formatINR, parseRupeeInput, toRupees } from "@shared/money";
import { WORK_KINDS, WORK_KIND_HELP, WORK_KIND_LABELS } from "@shared/types";
import type { WorkKind, WorkType } from "@shared/types";

// The eight validated categorical slots, in order. Offering only these keeps
// every chart colourblind-safe no matter what the user picks.
const PALETTE = CATEGORICAL.map((slot) => slot.light);

export default function WorkTypes() {
  const bootstrap = useBootstrap();
  const createType = useCreateWorkType();
  const updateType = useUpdateWorkType();
  const deleteType = useDeleteWorkType();
  const { toast } = useToast();

  const [editing, setEditing] = useState<WorkType | "new" | null>(null);
  const [deleting, setDeleting] = useState<WorkType | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const types = bootstrap.data?.workTypes ?? [];
  const visible = types.filter((t) => showInactive || t.isActive);
  const inactiveCount = types.filter((t) => !t.isActive).length;

  const usedBy = (typeId: number) =>
    (bootstrap.data?.rates ?? []).filter((r) => r.workTypeId === typeId).length;

  if (bootstrap.isLoading) return <Spinner label="Loading towel types" />;

  return (
    <>
      <PageHeader
        title="Towel types"
        meta={`${types.filter((t) => t.isActive).length} active`}
        action={
          <Button
            size="sm"
            variant="primary"
            icon={<Plus size={15} />}
            onClick={() => setEditing("new")}
          >
            Add
          </Button>
        }
      />

      <PageBody className="space-y-3">
        {visible.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<Layers size={28} />}
              title="No towel types yet"
              description="Add the towel types and job types you pay for, then assign them to workers."
              action={
                <Button variant="primary" onClick={() => setEditing("new")}>
                  Add the first type
                </Button>
              }
            />
          </Panel>
        ) : (
          visible.map((type) => (
            <Panel key={type.id} className="p-3">
              <button
                className="flex w-full items-center gap-3 text-left"
                onClick={() => setEditing(type)}
              >
                <span
                  className="h-8 w-8 shrink-0 rounded-xl"
                  style={{ background: type.color }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{type.name}</span>
                    {!type.isActive && <Badge>Hidden</Badge>}
                  </div>
                  <p className="mt-0.5 truncate text-sm ink-2">
                    {type.kind === "count_x_price" &&
                      `${formatINR(type.defaultUnitPrice)} per ${type.unitLabel.replace(/s$/, "")} (default)`}
                    {type.kind === "direct_sum" && "Daily rupee amount"}
                    {type.kind === "formula_sum_ratio" &&
                      `Week's total ÷ ${type.defaultDivisor} × ${formatINR(type.defaultMultiplier)}`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <Badge tone="accent">{WORK_KIND_LABELS[type.kind]}</Badge>
                  <p className="mt-1 text-xs ink-2">
                    {usedBy(type.id)} {usedBy(type.id) === 1 ? "worker" : "workers"}
                  </p>
                </div>
              </button>
            </Panel>
          ))
        )}

        {inactiveCount > 0 && (
          <Button className="w-full" onClick={() => setShowInactive((v) => !v)}>
            <EyeOff size={15} />
            {showInactive ? "Hide" : "Show"} {inactiveCount} hidden
          </Button>
        )}
      </PageBody>

      <WorkTypeSheet
        type={editing}
        onClose={() => setEditing(null)}
        onDelete={(type) => {
          setEditing(null);
          setDeleting(type);
        }}
        saving={createType.isPending || updateType.isPending}
        onSubmit={async (values) => {
          if (editing === "new") {
            await createType.mutateAsync(values);
            toast("Towel type added.", { tone: "success" });
          } else if (editing) {
            await updateType.mutateAsync({ id: editing.id, ...values });
            toast("Towel type updated.", { tone: "success" });
          }
          setEditing(null);
        }}
      />

      <ConfirmSheet
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const result = await deleteType.mutateAsync(deleting.id);
          toast("deactivated" in result ? result.message : `${deleting.name} removed.`, {
            tone: "success",
          });
          setDeleting(null);
        }}
        title={`Remove ${deleting?.name}?`}
        confirmLabel="Remove"
        destructive
        loading={deleteType.isPending}
        description="If this type has been used in any daily entry it will be hidden instead of deleted, so past weeks keep their figures."
      />
    </>
  );
}

function WorkTypeSheet({
  type,
  onClose,
  onSubmit,
  onDelete,
  saving,
}: {
  type: WorkType | "new" | null;
  onClose: () => void;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
  onDelete: (type: WorkType) => void;
  saving: boolean;
}) {
  const isNew = type === "new";
  const existing = type && type !== "new" ? type : null;

  const [name, setName] = useState("");
  const [kind, setKind] = useState<WorkKind>("count_x_price");
  const [unitLabel, setUnitLabel] = useState("towels");
  const [price, setPrice] = useState("");
  const [divisor, setDivisor] = useState("75");
  const [multiplier, setMultiplier] = useState("35");
  const [color, setColor] = useState(PALETTE[0]);
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState("");

  const formKey = isNew ? "new" : (existing?.id ?? 0);
  const [lastKey, setLastKey] = useState<string | number>("");
  if (type && formKey !== lastKey) {
    setLastKey(formKey);
    setName(existing?.name ?? "");
    setKind(existing?.kind ?? "count_x_price");
    setUnitLabel(existing?.unitLabel ?? "towels");
    setPrice(existing?.defaultUnitPrice ? String(toRupees(existing.defaultUnitPrice)) : "");
    setDivisor(String(existing?.defaultDivisor ?? 75));
    setMultiplier(String(toRupees(existing?.defaultMultiplier ?? 3500)));
    setColor(existing?.color ?? PALETTE[Math.floor(Math.random() * PALETTE.length)]);
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
      kind,
      unitLabel: unitLabel.trim() || "towels",
      defaultUnitPrice: parseRupeeInput(price),
      defaultDivisor: Number(divisor) || 75,
      defaultMultiplier: parseRupeeInput(multiplier),
      color,
      isActive,
    });
  };

  return (
    <Sheet
      open={type !== null}
      onClose={onClose}
      title={isNew ? "Add towel type" : "Edit towel type"}
      footer={
        <>
          {existing && (
            <Button variant="danger" icon={<Trash2 size={16} />} onClick={() => onDelete(existing)}>
              Remove
            </Button>
          )}
          <Button className="flex-1" variant="primary" onClick={submit} loading={saving}>
            {isNew ? "Add type" : "Save changes"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" error={error}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Drill, x30, Paavu"
            autoFocus
          />
        </Field>

        <Field label="How is it paid?" hint={WORK_KIND_HELP[kind]}>
          <Select value={kind} onChange={(e) => setKind(e.target.value as WorkKind)}>
            {WORK_KINDS.map((k) => (
              <option key={k} value={k}>
                {WORK_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>

        {kind !== "direct_sum" && (
          <Field label="What is counted?" hint="Shown next to the input on the entry screen">
            <Input
              value={unitLabel}
              onChange={(e) => setUnitLabel(e.target.value)}
              placeholder="towels"
            />
          </Field>
        )}

        {kind === "count_x_price" && (
          <Field
            label="Default price per piece"
            hint="Each worker can be given their own price when you assign this type to them."
          >
            <NumberInput
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
            />
          </Field>
        )}

        {kind === "formula_sum_ratio" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Divide by">
              <NumberInput value={divisor} onChange={(e) => setDivisor(e.target.value)} />
            </Field>
            <Field label="Times ₹">
              <NumberInput value={multiplier} onChange={(e) => setMultiplier(e.target.value)} />
            </Field>
            <p className="col-span-2 -mt-2 text-xs ink-2">
              A week totalling {divisor || 0} {unitLabel} pays ₹{multiplier || 0}.
            </p>
          </div>
        )}

        <Field label="Colour" hint="Used in the charts and next to the name">
          <div className="flex flex-wrap gap-2">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Colour ${c}`}
                onClick={() => setColor(c)}
                className="h-9 w-9 rounded-xl transition"
                style={{
                  background: c,
                  outline: color === c ? "2px solid var(--ink)" : "none",
                  outlineOffset: 2,
                }}
              />
            ))}
          </div>
        </Field>

        {existing && (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Active</p>
              <p className="text-xs ink-2">
                Hidden types stay out of daily entry but keep their history.
              </p>
            </div>
            <Switch checked={isActive} onChange={setIsActive} label="Active" />
          </div>
        )}
      </div>
    </Sheet>
  );
}
