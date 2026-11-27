// frontend/components/FundamentalView.tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import LineChart, { Pt, Ser } from "@/components/LineChart";
import { useTheme } from "@/components/ThemeProvider";
import { Loading } from "@/components/Ui";
import { fmt, PriceYear, useJSON } from "@/lib/data";
import { loadPrices } from "@/lib/prices";
import { prepareFilings, Quarter, valuationSeries } from "@/lib/valuation";

type Stmt = { periods: { y: number; q: number; end: string }[]; reports: Record<string, { id: number | null; vi: string | null; en: string | null; v: (number | null)[] }[]> };
type Fund = { quarters: Quarter[] };
type SnapRow = { symbol: string; exchange: string | null; sector: string; industry: string; group: string; close_vnd: number | null; mcap: number | null; pe: number | null; pb: number | null };
type Scope = { dates: string[]; series: Record<string, (number | null)[]>; parts: Record<string, Record<string, (number | null)[]>> };

const TABS: [string, string][] = [["KQKD", "Income statement"], ["CDKT", "Balance sheet"], ["LCTT", "Cash flow"], ["CSTC", "Financial ratios"]];
const RANGES: [string, number][] = [["1Y", 252], ["3Y", 756], ["5Y", 1260], ["All", 1e9]];
const num0 = (v: number | null, d = 1) => (v === null ? "–" : v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }));
const bn = (v: number | null) => (v === null ? "–" : (v / 1e9).toLocaleString("en-US", { maximumFractionDigits: 0 }));
const neg = "text-rose-600 dark:text-rose-400", pos = "text-emerald-600 dark:text-emerald-400";

const Card = ({ l, v, n }: { l: string; v: string; n?: string }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
    <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{l}</div>
    <div className="mt-0.5 text-xl font-semibold tabular-nums text-slate-100">{v}</div>
    {n && <div className="text-[11px] text-slate-500">{n}</div>}
  </div>
);

