import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Check, Loader2, X } from "lucide-react";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function Card({
  className,
  children,
  ...rest
}: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        "surface rounded-2xl border shadow-sm",
        className,
      )}
      style={{ borderColor: "var(--border)" }}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex items-start justify-between gap-3 px-4 pt-4", className)}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold leading-tight">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition " +
  "disabled:opacity-50 disabled:pointer-events-none select-none active:scale-[0.98]";

const BUTTON_SIZES: Record<ButtonSize, string> = {
  // 44px minimum height throughout — this is used with thumbs.
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-sm",
  lg: "h-12 px-5 text-base",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles: Record<ButtonVariant, React.CSSProperties> = {
    primary: { background: "var(--accent)", color: "#fff" },
    secondary: {
      background: "var(--surface)",
      color: "var(--text)",
      border: "1px solid var(--border-strong)",
    },
    ghost: { background: "transparent", color: "var(--text-muted)" },
    danger: { background: "var(--negative)", color: "#fff" },
    success: { background: "var(--positive)", color: "#fff" },
  };

  return (
    <button
      className={cx(BUTTON_BASE, BUTTON_SIZES[size], className)}
      style={styles[variant]}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: { label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition active:scale-95",
        "hover:bg-black/5 dark:hover:bg-white/10",
        className,
      )}
      style={{ color: "var(--text-muted)" }}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("block", className)}>
      {label && <span className="mb-1.5 block text-sm font-medium">{label}</span>}
      {children}
      {error ? (
        <span className="mt-1 flex items-center gap-1 text-xs" style={{ color: "var(--negative)" }}>
          <AlertCircle size={12} />
          {error}
        </span>
      ) : (
        hint && <span className="mt-1 block text-xs text-muted">{hint}</span>
      )}
    </label>
  );
}

export const INPUT_CLASS =
  "w-full rounded-xl border px-3 text-base outline-none transition " +
  "placeholder:text-[color:var(--text-subtle)] focus:border-[color:var(--ring)]";

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(INPUT_CLASS, "h-11", className)}
      style={{ background: "var(--surface)", borderColor: "var(--border-strong)", color: "var(--text)" }}
      {...rest}
    />
  );
}

/**
 * Numeric field tuned for fast repeated entry on a phone:
 * `inputMode="decimal"` brings up the number pad, and focusing selects the
 * existing value so typing overwrites instead of appending.
 */
export function NumberInput({
  className,
  onFocus,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      className={cx(INPUT_CLASS, "tnum h-12 text-right font-semibold", className)}
      style={{ background: "var(--surface)", borderColor: "var(--border-strong)", color: "var(--text)" }}
      onFocus={(e) => {
        e.currentTarget.select();
        onFocus?.(e);
      }}
      {...rest}
    />
  );
}

export function Select({
  className,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(INPUT_CLASS, "h-11 appearance-none pr-8", className)}
      style={{ background: "var(--surface)", borderColor: "var(--border-strong)", color: "var(--text)" }}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative h-7 w-12 shrink-0 rounded-full transition"
      style={{ background: checked ? "var(--accent)" : "var(--border-strong)" }}
    >
      <span
        className="absolute top-1 h-5 w-5 rounded-full bg-white transition-all"
        style={{ left: checked ? "1.5rem" : "0.25rem" }}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Badge / Pill
// ---------------------------------------------------------------------------

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: "neutral" | "positive" | "negative" | "warning" | "accent";
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    neutral: { background: "var(--surface-3)", color: "var(--text-muted)" },
    positive: { background: "var(--positive-soft)", color: "var(--positive)" },
    negative: { background: "var(--negative-soft)", color: "var(--negative)" },
    warning: { background: "var(--warning-soft)", color: "var(--warning)" },
    accent: { background: "var(--accent-soft)", color: "var(--accent)" },
  };
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        className,
      )}
      style={tones[tone]}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Modal / Sheet — one component, bottom sheet on phones, dialog on desktop
// ---------------------------------------------------------------------------

export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Move focus into the panel so keyboard and screen-reader users land here.
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(
          "surface relative flex max-h-[92vh] w-full flex-col rounded-t-3xl shadow-2xl outline-none",
          "sm:rounded-3xl",
          wide ? "sm:max-w-2xl" : "sm:max-w-md",
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          <IconButton label="Close" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <div className="safe-bottom flex gap-2 border-t px-5 py-4">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Confirmation dialog for destructive or irreversible actions. */
export function ConfirmSheet({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  destructive = false,
  loading = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button className="flex-1" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            variant={destructive ? "danger" : "primary"}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-muted">{description}</div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

interface Toast {
  id: number;
  message: string;
  tone: "info" | "success" | "error";
  action?: { label: string; onClick: () => void };
}

const ToastContext = createContext<{
  toast: (
    message: string,
    options?: { tone?: Toast["tone"]; action?: Toast["action"] },
  ) => void;
}>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const toast: ReturnType<typeof useToast>["toast"] = (message, options = {}) => {
    const id = nextId.current++;
    setToasts((current) => [
      ...current,
      { id, message, tone: options.tone ?? "info", action: options.action },
    ]);
    // Give undo actions longer to be noticed and clicked.
    const ttl = options.action ? 7000 : 3500;
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), ttl);
  };

  const dismiss = (id: number) =>
    setToasts((current) => current.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl px-4 py-3 text-sm shadow-lg"
            style={{
              background:
                t.tone === "error"
                  ? "var(--negative)"
                  : t.tone === "success"
                    ? "var(--positive)"
                    : "var(--text)",
              color: t.tone === "info" ? "var(--surface)" : "#fff",
            }}
          >
            {t.tone === "success" && <Check size={16} className="shrink-0" />}
            {t.tone === "error" && <AlertCircle size={16} className="shrink-0" />}
            <span className="min-w-0 flex-1">{t.message}</span>
            {t.action && (
              <button
                className="shrink-0 font-semibold underline underline-offset-2"
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-muted">
      <Loader2 size={18} className="animate-spin" />
      <span className="text-sm">{label}…</span>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      {icon && <div style={{ color: "var(--text-subtle)" }}>{icon}</div>}
      <div>
        <p className="font-medium">{title}</p>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <AlertCircle size={28} style={{ color: "var(--negative)" }} />
      <div>
        <p className="font-medium">Couldn't load this</p>
        <p className="mt-1 text-sm text-muted">{message}</p>
      </div>
      {onRetry && <Button onClick={onRetry}>Try again</Button>}
    </div>
  );
}
