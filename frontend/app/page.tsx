// frontend/app/page.tsx
"use client";
import { ArrowDownRight, ArrowUpDown, ArrowUpRight, ChevronDown, ChevronUp, Columns3, Minus, Search, X } from "lucide-react";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import LineChart, { Ser } from "@/components/LineChart";
import Sparkline from "@/components/Sparkline";
import { useTheme } from "@/components/ThemeProvider";
import { Page } from "@/components/Ui";
import { Columnar, fmt, num, Row, Status, useJSON } from "@/lib/data";

/* ------------------------------------------------------------------ classification
   "Main" = headline benchmark indices (edit this list to match your index codes);
   everything else is shown under "Sector indices". */
const MAIN_ORDER = ["VNINDEX", "VN30", "VN100", "VNMID", "VNSML", "VNALL", "VNXALL", "VNX50", "HNXINDEX", "HNX30", "UPCOMINDEX"];
const KPI_CODES = ["VNINDEX", "VN30", "HNXINDEX", "UPCOMINDEX"];   // all markets: HOSE, HOSE large caps, HNX, UPCOM
const rank = (s: string) => { const i = MAIN_ORDER.indexOf(s); return i < 0 ? 99 : i; };
type Cat = "all" | "main" | "sector";
const SMAS = ["sma_10", "sma_20", "sma_50", "sma_200"] as const;

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
const dist = (r: Row, k: string) => { const c = num(r, "close"), m = num(r, k); return c !== null && m ? (c / m - 1) * 100 : null; };
const up_ = "text-emerald-600 dark:text-emerald-400", dn_ = "text-rose-600 dark:text-rose-400";

