"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Clock from "./Clock";
import ThemeToggle from "./ThemeToggle";

const items = [["/", "Overview"], ["/breadth", "Market breadth"], ["/valuation", "Valuation"], ["/fundamental/VIC", "Fundamentals"], ["/valuation", "Valuation"], ["/screener", "Screener"], ["/stock/VIC", "Stock analysis"], ["/monitor", "Data monitor"]];

export default function Nav() {
  const p = usePathname();
  return (
    <nav className="sticky top-0 z-30 flex flex-wrap items-center gap-1 border-b border-slate-800 bg-slate-950/90 px-4 py-2 backdrop-blur">
      <span className="mr-4 font-semibold text-sky-600 dark:text-sky-400">VN Market Intelligence</span>
      {items.map(([href, label]) => {
        const active = href === "/" ? p === "/" : p.startsWith(href.split("/").slice(0, 2).join("/"));
        return (
          <Link key={href} href={href} className={`rounded-md px-3 py-1 text-sm ${active ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-100"}`}>{label}</Link>
        );
      })}
      <div className="ml-auto flex items-center gap-3"><Clock /><ThemeToggle /></div>
    </nav>
  );
}
