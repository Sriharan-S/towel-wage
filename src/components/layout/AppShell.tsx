import { NavLink, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import {
  BarChart3,
  HandCoins,
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
  short: string;
  icon: ReactNode;
  /** shown in the phone tab bar */
  primary?: boolean;
}

function useNavItems(): NavItem[] {
  const today = useToday();
  return [
    { to: "/", label: "Dashboard", short: "Stats", icon: <BarChart3 size={19} />, primary: true },
    { to: "/entry", label: "Daily entry", short: "Entry", icon: <PencilLine size={19} />, primary: true },
    {
      to: `/week/${weekStartOf(today)}`,
      label: "Wages",
      short: "Wages",
      icon: <Wallet size={19} />,
      primary: true,
    },
    { to: "/advances", label: "Advances", short: "Loans", icon: <HandCoins size={19} />, primary: true },
    { to: "/history", label: "History", short: "History", icon: <History size={15} /> },
    { to: "/workers", label: "Workers", short: "Workers", icon: <Users size={15} /> },
    { to: "/types", label: "Towel types", short: "Types", icon: <Layers size={15} /> },
    { to: "/settings", label: "Settings", short: "More", icon: <SettingsIcon size={15} /> },
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
    /*
      The shell owns the viewport: it never scrolls. Each page scrolls inside
      its own body, so the tab bar and the page header stay put no matter how
      long the content is — on a phone that matters, because the tab bar is the
      only way back out of a screen.
    */
    <div className="flex h-dvh flex-col overflow-hidden">
      {/* Desktop rail */}
      <aside
        className="no-print fixed inset-y-0 left-0 z-20 hidden w-52 flex-col border-r lg:flex"
        style={{ background: "var(--panel)", borderColor: "var(--line)" }}
      >
        <div
          className="flex h-11 items-center gap-2 border-b px-3"
          style={{ borderColor: "var(--line)" }}
        >
          <div
            className="flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            T
          </div>
          <span className="truncate text-xs font-semibold">
            {data?.settings.businessName ?? "Towel Wage"}
          </span>
        </div>

        <nav className="flex flex-col gap-px p-2">
          {items.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              className="flex h-9 items-center gap-2.5 rounded px-2 text-[13px] font-medium transition-colors"
              style={
                isActive(item.to)
                  ? { background: "var(--accent-soft)", color: "var(--accent)" }
                  : { color: "var(--ink-2)" }
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto px-3 py-2 text-[10px] ink-4">Sun–Sat pay weeks</div>
      </aside>

      <main className="flex min-h-0 flex-1 flex-col lg:ml-52">{children}</main>

      {/* Phone tab bar — a flex sibling, so it is always on screen */}
      <nav
        className="no-print safe-bottom z-40 flex shrink-0 border-t lg:hidden"
        style={{ background: "var(--panel)", borderColor: "var(--line)" }}
      >
        {items
          .filter((i) => i.primary)
          .map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              className="flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium"
              style={isActive(item.to) ? { color: "var(--accent)" } : { color: "var(--ink-3)" }}
            >
              {item.icon}
              {item.short}
            </NavLink>
          ))}
        <NavLink
          to="/settings"
          className="flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium"
          style={
            ["/settings", "/workers", "/types", "/history"].some((p) =>
              location.pathname.startsWith(p),
            )
              ? { color: "var(--accent)" }
              : { color: "var(--ink-3)" }
          }
        >
          <SettingsIcon size={19} />
          More
        </NavLink>
      </nav>
    </div>
  );
}

/**
 * Page top bar. A single 44px line: title, inline meta, actions on the right.
 * Deliberately not a large hero — the data below is the point.
 */
export function PageHeader({
  title,
  meta,
  action,
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  /** an optional second row, e.g. a date navigator */
  children?: ReactNode;
}) {
  return (
    <header
      className="safe-top z-30 shrink-0 border-b"
      style={{ background: "var(--panel)", borderColor: "var(--line)" }}
    >
      <div className="mx-auto flex h-11 max-w-[1400px] items-center gap-3 px-3 lg:px-5">
        <h1 className="shrink-0 text-sm font-semibold">{title}</h1>
        {meta && <div className="min-w-0 flex-1 truncate text-xs ink-3">{meta}</div>}
        {!meta && <div className="flex-1" />}
        {action && <div className="no-print flex shrink-0 items-center gap-1.5">{action}</div>}
      </div>
      {children && (
        <div
          className="mx-auto max-w-[1400px] border-t px-3 py-2 lg:px-5"
          style={{ borderColor: "var(--line)" }}
        >
          {children}
        </div>
      )}
    </header>
  );
}

/**
 * The one scrollable region on a page. The shell itself is fixed, so anything
 * that overflows has to scroll here.
 */
export function PageBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={cx("mx-auto max-w-[1400px] px-3 py-3 lg:px-5 lg:py-4", className)}>
        {children}
      </div>
    </div>
  );
}
