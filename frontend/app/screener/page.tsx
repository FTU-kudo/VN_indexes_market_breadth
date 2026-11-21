// frontend/app/screener/page.tsx
"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Loading, Page } from "@/components/Ui";
import { fmt, num, Row, StockInfo, tone, useJSON } from "@/lib/data";

type SortKey = "symbol" | "pe" | "pb" | "close" | "ret_1" | "vol_ratio_20" | "rsi_14" | "macd_hist" | "dist50" | "rs_20";

export default function Screener() {
  const snap = useJSON<{ rows: Row[] }>("indicators/snapshot_stocks.json");
  const info = useJSON<StockInfo[]>("stocks.json");
  const idx = useJSON<{ code: string }[]>("indexes.json");
  const valn = useJSON<{ rows: { symbol: string; pe: number | null; pb: number | null }[] }>("valuation/snapshot.json");
  const [f, setF] = useState({ q: "", ex: "", index: "", a20: false, a50: false, a200: false, macd: false, rsiMin: "", rsiMax: "", volMin: "", rsMin: "", peMax: "", pbMax: "", latestOnly: true });
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

  const head = (k: SortKey, label: string) => (
    <th key={k} className="cursor-pointer select-none" onClick={() => setSort((p) => ({ k, dir: p.k === k ? (-p.dir as 1 | -1) : -1 }))}>{label}{sort.k === k ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</th>
  );
  const chk = (k: "a20" | "a50" | "a200" | "macd" | "latestOnly", label: string) => (
    <label className="flex items-center gap-1"><input type="checkbox" checked={f[k]} onChange={(e) => set(k, e.target.checked)} />{label}</label>
  );
  const numIn = (k: "rsiMin" | "rsiMax" | "volMin" | "rsMin" | "peMax" | "pbMax", label: string) => (
    <label className="flex items-center gap-1">{label}<input className="w-16" inputMode="decimal" value={f[k]} onChange={(e) => set(k, e.target.value)} /></label>
  );

  return (
    <Page title="Stock screener">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <input placeholder="Ticker" value={f.q} onChange={(e) => set("q", e.target.value)} className="w-24" />
        <select value={f.ex} onChange={(e) => set("ex", e.target.value)}><option value="">All exchanges</option><option>HOSE</option><option>HNX</option><option>UPCOM</option></select>
        <select value={f.index} onChange={(e) => set("index", e.target.value)}><option value="">All indexes</option>{(idx.data ?? []).map((i) => <option key={i.code}>{i.code}</option>)}</select>
        {chk("a20", "Close > SMA20")}{chk("a50", "> SMA50")}{chk("a200", "> SMA200")}{chk("macd", "MACD bullish")}
        {numIn("rsiMin", "RSI14 ≥")}{numIn("rsiMax", "≤")}{numIn("volMin", "Vol ratio ≥")}{numIn("rsMin", "RS20 vs VNINDEX ≥")}{numIn("peMax", "P/E ≤")}{numIn("pbMax", "P/B ≤")}
        {chk("latestOnly", `Latest session only (${maxDate || "–"})`)}
      </div>
      {snap.loading ? <Loading what="snapshot" /> : (
        <>
          <p className="text-sm text-slate-400">{rows.length} of {merged.length} stocks (showing first 300). Prices are in thousand VND. P/E and P/B are blank for loss-making stocks.</p>
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-900"><tr>
                {head("symbol", "Symbol")}<th>Exch</th>{head("close", "Close")}{head("pe", "P/E")}{head("pb", "P/B")}{head("ret_1", "Chg %")}{head("vol_ratio_20", "Vol ratio")}{head("rsi_14", "RSI14")}{head("macd_hist", "MACD hist")}{head("dist50", "vs SMA50 %")}{head("rs_20", "RS20")}<th>Date</th>
              </tr></thead>
              <tbody>
                {rows.slice(0, 300).map(({ r, info: i, dist50, pe, pb }) => (
                  <tr key={r.symbol} className="border-t border-slate-800 hover:bg-slate-900">
                    <td><Link href={`/stock/${r.symbol}`} className="font-medium text-sky-600 dark:text-sky-300">{r.symbol}</Link></td>
                    <td className="text-slate-400">{i?.exchange ?? "–"}</td>
                    <td>{fmt(num(r, "close"))}</td>
                    <td className="font-medium">{fmt(pe)}</td>
                    <td className="font-medium">{fmt(pb)}</td>
                    <td className={tone(num(r, "ret_1"))}>{fmt(num(r, "ret_1"))}</td>
                    <td>{fmt(num(r, "vol_ratio_20"))}</td>
                    <td>{fmt(num(r, "rsi_14"), 1)}</td>
                    <td className={tone(num(r, "macd_hist"))}>{fmt(num(r, "macd_hist"), 3)}</td>
                    <td className={tone(dist50)}>{fmt(dist50)}</td>
                    <td className={tone(num(r, "rs_20"))}>{fmt(num(r, "rs_20"))}</td>
                    <td className="text-slate-500">{r.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Page>
  );
}
