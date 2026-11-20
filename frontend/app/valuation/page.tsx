"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import LineChart, { Ser } from "@/components/LineChart";
import { useTheme } from "@/components/ThemeProvider";
import { Loading, Page } from "@/components/Ui";
import { fmt, useJSON } from "@/lib/data";

/* ---------------------------------------------------------------- types */
type Parts = Record<string, Record<string, (number | null)[]>>;
type Scope = { id: string; label: string; kind: string; dates: string[]; series: Record<string, (number | null)[]>; parts: Parts; n_members: number };
type Listing = { id: string; label: string; kind: string; n_members: number; last_date: string };
type Stock = { symbol: string; exchange: string | null; sector: string; industry: string; group: string; close_vnd: number | null; pe: number | null; pb: number | null; mcap: number | null; stale: boolean };
type Snapshot = { method: { special_groups: Record<string, string[]> }; rows: Stock[] };

const RANGES: [string, number | "ytd"][] = [["5Y", 1260], ["3Y", 756], ["1Y", 252], ["YTD", "ytd"], ["3M", 63]];
const METRICS = [["wpe", "Weighted P/E"], ["wpb", "Weighted P/B"], ["mpe", "Median P/E"], ["mpb", "Median P/B"]] as const;
type Metric = (typeof METRICS)[number][0];
const TOTAL = "__total__";
const PALETTE = ["#38bdf8", "#f59e0b", "#34d399", "#f43f5e", "#a78bfa", "#fb923c", "#2dd4bf", "#e879f9", "#84cc16", "#60a5fa", "#fbbf24", "#f472b6", "#4ade80", "#c084fc", "#22d3ee", "#fca5a1"];

/* ---------------------------------------------------------------- helpers */
const ratio = (a: number | null | undefined, b: number | null | undefined) => (a != null && b != null && b > 0 ? a / b : null);
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const compactVnd = (v: number | null) => (v == null ? "–" : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(0));
/** Traffic-light colour for a P/E: <12 green, <20 blue, <30 yellow, otherwise red. */
const peTone = (v: number | null) => (v == null ? "text-slate-500" : v < 12 ? "text-emerald-600 dark:text-emerald-400" : v < 20 ? "text-sky-600 dark:text-sky-400" : v < 30 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400");
const peBar = (v: number) => (v < 12 ? "bg-emerald-500" : v < 20 ? "bg-sky-500" : v < 30 ? "bg-amber-400" : "bg-rose-500");

function Bars({ title, note, items, color }: { title: string; note: string; items: { label: string; value: number | null; dim: boolean }[]; color: (v: number) => string }) {
  const rows = items.filter((i) => i.value != null).sort((a, b) => (a.value as number) - (b.value as number));
  const max = Math.max(1e-9, ...rows.map((r) => r.value as number));
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-3">
      <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      <p className="mb-2 text-xs text-slate-500">{note}</p>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.label} className={`flex items-center gap-2 text-xs ${r.dim ? "opacity-35" : ""}`} title={r.dim ? "excluded" : undefined}>
            <span className="w-40 shrink-0 truncate text-right text-slate-400">{r.label}</span>
            <div className="h-3.5 flex-1 rounded bg-slate-800/60"><div className={`h-full rounded ${color(r.value as number)}`} style={{ width: `${Math.max(2, ((r.value as number) / max) * 100)}%` }} /></div>
            <span className="w-12 shrink-0 tabular-nums text-slate-200">{fmt(r.value, 2)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

const Chip = ({ on, tone = "sky", onClick, children }: { on: boolean; tone?: "sky" | "rose"; onClick: () => void; children: React.ReactNode }) => (
  <button onClick={onClick} aria-pressed={on}
    className={`rounded-full border px-2.5 py-1 text-xs transition ${on
      ? tone === "rose" ? "border-rose-400 bg-rose-500/15 text-rose-700 line-through dark:text-rose-300" : "border-sky-500 bg-sky-500/15 text-sky-700 dark:text-sky-300"
      : "border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200"}`}>{children}</button>
);
const Seg = <T extends string | number>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [string, T][] }) => (
  <div className="flex rounded-lg border border-slate-800 bg-slate-900 p-0.5 text-xs">
    {options.map(([l, v]) => (
      <button key={l} onClick={() => onChange(v)} className={`rounded-md px-2.5 py-1 ${value === v ? "bg-sky-600 text-white" : "text-slate-400 hover:text-slate-100"}`}>{l}</button>
    ))}
  </div>
);

