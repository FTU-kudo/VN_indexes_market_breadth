// frontend/components/LineChart.tsx
"use client";
import { ColorType, createChart, ISeriesApi, LineStyle } from "lightweight-charts";
import { ReactNode, useEffect, useRef, useState } from "react";
import { useTheme } from "./ThemeProvider";

export type Pt = { time: string; value: number | null; color?: string };
export type Ser = { name: string; color: string; data: Pt[]; kind?: "line" | "hist"; width?: number; scale?: "left" | "right"; dashed?: boolean };

export const chartOptions = (height: number, dark = true) => ({
  height, autoSize: true,
  localization: { locale: "en-US" }, // month names etc. in English regardless of the browser language
  layout: { background: { type: ColorType.Solid, color: "rgba(0,0,0,0)" }, textColor: dark ? "#949caa" : "#5b6578" },
  grid: { vertLines: { color: dark ? "#242934" : "#e9ecf2" }, horzLines: { color: dark ? "#242934" : "#e9ecf2" } },
  rightPriceScale: { borderColor: dark ? "#333a47" : "#d6dbe3" }, timeScale: { borderColor: dark ? "#333a47" : "#d6dbe3", minBarSpacing: 0.02 },   // default 0.5 px cannot fit 16 years of daily bars: only a slice was shown
});

const NO_LINES: { value: number; color?: string }[] = [];

export default function LineChart({ series, height = 260, hlines = NO_LINES, title, actions, yBounds }: {
  series: Ser[]; height?: number; hlines?: { value: number; color?: string }[]; title?: string; actions?: ReactNode; yBounds?: { min?: number; max?: number };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const seriesRefs = useRef<Map<string, ISeriesApi<"Line" | "Histogram">>>(new Map());
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const { theme } = useTheme();

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, chartOptions(height, theme === "dark"));
    const map = new Map<string, ISeriesApi<"Line" | "Histogram">>();
    if (yBounds) chart.priceScale("right").applyOptions({ scaleMargins: { top: 0, bottom: 0 } });
    if (series.some((s) => s.scale === "left")) chart.applyOptions({ leftPriceScale: { visible: true, borderColor: theme === "dark" ? "#333a47" : "#d6dbe3" } });
    series.forEach((s, idx) => {
      // missing values become whitespace so gaps stay gaps (nulls used to be dropped and the line was drawn straight across them)
      const clean = s.data.map((p) => (p.value === null ? { time: p.time } : { time: p.time, value: p.value as number, ...(p.color ? { color: p.color } : {}) }));
      const visible = !hidden[s.name];
      if (s.kind === "hist") {
        const h = chart.addHistogramSeries({ color: s.color, visible, priceFormat: { type: "price", precision: 2, minMove: 0.01 } });
        h.setData(clean);
        map.set(s.name, h);
      } else {
        const l = chart.addLineSeries({ color: s.color, visible, lineWidth: (s.width ?? 2) as 1 | 2 | 3 | 4, priceLineVisible: false, priceScaleId: s.scale ?? "right", lineStyle: s.dashed ? LineStyle.Dashed : LineStyle.Solid });
        l.setData(clean);
        map.set(s.name, l);
        if (idx === 0) hlines.forEach((h) => l.createPriceLine({ price: h.value, color: h.color ?? "#475569", lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "" }));
      }
    });
    seriesRefs.current = map;
    chart.timeScale().fitContent();
    return () => { seriesRefs.current.clear(); chart.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, height, hlines, theme, yBounds]);

  useEffect(() => {
    seriesRefs.current.forEach((api, name) => {
      api.applyOptions({ visible: !hidden[name] });
    });
  }, [hidden]);

  const toggle = (name: string) => setHidden((prev) => ({ ...prev, [name]: !prev[name] }));

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        {title && <span className="mr-1 font-bold text-slate-100">{title}</span>}
        {series.map((s) => {
          const isHidden = !!hidden[s.name];
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
              {s.name}
            </button>
          );
        })}
        {actions && <div className="ml-auto">{actions}</div>}
      </div>
      <div ref={ref} style={{ height }} />
    </div>
  );
}
