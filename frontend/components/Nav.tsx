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
  title?: string;
};

const ITEMS: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard, match: (p) => p === "/" },
  { href: "/breadth", label: "Market breadth", icon: Activity, match: (p) => p.startsWith("/breadth"), title: "Advance/decline ratios & market internals" },
  { href: "/valuation", label: "Valuation", icon: Scale, match: (p) => p.startsWith("/valuation") },
  { href: "/stock/VIC?view=fundamental", label: "Fundamentals", icon: FileSpreadsheet, match: (p, f) => p.startsWith("/stock") && f },
  { href: "/screener", label: "Screener", icon: SlidersHorizontal, match: (p) => p.startsWith("/screener") },
  { href: "/stock/VIC", label: "Stock analysis", icon: CandlestickChart, match: (p, f) => p.startsWith("/stock") && !f },
  { href: "/monitor", label: "Data monitor", icon: Database, match: (p) => p.startsWith("/monitor"), title: "Real-time pipeline & feed health" },
];

function NavInner() {
  const p = usePathname();
  const fundamental = useSearchParams().get("view") === "fundamental";
  const [mobileOpen, setMobileOpen] = useState(false);

  const linkCls = (active: boolean) =>
    `group inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-[15px] font-semibold transition-all duration-150 ${
      active
        ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/25"
        : "text-slate-200 hover:bg-blue-50/80 hover:text-blue-600 dark:hover:bg-blue-950/50 dark:hover:text-blue-400"
    }`;

  return (
    <header className="sticky top-0 z-50 border-b border-slate-800/90 bg-slate-900/90 shadow-sm backdrop-blur-md">
      {/* Row 1: Brand + Global Utilities */}
      <div className="flex h-14 items-center justify-between gap-4 px-4 lg:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/25">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
              <path d="M3 16l4-5 4 3 5-7 5 4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 bg-clip-text text-xl font-extrabold tracking-tight text-transparent dark:from-blue-400 dark:via-indigo-400 dark:to-cyan-300">
            VN Market Intelligence
          </span>
        </Link>

        <div className="flex shrink-0 items-center gap-2.5">
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
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-950 md:hidden"
          >
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Row 2: Full-width Navigation Tabs (md+) */}
      <nav className="hidden border-t border-slate-800/60 px-4 py-1.5 md:flex md:items-center md:gap-1.5 md:overflow-x-auto lg:px-6">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.label} href={item.href} title={item.title} className={linkCls(item.match(p, fundamental))}>
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Mobile drawer */}
      {mobileOpen && (
        <nav className="space-y-1 border-t border-slate-800 bg-slate-950 px-4 py-3 md:hidden">
          {ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`flex w-full items-center gap-2 ${linkCls(item.match(p, fundamental))}`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
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
  return <Suspense fallback={<header className="h-24 border-b border-slate-800" />}><NavInner /></Suspense>;
}
