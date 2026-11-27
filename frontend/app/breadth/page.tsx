// frontend/app/breadth/page.tsx
"use client";
import { Info } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import LineChart, { Ser } from "@/components/LineChart";
import { Loading, Page } from "@/components/Ui";
import { Columnar, fmt, useJSON } from "@/lib/data";

type Group = { id: string; label: string; kind: string; n_members: number; last_date: string; composite: number | null; above_50_pct: number | null };
type Breadth = Columnar & { id: string; label: string; membership_basis: string; n_members: number; n_members_with_prices: number; composite_weights: Record<string, number> };
const RANGES: [string, number][] = [["6M", 126], ["1Y", 252], ["3Y", 756], ["All", 1e9]];
const KIND_LABEL: Record<string, string> = { market: "Market", exchange: "Exchanges", index: "Indexes" };

export default function BreadthPage() {
  const list = useJSON<{ groups: Group[]; membership_basis: string }>("breadth/index.json");
  const [gid, setGid] = useState("HOSE"); // default group
  const [range, setRange] = useState(252);
  const [hlWin, setHlWin] = useState("52w");
  const b = useJSON<Breadth>(`breadth/${gid}.json`);

  const s = useMemo(() => {
    if (!b.data) return null;
    const from = Math.max(0, b.data.dates.length - range);
    const dates = b.data.dates.slice(from);
    const mk = (name: string, color: string, k: string, extra: Partial<Ser> = {}): Ser => ({
      name, color, ...extra, data: dates.map((t, i) => ({ time: t, value: b.data!.series[k]?.slice(from)[i] ?? null })),
    });
    return {
      ma: [mk("> MA10", "#a78bfa", "above_10_pct"), mk("> MA20", "#38bdf8", "above_20_pct"), mk("> MA50", "#f59e0b", "above_50_pct"), mk("> MA200", "#f43f5e", "above_200_pct")],
      ad: [mk("A/D Line", "#34d399", "ad_line")],
      hl: [mk(`New ${hlWin} highs`, "#10b981", `hi${hlWin}`), mk(`New ${hlWin} lows`, "#f43f5e", `lo${hlWin}`)],
      score: [mk("Composite", "#fbbf24", "composite", { width: 3 }), mk("MA", "#38bdf8", "score_ma", { width: 1 }), mk("A/D", "#34d399", "score_ad", { width: 1 }), mk("HI/LO", "#a78bfa", "score_hl", { width: 1 }), mk("MACD", "#fb7185", "score_macd", { width: 1 }), mk("RSI", "#94a3b8", "score_rsi", { width: 1 })],
      part: [mk("% Up (1D)", "#38bdf8", "pct_up_1d", { width: 1 }), mk("% MACD Bull", "#34d399", "pct_macd_bull"), mk("% RSI > 50", "#f59e0b", "pct_rsi_gt50"), mk("% RSI > 70", "#f43f5e", "pct_rsi_gt70", { width: 1 }), mk("% RSI < 30", "#a78bfa", "pct_rsi_lt30", { width: 1 })],
    };
  }, [b.data, range, hlWin]);

  const last = (k: string) => b.data?.series[k]?.[b.data.dates.length - 1] ?? null;
  const groups = list.data?.groups ?? [];
  // if the default group is not in the data (e.g. before the first run), fall back to the whole market
  useEffect(() => {
    if (groups.length && !groups.some((g) => g.id === gid)) setGid(groups.find((g) => g.id === "MARKET")?.id ?? groups[0].id);
  }, [groups, gid]);
  const lines50 = useMemo(() => [{ value: 50 }], []);
  const lines3070 = useMemo(() => [{ value: 30, color: "#f43f5e" }, { value: 70, color: "#10b981" }], []);

  return (
    <Page title="Market breadth">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <select value={gid} onChange={(e) => setGid(e.target.value)}>
          {["market", "exchange", "index"].map((k) => (
            <optgroup key={k} label={KIND_LABEL[k]}>
              {groups.filter((g) => g.kind === k).map((g) => <option key={g.id} value={g.id}>{g.id} ({g.n_members})</option>)}
            </optgroup>
          ))}
        </select>
        <div className="flex gap-1">{RANGES.map(([l, n]) => (
          <button key={l} onClick={() => setRange(n)} className={`rounded px-2 py-1 ${range === n ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300"}`}>{l}</button>
        ))}</div>
      </div>
      <p className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
        <Info className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        <span>Survivorship bias: {list.data?.membership_basis ?? "membership uses current constituents"}.</span>
      </p>
      {b.loading || !s ? <Loading what="breadth" /> : (
        <>
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
            {([
              ["Composite", last("composite"), 1, "border-t-2 border-t-blue-600", "text-slate-100"],
              ["% > MA50", last("above_50_pct"), 1, "", "text-slate-100"],
              ["% > MA200", last("above_200_pct"), 1, "", "text-slate-100"],
              ["Advancing", last("adv"), 0, "border-t-2 border-t-emerald-500", "text-emerald-600 dark:text-emerald-400"],
              ["Declining", last("dec"), 0, "border-t-2 border-t-rose-500", "text-rose-600 dark:text-rose-400"],
            ] as const).map(([l, v, d, borderCls, valCls]) => (
              <div key={l} className={`rounded-xl border border-slate-800 ${borderCls} bg-slate-900 p-3 shadow-sm`}>
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{l}</div>
                <div className={`mt-1 text-2xl font-extrabold tabular-nums ${valCls}`}>{fmt(v, d)}</div>
              </div>
            ))}
          </div>
          <LineChart title="% of stocks above moving average" series={s.ma} hlines={lines50} />
          <div className="grid gap-4 lg:grid-cols-2">
            <LineChart title="Advance–Decline line (cumulative net advances)" series={s.ad} />
            <LineChart title="New highs vs new lows (count)" series={s.hl} actions={
              <select value={hlWin} onChange={(e) => setHlWin(e.target.value)} aria-label="Highs/lows window" className="py-0.5 text-xs">
              <option value="20">20-day</option><option value="50">50-day</option><option value="52w">52-week</option>
            </select>
            } />
          </div>
          <LineChart title={`Composite breadth score (Weights: ${Object.entries(b.data!.composite_weights).map(([k, v]) => `${k === "hl" ? "HI/LO" : k === "ad" ? "A/D" : k.toUpperCase()} ${Number(v).toFixed(2)}`).join(" · ")})`} series={s.score} hlines={lines3070} height={300} />
          <LineChart title="Participation (% of stocks)" series={s.part} hlines={lines50} />
        </>
      )}
    </Page>
  );
}
