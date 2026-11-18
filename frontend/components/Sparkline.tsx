"use client";
import { useId } from "react";

/** Tiny dependency-free area sparkline. Colour follows `up` (emerald / rose) via currentColor. */
export default function Sparkline({ values, up, className = "" }: { values: number[]; up: boolean; className?: string }) {
  const gid = useId().replace(/:/g, "");
  if (values.length < 2) return <div className={className} />;
  const w = 120, h = 36, p = 2;
  const min = Math.min(...values), span = Math.max(...values) - min || 1;
  const pts = values.map((v, i) => `${(p + (i * (w - 2 * p)) / (values.length - 1)).toFixed(1)},${(h - p - ((v - min) / span) * (h - 2 * p)).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden className={`${up ? "text-emerald-500" : "text-rose-500"} ${className}`}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`${p},${h} ${pts.join(" ")} ${w - p},${h}`} fill={`url(#${gid})`} />
      <polyline points={pts.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
