// frontend/components/LineChart.tsx
"use client";
import { ColorType, createChart, ISeriesApi, LineStyle, Time } from "lightweight-charts";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
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

function formatTime(t: Time): string {
  if (typeof t === "string") return t;
  if (typeof t === "number") return new Date(t * 1000).toISOString().slice(0, 10);
  return `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
}

function formatVal(name: string, v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  if (name.includes("%") || name.startsWith("> MA")) return `${v.toFixed(2)}%`;
  if (Math.abs(v) >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (Number.isInteger(v)) return v.toLocaleString("en-US");
  return v.toFixed(2);
}

export default function LineChart({ series, height = 260, hlines = NO_LINES, title, actions, yBounds }: {
  series: Ser[]; height?: number; hlines?: { value: number; color?: string }[]; title?: string; actions?: ReactNode; yBounds?: { min?: number; max?: number };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const seriesRefs = useRef<Map<string, ISeriesApi<"Line" | "Histogram">>>(new Map());
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [hover, setHover] = useState<{ date: string; vals: Record<string, number | null> } | null>(null);
  const { theme } = useTheme();

  const latest = useMemo(() => {
    const vals: Record<string, number | null> = {};
    let date = "";
    for (const s of series) {
      for (let i = s.data.length - 1; i >= 0; i--) {
        if (s.data[i].value !== null) {
          vals[s.name] = s.data[i].value;
          if (!date || s.data[i].time > date) date = s.data[i].time;
          break;
        }
      }
    }
    return { date, vals };
  }, [series]);

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
        const l = chart.addLineSeries({
          color: s.color,
          visible,
          lineWidth: (s.width ?? 2) as 1 | 2 | 3 | 4,
          priceLineVisible: false,
          priceScaleId: s.scale ?? "right",
          lineStyle: s.dashed ? LineStyle.Dashed : LineStyle.Solid,
          ...(yBounds ? {
            autoscaleInfoProvider: (original: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
              const res = original();
              if (!res) return null;
              return {
                priceRange: {
                  minValue: yBounds.min ?? res.priceRange.minValue,
                  maxValue: yBounds.max ?? res.priceRange.maxValue,
                },
              };
            },
          } : {}),
        });
        l.setData(clean);
        map.set(s.name, l);
        if (idx === 0) hlines.forEach((h) => l.createPriceLine({ price: h.value, color: h.color ?? "#475569", lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "" }));
      }
    });
    seriesRefs.current = map;
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

    return () => { seriesRefs.current.clear(); setHover(null); chart.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, height, hlines, theme, yBounds]);

  useEffect(() => {
    seriesRefs.current.forEach((api, name) => {
      api.applyOptions({ visible: !hidden[name] });
    });
  }, [hidden]);

  const toggle = (name: string) => setHidden((prev) => ({ ...prev, [name]: !prev[name] }));
  const activeVals = hover ? hover.vals : latest.vals;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        {title && <span className="mr-1 font-bold text-slate-100">{title}</span>}
        {hover ? (
          <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-blue-900 dark:border-blue-800/80 dark:bg-blue-950/80 dark:text-blue-100">
            {hover.date}
          </span>
        ) : latest.date ? (
          <span className="rounded border border-slate-700/80 bg-slate-950 px-2 py-0.5 text-[11px] font-medium tabular-nums text-slate-400">
            Latest: {latest.date}
          </span>
        ) : null}
        {series.map((s) => {
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
              {!isHidden && val !== undefined && (
                <span className="tabular-nums text-slate-400">: {formatVal(s.name, val)}</span>
              )}
            </button>
          );
        })}
        {actions && <div className="ml-auto">{actions}</div>}
      </div>
      <div ref={ref} style={{ height }} />
    </div>
  );
}
