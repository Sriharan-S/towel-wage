import { NavLink, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import {
  BarChart3,
  History,
  Layers,
  PencilLine,
  Settings as SettingsIcon,
  Users,
  Wallet,
} from "lucide-react";
import { useBootstrap, useToday } from "@/lib/queries";
import { weekStartOf } from "@shared/dates";
import { cx } from "@/components/ui";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  /** shown in the phone tab bar */
  primary?: boolean;
}

function useNavItems(): NavItem[] {
  const today = useToday();
  return [
    { to: "/", label: "Dashboard", icon: <BarChart3 size={20} />, primary: true },
    { to: "/entry", label: "Daily entry", icon: <PencilLine size={20} />, primary: true },
    {
      to: `/week/${weekStartOf(today)}`,
      label: "Wages",
      icon: <Wallet size={20} />,
      primary: true,
    },
    { to: "/history", label: "History", icon: <History size={20} />, primary: true },
    { to: "/workers", label: "Workers", icon: <Users size={20} /> },
    { to: "/types", label: "Towel types", icon: <Layers size={20} /> },
    { to: "/settings", label: "Settings", icon: <SettingsIcon size={20} /> },
  ];
}

export function AppShell({ children }: { children: ReactNode }) {
  const items = useNavItems();
  const { data } = useBootstrap();
  const location = useLocation();

  // The week route carries a date, so exact matching would never highlight it.
  const isActive = (to: string) =>
    to === "/"
      ? location.pathname === "/"
      : location.pathname.startsWith(to.split("/").slice(0, 2).join("/"));

  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <aside
        className="no-print fixed inset-y-0 left-0 hidden w-60 flex-col border-r px-3 py-5 lg:flex"
        style={{ background: "var(--surface)" }}
      >
        <div className="mb-6 flex items-center gap-2 px-2">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl text-lg"
            style={{ background: "var(--accent-soft)" }}
          >
            🧻
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {data?.settings.businessName ?? "Towel Wage"}
            </p>
            <p className="text-xs text-muted">Weekly wages</p>
          </div>
        </div>

        <nav className="flex flex-col gap-1">
          {items.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              className={cx(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
              )}
              style={
                isActive(item.to)
                  ? { background: "var(--accent-soft)", color: "var(--accent)" }
                  : { color: "var(--text-muted)" }
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <main className="pb-24 lg:ml-60 lg:pb-8">{children}</main>

      {/* Phone tab bar */}
      <nav
        className="no-print safe-bottom fixed inset-x-0 bottom-0 z-40 flex border-t px-2 pt-1 lg:hidden"
        style={{ background: "var(--surface)" }}
      >
        {items
          .filter((i) => i.primary)
          .map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              className="flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium"
              style={
                isActive(item.to)
                  ? { color: "var(--accent)" }
                  : { color: "var(--text-subtle)" }
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        <NavLink
          to="/settings"
          className="flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium"
          style={
            ["/settings", "/workers", "/types"].some((p) => location.pathname.startsWith(p))
              ? { color: "var(--accent)" }
              : { color: "var(--text-subtle)" }
          }
        >
          <SettingsIcon size={20} />
          More
        </NavLink>
      </nav>
    </div>
  );
}

/** Sticky page header with an optional trailing action. */
export function PageHeader({
  title,
  subtitle,
  action,
  sticky = true,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  sticky?: boolean;
}) {
  return (
    <header
      className={cx(
        "safe-top z-30 border-b px-4 py-3 lg:px-8",
        sticky && "sticky top-0",
      )}
      style={{ background: "var(--surface)" }}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold leading-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 truncate text-sm text-muted">{subtitle}</p>}
        </div>
        {action && <div className="no-print flex shrink-0 items-center gap-2">{action}</div>}
      </div>
    </header>
  );
}

export function PageBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("mx-auto max-w-6xl px-4 py-4 lg:px-8 lg:py-6", className)}>
      {children}
    </div>
  );
}
