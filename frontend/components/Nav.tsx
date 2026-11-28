// frontend/components/Nav.tsx
"use client";
import { Activity, CandlestickChart, Database, FileSpreadsheet, LayoutDashboard, Menu, Scale, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import Clock from "./Clock";
import ThemeToggle from "./ThemeToggle";
import TickerCommandSearch from "./TickerCommandSearch";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  match: (p: string, fundamental: boolean) => boolean;
  iconCls: string;
  hoverCls: string;
  title?: string;
};

const ITEMS: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard, match: (p) => p === "/", iconCls: "text-blue-600 dark:text-blue-400", hoverCls: "hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-950/50 dark:hover:text-blue-300" },
  { href: "/breadth", label: "Market breadth", icon: Activity, match: (p) => p.startsWith("/breadth"), iconCls: "text-emerald-600 dark:text-emerald-400", hoverCls: "hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/50 dark:hover:text-emerald-300", title: "Advance/decline ratios & market internals" },
  { href: "/valuation", label: "Valuation", icon: Scale, match: (p) => p.startsWith("/valuation"), iconCls: "text-violet-600 dark:text-violet-400", hoverCls: "hover:bg-violet-50 hover:text-violet-700 dark:hover:bg-violet-950/50 dark:hover:text-violet-300" },
  { href: "/stock/VIC?view=fundamental", label: "Fundamentals", icon: FileSpreadsheet, match: (p, f) => p.startsWith("/stock") && f, iconCls: "text-amber-600 dark:text-amber-400", hoverCls: "hover:bg-amber-50 hover:text-amber-700 dark:hover:bg-amber-950/50 dark:hover:text-amber-300" },
  { href: "/screener", label: "Screener", icon: SlidersHorizontal, match: (p) => p.startsWith("/screener"), iconCls: "text-cyan-600 dark:text-cyan-400", hoverCls: "hover:bg-cyan-50 hover:text-cyan-700 dark:hover:bg-cyan-950/50 dark:hover:text-cyan-300" },
  { href: "/stock/VIC", label: "Stock analysis", icon: CandlestickChart, match: (p, f) => p.startsWith("/stock") && !f, iconCls: "text-rose-600 dark:text-rose-400", hoverCls: "hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/50 dark:hover:text-rose-300" },
  { href: "/monitor", label: "Data monitor", icon: Database, match: (p) => p.startsWith("/monitor"), iconCls: "text-indigo-600 dark:text-indigo-400", hoverCls: "hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-indigo-950/50 dark:hover:text-indigo-300", title: "Real-time pipeline & feed health" },
];

function NavInner() {
  const p = usePathname();
  const fundamental = useSearchParams().get("view") === "fundamental";
  const [mobileOpen, setMobileOpen] = useState(false);

  const linkCls = (item: NavItem, active: boolean) =>
    `group inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[13px] font-semibold transition-all duration-150 ${
      active
        ? "bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 text-white shadow-md shadow-indigo-500/30"
        : `text-slate-200 hover:scale-[1.02] ${item.hoverCls}`
    }`;

  return (
    <header className="sticky top-0 z-50 border-b border-slate-800/80 bg-slate-900/95 shadow-sm backdrop-blur-md">
      <div className="flex h-14 w-full flex-nowrap items-center justify-between gap-3 whitespace-nowrap px-4">
        {/* Left: Brand + 7 Color-Coded Nav Tabs */}
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 via-indigo-600 to-cyan-500 text-white shadow-md shadow-blue-500/30">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
                <path d="M3 16l4-5 4 3 5-7 5 4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="bg-gradient-to-r from-blue-700 via-blue-500 to-cyan-500 bg-clip-text text-[17px] font-extrabold tracking-tight text-transparent dark:from-blue-400 dark:via-indigo-400 dark:to-cyan-300">
              VN Market Intelligence
            </span>
          </Link>

          <nav className="hidden items-center gap-1 lg:flex">
            {ITEMS.map((item) => {
              const Icon = item.icon;
              const active = item.match(p, fundamental);
              return (
                <Link key={item.label} href={item.href} title={item.title} className={linkCls(item, active)}>
                  <Icon className={`h-3.5 w-3.5 shrink-0 ${active ? "text-white" : item.iconCls}`} aria-hidden />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right: Compact Utilities */}
        <div className="flex shrink-0 items-center gap-2">
          <TickerCommandSearch />
          <div className="hidden sm:block">
            <Clock />
          </div>
          <span className="hidden h-4 w-px bg-slate-800 sm:block" aria-hidden />
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle navigation"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-950 lg:hidden"
          >
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <div className="h-px w-full bg-gradient-to-r from-blue-500/20 via-indigo-500/20 to-cyan-500/20" aria-hidden />

      {/* Mobile / Tablet drawer */}
      {mobileOpen && (
        <nav className="space-y-1 border-t border-slate-800 bg-slate-950 px-4 py-3 lg:hidden">
          {ITEMS.map((item) => {
            const Icon = item.icon;
            const active = item.match(p, fundamental);
            return (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`flex w-full items-center gap-2 ${linkCls(item, active)}`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${active ? "text-white" : item.iconCls}`} aria-hidden />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      )}
    </header>
  );
}

export default function Nav() {
  return <Suspense fallback={<header className="h-14 border-b border-slate-800" />}><NavInner /></Suspense>;
}
