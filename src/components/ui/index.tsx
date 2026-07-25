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
// Panel — the structural container. Hairline rule, no shadow.
// ---------------------------------------------------------------------------

export function Panel({
  className,
  children,
  ...rest
}: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx("rounded-md border", className)}
      style={{ background: "var(--panel)", borderColor: "var(--line)" }}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Panel header: an eyebrow label, optional count, optional trailing action. */
export function PanelHeader({
  title,
  meta,
  action,
  className,
}: {
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex h-9 items-center justify-between gap-3 border-b px-3",
        className,
      )}
      style={{ borderColor: "var(--line)" }}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="eyebrow truncate">{title}</span>
        {meta && <span className="text-xs ink-3 tnum">{meta}</span>}
      </div>
      {action && <div className="no-print flex shrink-0 items-center gap-1">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant = "primary" | "default" | "ghost" | "danger";
type ButtonSize = "xs" | "sm" | "md";

const SIZES: Record<ButtonSize, string> = {
  xs: "h-6 px-2 text-xs gap-1",
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-8 px-3 text-sm gap-1.5",
};

export function Button({
  variant = "default",
  size = "sm",
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
    primary: { background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" },
    default: {
      background: "var(--panel)",
      color: "var(--ink)",
      borderColor: "var(--line-strong)",
    },
    ghost: { background: "transparent", color: "var(--ink-2)", borderColor: "transparent" },
    danger: { background: "transparent", color: "var(--neg)", borderColor: "var(--line-strong)" },
  };

  return (
    <button
      className={cx(
        "inline-flex select-none items-center justify-center whitespace-nowrap rounded border font-medium",
        "transition-colors disabled:pointer-events-none disabled:opacity-40",
        SIZES[size],
        className,
      )}
      style={styles[variant]}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={13} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  size = 28,
  className,
  children,
  ...rest
}: { label: string; size?: number } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded transition-colors",
        "hover:bg-[color:var(--panel-3)] disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
      style={{ color: "var(--ink-2)", width: size, height: size }}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Segmented control — a row of mutually exclusive options. */
export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  size = "sm",
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  size?: "xs" | "sm";
  className?: string;
}) {
  return (
    <div
      className={cx("inline-flex rounded border p-0.5", className)}
      style={{ background: "var(--panel-3)", borderColor: "var(--line)" }}
      role="group"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            title={option.title}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cx(
              "rounded-sm font-medium transition-colors",
              size === "xs" ? "h-5 px-1.5 text-[11px]" : "h-6 px-2 text-xs",
            )}
            style={
              active
                ? { background: "var(--panel)", color: "var(--ink)" }
                : { color: "var(--ink-3)" }
            }
          >
            {option.label}
          </button>
        );
      })}
    </div>
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
      {label && <span className="mb-1 block text-xs font-medium ink-2">{label}</span>}
      {children}
      {error ? (
        <span
          className="mt-1 flex items-center gap-1 text-[11px]"
          style={{ color: "var(--neg)" }}
        >
          <AlertCircle size={11} />
          {error}
        </span>
      ) : (
        hint && <span className="mt-1 block text-[11px] ink-3">{hint}</span>
      )}
    </label>
  );
}

const INPUT_BASE =
  "w-full rounded border px-2 outline-none transition-colors " +
  "placeholder:text-[color:var(--ink-4)] focus:border-[color:var(--accent)]";

const INPUT_STYLE: React.CSSProperties = {
  background: "var(--panel)",
  borderColor: "var(--line-strong)",
  color: "var(--ink)",
};

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input className={cx(INPUT_BASE, "h-8 text-sm", className)} style={INPUT_STYLE} {...rest} />
  );
}

