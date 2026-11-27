// frontend/components/CandleChart.tsx
"use client";
import { createChart, ISeriesApi, Time } from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { chartOptions, Ser } from "./LineChart";
import { useTheme } from "./ThemeProvider";

export type Candle = { time: string; open: number; high: number; low: number; close: number; volume: number };

function formatTime(t: Time): string {
  if (typeof t === "string") return t;
  if (typeof t === "number") return new Date(t * 1000).toISOString().slice(0, 10);
  return `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
}

export default function CandleChart({ candles, overlays, height = 420 }: { candles: Candle[]; overlays: Ser[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const overlayRefs = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [hover, setHover] = useState<{ date: string; vals: Record<string, number | null> } | null>(null);
  const { theme } = useTheme();

  const latest = useMemo(() => {
    const vals: Record<string, number | null> = {};
    for (const o of overlays) {
      for (let i = o.data.length - 1; i >= 0; i--) {
        if (o.data[i].value !== null) {
          vals[o.name] = o.data[i].value;
          break;
        }
      }
    }
    const date = candles.length ? candles[candles.length - 1].time : "";
    return { date, vals };
  }, [candles, overlays]);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, chartOptions(height, theme === "dark"));
    const cs = chart.addCandlestickSeries({ upColor: "#10b981", downColor: "#f43f5e", wickUpColor: "#10b981", wickDownColor: "#f43f5e", borderVisible: false });
    cs.setData(candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    const vol = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol" });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    vol.setData(candles.map((c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? "#10b98155" : "#f43f5e55" })));

    const map = new Map<string, ISeriesApi<"Line">>();
    overlays.forEach((o) => {
      const l = chart.addLineSeries({ color: o.color, visible: !hidden[o.name], lineWidth: (o.width ?? 1) as 1 | 2 | 3 | 4, priceLineVisible: false, lastValueVisible: false });
      l.setData(o.data.filter((p) => p.value !== null).map((p) => ({ time: p.time, value: p.value as number })));
      map.set(o.name, l);
    });
    overlayRefs.current = map;
    chart.timeScale().fitContent();

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData.size) {
        setHover(null);
        return;
      }
      const vals: Record<string, number | null> = {};
      map.forEach((api, name) => {
        const d = param.seriesData.get(api);
        vals[name] = d && "value" in d && typeof d.value === "number" ? d.value : null;
      });
      setHover({ date: formatTime(param.time), vals });
    });

    return () => { overlayRefs.current.clear(); setHover(null); chart.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, overlays, height, theme]);

  useEffect(() => {
    overlayRefs.current.forEach((api, name) => {
      api.applyOptions({ visible: !hidden[name] });
    });
  }, [hidden]);

  const toggle = (name: string) => setHidden((prev) => ({ ...prev, [name]: !prev[name] }));
  const activeVals = hover ? hover.vals : latest.vals;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 shadow-sm">
      <div className="mb-2 flex min-h-[26px] flex-wrap items-center gap-1.5 text-xs">
        {hover ? (
          <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-blue-900 dark:border-blue-800/80 dark:bg-blue-950/80 dark:text-blue-100">
            {hover.date}
          </span>
        ) : latest.date ? (
          <span className="rounded border border-slate-700/80 bg-slate-950 px-2 py-0.5 text-[11px] font-medium tabular-nums text-slate-400">
            Latest: {latest.date}
          </span>
        ) : null}
        {overlays.map((s) => {
          const isHidden = !!hidden[s.name];
          const val = activeVals[s.name];
          return (
            <button
              key={s.name}
              type="button"
              onClick={() => toggle(s.name)}
              aria-pressed={!isHidden}
              title="Click to show/hide"
              className={`inline-flex cursor-pointer select-none items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-all ${
                isHidden
                  ? "border-slate-800 bg-slate-900 font-medium text-slate-500 line-through hover:border-slate-700 hover:text-slate-300"
                  : "border-slate-700 bg-slate-950 font-semibold text-slate-100 hover:border-slate-600"
              }`}
            >
              <i className={`inline-block h-2 w-2.5 rounded-sm transition-opacity ${isHidden ? "opacity-35" : ""}`} style={{ background: s.color }} aria-hidden />
              <span>{s.name}</span>
              {!isHidden && val !== null && val !== undefined && (
                <span className="tabular-nums text-slate-400">: {val.toFixed(2)}</span>
              )}
            </button>
          );
        })}
      </div>
      <div ref={ref} style={{ height }} />
    </div>
  );
}