/* ---------------------------------------------------------------- page */
export default function Valuation() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const list = useJSON<{ groups: Listing[] }>("valuation/index.json");
  const snap = useJSON<Snapshot>("valuation/snapshot.json");
  const cons = useJSON<{ indexes: Record<string, string[]> }>("constituents.json");
  const [scopeId, setScopeId] = useState("HOSE");
  const sc = useJSON<Scope>(`valuation/${scopeId}.json`);
  const [range, setRange] = useState<number | "ytd">(1260);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [metric, setMetric] = useState<Metric>("wpe");
  const [trendSel, setTrendSel] = useState<string[]>([TOTAL]);
  const [f, setF] = useState({ q: "", sector: "", industry: "", group: "", size: 25, page: 1 });

  const scopes = list.data?.groups ?? [];
  useEffect(() => {
    if (scopes.length && !scopes.some((g) => g.id === scopeId)) setScopeId(scopes.find((g) => g.id === "MARKET")?.id ?? scopes[0].id);
  }, [scopes, scopeId]);
  useEffect(() => { setExcluded([]); setTrendSel([TOTAL]); setF((p) => ({ ...p, page: 1 })); }, [scopeId]);

  /* stocks in the selected scope */
  const stocks = useMemo(() => {
    const rows = snap.data?.rows ?? [];
    if (scopeId === "MARKET") return rows;
    if (sc.data?.kind === "exchange") return rows.filter((r) => r.exchange === scopeId);
    const m = new Set(cons.data?.indexes?.[scopeId] ?? []);
    return rows.filter((r) => m.has(r.symbol));
  }, [snap.data, cons.data, scopeId, sc.data?.kind]);

  const groups = useMemo(() => Object.keys(sc.data?.parts ?? {}).sort((a, b) => a.localeCompare(b)), [sc.data]);
  const groupN = useMemo(() => { const m: Record<string, number> = {}; stocks.forEach((s) => { m[s.group] = (m[s.group] ?? 0) + 1; }); return m; }, [stocks]);

  /* weighted P/E, P/B over any set of groups: sums are additive across groups */
  const weighted = useMemo(() => {
    if (!sc.data) return null;
    const n = sc.data.dates.length, P = sc.data.parts;
    const calc = (inc: (g: string) => boolean) => {
      const pe: (number | null)[] = [], pb: (number | null)[] = [], npe: number[] = [], npb: number[] = [];
      for (let i = 0; i < n; i++) {
        let a = 0, b = 0, c = 0, d = 0, x = 0, y = 0;
        for (const g of groups) if (inc(g)) { const p = P[g]; a += p.mcap_pe[i] ?? 0; b += p.ni[i] ?? 0; c += p.mcap_pb[i] ?? 0; d += p.eq[i] ?? 0; x += p.n_pe[i] ?? 0; y += p.n_pb[i] ?? 0; }
        pe.push(ratio(a, b)); pb.push(ratio(c, d)); npe.push(x); npb.push(y);
      }
      return { pe, pb, npe, npb };
    };
    return { all: calc(() => true), rest: calc((g) => !excluded.includes(g)) };
  }, [sc.data, groups, excluded]);

  const cut = useMemo(() => {
    if (!sc.data) return 0;
    const n = sc.data.dates.length;
    if (range === "ytd") { const y = sc.data.dates[n - 1].slice(0, 4); const i = sc.data.dates.findIndex((d) => d >= `${y}-01-01`); return Math.max(0, i); }
    return Math.max(0, n - range);
  }, [sc.data, range]);

  const mainSeries: Ser[] = useMemo(() => {
    if (!sc.data || !weighted) return [];
    const dates = sc.data.dates.slice(cut);
    const mk = (name: string, color: string, v: (number | null)[], scale: "left" | "right", dashed = false): Ser =>
      ({ name, color, scale, dashed, width: 2, data: dates.map((t, i) => ({ time: t, value: v.slice(cut)[i] ?? null })) });
    const out = [mk(`${scopeId} W P/E`, "#3b82f6", weighted.all.pe, "left"), mk(`${scopeId} W P/B`, "#10b981", weighted.all.pb, "right")];
    if (excluded.length) out.push(mk(`${scopeId} W P/E (Excl)`, "#a78bfa", weighted.rest.pe, "left", true), mk(`${scopeId} W P/B (Excl)`, "#f59e0b", weighted.rest.pb, "right", true));
    return out;
  }, [sc.data, weighted, cut, excluded, scopeId]);

  const last = sc.data ? sc.data.dates.length - 1 : -1;
  const rest = useMemo(() => stocks.filter((s) => !excluded.includes(s.group)), [stocks, excluded]);
  const medPe = median(rest.filter((s) => s.pe != null).map((s) => s.pe as number));
  const medPb = median(rest.filter((s) => s.pb != null).map((s) => s.pb as number));
  const special = snap.data?.method.special_groups ?? {};

  /* sector panels (latest values, all groups; excluded ones dimmed) */
  const bars = useMemo(() => {
    if (!sc.data || last < 0) return null;
    const P = sc.data.parts;
    const mk = (fn: (p: Record<string, (number | null)[]>) => number | null) => groups.map((g) => ({ label: g, value: fn(P[g]), dim: excluded.includes(g) }));
    return {
      wpe: mk((p) => ratio(p.mcap_pe[last], p.ni[last])), wpb: mk((p) => ratio(p.mcap_pb[last], p.eq[last])),
      mpe: mk((p) => p.med_pe[last]), mpb: mk((p) => p.med_pb[last]),
    };
  }, [sc.data, groups, excluded, last]);

  /* sector trend */
  const trend: Ser[] = useMemo(() => {
    if (!sc.data || !weighted) return [];
    const dates = sc.data.dates.slice(cut), P = sc.data.parts;
    const val = (g: string): (number | null)[] => {
      if (g === TOTAL) return metric === "wpe" ? weighted.all.pe : metric === "wpb" ? weighted.all.pb : sc.data!.series[metric === "mpe" ? "median_pe" : "median_pb"];
      const p = P[g];
      return sc.data!.dates.map((_, i) => metric === "wpe" ? ratio(p.mcap_pe[i], p.ni[i]) : metric === "wpb" ? ratio(p.mcap_pb[i], p.eq[i]) : metric === "mpe" ? p.med_pe[i] : p.med_pb[i]);
    };
    return trendSel.filter((g) => g === TOTAL || P[g]).map((g) => ({
      name: g === TOTAL ? `${scopeId} (all)` : g, color: g === TOTAL ? (dark ? "#e2e6ee" : "#1f2430") : PALETTE[groups.indexOf(g) % PALETTE.length], width: g === TOTAL ? 3 : 2,
      data: dates.map((t, i) => ({ time: t, value: val(g).slice(cut)[i] ?? null })),
    }));
  }, [sc.data, weighted, cut, metric, trendSel, groups, scopeId, dark]);

  /* stock table */
  const sectors = useMemo(() => Array.from(new Set(stocks.map((s) => s.sector))).sort(), [stocks]);
  const industries = useMemo(() => Array.from(new Set(stocks.map((s) => s.industry).filter(Boolean))).sort(), [stocks]);
  const table = useMemo(() => {
    const q = f.q.trim().toUpperCase();
    const r = stocks.filter((s) => (!q || s.symbol.includes(q)) && (!f.sector || s.sector === f.sector) && (!f.industry || s.industry === f.industry) && (!f.group || s.group === f.group));
    return r.sort((a, b) => (a.pe ?? 1e9) - (b.pe ?? 1e9));
  }, [stocks, f]);
  const pages = Math.max(1, Math.ceil(table.length / f.size));
  const page = Math.min(f.page, pages);

  const toggle = (g: string) => setExcluded((e) => (e.includes(g) ? e.filter((x) => x !== g) : [...e, g]));
  const asOf = sc.data && last >= 0 ? sc.data.dates[last] : null;
  const w = weighted?.rest;
  const kind = (k: string) => scopes.filter((g) => g.kind === k);

  if (!list.loading && scopes.length === 0) {
    return (
      <Page title="Valuation (P/E, P/B)">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">
          Valuation data is not available yet. Run the <b>Fundamentals update</b> workflow once (full history), then the daily update.
        </div>
      </Page>
    );
  }

  return (
    <Page title="Valuation – P/E & P/B">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <select value={scopeId} onChange={(e) => setScopeId(e.target.value)} aria-label="Market or index">
          {([["market", "All markets"], ["exchange", "Exchanges"], ["index", "Indexes"]] as const).map(([k, l]) => kind(k).length > 0 && (
            <optgroup key={k} label={l}>{kind(k).map((g) => <option key={g.id} value={g.id}>{g.id} ({g.n_members})</option>)}</optgroup>
          ))}
        </select>
        <span className="text-slate-400">As of <b className="text-slate-200">{asOf ?? "–"}</b> · PE = Close / TTM EPS · PB = Close / BVPS · valid stocks{" "}
          <b className="text-sky-600 dark:text-sky-400">{w && last >= 0 ? w.npe[last] : "–"} PE / {w && last >= 0 ? w.npb[last] : "–"} PB</b> out of {rest.length}</span>
      </div>

      {/* KPI cards */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Key valuation figures">
        {[["Weighted P/E", w && last >= 0 ? w.pe[last] : null, "Capitalization-weighted"], ["Median P/E", medPe, `${excluded.length ? "Remaining" : "All"} ${scopeId} stocks`],
          ["Weighted P/B", w && last >= 0 ? w.pb[last] : null, "Capitalization-weighted"], ["Median P/B", medPb, `${excluded.length ? "Remaining" : "All"} ${scopeId} stocks`]].map(([l, v, n]) => (
          <div key={l as string} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{scopeId} {l as string}</div>
            <div className="mt-1 text-3xl font-bold tabular-nums text-sky-600 dark:text-sky-400">{fmt(v as number | null, 2)}</div>
            <div className="mt-1 text-xs text-slate-500">{n as string}{excluded.length ? ` · ${excluded.length} group(s) excluded` : ""}</div>
          </div>
        ))}
      </section>

      {/* special groups */}
      {Object.entries(special).map(([name, syms]) => {
        const cards = syms.map((s) => stocks.find((r) => r.symbol === s)).filter((r): r is Stock => !!r);
        return cards.length > 0 && (
          <section key={name} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-100">{name}<span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-semibold uppercase text-white">Special group</span></h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {cards.map((c) => (
                <Link key={c.symbol} href={`/stock/${c.symbol}`} className="rounded-lg border border-sky-500/40 bg-sky-500/5 p-3 text-sm hover:border-sky-500">
                  <div className="text-lg font-bold text-sky-600 dark:text-sky-300">{c.symbol}</div>
                  <div className="text-xs text-slate-400">Close: <b className="text-slate-200">{compactVnd(c.close_vnd)}</b></div>
                  <div className="text-xs text-slate-400">P/E: <b className={peTone(c.pe)}>{fmt(c.pe, 2)}</b></div>
                  <div className="text-xs text-slate-400">P/B: <b className="text-sky-600 dark:text-sky-300">{fmt(c.pb, 2)}</b></div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}

      {/* market valuation + exclusion */}
      <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-100">Market valuation — {scopeId}</h2>
          <Seg value={range} onChange={setRange} options={RANGES} />
        </div>
        <div>
          <div className="mb-1 flex items-center gap-3 text-xs text-slate-400">
            Select groups to exclude from the {scopeId} calculation:
            {excluded.length > 0 && <button onClick={() => setExcluded([])} className="text-sky-600 underline dark:text-sky-300">Clear ({excluded.length})</button>}
          </div>
          <div className="flex flex-wrap gap-1.5">{groups.map((g) => <Chip key={g} on={excluded.includes(g)} tone="rose" onClick={() => toggle(g)}>{g} <span className="opacity-60">{groupN[g] ?? ""}</span></Chip>)}</div>
        </div>
        {sc.loading ? <Loading what="valuation" /> : <LineChart title="Capitalization-weighted P/E (left axis) and P/B (right axis)" series={mainSeries} height={340} />}
        <p className="text-xs text-slate-500">
          Weighted = total market cap ÷ total earnings (or equity) of profitable members, valued with filings published by each date. Excluding a group removes its stocks from every figure above (history included). Membership is current constituents, so history is survivorship-biased.
        </p>
      </section>

      {/* sector bars */}
      {bars && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Bars title="Sector weighted P/E" note="Capitalization-weighted" items={bars.wpe} color={peBar} />
          <Bars title="Sector weighted P/B" note="Capitalization-weighted" items={bars.wpb} color={() => "bg-emerald-500"} />
          <Bars title="Sector median P/E" note="Green <12 · Blue <20 · Yellow <30 · Red ≥30" items={bars.mpe} color={peBar} />
          <Bars title="Sector median P/B" note="Lower = cheaper vs book value" items={bars.mpb} color={() => "bg-indigo-400"} />
        </div>
      )}

      {/* sector trend */}
      <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-100">Sector trend</h2>
          <div className="flex flex-wrap gap-2"><Seg value={metric} onChange={setMetric} options={METRICS.map(([v, l]) => [l, v] as [string, Metric])} /><Seg value={range} onChange={setRange} options={RANGES} /></div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip on={false} onClick={() => setTrendSel([TOTAL, ...groups])}>Select all</Chip>
          <Chip on={false} onClick={() => setTrendSel([])}>Deselect all</Chip>
          <Chip on={trendSel.includes(TOTAL)} onClick={() => setTrendSel((s) => (s.includes(TOTAL) ? s.filter((x) => x !== TOTAL) : [...s, TOTAL]))}>{scopeId} (all)</Chip>
          {groups.map((g) => <Chip key={g} on={trendSel.includes(g)} onClick={() => setTrendSel((s) => (s.includes(g) ? s.filter((x) => x !== g) : [...s, g]))}>{g}</Chip>)}
        </div>
        {trend.length > 0 ? <LineChart title={METRICS.find((m) => m[0] === metric)?.[1]} series={trend} height={320} /> : <p className="text-sm text-slate-500">Pick at least one group.</p>}
      </section>

      {/* stock table */}
      <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-sm font-semibold text-slate-100">All {scopeId} stocks</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input placeholder="Ticker" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })} className="w-28" aria-label="Ticker filter" />
          <select value={f.sector} onChange={(e) => setF({ ...f, sector: e.target.value, page: 1 })} aria-label="Sector"><option value="">All sectors</option>{sectors.map((x) => <option key={x}>{x}</option>)}</select>
          <select value={f.industry} onChange={(e) => setF({ ...f, industry: e.target.value, page: 1 })} aria-label="Industry"><option value="">All industries</option>{industries.map((x) => <option key={x}>{x}</option>)}</select>
          <select value={f.group} onChange={(e) => setF({ ...f, group: e.target.value, page: 1 })} aria-label="Group"><option value="">All groups</option>{groups.map((x) => <option key={x}>{x}</option>)}</select>
          <label className="ml-auto flex items-center gap-1 text-slate-400">Show
            <select value={f.size} onChange={(e) => setF({ ...f, size: Number(e.target.value), page: 1 })}>{[10, 25, 50, 100].map((n) => <option key={n}>{n}</option>)}</select>
          </label>
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full min-w-[720px] text-sm tabular-nums">
            <thead className="bg-slate-950"><tr><th>Ticker</th><th className="text-right">Close (VND)</th><th className="text-right">P/E</th><th className="text-right">P/B</th><th>Sector</th><th>Industry</th><th>Group</th></tr></thead>
            <tbody>
              {table.slice((page - 1) * f.size, page * f.size).map((s) => (
                <tr key={s.symbol} className={`border-t border-slate-800 odd:bg-slate-950 even:bg-slate-900 ${excluded.includes(s.group) ? "opacity-40" : ""}`}>
                  <td><Link href={`/stock/${s.symbol}`} className="font-semibold text-sky-600 dark:text-sky-300">{s.symbol}</Link></td>
                  <td className="text-right text-slate-300">{compactVnd(s.close_vnd)}</td>
                  <td className={`text-right font-medium ${peTone(s.pe)}`}>{fmt(s.pe, 2)}</td>
                  <td className="text-right font-medium text-sky-600 dark:text-sky-300">{fmt(s.pb, 2)}</td>
                  <td className="text-slate-300">{s.sector}</td><td className="text-slate-500">{s.industry || "–"}</td><td className="text-slate-300">{s.group}</td>
                </tr>
              ))}
              {table.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">No stocks match.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <span>Showing {table.length ? (page - 1) * f.size + 1 : 0} to {Math.min(page * f.size, table.length)} of {table.length} entries (P/E and P/B are blank for loss-making or negative-equity stocks)</span>
          <div className="flex items-center gap-1">
            <button disabled={page <= 1} onClick={() => setF({ ...f, page: page - 1 })} className="rounded px-2 py-1 hover:bg-slate-800 disabled:opacity-40">Previous</button>
            <span className="rounded bg-sky-600 px-2 py-1 text-white">{page}</span><span>/ {pages}</span>
            <button disabled={page >= pages} onClick={() => setF({ ...f, page: page + 1 })} className="rounded px-2 py-1 hover:bg-slate-800 disabled:opacity-40">Next</button>
          </div>
        </div>
      </section>
    </Page>
  );
}
