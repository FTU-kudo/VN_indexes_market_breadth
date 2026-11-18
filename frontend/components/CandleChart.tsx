"use client";
import { createChart } from "lightweight-charts";
import { useEffect, useRef } from "react";
import { chartOptions, Ser } from "./LineChart";

export type Candle = { time: string; open: number; high: number; low: number; close: number; volume: number };

export default function CandleChart({ candles, overlays, height = 420 }: { candles: Candle[]; overlays: Ser[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, chartOptions(height));
    const cs = chart.addCandlestickSeries({ upColor: "#10b981", downColor: "#f43f5e", wickUpColor: "#10b981", wickDownColor: "#f43f5e", borderVisible: false });
    cs.setData(candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    const vol = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol" });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    vol.setData(candles.map((c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? "#10b98155" : "#f43f5e55" })));
    overlays.forEach((o) => {
      const l = chart.addLineSeries({ color: o.color, lineWidth: (o.width ?? 1) as 1 | 2 | 3 | 4, priceLineVisible: false, lastValueVisible: false });
      l.setData(o.data.filter((p) => p.value !== null).map((p) => ({ time: p.time, value: p.value as number })));
    });
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [candles, overlays, height]);
  return (
    <div className="rounded border border-slate-800 bg-slate-900 p-2">
      <div className="mb-1 flex flex-wrap gap-3 text-xs text-slate-400">
        {overlays.map((s) => (
          <span key={s.name} className="flex items-center gap-1"><i className="inline-block h-2 w-3 rounded-sm" style={{ background: s.color }} />{s.name}</span>
        ))}
      </div>
      <div ref={ref} style={{ height }} />
    </div>
  );
}
