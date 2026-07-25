import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Database,
  Download,
  Layers,
  Upload,
  Users,
} from "lucide-react";
import { PageBody, PageHeader } from "@/components/layout/AppShell";
import {
  Button,
  Panel,
  PanelHeader,
  ConfirmSheet,
  Field,
  Input,
  Select,
  Spinner,
  useToast,
} from "@/components/ui";
import { useBootstrap, useUpdateSettings } from "@/lib/queries";
import { api } from "@/lib/api";
import {
  ROUNDING_MODES,
  ROUNDING_MODE_HELP,
  ROUNDING_MODE_LABELS,
  type RoundingMode,
} from "@shared/types";

const TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Colombo",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "UTC",
];

const ROUNDING_STEPS = [1, 5, 10, 20, 50, 100];

export default function Settings() {
  const navigate = useNavigate();
  const bootstrap = useBootstrap();
  const updateSettings = useUpdateSettings();
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [pendingRestore, setPendingRestore] = useState<unknown>(null);
  const [restoring, setRestoring] = useState(false);

  const [businessName, setBusinessName] = useState<string | null>(null);

  if (!bootstrap.data) return <Spinner label="Loading settings" />;
  const { settings } = bootstrap.data;

  const save = (changes: Record<string, unknown>) =>
    updateSettings.mutate(changes, {
      onSuccess: () => toast("Settings saved.", { tone: "success" }),
      onError: (error) =>
        toast(error instanceof Error ? error.message : "Could not save", { tone: "error" }),
    });

  const pickRestoreFile = () => fileInput.current?.click();

  const onFileChosen = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed?.data) {
        toast("That doesn't look like a Towel Wage backup file.", { tone: "error" });
        return;
      }
      setPendingRestore(parsed);
    } catch {
      toast("Could not read that file — is it valid JSON?", { tone: "error" });
    }
  };

  return (
    <>
      <PageHeader title="Settings" />

      <PageBody className="space-y-4">
        {/* Shortcuts to the other management screens, which live behind
            "More" on a phone. */}
        <div className="grid grid-cols-2 gap-3">
          <Panel>
            <button
              className="flex w-full items-center gap-3 p-4 text-left"
              onClick={() => navigate("/workers")}
            >
              <Users size={20} style={{ color: "var(--accent)" }} />
              <div>
                <p className="font-medium">Workers</p>
                <p className="text-xs ink-2">
                  {bootstrap.data.workers.filter((w) => w.isActive).length} active
                </p>
              </div>
            </button>
          </Panel>
          <Panel>
            <button
              className="flex w-full items-center gap-3 p-4 text-left"
              onClick={() => navigate("/types")}
            >
              <Layers size={20} style={{ color: "var(--accent)" }} />
              <div>
                <p className="font-medium">Towel types</p>
                <p className="text-xs ink-2">
                  {bootstrap.data.workTypes.filter((t) => t.isActive).length} active
                </p>
              </div>
            </button>
          </Panel>
        </div>

        <Panel>
          <PanelHeader title="Business" />
          <div className="space-y-4 p-4">
            <Field label="Business name">
              <Input
                value={businessName ?? settings.businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                onBlur={() => {
                  if (businessName !== null && businessName !== settings.businessName) {
                    save({ businessName: businessName.trim() || "Towel Wage" });
                  }
                }}
              />
            </Field>

            <Field
              label="Timezone"
              hint="Decides which calendar day an entry belongs to, and where each week starts and ends."
            >
              <Select
                value={settings.timezone}
                onChange={(e) => save({ timezone: e.target.value })}
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Round payments to"
              hint="Paise are always cleared to the nearest rupee first, whatever you pick here."
            >
              <Select
                value={String(settings.roundingStep)}
                onChange={(e) => save({ roundingStep: Number(e.target.value) })}
              >
                {ROUNDING_STEPS.map((step) => (
                  <option key={step} value={step}>
                    {step === 1 ? "₹1 — just clear the paise" : `₹${step}`}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="When it isn't a round figure"
              hint={ROUNDING_MODE_HELP[settings.roundingMode]}
            >
              <Select
                value={settings.roundingMode}
                onChange={(e) => save({ roundingMode: e.target.value as RoundingMode })}
              >
                {ROUNDING_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {ROUNDING_MODE_LABELS[mode]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Backup"
            meta="Stored in Cloudflare D1"
          />
          <div className="space-y-2 p-4">
            <Button
              className="w-full"
              icon={<Download size={16} />}
              onClick={() => {
                window.location.href = api.backup.exportUrl("json");
              }}
            >
              Download full backup (JSON)
            </Button>
            <Button
              className="w-full"
              icon={<Download size={16} />}
              onClick={() => {
                window.location.href = api.backup.exportUrl("csv");
              }}
            >
              Download wages spreadsheet (CSV)
            </Button>
          </div>
        </Panel>

        <Panel style={{ borderColor: "var(--neg)" }}>
          <PanelHeader
            title={
              <span className="flex items-center gap-2">
                <AlertTriangle size={16} style={{ color: "var(--neg)" }} />
                Restore
              </span>
            }
            meta="Replaces everything currently stored"
          />
          <div className="p-4">
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFileChosen(file);
                e.target.value = "";
              }}
            />
            <Button
              className="w-full"
              variant="danger"
              icon={<Upload size={16} />}
              onClick={pickRestoreFile}
            >
              Restore from a backup file
            </Button>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="About" />
          <div className="space-y-1 p-4 text-sm ink-2">
            <p className="flex items-center gap-2">
              <Database size={14} /> Cloudflare Workers + D1
            </p>
            <p>
              Weeks run Sunday to Saturday. Every entry stores the price it was recorded at, so
              changing a rate never rewrites a week you have already paid.
            </p>
          </div>
        </Panel>
      </PageBody>

      <ConfirmSheet
        open={pendingRestore !== null}
        onClose={() => setPendingRestore(null)}
        loading={restoring}
        destructive
        confirmLabel="Replace everything"
        title="Restore this backup?"
        description="Every worker, towel type, daily entry and week currently stored will be deleted and replaced by the contents of this file. This cannot be undone — download a backup first if you are unsure."
        onConfirm={async () => {
          setRestoring(true);
          try {
            await api.backup.restore(pendingRestore);
            toast("Backup restored.", { tone: "success" });
            setPendingRestore(null);
            window.location.reload();
          } catch (error) {
            toast(error instanceof Error ? error.message : "Restore failed", { tone: "error" });
          } finally {
            setRestoring(false);
          }
        }}
      />
    </>
  );
}