function StatementTable({ stmt, report, count, filter }: { stmt: Stmt; report: string; count: number; filter: string }) {
  const lines = stmt.reports[report] ?? [];
  const money = report !== "CSTC";                           // statements are in VND million -> shown in VND billion; ratios as provided
  const order = stmt.periods.map((_, i) => i).reverse().slice(0, count);   // newest first
  const idxOf = new Map(stmt.periods.map((p, i) => [`${p.y}Q${p.q}`, i]));
  const f = filter.trim().toLowerCase();
  const show = lines.filter((l) => !f || `${l.vi ?? ""} ${l.en ?? ""}`.toLowerCase().includes(f));
  const cell = (v: number | null) => (v === null ? "–" : money ? (v / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 }) : v.toLocaleString("en-US", { maximumFractionDigits: 2 }));
  const latest = stmt.periods[order[0]];
  return (
    <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-800">
      <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm tabular-nums">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-20 min-w-[260px] border-b border-r border-slate-800 bg-slate-900 px-3 py-2">{money ? "VND billion" : "As provided"}</th>
            {money && latest && <th className="sticky top-0 z-10 border-b border-slate-800 bg-slate-900 px-3 py-2 text-right" title={`Change of Q${latest.q} ${latest.y} vs Q${latest.q} ${latest.y - 1}`}>YoY</th>}
            {order.map((i) => <th key={i} className="sticky top-0 z-10 border-b border-slate-800 bg-slate-900 px-3 py-2 text-right">Q{stmt.periods[i].q} {stmt.periods[i].y}</th>)}
          </tr>
        </thead>
        <tbody>
          {show.map((l, k) => {
            const a = latest ? l.v[order[0]] : null, j = latest ? idxOf.get(`${latest.y - 1}Q${latest.q}`) : undefined, b = j === undefined ? null : l.v[j];
            const yoy = a !== null && b !== null && b > 0 ? (a / b - 1) * 100 : null;
            return (
              <tr key={`${l.id}-${k}`} className="odd:bg-slate-950 even:bg-slate-900">
                <td className="sticky left-0 z-10 border-r border-slate-800 bg-inherit px-3 py-1.5">
                  <div className="text-slate-100">{l.vi || l.en}</div>
                  {l.vi && l.en && <div className="text-[11px] text-slate-500">{l.en}</div>}
                </td>
                {money && <td className={`px-3 py-1.5 text-right ${yoy === null ? "text-slate-500" : yoy >= 0 ? pos : neg}`}>{yoy === null ? "–" : `${yoy > 0 ? "+" : "−"}${Math.abs(yoy).toFixed(1)}%`}</td>}
                {order.map((i) => { const v = l.v[i]; return <td key={i} className={`px-3 py-1.5 text-right ${v !== null && v < 0 ? neg : "text-slate-200"}`}>{cell(v)}</td>; })}
              </tr>
            );
          })}
          {show.length === 0 && <tr><td colSpan={order.length + 2} className="px-3 py-8 text-center text-slate-500">No line items match.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** Valuation history, key metrics and the full financial statements of one stock (used inside the Stock analysis page). */
export default function FundamentalView({ sym }: { sym: string }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [range, setRange] = useState(1e9);
  const [tab, setTab] = useState("KQKD");
  const [count, setCount] = useState(8);
  const [filter, setFilter] = useState("");
  const [px, setPx] = useState<{ bars: PriceYear; kind: string } | null>(null);
  const [pxLoading, setPxLoading] = useState(true);
  const fund = useJSON<Fund>(`fundamentals/${sym}.json`);
  const stmt = useJSON<Stmt>(`statements/${sym}.json`);
  const snap = useJSON<{ rows: SnapRow[] }>("valuation/snapshot.json");
  const row = useMemo(() => snap.data?.rows.find((r) => r.symbol === sym) ?? null, [snap.data, sym]);
  const scope = useJSON<Scope>(row ? `valuation/${row.exchange ?? "MARKET"}.json` : null);

  useEffect(() => {
    let live = true;
    setPxLoading(true);
    loadPrices(sym).then((r) => { if (live) { setPx(r); setPxLoading(false); } });
    return () => { live = false; };
  }, [sym]);

  const filings = useMemo(() => (fund.data ? prepareFilings(fund.data.quarters) : []), [fund.data]);
  const val = useMemo(() => (px && filings.length ? valuationSeries(px.bars.d, px.bars.c, filings) : []), [px, filings]);
  const cut = Math.max(0, val.length - range);

  const kpi = useMemo(() => {
    const last = val.length ? val[val.length - 1] : null;
    const cur = [...filings].reverse().find((f) => f.niTtm !== null) ?? filings[filings.length - 1] ?? null;
    const shares = [...filings].reverse().find((f) => f.shares !== null)?.shares ?? null;
    const prev = cur ? filings.find((f) => f.niTtm !== null && +f.periodEnd.slice(0, 4) * 4 + Math.floor((+f.periodEnd.slice(5, 7) - 1) / 3) === +cur.periodEnd.slice(0, 4) * 4 + Math.floor((+cur.periodEnd.slice(5, 7) - 1) / 3) - 4) : null;
    const growth = cur?.niTtm != null && prev?.niTtm != null && prev.niTtm > 0 ? (cur.niTtm / prev.niTtm - 1) * 100 : null;
    return {
      last, cur, growth,
      eps: last?.ni != null && shares ? last.ni / shares : null, bvps: last?.eq != null && shares ? last.eq / shares : null,
      roe: last?.ni != null && last?.eq ? (last.ni / last.eq) * 100 : null,
    };
  }, [val, filings]);

  const peers = useMemo(() => {
    if (!scope.data || !row) return null;
    const m = (arr: (number | null)[] | undefined) => new Map(scope.data!.dates.map((d, i) => [d, arr?.[i] ?? null]));
    return { grpPe: m(scope.data.parts[row.group]?.med_pe), grpPb: m(scope.data.parts[row.group]?.med_pb), mktPe: m(scope.data.series.median_pe), mktPb: m(scope.data.series.median_pb) };
  }, [scope.data, row]);

  const charts = useMemo(() => {
    if (!val.length) return null;
    const v = val.slice(cut);
    const line = (name: string, color: string, f: (p: (typeof v)[number]) => number | null, width = 2): Ser => ({ name, color, width, data: v.map((p) => ({ time: p.date, value: f(p) })) });
    const mk = (kind: "pe" | "pb"): Ser[] => {
      const out = [line(`${sym} ${kind === "pe" ? "P/E" : "P/B"}`, "#3b82f6", (p) => p[kind], 3)];
      if (peers && row) {
        out.push(line(`${row.group} median`, "#f59e0b", (p) => (kind === "pe" ? peers.grpPe : peers.grpPb).get(p.date) ?? null, 2));
        out.push(line(`${row.exchange ?? "Market"} median`, dark ? "#94a3b8" : "#64748b", (p) => (kind === "pe" ? peers.mktPe : peers.mktPb).get(p.date) ?? null, 1));
      }
      return out;
    };
    const qs = [...(fund.data?.quarters ?? [])].sort((a, b) => (a.period_end < b.period_end ? -1 : 1)).slice(-20);
    const profit: Pt[] = qs.map((x) => ({ time: x.period_end, value: x.net_income_parent === null ? null : x.net_income_parent / 1e9, color: (x.net_income_parent ?? 0) >= 0 ? "#10b981" : "#f43f5e" }));
    const equity: Pt[] = qs.map((x) => ({ time: x.period_end, value: x.equity_parent === null ? null : x.equity_parent / 1e9 }));
    return { pe: mk("pe"), pb: mk("pb"), profit: [{ name: "Net profit (parent), VND bn", color: "#10b981", kind: "hist" as const, data: profit }], equity: [{ name: "Parent equity, VND bn", color: "#a78bfa", width: 2, data: equity }] };
  }, [val, cut, peers, row, sym, fund.data, dark]);

  const tabs = TABS.filter(([k]) => stmt.data?.reports[k]?.length);
  useEffect(() => { if (tabs.length && !tabs.some(([k]) => k === tab)) setTab(tabs[0][0]); }, [tabs, tab]);

  const loading = fund.loading || pxLoading;
  const cur = kpi.cur;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {RANGES.map(([l, n]) => <button type="button" key={l} onClick={() => setRange(n)} className={`rounded px-2 py-1 ${range === n ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300"}`}>{l}</button>)}
        {row && <span className="text-slate-400">{row.exchange} · {row.sector}{row.industry ? ` · ${row.industry}` : ""} · group <b className="text-slate-200">{row.group}</b></span>}
      </div>

      {loading ? <Loading what={sym} /> : !fund.data || !filings.length ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">No fundamentals stored for {sym} yet. Run the <b>Fundamentals update</b> workflow, or check the ticker.</div>
      ) : (
        <>
          {fund.data.quarters.some((x) => x.period_end < "1990-01-01") && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
              Some stored report dates are invalid (1970). Run <b>Fundamentals update</b> with <b>rebuild_only</b> ticked to repair them; P/E and P/B stay blank until then.
            </div>
          )}
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <Card l="P/E (TTM)" v={fmt(kpi.last?.pe ?? null, 2)} n={kpi.last?.pe == null ? "loss-making or no data" : undefined} />
            <Card l="P/B" v={fmt(kpi.last?.pb ?? null, 2)} />
            <Card l="Market cap (VND bn)" v={bn(kpi.last?.mcap ?? null)} />
            <Card l="EPS TTM (VND)" v={num0(kpi.eps, 0)} />
            <Card l="BVPS (VND)" v={num0(kpi.bvps, 0)} />
            <Card l="ROE (TTM)" v={kpi.roe === null ? "–" : `${kpi.roe.toFixed(1)}%`} n="profit ÷ latest equity" />
            <Card l="Net profit TTM (VND bn)" v={bn(cur?.niTtm ?? null)} n={kpi.growth === null ? undefined : `${kpi.growth >= 0 ? "+" : "−"}${Math.abs(kpi.growth).toFixed(1)}% vs a year earlier`} />
            <Card l="Parent equity (VND bn)" v={bn(cur?.equity ?? null)} />
            <Card l="Latest report" v={cur ? `Q${Math.floor((+cur.periodEnd.slice(5, 7) - 1) / 3) + 1} ${cur.periodEnd.slice(0, 4)}` : "–"} n={cur ? `period end ${cur.periodEnd}` : undefined} />
          </section>

          {charts && (
            <div className="grid gap-4 lg:grid-cols-2">
              <LineChart title={`P/E — ${sym} vs peers`} series={charts.pe} height={260} />
              <LineChart title={`P/B — ${sym} vs peers`} series={charts.pb} height={260} />
              <LineChart title="Quarterly net profit attributable to parent (VND bn)" series={charts.profit} height={220} />
              <LineChart title="Parent shareholders’ equity (VND bn)" series={charts.equity} height={220} />
            </div>
          )}

          <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="mr-2 text-sm font-semibold text-slate-100">Financial statements</h2>
              <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-0.5 text-xs">
                {tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`rounded-md px-2.5 py-1 ${tab === k ? "bg-sky-600 text-white" : "text-slate-400 hover:text-slate-100"}`}>{l}</button>)}
              </div>
              <label className="ml-auto flex items-center gap-1 text-xs text-slate-400">Quarters
                <select value={count} onChange={(e) => setCount(Number(e.target.value))}>{[4, 8, 12, 20, 40].map((n) => <option key={n} value={n}>{n}</option>)}</select>
              </label>
              <input placeholder="Filter line items…" value={filter} onChange={(e) => setFilter(e.target.value)} className="w-52 text-sm" aria-label="Filter line items" />
            </div>
            {tab === "LCTT" && <p className="text-xs text-amber-700 dark:text-amber-300">Cash-flow columns are labelled Q1 of each year and look like full-year totals, not quarterly figures.</p>}
            {stmt.loading ? <Loading what="statements" /> : stmt.data && tabs.length ? <StatementTable stmt={stmt.data} report={tab} count={count} filter={filter} />
              : <p className="text-sm text-slate-500">Statements are not stored for {sym} yet. Run <b>Fundamentals update</b> with “full” ticked to load them.</p>}
          </section>
          <p className="text-xs text-slate-500">
            P/E = market cap ÷ trailing-12-month profit attributable to parent shareholders; P/B = market cap ÷ parent equity; market cap uses the latest share count (contributed capital ÷ 10,000 VND).
            Each report is applied from its assumed filing date (quarter end plus the legal deadline), so ratios may react a little later than the real filing. Cash-flow figures may be year-to-date.
          </p>
        </>
      )}
    </div>
  );
}
