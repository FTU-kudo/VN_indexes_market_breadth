// frontend/components/TickerCommandSearch.tsx
"use client";
import { Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { StockInfo, useJSON } from "@/lib/data";

export default function TickerCommandSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const stocks = useJSON<StockInfo[]>("stocks.json");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "/" && !open && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 20);
    else setQ("");
  }, [open]);

  const matches = useMemo(() => {
    const list = stocks.data ?? [];
    const term = q.trim().toUpperCase();
    if (!term) return list.slice(0, 8);
    return list.filter((s) => s.symbol.includes(term)).slice(0, 12);
  }, [stocks.data, q]);

  const go = (sym: string) => {
    setOpen(false);
    router.push(`/stock/${sym}`);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center justify-between gap-2 rounded-lg border border-slate-700/80 bg-slate-900 px-2.5 text-xs text-slate-400 transition hover:border-slate-600 hover:text-slate-100 xl:w-36"
        aria-label="Quick ticker search"
      >
        <span className="inline-flex items-center gap-1.5">
          <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="hidden sm:inline">Search...</span>
        </span>
        <kbd className="hidden rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-slate-400 lg:inline">⌘K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-20 backdrop-blur-xs" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <form
              className="flex items-center gap-2 border-b border-slate-800 px-3 py-2.5"
              onSubmit={(e) => {
                e.preventDefault();
                const sym = q.trim().toUpperCase() || matches[0]?.symbol;
                if (sym) go(sym);
              }}
            >
              <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Type ticker symbol (e.g. VIC, VCB, FPT)..."
                className="w-full border-0 bg-transparent p-0 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-0"
              />
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded p-1 text-slate-400 hover:text-slate-100">
                <X className="h-4 w-4" />
              </button>
            </form>
            <div className="max-h-72 overflow-y-auto p-1.5">
              {matches.map((s) => (
                <button
                  key={s.symbol}
                  type="button"
                  onClick={() => go(s.symbol)}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition hover:bg-slate-950"
                >
                  <span className="font-bold text-slate-100">{s.symbol}</span>
                  <span className="rounded border border-slate-700/80 bg-slate-950 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">{s.exchange}</span>
                </button>
              ))}
              {matches.length === 0 && <p className="px-3 py-6 text-center text-xs text-slate-500">No matching tickers.</p>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