/**
 * Numeric cell tuned for fast repeated entry.
 *
 * `inputMode="decimal"` brings up the number pad on a phone, and focusing
 * selects the existing value so typing overwrites rather than appends.
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
      className={cx(INPUT_BASE, "tnum h-9 text-right text-sm font-medium", className)}
      style={INPUT_STYLE}
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
      className={cx(INPUT_BASE, "h-8 appearance-none pr-7 text-sm", className)}
      style={INPUT_STYLE}
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
      className="relative h-5 w-9 shrink-0 rounded-full transition-colors"
      style={{ background: checked ? "var(--accent)" : "var(--line-strong)" }}
    >
      <span
        className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all"
        style={{ left: checked ? "1.125rem" : "0.125rem" }}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Badge / status
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
  const tones: Record<string, React.CSSProperties> = {
    neutral: { background: "var(--panel-3)", color: "var(--ink-2)" },
    positive: { background: "var(--pos-soft)", color: "var(--pos)" },
    negative: { background: "var(--neg-soft)", color: "var(--neg)" },
    warning: { background: "var(--warn-soft)", color: "var(--warn)" },
    accent: { background: "var(--accent-soft)", color: "var(--accent)" },
  };
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded px-1.5 py-px text-[11px] font-medium leading-4",
        className,
      )}
      style={tones[tone]}
    >
      {children}
    </span>
  );
}

/** A number that changes colour by sign, for deltas and balances. */
export function Money({
  children,
  tone,
  className,
}: {
  children: ReactNode;
  tone?: "positive" | "negative" | "muted";
  className?: string;
}) {
  return (
    <span
      className={cx("tnum", className)}
      style={{
        color:
          tone === "positive"
            ? "var(--pos)"
            : tone === "negative"
              ? "var(--neg)"
              : tone === "muted"
                ? "var(--ink-3)"
                : undefined,
      }}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sheet — bottom sheet on phones, centred dialog on desktop
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
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="no-print fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(
          "relative flex max-h-[92vh] w-full flex-col rounded-t-lg border shadow-2xl outline-none",
          "sm:rounded-lg",
          wide ? "sm:max-w-2xl" : "sm:max-w-sm",
        )}
        style={{ background: "var(--panel)", borderColor: "var(--line-strong)" }}
      >
        <div
          className="flex items-start justify-between gap-3 border-b px-3 py-2.5"
          style={{ borderColor: "var(--line)" }}
        >
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-semibold">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-xs ink-3">{description}</p>}
          </div>
          <IconButton label="Close" onClick={onClose} size={24}>
            <X size={16} />
          </IconButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>

        {footer && (
          <div
            className="safe-bottom flex gap-2 border-t p-3"
            style={{ borderColor: "var(--line)" }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmSheet({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  destructive = false,
  loading = false,
  confirmOnEnter = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  /**
   * Let Enter confirm, for prompts reached by pressing Enter in the first
   * place. Deliberately opt-in — a stray Enter must never delete anything, so
   * destructive prompts leave it off.
   */
  confirmOnEnter?: boolean;
}) {
  // Held in a ref so a caller's inline arrow does not re-run the effect below
  // on every render, which would keep restarting the arming delay.
  const confirmRef = useRef(onConfirm);
  confirmRef.current = onConfirm;

  useEffect(() => {
    if (!open || !confirmOnEnter || loading) return;

    /*
      Armed on a short delay, and deaf to auto-repeat. Without both, the very
      keypress that opened this prompt — or a finger resting on Enter — would
      confirm it before it had been read.
    */
    let armed = false;
    const timer = setTimeout(() => {
      armed = true;
    }, 250);

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.repeat || !armed) return;
      e.preventDefault();
      confirmRef.current();
    };

    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, confirmOnEnter, loading]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button className="flex-1" size="md" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            size="md"
            variant={destructive ? "danger" : "primary"}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-xs leading-relaxed ink-2">{description}</div>
      {confirmOnEnter && (
        <p className="mt-2 text-[11px] ink-4">
          Press <kbd className="font-mono">Enter</kbd> again to confirm, or{" "}
          <kbd className="font-mono">Esc</kbd> to go back.
        </p>
      )}
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
    setTimeout(
      () => setToasts((current) => current.filter((t) => t.id !== id)),
      options.action ? 7000 : 3200,
    );
  };

  const dismiss = (id: number) => setToasts((c) => c.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        className="no-print pointer-events-none fixed inset-x-0 bottom-16 z-[60] flex flex-col items-center gap-1.5 px-3 sm:bottom-4"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex w-full max-w-sm items-center gap-2 rounded border px-3 py-2 text-xs shadow-lg"
            style={{
              background: "var(--ink)",
              color: "var(--panel)",
              borderColor: "transparent",
            }}
          >
            {t.tone === "success" && (
              <Check size={13} className="shrink-0" style={{ color: "var(--pos)" }} />
            )}
            {t.tone === "error" && (
              <AlertCircle size={13} className="shrink-0" style={{ color: "var(--neg)" }} />
            )}
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
    <div className="flex items-center justify-center gap-2 py-16 text-xs ink-3">
      <Loader2 size={14} className="animate-spin" />
      <span>{label}…</span>
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
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      {icon && <div style={{ color: "var(--ink-4)" }}>{icon}</div>}
      <div>
        <p className="text-sm font-medium">{title}</p>
        {description && (
          <p className="mx-auto mt-1 max-w-sm text-xs ink-3">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <AlertCircle size={22} style={{ color: "var(--neg)" }} />
      <div>
        <p className="text-sm font-medium">Couldn't load this</p>
        <p className="mt-1 text-xs ink-3">{message}</p>
      </div>
      {onRetry && <Button onClick={onRetry}>Try again</Button>}
    </div>
  );
}
