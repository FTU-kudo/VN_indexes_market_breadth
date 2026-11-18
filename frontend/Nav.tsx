"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [["/", "Overview"], ["/breadth", "Market breadth"], ["/screener", "Screener"], ["/stock/VIC", "Stock analysis"], ["/monitor", "Data monitor"]];

export default function Nav() {
  const p = usePathname();
  return (
    <nav className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b border-slate-800 bg-slate-950/95 px-4 py-2 backdrop-blur">
      <span className="mr-4 font-semibold text-sky-400">VN Market Intelligence</span>
      {items.map(([href, label]) => {
        const active = href === "/" ? p === "/" : p.startsWith(href.split("/").slice(0, 2).join("/"));
        return (
          <Link key={href} href={href} className={`rounded px-3 py-1 text-sm ${active ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"}`}>{label}</Link>
        );
      })}
    </nav>
  );
}
