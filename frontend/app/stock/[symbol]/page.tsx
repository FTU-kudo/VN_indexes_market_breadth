// frontend/app/stock/[symbol]/page.tsx
"use client";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import CandleChart, { Candle } from "@/components/CandleChart";
import LineChart, { Pt, Ser } from "@/components/LineChart";
import FundamentalView from "@/components/FundamentalView";
import { Loading, Page } from "@/components/Ui";
import { fmt, num, PriceYear, Row, tone, useJSON } from "@/lib/data";
import { loadPrices } from "@/lib/prices";
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

function StockInner() {
  const view = useSearchParams().get("view") === "fundamental" ? "fundamental" : "technical";
  const { symbol } = useParams<{ symbol: string }>();
  const sym = decodeURIComponent(symbol).toUpperCase();
  const router = useRouter();
  const [q, setQ] = useState(sym);
  const [range, setRange] = useState(252);
  const [px, setPx] = useState<{ bars: PriceYear; kind: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const snap = useJSON<{ rows: Row[] }>("indicators/snapshot_stocks.json");
  const snapIdx = useJSON<{ rows: Row[] }>("indicators/snapshot_indexes.json");
  const valn = useJSON<{ rows: { symbol: string; pe: number | null; pb: number | null; group: string }[] }>("valuation/snapshot.json");

  useEffect(() => {
    let live = true;
    setLoading(true); setQ(sym);
    loadPrices(sym).then((r) => { if (live) { setPx(r); setLoading(false); } });
    return () => { live = false; };
  }, [sym]);

  const row = useMemo(() => (snap.data?.rows.find((r) => r.symbol === sym) ?? snapIdx.data?.rows.find((r) => r.symbol === sym)), [snap.data, snapIdx.data, sym]);

  const vrow = useMemo(() => valn.data?.rows.find((r) => r.symbol === sym), [valn.data, sym]);
  const bar = useMemo(() => {
    if (!px) return null;
    const b = px.bars, i = b.d.length - 1;
    if (i < 0) return null;
    const prev = i > 0 ? b.c[i - 1] : null;
    return { date: b.d[i], o: b.o[i], h: b.h[i], l: b.l[i], c: b.c[i], v: b.v[i], chg: prev ? b.c[i] - prev : null, pct: prev ? (b.c[i] / prev - 1) * 100 : null };
  }, [px]);

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
    <Page title={`${view === "fundamental" ? "Fundamental analysis" : "Stock analysis"} – ${sym}`}>
      <form className="flex flex-wrap items-center gap-2 text-sm" onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/stock/${q.trim().toUpperCase()}${view === "fundamental" ? "?view=fundamental" : ""}`); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} className="w-28 uppercase" aria-label="Ticker" />
        <button className="rounded bg-sky-600 px-3 py-1 text-white">Go</button>
        {view === "technical" && RANGES.map(([l, n]) => (
          <button type="button" key={l} onClick={() => setRange(n)} className={`rounded px-2 py-1 ${range === n ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300"}`}>{l}</button>
        ))}
        <div role="tablist" aria-label="Analysis type" className="ml-2 flex rounded-lg border border-slate-800 bg-slate-900 p-0.5">
          {([["technical", "Technical"], ["fundamental", "Fundamental"]] as const).map(([k, l]) => (
            <button type="button" role="tab" key={k} aria-selected={view === k} onClick={() => router.replace(k === "fundamental" ? `/stock/${sym}?view=fundamental` : `/stock/${sym}`)}
              className={`rounded-md px-3 py-1 ${view === k ? "bg-sky-600 text-white" : "text-slate-400 hover:text-slate-100"}`}>{l}</button>
          ))}
        </div>
      </form>
      {bar && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="text-slate-400">Latest bar <b className="text-slate-200">{bar.date}</b></span>
          {([["O", bar.o], ["H", bar.h], ["L", bar.l], ["C", bar.c]] as [string, number][]).map(([k, x]) => (
            <span key={k} className="text-slate-400">{k} <b className="tabular-nums text-slate-100">{fmt(x, 2)}</b></span>
          ))}
          {bar.chg !== null && bar.pct !== null && (
            <span className={`font-semibold tabular-nums ${tone(bar.chg)}`}>{bar.chg > 0 ? "+" : bar.chg < 0 ? "−" : ""}{Math.abs(bar.chg).toFixed(2)} / {bar.pct > 0 ? "+" : bar.pct < 0 ? "−" : ""}{Math.abs(bar.pct).toFixed(2)}%</span>
          )}
          <span className="text-slate-400">Vol <b className="tabular-nums text-slate-100">{new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(bar.v)}</b></span>
          {vrow && <span className="text-slate-400">P/E <b className="tabular-nums text-slate-100">{fmt(vrow.pe)}</b> · P/B <b className="tabular-nums text-slate-100">{fmt(vrow.pb)}</b></span>}
          
        </div>
      )}
      {view === "fundamental" ? <FundamentalView sym={sym} /> : <>
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
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold text-slate-100">Technical Indicator Breakdown</h2>
            <span className="rounded border border-slate-700/80 bg-slate-950 px-2.5 py-0.5 text-xs font-medium tabular-nums text-slate-400">
              Latest session: {row.date}
            </span>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {GROUPS.map(([title, test]) => {
              const keys = Object.keys(row).filter(test);
              const close = num(row, "close");
              const isMa = title === "Moving averages";
              const aboveCount = isMa && close !== null ? keys.filter((k) => { const v = num(row, k); return v !== null && close > v; }).length : 0;
              const isPerf = title.startsWith("Performance");
              const absKeys = isPerf ? keys.filter((k) => !k.startsWith("rs_")) : keys;
              const rsKeys = isPerf ? keys.filter((k) => k.startsWith("rs_")) : [];
              return (
                <div key={title} className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-sm">
                  <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/80 px-4 py-2.5">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">{title}</h3>
                    {isMa && close !== null && (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold tabular-nums text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                        {aboveCount}/{keys.length} Above
                      </span>
                    )}
                  </div>
                  <table className="w-full text-xs">
                    <tbody>
                      {absKeys.map((k) => <IndicatorRow key={k} k={k} v={num(row, k)} close={close} />)}
                      {isPerf && rsKeys.length > 0 && (
                        <>
                          <tr className="border-t border-slate-800 bg-slate-950/60">
                            <td colSpan={2} className="px-4 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Relative Strength vs VNINDEX</td>
                          </tr>
                          {rsKeys.map((k) => <IndicatorRow key={k} k={k} v={num(row, k)} close={close} />)}
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </section>
      )}
      </>}
    </Page>
  );
}

const LABELS: Record<string, string> = {
  sma_5: "SMA (5)", ema_5: "EMA (5)", sma_10: "SMA (10)", ema_10: "EMA (10)",
  sma_20: "SMA (20)", ema_20: "EMA (20)", sma_50: "SMA (50)", ema_50: "EMA (50)",
  sma_100: "SMA (100)", ema_100: "EMA (100)", sma_200: "SMA (200)", ema_200: "EMA (200)",
  rsi_6: "RSI (6)", rsi_9: "RSI (9)", rsi_14: "RSI (14)", rsi_21: "RSI (21)",
  macd: "MACD Line (12, 26)", macd_signal: "MACD Signal (9)", macd_hist: "MACD Histogram",
  stoch_k: "Stochastic %K", stoch_d: "Stochastic %D", willr_14: "Williams %R (14)", roc_12: "ROC (12)",
  adx_14: "ADX (14)", plus_di_14: "+DI (14)", minus_di_14: "-DI (14)",
  psar: "Parabolic SAR", psar_dir: "PSAR Direction", supertrend: "Supertrend", supertrend_dir: "Supertrend Direction",
  ichi_tenkan: "Ichimoku Tenkan-sen", ichi_kijun: "Ichimoku Kijun-sen", ichi_senkou_a: "Ichimoku Senkou Span A", ichi_senkou_b: "Ichimoku Senkou Span B",
  atr_14: "ATR (14)", bb_mid: "Bollinger Middle (20)", bb_upper: "Bollinger Upper", bb_lower: "Bollinger Lower",
  bb_width: "Bollinger Band Width", bb_pctb: "Bollinger %B", hv_20: "Historical Vol (20D)", hv_60: "Historical Vol (60D)",
  drawdown: "Current Drawdown", max_dd_252: "Max Drawdown (252D)",
  volume: "Session Volume", obv: "On-Balance Volume (OBV)", vol_sma_10: "Volume SMA (10)",
  vol_sma_20: "Volume SMA (20)", vol_sma_50: "Volume SMA (50)", vol_ratio_20: "Volume Ratio (vs 20D)",
  mfi_14: "Money Flow Index (14)", ad_line: "Accumulation / Distribution",
  ret_1: "Return 1D", perf_5: "Return 5D", perf_10: "Return 10D", perf_20: "Return 20D",
  perf_50: "Return 50D", perf_100: "Return 100D", perf_200: "Return 200D",
  rs_ratio: "RS Ratio vs VNINDEX", rs_5: "RS 5D vs VNINDEX", rs_10: "RS 10D vs VNINDEX",
  rs_20: "RS 20D vs VNINDEX", rs_50: "RS 50D vs VNINDEX", rs_100: "RS 100D vs VNINDEX", rs_200: "RS 200D vs VNINDEX",
};
const humanize = (k: string) => LABELS[k] ?? k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function IndicatorRow({ k, v, close }: { k: string; v: number | null; close: number | null }) {
  const label = humanize(k);
  const valStr = fmt(v, Math.abs(v ?? 0) >= 1e6 ? 0 : 2);
  let badge: React.ReactNode = null;
  let valCls = "text-slate-100";

  if (v !== null) {
    if (/^(sma|ema)_/.test(k) && close !== null) {
      const above = close > v;
      badge = (
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${above ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" : "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"}`}>
          {above ? "Above" : "Below"}
        </span>
      );
    } else if (/^(rsi|stoch)_/.test(k)) {
      const [txt, cls] = v >= 70 ? ["Overbought", "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"]
        : v <= 30 ? ["Oversold", "bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300"]
        : ["Neutral", "bg-slate-950 text-slate-400"];
      badge = <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>{txt}</span>;
    } else if (k === "macd_hist" || k === "roc_12" || k === "ret_1" || k.startsWith("perf_") || k.startsWith("rs_")) {
      valCls = v > 0 ? "text-emerald-600 dark:text-emerald-400" : v < 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-400";
    } else if (k === "psar_dir" || k === "supertrend_dir") {
      const bull = v > 0;
      return (
        <tr className="border-t border-slate-800">
          <td className="px-4 py-1.5 text-slate-400">{label}</td>
          <td className="px-4 py-1.5 text-right">
            <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold ${bull ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" : "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"}`}>
              {bull ? "Bullish ▲" : "Bearish ▼"}
            </span>
          </td>
        </tr>
      );
    } else if (k === "drawdown" || k === "max_dd_252") {
      if (v < 0) valCls = "text-rose-600 dark:text-rose-400";
    } else if (k === "bb_pctb") {
      const pct = Math.max(0, Math.min(100, v * 100));
      badge = (
        <span className="inline-block h-1.5 w-12 overflow-hidden rounded-full bg-slate-800 align-middle" title={`${pct.toFixed(0)}%`}>
          <span className="block h-full bg-sky-500" style={{ width: `${pct}%` }} />
        </span>
      );
    } else if (k === "vol_ratio_20") {
      if (v >= 1.5) badge = <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">High Vol</span>;
      else if (v < 0.7) badge = <span className="rounded bg-slate-950 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">Low Vol</span>;
    }
  }

  return (
    <tr className="border-t border-slate-800">
      <td className="px-4 py-1.5 text-slate-400">{label}</td>
      <td className="px-4 py-1.5 text-right tabular-nums">
        <span className="inline-flex items-center justify-end gap-2">
          {badge}
          <span className={`font-medium ${valCls}`}>{valStr}</span>
        </span>
      </td>
    </tr>
  );
}

export default function StockPage() {
  return <Suspense fallback={<Page title="Stock analysis"><Loading what="page" /></Page>}><StockInner /></Suspense>;
}
