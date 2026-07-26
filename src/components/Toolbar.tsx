import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreVertical } from "lucide-react";
import { Button, cx } from "@/components/ui";

export interface ToolbarItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  variant?: "primary" | "default" | "danger";
  disabled?: boolean;
  loading?: boolean;
  /** Stays on the bar on a phone instead of folding into the menu. */
  keepVisible?: boolean;
  /** Shown in the menu under the label. */
  hint?: string;
}

/**
 * Page actions that fit whatever screen they land on.
 *
 * A phone has room for one or two, so the rest collapse behind a "⋮" — the
 * alternative was a row of buttons running off the edge, which is what the
 * Wages header used to do. On a wider screen every action is a labelled button
 * and the menu disappears entirely.
 */
export function Toolbar({ items }: { items: ToolbarItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const visible = items.filter((i) => i.keepVisible);
  const overflow = items.filter((i) => !i.keepVisible);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {/* Wide screens: every action, labelled. */}
      <div className="hidden items-center gap-1.5 sm:flex">
        {items.map((item) => (
          <Button
            key={item.label}
            icon={item.icon}
            variant={item.variant}
            disabled={item.disabled}
            loading={item.loading}
            onClick={item.onClick}
            title={item.hint ?? item.label}
          >
            {item.label}
          </Button>
        ))}
      </div>

      {/* Phones: the few that matter, then a menu. */}
      <div className="flex items-center gap-1.5 sm:hidden">
        {visible.map((item) => (
          <Button
            key={item.label}
            icon={item.icon}
            variant={item.variant}
            disabled={item.disabled}
            loading={item.loading}
            onClick={item.onClick}
            aria-label={item.label}
            title={item.label}
          >
            {item.label}
          </Button>
        ))}

        {overflow.length > 0 && (
          <div className="relative" ref={ref}>
            <Button
              onClick={() => setOpen((v) => !v)}
              aria-label="More actions"
              aria-expanded={open}
              aria-haspopup="menu"
              icon={<MoreVertical size={15} />}
            />
            {open && (
              <div
                role="menu"
                className="absolute right-0 top-full z-50 mt-1 w-56 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-md border shadow-xl"
                style={{ background: "var(--panel)", borderColor: "var(--line-strong)" }}
              >
                {overflow.map((item) => (
                  <button
                    key={item.label}
                    role="menuitem"
                    disabled={item.disabled || item.loading}
                    onClick={() => {
                      setOpen(false);
                      item.onClick();
                    }}
                    className={cx(
                      "flex w-full items-center gap-2.5 border-b px-3 py-2.5 text-left text-sm last:border-b-0",
                      "transition-colors hover:bg-[color:var(--panel-2)]",
                      "disabled:pointer-events-none disabled:opacity-40",
                    )}
                    style={{
                      borderColor: "var(--line)",
                      color:
                        item.variant === "danger"
                          ? "var(--neg)"
                          : item.variant === "primary"
                            ? "var(--accent)"
                            : "var(--ink)",
                    }}
                  >
                    <span className="w-4 shrink-0" style={{ color: "var(--ink-3)" }}>
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{item.label}</span>
                      {item.hint && (
                        <span className="block truncate text-[11px] ink-3">{item.hint}</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
