"use client";
import { useMemo, useState } from "react";
import LineChart, { Ser } from "@/components/LineChart";
import { Loading, Page } from "@/components/Ui";
import { Columnar, fmt, num, Row, Status, tone, useJSON } from "@/lib/data";

const KEY = ["VNINDEX", "VN30", "VN100", "HNXINDEX", "HNX30", "UPCOMINDEX"];

export default function Overview() {
  const snap = useJSON<{ rows: Row[] }>("indicators/snapshot_indexes.json");
  const status = useJSON<Status>("monitor/status.json");
  const [sel, setSel] = useState("VNINDEX");
  const hist = useJSON<Columnar>(`indicators/indexes/${sel}.json`);

  const rows = useMemo(() => {
    const r = [...(snap.data?.rows ?? [])];
    const rank = (s: string) => (KEY.includes(s) ? KEY.indexOf(s) : 99);
    return r.sort((a, b) => rank(a.symbol) - rank(b.symbol) || a.symbol.localeCompare(b.symbol));
  }, [snap.data]);

  const series: Ser[] = useMemo(() => {
    if (!hist.data) return [];
    const mk = (name: string, color: string, k: string, width = 1): Ser => ({
      name, color, width, data: hist.data!.dates.map((t, i) => ({ time: t, value: hist.data!.series[k]?.[i] ?? null })),
    });
    return [mk("Close", "#e2e8f0", "close", 2), mk("SMA20", "#38bdf8", "sma_20"), mk("SMA50", "#f59e0b", "sma_50"), mk("SMA200", "#f43f5e", "sma_200")];
  }, [hist.data]);

  return (
    <Page title="Market overview">
      <p className="text-sm text-slate-400">
        Latest trading date: <b className="text-slate-200">{status.data?.latest_trading_date ?? "–"}</b> · {rows.length} indexes
      </p>
      {snap.loading ? <Loading what="indexes" /> : (
        <div className="overflow-x-auto rounded border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900"><tr>
              {["Index", "Close", "Chg %", "Volume", "SMA10", "SMA20", "SMA50", "SMA200", "RSI14", "MACD hist", "Date"].map((h) => <th key={h}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol} onClick={() => setSel(r.symbol)} className={`cursor-pointer border-t border-slate-800 hover:bg-slate-900 ${sel === r.symbol ? "bg-slate-900" : ""}`}>
                  <td className="font-medium text-sky-300">{r.symbol}</td>
                  <td>{fmt(num(r, "close"))}</td>
                  <td className={tone(num(r, "ret_1"))}>{fmt(num(r, "ret_1"))}</td>
                  <td>{fmt(num(r, "volume"), 0)}</td>
                  {["sma_10", "sma_20", "sma_50", "sma_200"].map((k) => (
                    <td key={k} className={num(r, k) === null ? "" : (num(r, "close") ?? 0) >= (num(r, k) as number) ? "text-emerald-400" : "text-rose-400"}>{fmt(num(r, k))}</td>
                  ))}
                  <td>{fmt(num(r, "rsi_14"), 1)}</td>
                  <td className={tone(num(r, "macd_hist"))}>{fmt(num(r, "macd_hist"))}</td>
                  <td className="text-slate-500">{r.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-500">Green/red SMA cells: close above/below that average. Click a row to chart it (last ~500 sessions).</p>
      {hist.loading ? <Loading what={sel} /> : hist.data ? <LineChart title={`${sel} – close & moving averages`} series={series} height={380} /> : <p className="text-sm text-slate-500">No history file for {sel}.</p>}
    </Page>
  );
}
