"use client";
import { ColorType, createChart, LineStyle } from "lightweight-charts";
import { useEffect, useRef } from "react";
import { useTheme } from "./ThemeProvider";

export type Pt = { time: string; value: number | null; color?: string };
export type Ser = { name: string; color: string; data: Pt[]; kind?: "line" | "hist"; width?: number };

export const chartOptions = (height: number, dark = true) => ({
  height, autoSize: true,
  layout: { background: { type: ColorType.Solid, color: "rgba(0,0,0,0)" }, textColor: dark ? "#949caa" : "#5b6578" },
  grid: { vertLines: { color: dark ? "#242934" : "#e9ecf2" }, horzLines: { color: dark ? "#242934" : "#e9ecf2" } },
  rightPriceScale: { borderColor: dark ? "#333a47" : "#d6dbe3" }, timeScale: { borderColor: dark ? "#333a47" : "#d6dbe3" },
});

const NO_LINES: { value: number; color?: string }[] = [];

export default function LineChart({ series, height = 260, hlines = NO_LINES, title }: {
  series: Ser[]; height?: number; hlines?: { value: number; color?: string }[]; title?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, chartOptions(height, theme === "dark"));
    series.forEach((s, idx) => {
      const clean = s.data.filter((p) => p.value !== null).map((p) => ({ time: p.time, value: p.value as number, ...(p.color ? { color: p.color } : {}) }));
      if (s.kind === "hist") {
        chart.addHistogramSeries({ color: s.color, priceFormat: { type: "price", precision: 2, minMove: 0.01 } }).setData(clean);
      } else {
        const l = chart.addLineSeries({ color: s.color, lineWidth: (s.width ?? 2) as 1 | 2 | 3 | 4, priceLineVisible: false });
        l.setData(clean);
        if (idx === 0) hlines.forEach((h) => l.createPriceLine({ price: h.value, color: h.color ?? "#475569", lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "" }));
      }
    });
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [series, height, hlines, theme]);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-2">
      <div className="mb-1 flex flex-wrap items-center gap-3 text-xs">
        {title && <span className="font-semibold text-slate-200">{title}</span>}
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1 text-slate-400">
            <i className="inline-block h-2 w-3 rounded-sm" style={{ background: s.color }} />{s.name}
          </span>
        ))}
      </div>
      <div ref={ref} style={{ height }} />
    </div>
  );
}
