import { NavLink, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import {
  BarChart3,
  HandCoins,
  History,
  Layers,
  PencilLine,
  Settings as SettingsIcon,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";
import { useBootstrap, useToday } from "@/lib/queries";
import { useRole } from "@/lib/role";
import { weekStartOf } from "@shared/dates";
import { cx } from "@/components/ui";

interface NavItem {
  to: string;
  label: string;
  short: string;
  icon: ReactNode;
  /** shown in the phone tab bar */
  primary?: boolean;
  /** hidden from managers — these decide what people are paid */
  adminOnly?: boolean;
}

function useNavItems(): NavItem[] {
  const today = useToday();
  const { isAdmin } = useRole();
  const items: NavItem[] = [
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
    {
      to: "/workers",
      label: "Workers",
      short: "Workers",
      icon: <Users size={15} />,
      adminOnly: true,
    },
    {
      to: "/types",
      label: "Towel types",
      short: "Types",
      icon: <Layers size={15} />,
      adminOnly: true,
    },
    {
      to: "/bonus",
      label: "Deepavali bonus",
      short: "Bonus",
      icon: <Sparkles size={15} />,
      adminOnly: true,
    },
    {
      to: "/settings",
      label: "Settings",
      short: "More",
      icon: <SettingsIcon size={15} />,
      adminOnly: true,
    },
  ];

  return isAdmin ? items : items.filter((item) => !item.adminOnly);
}

export function AppShell({ children }: { children: ReactNode }) {
  const items = useNavItems();
  const { data } = useBootstrap();
  const { isAdmin } = useRole();
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
    <div className="app-viewport flex flex-col overflow-hidden">
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

        <div className="mt-auto px-3 py-2 text-[10px] ink-4">
          Sun–Sat pay weeks
          {!isAdmin && <span className="mt-0.5 block">Signed in as manager</span>}
        </div>
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
        {/* Managers get History here; everything else behind More is admin-only. */}
        <NavLink
          to={isAdmin ? "/settings" : "/history"}
          className="flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium"
          style={
            ["/settings", "/workers", "/types", "/history", "/bonus"].some((p) =>
              location.pathname.startsWith(p),
            )
              ? { color: "var(--accent)" }
              : { color: "var(--ink-3)" }
          }
        >
          {isAdmin ? <SettingsIcon size={19} /> : <History size={19} />}
          {isAdmin ? "More" : "History"}
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
      {/*
        The actions never shrink and never wrap; the title and meta give way to
        them instead. Anything that cannot fit belongs in the Toolbar's menu.
      */}
      <div className="mx-auto flex h-11 max-w-[1400px] items-center gap-2 px-3 lg:gap-3 lg:px-5">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h1 className="truncate text-sm font-semibold">{title}</h1>
          {meta && <div className="hidden min-w-0 truncate text-xs ink-3 sm:block">{meta}</div>}
        </div>
        {action && <div className="no-print flex shrink-0 items-center gap-1.5">{action}</div>}
      </div>
      {/* On a phone the meta gets its own line rather than fighting for space. */}
      {meta && (
        <div
          className="mx-auto max-w-[1400px] truncate px-3 pb-1.5 text-xs ink-3 sm:hidden"
          style={{ marginTop: "-0.25rem" }}
        >
          {meta}
        </div>
      )}
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
