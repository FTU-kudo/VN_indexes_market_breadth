// frontend/app/screener/page.tsx
"use client";
import { Check, Search, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Loading, Page } from "@/components/Ui";
import { fmt, num, Row, StockInfo, tone, useJSON } from "@/lib/data";

type SortKey = "symbol" | "pe" | "pb" | "close" | "ret_1" | "vol_ratio_20" | "rsi_14" | "macd_hist" | "dist50" | "rs_20";

const INITIAL_FILTERS = {
  q: "", ex: "", index: "",
  a20: false, a50: false, a200: false, macd: false,
  rsiMin: "", rsiMax: "", volMin: "", rsMin: "", peMax: "", pbMax: "",
  latestOnly: true,
};

const EX_BADGE: Record<string, string> = {
  HOSE: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800/80 dark:bg-blue-950/60 dark:text-blue-300",
  HNX: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800/80 dark:bg-indigo-950/60 dark:text-indigo-300",
  UPCOM: "border-slate-700 bg-slate-950 text-slate-300",
};

export default function Screener() {
  const snap = useJSON<{ rows: Row[] }>("indicators/snapshot_stocks.json");
  const info = useJSON<StockInfo[]>("stocks.json");
  const idx = useJSON<{ code: string }[]>("indexes.json");
  const valn = useJSON<{ rows: { symbol: string; pe: number | null; pb: number | null }[] }>("valuation/snapshot.json");
  const [f, setF] = useState(INITIAL_FILTERS);
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "vol_ratio_20", dir: -1 });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  const merged = useMemo(() => {
    const m = new Map((info.data ?? []).map((s) => [s.symbol, s]));
    const vm = new Map((valn.data?.rows ?? []).map((s) => [s.symbol, s]));
    return (snap.data?.rows ?? []).map((r) => {
      const c = num(r, "close"), s50 = num(r, "sma_50");
      const v = vm.get(r.symbol);
      return { r, info: m.get(r.symbol), dist50: c !== null && s50 ? (c / s50 - 1) * 100 : null, pe: v?.pe ?? null, pb: v?.pb ?? null };
    });
  }, [snap.data, info.data, valn.data]);
  const maxDate = useMemo(() => merged.reduce((a, x) => (x.r.date > a ? x.r.date : a), ""), [merged]);

  const rows = useMemo(() => {
    const n = (s: string) => (s.trim() === "" ? null : Number(s));
    const [rmin, rmax, vmin, rsmin, peMax, pbMax] = [n(f.rsiMin), n(f.rsiMax), n(f.volMin), n(f.rsMin), n(f.peMax), n(f.pbMax)];
    const val = (x: (typeof merged)[number], k: SortKey) => (k === "symbol" ? x.r.symbol : k === "dist50" ? x.dist50 : k === "pe" ? x.pe : k === "pb" ? x.pb : num(x.r, k));
    const out = merged.filter(({ r, info: i, dist50, pe, pb }) => {
      const c = num(r, "close");
      if (f.latestOnly && r.date !== maxDate) return false;
      if (f.q && !r.symbol.includes(f.q.toUpperCase())) return false;
      if (f.ex && i?.exchange !== f.ex) return false;
      if (f.index && !i?.indexes.includes(f.index)) return false;
      for (const [on, k] of [[f.a20, "sma_20"], [f.a50, "sma_50"], [f.a200, "sma_200"]] as [boolean, string][]) {
        const m = num(r, k);
        if (on && (c === null || m === null || c <= m)) return false;
      }
      if (f.macd && !((num(r, "macd") ?? -1) > (num(r, "macd_signal") ?? 1))) return false;
      const rsi = num(r, "rsi_14"), vr = num(r, "vol_ratio_20"), rs = num(r, "rs_20");
      if (rmin !== null && (rsi === null || rsi < rmin)) return false;
      if (rmax !== null && (rsi === null || rsi > rmax)) return false;
      if (vmin !== null && (vr === null || vr < vmin)) return false;
      if (rsmin !== null && (rs === null || rs < rsmin)) return false;
      if (peMax !== null && (pe === null || pe > peMax)) return false;
      if (pbMax !== null && (pb === null || pb > pbMax)) return false;
      void dist50;
      return true;
    });
    return out.sort((a, b) => {
      const x = val(a, sort.k), y = val(b, sort.k);
      if (x === null) return 1;
      if (y === null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [merged, f, sort, maxDate]);

  const activeChips: { label: string; clear: () => void }[] = [
    ...(f.q ? [{ label: `Ticker: ${f.q.toUpperCase()}`, clear: () => set("q", "") }] : []),
    ...(f.ex ? [{ label: `Exch: ${f.ex}`, clear: () => set("ex", "") }] : []),
    ...(f.index ? [{ label: `Index: ${f.index}`, clear: () => set("index", "") }] : []),
    ...(f.a20 ? [{ label: "Close > SMA20", clear: () => set("a20", false) }] : []),
    ...(f.a50 ? [{ label: "> SMA50", clear: () => set("a50", false) }] : []),
    ...(f.a200 ? [{ label: "> SMA200", clear: () => set("a200", false) }] : []),
    ...(f.macd ? [{ label: "MACD bullish", clear: () => set("macd", false) }] : []),
    ...(f.rsiMin ? [{ label: `RSI14 ≥ ${f.rsiMin}`, clear: () => set("rsiMin", "") }] : []),
    ...(f.rsiMax ? [{ label: `RSI14 ≤ ${f.rsiMax}`, clear: () => set("rsiMax", "") }] : []),
    ...(f.volMin ? [{ label: `Vol ratio ≥ ${f.volMin}`, clear: () => set("volMin", "") }] : []),
    ...(f.rsMin ? [{ label: `RS20 ≥ ${f.rsMin}`, clear: () => set("rsMin", "") }] : []),
    ...(f.peMax ? [{ label: `P/E ≤ ${f.peMax}`, clear: () => set("peMax", "") }] : []),
    ...(f.pbMax ? [{ label: `P/B ≤ ${f.pbMax}`, clear: () => set("pbMax", "") }] : []),
    ...(!f.latestOnly ? [{ label: "All sessions", clear: () => set("latestOnly", true) }] : []),
  ];

  const head = (k: SortKey, label: string, right = false) => {
    const active = sort.k === k;
    return (
      <th
        key={k}
        className={`cursor-pointer select-none px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider ${right ? "text-right" : ""} ${
          active ? "text-blue-700 dark:text-blue-400" : "text-slate-400 hover:text-slate-100"
        }`}
        onClick={() => setSort((p) => ({ k, dir: p.k === k ? (-p.dir as 1 | -1) : -1 }))}
      >
        {label}{active ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
      </th>
    );
  };

  const togglePill = (k: "a20" | "a50" | "a200" | "macd", label: string) => {
    const on = f[k];
    return (
      <button
        key={k}
        type="button"
        aria-pressed={on}
        onClick={() => set(k, !on)}
        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-all ${
          on
            ? "border-blue-300 bg-blue-50 font-semibold text-blue-700 shadow-sm dark:border-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
            : "border-slate-700 bg-slate-900 font-medium text-slate-300 hover:border-slate-600 hover:bg-slate-950"
        }`}
      >
        {on && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
        {label}
      </button>
    );
  };

  const displayedCount = Math.min(rows.length, 300);

  return (
    <Page title="Stock screener">
      {/* 2-Zone Filter Card */}
      <section className="space-y-3.5 rounded-xl border border-slate-800 bg-slate-900 p-4 shadow-sm" aria-label="Screener filters">
        {/* Zone A */}
        <div className="flex flex-wrap items-center gap-2.5 border-b border-slate-800 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              placeholder="Search ticker..."
              value={f.q}
              onChange={(e) => set("q", e.target.value)}
              aria-label="Search ticker"
              className="h-9 w-40 rounded-lg border-slate-700 pl-8 pr-7 text-xs font-medium sm:w-44"
            />
            {f.q && (
              <button type="button" onClick={() => set("q", "")} aria-label="Clear ticker" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-100">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <select value={f.ex} onChange={(e) => set("ex", e.target.value)} aria-label="Exchange" className="h-9 rounded-lg border-slate-700 bg-slate-950 px-3 text-xs font-semibold text-slate-100">
            <option value="">All exchanges</option><option>HOSE</option><option>HNX</option><option>UPCOM</option>
          </select>

          <select value={f.index} onChange={(e) => set("index", e.target.value)} aria-label="Index" className="h-9 rounded-lg border-slate-700 bg-slate-950 px-3 text-xs font-semibold text-slate-100">
            <option value="">All indexes</option>{(idx.data ?? []).map((i) => <option key={i.code}>{i.code}</option>)}
          </select>

          {togglePill("a20", "Close > SMA20")}
          {togglePill("a50", "> SMA50")}
          {togglePill("a200", "> SMA200")}
          {togglePill("macd", "MACD bullish")}

          <button
            type="button"
            aria-pressed={f.latestOnly}
            onClick={() => set("latestOnly", !f.latestOnly)}
            className={`ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold tabular-nums transition-all ${
              f.latestOnly
                ? "border-emerald-200/80 bg-emerald-50/70 text-emerald-800 dark:border-emerald-800/80 dark:bg-emerald-950/50 dark:text-emerald-300"
                : "border-slate-700 bg-slate-950 text-slate-400 hover:text-slate-200"
            }`}
          >
            {f.latestOnly && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            Latest session only ({maxDate || "–"})
          </button>
        </div>

        {/* Zone B */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">RSI14</div>
            <div className="flex items-center gap-1.5">
              <input placeholder="Min ≥" inputMode="decimal" value={f.rsiMin} onChange={(e) => set("rsiMin", e.target.value)} aria-label="RSI14 min" className="h-7 w-full rounded border-slate-700 bg-slate-900 px-2 text-xs tabular-nums" />
              <span className="text-xs text-slate-500">–</span>
              <input placeholder="Max ≤" inputMode="decimal" value={f.rsiMax} onChange={(e) => set("rsiMax", e.target.value)} aria-label="RSI14 max" className="h-7 w-full rounded border-slate-700 bg-slate-900 px-2 text-xs tabular-nums" />
            </div>
          </div>

          {([
            ["volMin", "Vol ratio ≥", "e.g. 1.5"],
            ["rsMin", "RS20 vs VNINDEX ≥", "e.g. 0"],
            ["peMax", "P/E ≤", "e.g. 15"],
            ["pbMax", "P/B ≤", "e.g. 2"],
          ] as const).map(([k, label, ph]) => (
            <div key={k} className="rounded-lg border border-slate-800 bg-slate-950/70 p-2">
              <label htmlFor={`scr-${k}`} className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</label>
              <input id={`scr-${k}`} placeholder={ph} inputMode="decimal" value={f[k]} onChange={(e) => set(k, e.target.value)} className="h-7 w-full rounded border-slate-700 bg-slate-900 px-2 text-xs tabular-nums" />
            </div>
          ))}
        </div>
      </section>

      {snap.loading ? <Loading what="snapshot" /> : (
        <>
          {/* Results Summary & Methodology Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 py-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs text-slate-400">
                Showing <b className="tabular-nums text-slate-100">{displayedCount}</b> of <b className="tabular-nums text-slate-100">{rows.length}</b> matched (<b className="tabular-nums text-slate-100">{merged.length}</b> total)
              </span>
              {activeChips.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  onClick={c.clear}
                  className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                >
                  {c.label} <X className="h-3 w-3" aria-hidden />
                </button>
              ))}
              {activeChips.length > 0 && (
                <button
                  type="button"
                  onClick={() => setF(INITIAL_FILTERS)}
                  className="rounded-md px-2.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/50"
                >
                  Reset all filters
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-md border border-slate-800 bg-slate-950 px-2.5 py-1 font-medium text-slate-400">Unit: Thousand VND</span>
              <span className="rounded-md border border-slate-800 bg-slate-950 px-2.5 py-1 font-medium text-slate-400">Note: Blank P/E &amp; P/B = loss-making / negative BVPS</span>
            </div>
          </div>

          {/* Results Table */}
          <div className="max-h-[75vh] overflow-auto rounded-xl border border-slate-800 bg-slate-950 shadow-sm">
            <table className="w-full min-w-[920px] border-separate border-spacing-0 text-sm tabular-nums">
              <thead className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur-sm">
                <tr className="border-b border-slate-800">
                  {head("symbol", "Symbol")}
                  <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Exch</th>
                  {head("close", "Close", true)}
                  {head("pe", "P/E", true)}
                  {head("pb", "P/B", true)}
                  {head("ret_1", "Chg %", true)}
                  {head("vol_ratio_20", "Vol ratio", true)}
                  {head("rsi_14", "RSI14", true)}
                  {head("macd_hist", "MACD hist", true)}
                  {head("dist50", "vs SMA50 %", true)}
                  {head("rs_20", "RS20", true)}
                  <th className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-400">Date</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 300).map(({ r, info: i, dist50, pe, pb }) => {
                  const rsi = num(r, "rsi_14");
                  const rsiCls = rsi === null ? "text-slate-500" : rsi >= 70 ? "font-semibold text-amber-600 dark:text-amber-400" : rsi <= 30 ? "font-semibold text-sky-600 dark:text-sky-400" : "text-slate-200";
                  const ex = i?.exchange ?? "";
                  return (
                    <tr key={r.symbol} className="border-t border-slate-800 odd:bg-slate-950 even:bg-slate-900 transition-colors hover:bg-blue-50/40 dark:hover:bg-blue-950/30">
                      <td className="px-3 py-2"><Link href={`/stock/${r.symbol}`} className="font-bold text-blue-600 hover:text-blue-800 hover:underline dark:text-sky-300">{r.symbol}</Link></td>
                      <td className="px-3 py-2">
                        {ex ? <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold ${EX_BADGE[ex] ?? EX_BADGE.UPCOM}`}>{ex}</span> : <span className="text-slate-500">–</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-200">{fmt(num(r, "close"))}</td>
                      <td className="px-3 py-2 text-right font-medium text-slate-200">{fmt(pe)}</td>
                      <td className="px-3 py-2 text-right font-medium text-slate-200">{fmt(pb)}</td>
                      <td className={`px-3 py-2 text-right font-medium ${tone(num(r, "ret_1"))}`}>{fmt(num(r, "ret_1"))}</td>
                      <td className="px-3 py-2 text-right text-slate-200">{fmt(num(r, "vol_ratio_20"))}</td>
                      <td className={`px-3 py-2 text-right ${rsiCls}`}>{fmt(rsi, 1)}</td>
                      <td className={`px-3 py-2 text-right ${tone(num(r, "macd_hist"))}`}>{fmt(num(r, "macd_hist"), 3)}</td>
                      <td className={`px-3 py-2 text-right ${tone(dist50)}`}>{fmt(dist50)}</td>
                      <td className={`px-3 py-2 text-right ${tone(num(r, "rs_20"))}`}>{fmt(num(r, "rs_20"))}</td>
                      <td className="px-3 py-2 text-right text-slate-500">{r.date}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Page>
  );
}
