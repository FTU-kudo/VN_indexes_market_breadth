import { useEffect, useState } from "react";

export const BASE = (process.env.NEXT_PUBLIC_DATA_BASE_URL || "").replace(/\/$/, "");

export type Row = { symbol: string; date: string; [k: string]: number | string | null };
export type Status = {
  latest_trading_date: string | null; last_data_change_utc: string | null;
  n_indexes: number; n_stocks: number;
  universe?: { indexes_listed: number; symbols_listed: number; symbol_types: Record<string, number>; equity_types_used: string[] };
  collect?: Record<string, number>;
  failures?: { symbol: string; kind: string; error: string }[];
};
export type Validation = {
  series_checked: number; series_with_errors: number; series_with_warnings: number; series_stale_over_10d: number;
  fatal: string[]; issues: { symbol: string; level: string; msg: string }[];
};
export type StockInfo = { symbol: string; exchange: string | null; type: string | null; indexes: string[] };
export type Columnar = { dates: string[]; series: Record<string, (number | null)[]> };
export type PriceYear = { d: string[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] };

export async function getJSON<T>(path: string): Promise<T | null> {
  if (!BASE) return null;
  try {
    const r = await fetch(`${BASE}/${path}`);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export function useJSON<T>(path: string | null): { data: T | null; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  useEffect(() => {
    let live = true;
    if (!path) { setData(null); setLoading(false); return; }
    setLoading(true);
    getJSON<T>(path).then((d) => { if (live) { setData(d); setLoading(false); } });
    return () => { live = false; };
  }, [path]);
  return { data, loading };
}

export const num = (r: Row | undefined | null, k: string): number | null => {
  const v = r?.[k];
  return typeof v === "number" ? v : null;
};
export const fmt = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined ? "–" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const tone = (v: number | null | undefined) =>
  v === null || v === undefined || v === 0 ? "" : v > 0 ? "text-emerald-400" : "text-rose-400";
