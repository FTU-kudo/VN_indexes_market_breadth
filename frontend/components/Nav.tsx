// frontend/components/Nav.tsx
"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Clock from "./Clock";
import ThemeToggle from "./ThemeToggle";

const items: [string, string, (p: string, fundamental: boolean) => boolean][] = [
  ["/", "Overview", (p) => p === "/"],
  ["/breadth", "Market breadth", (p) => p.startsWith("/breadth")],
  ["/valuation", "Valuation", (p) => p.startsWith("/valuation")],
  ["/stock/VIC?view=fundamental", "Fundamentals", (p, f) => p.startsWith("/stock") && f],
  ["/screener", "Screener", (p) => p.startsWith("/screener")],
  ["/stock/VIC", "Stock analysis", (p, f) => p.startsWith("/stock") && !f],
  ["/monitor", "Data monitor", (p) => p.startsWith("/monitor")],
];

function NavInner() {
  const p = usePathname();
  const fundamental = useSearchParams().get("view") === "fundamental";
  return (
    <nav className="sticky top-0 z-30 flex flex-wrap items-center gap-1 border-b border-slate-800 bg-slate-950/90 px-4 py-2 backdrop-blur">
      <span className="mr-4 font-semibold text-sky-600 dark:text-sky-400">VN Market Intelligence</span>
      {items.map(([href, label, match]) => (
        <Link key={label} href={href} className={`rounded-md px-3 py-1 text-sm ${match(p, fundamental) ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-100"}`}>{label}</Link>
      ))}
      <div className="ml-auto flex items-center gap-3"><Clock /><ThemeToggle /></div>
    </nav>
  );
}

export default function Nav() {
  return <Suspense fallback={<nav className="h-[49px] border-b border-slate-800" />}><NavInner /></Suspense>;
}
