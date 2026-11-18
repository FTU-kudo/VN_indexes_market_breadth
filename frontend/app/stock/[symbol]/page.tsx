"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import CandleChart, { Candle } from "@/components/CandleChart";
import LineChart, { Pt, Ser } from "@/components/LineChart";
import { Loading, Page } from "@/components/Ui";
import { fmt, getJSON, num, PriceYear, Row, useJSON } from "@/lib/data";
import { bollinger, macd, N, rsi, sma } from "@/lib/ta";

const RANGES: [string, number][] = [["3M", 63], ["6M", 126], ["1Y", 252], ["3Y", 756], ["All", 1e9]];
const GROUPS: [string, (k: string) => boolean][] = [
  ["Moving averages", (k) => /^(sma|ema)_/.test(k)],
  ["Momentum", (k) => /^(rsi|macd|stoch|willr|roc)/.test(k)],
  ["Trend", (k) => /^(adx|plus_di|minus_di|psar|supertrend|ichi)/.test(k)],
  ["Volatility", (k) => /^(atr|bb_|hv_|drawdown|max_dd)/.test(k)],
  ["Volume", (k) => /^(obv|vol_|mfi|ad_line|volume)/.test(k)],
  ["Performance & relative strength", (k) => /^(perf|rs_|ret_)/.test(k)],
];

async function loadPrices(sym: string): Promise<{ bars: PriceYear; kind: string } | null> {
  for (const kind of ["stocks", "indexes"]) {
    const years = Array.from({ length: new Date().getFullYear() - 2019 }, (_, i) => 2020 + i);
    const parts = (await Promise.all(years.map((y) => getJSON<PriceYear>(`prices/${kind}/${sym}/${y}.json`)))).filter(Boolean) as PriceYear[];
    if (parts.length) {
      const bars: PriceYear = { d: [], o: [], h: [], l: [], c: [], v: [] };
      parts.forEach((p) => (["d", "o", "h", "l", "c", "v"] as const).forEach((k) => (bars[k] as unknown[]).push(...p[k])));
      return { bars, kind };
    }
  }
  return null;
}

export default function StockPage() {
  const { symbol } = useParams<{ symbol: string }>();
  const sym = decodeURIComponent(symbol).toUpperCase();
  const router = useRouter();
  const [q, setQ] = useState(sym);
  const [range, setRange] = useState(252);
  const [px, setPx] = useState<{ bars: PriceYear; kind: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const snap = useJSON<{ rows: Row[] }>("indicators/snapshot_stocks.json");
  const snapIdx = useJSON<{ rows: Row[] }>("indicators/snapshot_indexes.json");

  useEffect(() => {
    let live = true;
    setLoading(true); setQ(sym);
    loadPrices(sym).then((r) => { if (live) { setPx(r); setLoading(false); } });
    return () => { live = false; };
  }, [sym]);

  const row = useMemo(() => (snap.data?.rows.find((r) => r.symbol === sym) ?? snapIdx.data?.rows.find((r) => r.symbol === sym)), [snap.data, snapIdx.data, sym]);

  const v = useMemo(() => {
    if (!px) return null;
    const { d, o, h, l, c, v: vol } = px.bars;
    const from = Math.max(0, d.length - range);
    const pts = (a: N[], color?: (i: number) => string | undefined): Pt[] => d.slice(from).map((t, i) => ({ time: t, value: a[from + i], color: color?.(from + i) }));
    const ser = (name: string, color: string, a: N[], width = 1): Ser => ({ name, color, width, data: pts(a) });
    const bb = bollinger(c), m = macd(c);
    return {
      candles: d.slice(from).map((t, i): Candle => ({ time: t, open: o[from + i], high: h[from + i], low: l[from + i], close: c[from + i], volume: vol[from + i] })),
      overlays: [ser("SMA20", "#38bdf8", sma(c, 20)), ser("SMA50", "#f59e0b", sma(c, 50)), ser("SMA200", "#f43f5e", sma(c, 200)), ser("BB upper", "#64748b", bb.up), ser("BB lower", "#64748b", bb.lo)],
      rsi: [ser("RSI14", "#a78bfa", rsi(c, 14), 2)],
      macd: [
        { name: "Histogram", color: "#64748b", kind: "hist" as const, data: pts(m.hist, (i) => ((m.hist[i] ?? 0) >= 0 ? "#10b981" : "#f43f5e")) },
        ser("MACD", "#38bdf8", m.line, 2), ser("Signal", "#f59e0b", m.signal, 1),
      ] as Ser[],
    };
  }, [px, range]);

  const lines = useMemo(() => [{ value: 30, color: "#10b981" }, { value: 70, color: "#f43f5e" }], []);

  return (
    <Page title={`Stock analysis – ${sym}`}>
      <form className="flex flex-wrap items-center gap-2 text-sm" onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/stock/${q.trim().toUpperCase()}`); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} className="w-28 uppercase" aria-label="Ticker" />
        <button className="rounded bg-sky-600 px-3 py-1 text-white">Go</button>
        {RANGES.map(([l, n]) => (
          <button type="button" key={l} onClick={() => setRange(n)} className={`rounded px-2 py-1 ${range === n ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300"}`}>{l}</button>
        ))}
        {row && <span className="text-slate-400">Last bar {row.date} · close {fmt(num(row, "close"))}</span>}
      </form>
      {loading ? <Loading what={sym} /> : !v ? <p className="text-sm text-slate-400">No stored prices for {sym}.</p> : (
        <>
          <CandleChart candles={v.candles} overlays={v.overlays} />
          <div className="grid gap-4 lg:grid-cols-2">
            <LineChart title="RSI (14)" series={v.rsi} hlines={lines} height={200} />
            <LineChart title="MACD (12, 26, 9)" series={v.macd} height={200} />
          </div>
        </>
      )}
      {row && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {GROUPS.map(([title, test]) => (
            <div key={title} className="rounded border border-slate-800 bg-slate-900 p-2">
              <h3 className="mb-1 text-sm font-semibold text-slate-300">{title}</h3>
              <table className="w-full text-xs"><tbody>
                {Object.keys(row).filter(test).map((k) => (
                  <tr key={k} className="border-t border-slate-800"><td className="text-slate-400">{k}</td><td className="text-right">{fmt(num(row, k), Math.abs(num(row, k) ?? 0) >= 1e6 ? 0 : 2)}</td></tr>
                ))}
              </tbody></table>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-500">Chart overlays are computed in the browser from stored OHLCV; the table shows the Python-computed snapshot (latest bar). Prices are as returned by Yuanta history.</p>
    </Page>
  );
}