/** Signed number with a real minus sign, e.g. −13.39 / +0.30. */
const sgn = (v: number, d = 2) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}`;
/** Points gained/lost vs the previous close (chg_1); derived from close and % change for data written before chg_1 existed. */
const chgPts = (r: Row): number | null => {
  const a = num(r, "chg_1");
  if (a !== null) return a;
  const c = num(r, "close"), p = num(r, "ret_1");
  return c !== null && p !== null ? c - c / (1 + p / 100) : null;
};

/* ------------------------------------------------------------------ cell renderers */
function ChgPill({ v }: { v: number | null }) {
  if (v === null) return <span className="text-slate-500">–</span>;
  const [cls, Icon] = v > 0 ? ["bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", ArrowUpRight]
    : v < 0 ? ["bg-rose-500/15 text-rose-700 dark:text-rose-300", ArrowDownRight] : ["bg-slate-500/15 text-slate-300", Minus];
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${cls}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden />{Math.abs(v).toFixed(2)}%
    </span>
  );
}

/** "−13.39 / −0.79%" : exact points and percent move vs the previous close. */
function ChgText({ r, className = "" }: { r: Row; className?: string }) {
  const pts = chgPts(r), pct = num(r, "ret_1");
  if (pts === null || pct === null) return <span className="text-slate-500">–</span>;
  const [cls, Icon] = pts > 0 ? [up_, ArrowUpRight] : pts < 0 ? [dn_, ArrowDownRight] : ["text-slate-400", Minus];
  return (
    <span className={`inline-flex items-center gap-1 font-semibold tabular-nums ${cls} ${className}`} title="Change vs previous close (points / %)">
      <Icon className="h-4 w-4" aria-hidden />{sgn(pts)} / {sgn(pct)}%
    </span>
  );
}

function PtsCell({ v }: { v: number | null }) {
  if (v === null) return <span className="text-slate-500">–</span>;
  return <span className={`font-medium ${v > 0 ? up_ : v < 0 ? dn_ : "text-slate-400"}`}>{sgn(v)}</span>;
}

function SmaCell({ r, k }: { r: Row; k: string }) {
  const d = dist(r, k), m = num(r, k);
  if (d === null) return <span className="text-slate-500">–</span>;
  const above = d >= 0;
  return (
    <span className="inline-flex items-center justify-end gap-1" title={`Close is ${above ? "above" : "below"} ${k.replace("_", " ").toUpperCase()} by ${Math.abs(d).toFixed(2)}%`}>
      <span className="text-slate-300">{fmt(m)}</span>
      {above ? <ChevronUp className={`h-3.5 w-3.5 ${up_}`} aria-label="close above" /> : <ChevronDown className={`h-3.5 w-3.5 ${dn_}`} aria-label="close below" />}
    </span>
  );
}

function VolCell({ v, max }: { v: number | null; max: number }) {
  if (v === null) return <span className="text-slate-500">–</span>;
  return (
    <div className="relative flex items-center justify-end py-0.5" title={v.toLocaleString("en-US")}>
      <div className="absolute inset-y-0 right-0 rounded bg-sky-500/15" style={{ width: `${max ? Math.max(3, (v / max) * 100) : 0}%` }} />
      <span className="relative px-1.5 text-slate-200">{compact.format(v)}</span>
    </div>
  );
}

function RsiCell({ v }: { v: number | null }) {
  if (v === null) return <span className="text-slate-500">–</span>;
  const [label, cls] = v < 30 ? ["Oversold", "border border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300"]
    : v > 70 ? ["Overbought", "border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300"]
    : ["Neutral", "border border-slate-700/80 bg-slate-950 text-slate-400"];
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="text-slate-200">{v.toFixed(1)}</span>
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>{label}</span>
    </span>
  );
}

function MacdCell({ v }: { v: number | null }) {
  if (v === null) return <span className="text-slate-500">–</span>;
  return (
    <span className={`inline-flex items-center justify-end gap-0.5 ${v > 0 ? up_ : v < 0 ? dn_ : "text-slate-400"}`} title={v > 0 ? "MACD above signal (bullish)" : "MACD below signal (bearish)"}>
      {v > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : v < 0 ? <ArrowDownRight className="h-3.5 w-3.5" /> : null}{Math.abs(v).toFixed(2)}
    </span>
  );
}

const trendCount = (r: Row) => SMAS.filter((k) => (dist(r, k) ?? -1) >= 0).length;
function TrendCell({ r }: { r: Row }) {
  const n = trendCount(r);
  return (
    <span className="inline-flex items-center justify-center gap-1.5" title={`Close above ${n} of 4 moving averages (SMA 10/20/50/200)`}>
      <span className="flex gap-0.5">{SMAS.map((k) => <i key={k} className={`h-1.5 w-1.5 rounded-full ${(dist(r, k) ?? -1) >= 0 ? "bg-emerald-500" : "bg-slate-600"}`} />)}</span>
      <span className="text-xs text-slate-400">{n}/4</span>
    </span>
  );
}

/* ------------------------------------------------------------------ column model */
type Col = { key: string; label: string; center?: boolean; get: (r: Row) => number | null; cell: (r: Row, maxVol: number) => ReactNode };
const COLS: Col[] = [
  { key: "close", label: "Close", get: (r) => num(r, "close"), cell: (r) => <span className="font-medium text-slate-100">{fmt(num(r, "close"))}</span> },
  { key: "chg", label: "Chg %", get: (r) => num(r, "ret_1"), cell: (r) => <ChgPill v={num(r, "ret_1")} /> },
  { key: "pts", label: "Chg (pts)", get: chgPts, cell: (r) => <PtsCell v={chgPts(r)} /> },
  { key: "vol", label: "Volume", get: (r) => num(r, "volume"), cell: (r, m) => <VolCell v={num(r, "volume")} max={m} /> },
  { key: "trend", label: "Trend", center: true, get: trendCount, cell: (r) => <TrendCell r={r} /> },
  ...SMAS.map((k): Col => ({ key: k, label: k.replace("_", " ").toUpperCase(), get: (r) => dist(r, k), cell: (r) => <SmaCell r={r} k={k} /> })),
  { key: "rsi", label: "RSI 14", get: (r) => num(r, "rsi_14"), cell: (r) => <RsiCell v={num(r, "rsi_14")} /> },
  { key: "macd", label: "MACD hist", get: (r) => num(r, "macd_hist"), cell: (r) => <MacdCell v={num(r, "macd_hist")} /> },
];

/* ------------------------------------------------------------------ KPI card */
function KpiCard({ row, name, selected, onPick }: { row: Row; name: string; selected: boolean; onPick: () => void }) {
  const hist = useJSON<Columnar>(`indicators/indexes/${row.symbol}.json`);
  const vals = useMemo(() => (hist.data?.series.close ?? []).filter((v): v is number => v !== null).slice(-60), [hist.data]);
  const up = vals.length > 1 ? vals[vals.length - 1] >= vals[0] : (num(row, "ret_1") ?? 0) >= 0;
  return (
    <button
      onClick={onPick}
      aria-pressed={selected}
      className={`group rounded-xl border p-4 text-left transition-all hover:border-blue-400/70 ${
        selected
          ? "border-blue-400 bg-blue-50/15 ring-2 ring-blue-500/30 dark:bg-blue-950/20"
          : "border-slate-800 bg-slate-900"
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-slate-300">{row.symbol}</div>
          {name !== row.symbol && <div className="text-xs text-slate-500">{name}</div>}
        </div>
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div>
          <div className="text-2xl font-extrabold tracking-tight tabular-nums text-slate-100 sm:text-[26px]">{fmt(num(row, "close"))}</div>
          <ChgText r={row} className="mt-0.5 text-sm" />
        </div>
        <div className="w-28 shrink-0">
          {hist.loading ? <div className="h-9 animate-pulse rounded bg-slate-800" /> : <Sparkline values={vals} up={up} className="h-9 w-full" />}
          <div className="text-right text-[10px] text-slate-500">last {vals.length || 60} sessions</div>
        </div>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ page */
export default function Overview() {
  const { theme } = useTheme();
  const snap = useJSON<{ rows: Row[] }>("indicators/snapshot_indexes.json");
  const names = useJSON<{ code: string; name: string }[]>("indexes.json");
  const status = useJSON<Status>("monitor/status.json");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Cat>("all");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [sel, setSel] = useState("VNINDEX");
  const [hidden, setHidden] = useState<string[]>([]);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const hist = useJSON<Columnar>(`indicators/indexes/${sel}.json`);

  useEffect(() => { try { setHidden(JSON.parse(localStorage.getItem("overview.hidden") || "[]")); } catch { /* ignore */ } }, []);
  useEffect(() => { try { localStorage.setItem("overview.hidden", JSON.stringify(hidden)); } catch { /* ignore */ } }, [hidden]);
  useEffect(() => {
    if (!menu) return;
    const off = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [menu]);

  const nameOf = useMemo(() => new Map((names.data ?? []).map((n) => [n.code, n.name])), [names.data]);
  const all = useMemo(() => [...(snap.data?.rows ?? [])].sort((a, b) => rank(a.symbol) - rank(b.symbol) || a.symbol.localeCompare(b.symbol)), [snap.data]);
  const kpis = useMemo(() => {
    const picked = KPI_CODES.map((c) => all.find((r) => r.symbol === c)).filter((r): r is Row => !!r);
    return [...picked, ...all.filter((r) => !picked.includes(r))].slice(0, 4);
  }, [all]);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const f = all.filter((r) => (cat === "all" || (cat === "main") === MAIN_ORDER.includes(r.symbol))
      && (!t || r.symbol.toLowerCase().includes(t) || (nameOf.get(r.symbol) ?? "").toLowerCase().includes(t)));
    const col = COLS.find((c) => c.key === sort?.key);
    if (!sort || !col) return f;
    return [...f].sort((a, b) => { const x = col.get(a), y = col.get(b); return x === null ? 1 : y === null ? -1 : (x - y) * sort.dir; });
  }, [all, q, cat, sort, nameOf]);

  const maxVol = useMemo(() => Math.max(0, ...rows.map((r) => num(r, "volume") ?? 0)), [rows]);
  const movers = useMemo(() => {
    const s = all.filter((r) => num(r, "ret_1") !== null).sort((a, b) => (num(b, "ret_1") as number) - (num(a, "ret_1") as number));
    return { gain: s.slice(0, 3).filter((r) => (num(r, "ret_1") as number) > 0), lose: s.slice(-3).reverse().filter((r) => (num(r, "ret_1") as number) < 0) };
  }, [all]);
  const cols = COLS.filter((c) => !hidden.includes(c.key));
  const toggleSort = (key: string) => setSort((s) => (s?.key !== key ? { key, dir: -1 } : s.dir === -1 ? { key, dir: 1 } : null));

  const dark = theme === "dark";
  const series: Ser[] = useMemo(() => {
    if (!hist.data) return [];
    const mk = (name: string, color: string, k: string, width = 1): Ser => ({ name, color, width, data: hist.data!.dates.map((t, i) => ({ time: t, value: hist.data!.series[k]?.[i] ?? null })) });
    return [mk("Close", dark ? "#e2e6ee" : "#1f2430", "close", 2), mk("SMA20", "#38bdf8", "sma_20"), mk("SMA50", "#f59e0b", "sma_50"), mk("SMA200", "#f43f5e", "sma_200")];
  }, [hist.data, dark]);

  const Mover = ({ r }: { r: Row }) => (
    <button onClick={() => setSel(r.symbol)} className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-slate-950">
      <span className="font-semibold text-slate-100">{r.symbol}</span><ChgText r={r} className="text-xs" />
    </button>
  );

  return (
    <Page title="Market overview">
      <div className="-mt-2 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-md border border-blue-200/80 bg-blue-50 px-2.5 py-1 text-xs font-semibold tabular-nums text-blue-900 dark:border-blue-800/80 dark:bg-blue-950/80 dark:text-blue-100">
          Session: {status.data?.latest_trading_date ?? "–"}
        </span>
        <span className="inline-flex items-center rounded-md border border-slate-700/80 bg-slate-950 px-2.5 py-1 text-xs font-medium tabular-nums text-slate-300">
          Coverage: {all.length} indices · Last close
        </span>
      </div>

      {/* KPI bar */}
      <section aria-label="Key indices" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {snap.loading ? [0, 1, 2, 3].map((i) => <div key={i} className="h-[108px] animate-pulse rounded-xl border border-slate-800 bg-slate-900" />)
          : kpis.map((r) => <KpiCard key={r.symbol} row={r} name={nameOf.get(r.symbol) ?? r.symbol} selected={sel === r.symbol} onPick={() => setSel(r.symbol)} />)}
      </section>

      {/* Movers */}
      {(movers.gain.length > 0 || movers.lose.length > 0) && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 px-4 py-2.5 shadow-sm" aria-label="Top movers">
          {movers.gain.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">Top gainers</span>
              {movers.gain.map((r) => <Mover key={r.symbol} r={r} />)}
            </div>
          )}
          {movers.lose.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-rose-50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">Top losers</span>
              {movers.lose.map((r) => <Mover key={r.symbol} r={r} />)}
            </div>
          )}
        </section>
      )}

      {/* Controls + Table */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-950/80 px-4 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search index…" aria-label="Search indexes" className="w-56 rounded-lg py-1.5 pl-8 pr-7" />
          {q && <button onClick={() => setQ("")} aria-label="Clear search" className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200"><X className="h-4 w-4" /></button>}
        </div>
        <div role="tablist" aria-label="Index category" className="flex rounded-lg border border-slate-800 bg-slate-900 p-0.5">
          {([["all", "All"], ["main", "Main indices"], ["sector", "Sector indices"]] as [Cat, string][]).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={cat === k} onClick={() => setCat(k)}
              className={`rounded-md px-3 py-1 text-sm ${cat === k ? "bg-sky-600 text-white shadow-sm" : "text-slate-400 hover:text-slate-100"}`}>{l}</button>
          ))}
        </div>
        <div className="relative ml-auto" ref={menuRef}>
          <button onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-700">
            <Columns3 className="h-4 w-4" />Columns{hidden.length > 0 && <span className="rounded-full bg-slate-700 px-1.5 text-[10px]">{COLS.length - hidden.length}/{COLS.length}</span>}
          </button>
          {menu && (
            <div role="menu" className="absolute right-0 z-40 mt-1 w-52 rounded-xl border border-slate-800 bg-slate-900 p-2 shadow-xl">
              {COLS.map((c) => (
                <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-800">
                  <input type="checkbox" className="accent-sky-600" checked={!hidden.includes(c.key)}
                    onChange={() => setHidden((h) => (h.includes(c.key) ? h.filter((x) => x !== c.key) : [...h, c.key]))} />{c.label}
                </label>
              ))}
              <button onClick={() => setHidden([])} className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-sky-600 hover:bg-slate-800 dark:text-sky-300">Reset to default</button>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-separate border-spacing-0 text-sm tabular-nums">
          <thead className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur-sm">
            <tr>
              <th scope="col" className="sticky left-0 top-0 z-20 border-b border-r border-slate-800 bg-slate-900 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Index</th>
              {cols.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th key={c.key} scope="col" aria-sort={active ? (sort!.dir === -1 ? "descending" : "ascending") : "none"}
                    className="border-b border-slate-800 bg-slate-900 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <button onClick={() => toggleSort(c.key)} className={`inline-flex w-full items-center gap-1 hover:text-slate-100 ${c.center ? "justify-center" : "justify-end"} ${active ? "text-slate-100" : ""}`}>
                      {c.label}{active ? (sort!.dir === -1 ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {snap.loading && [...Array(8)].map((_, i) => (
              <tr key={i} className="odd:bg-slate-950 even:bg-slate-900"><td colSpan={cols.length + 1} className="px-3 py-3"><div className="h-4 animate-pulse rounded bg-slate-800" /></td></tr>
            ))}
            {rows.map((r) => {
              const name = nameOf.get(r.symbol) ?? r.symbol;
              const isSelected = sel === r.symbol;
              return (
                <tr key={r.symbol} onClick={() => setSel(r.symbol)} onKeyDown={(e) => e.key === "Enter" && setSel(r.symbol)} tabIndex={0} aria-selected={isSelected}
                  className={`cursor-pointer outline-none transition-colors ${
                    isSelected
                      ? "bg-blue-50/60 dark:bg-blue-950/30"
                      : "odd:bg-slate-950 even:bg-slate-900 hover:bg-slate-900/90 focus-visible:bg-slate-800"
                  }`}>
                  <td className={`sticky left-0 z-10 border-r border-slate-800 bg-inherit px-3 py-2 ${isSelected ? "border-l-4 border-l-blue-600" : ""}`}>
                    <div className="flex items-center gap-2">
                      <div><div className="font-semibold text-slate-100">{r.symbol}</div>{name !== r.symbol && <div className="max-w-[10rem] truncate text-xs text-slate-500">{name}</div>}</div>
                    </div>
                  </td>
                  {cols.map((c) => <td key={c.key} className={`px-3 py-2 ${c.center ? "text-center" : "text-right"}`}>{c.cell(r, maxVol)}</td>)}
                </tr>
              );
            })}
            {!snap.loading && rows.length === 0 && (
              <tr><td colSpan={cols.length + 1} className="px-3 py-10 text-center text-slate-500">
                {all.length === 0 ? "No index data found." : <>No indexes match “{q}”. <button onClick={() => { setQ(""); setCat("all"); }} className="text-sky-600 underline dark:text-sky-300">Clear filters</button></>}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/90 px-3.5 py-2 text-xs text-slate-400">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
          <span className="inline-flex items-center gap-1.5">
            <span className="font-semibold text-emerald-600 dark:text-emerald-400" aria-hidden>▲</span>
            <span className="text-slate-500">/</span>
            <span className="font-semibold text-rose-600 dark:text-rose-400" aria-hidden>▼</span>
            <span><b className="font-semibold text-slate-200">Close above / below SMA</b> <span className="text-slate-500">(hover value for % distance)</span></span>
          </span>
          <span><b className="font-semibold text-slate-200">Trend</b> = count of SMAs below close</span>
          <span><b className="font-semibold text-slate-200">Volume bar</b> = scaled relative to max volume in current view</span>
        </div>
        <span className="rounded-md border border-blue-200/70 bg-blue-50 px-2.5 py-0.5 font-medium text-blue-700 dark:border-blue-800/80 dark:bg-blue-950/60 dark:text-blue-300">
          Click any row to update chart
        </span>
      </div>

      {hist.data ? <LineChart title={`${sel} – close & moving averages (last ~500 sessions)`} series={series} height={360} />
        : !hist.loading && <p className="text-sm text-slate-500">No history file for {sel}.</p>}
    </Page>
  );
}
