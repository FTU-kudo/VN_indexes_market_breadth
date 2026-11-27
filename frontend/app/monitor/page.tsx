// frontend/app/monitor/page.tsx
"use client";
import { AlertTriangle, CheckCircle2, ChevronDown, Search, Terminal, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Loading, Page } from "@/components/Ui";
import { Status, Validation, useJSON } from "@/lib/data";

type HistCov = { valuation_start_market?: string | null; valuation_start_hose?: string | null; requested_start: string; benchmark_first_bar: string | null; actual_start_year: Record<string, number | null>; prices_stocks: { symbols: number; earliest_date: string | null; reached_requested_start: number; first_year_counts: Record<string, number> }; fundamentals: { stocks: number; earliest_period_end: string | null; first_year_counts?: Record<string, number> } };
type Era = { split: string; highlights: string[] };
type FieldSamples = { samples: Record<string, { period: string; fields: Record<string, { matched: string | null; value: number | null; candidates: string[] }> }> };
type Coverage = { fundamentals_files: number; stocks_valued: number; pe_valid_now: number; pb_valid_now: number; loss_making_now: number; stale_filing_now: number; latest_ttm_period: Record<string, number>; no_prices: { count: number; examples: string[] }; no_net_income: { count: number; examples: string[] }; no_equity: { count: number; examples: string[] }; no_shares: { count: number; examples: string[] }; no_ttm: { count: number; examples: string[] }; invalid_dates?: { count: number; examples: string[] }; ttm_diagnosis?: Record<string, { count: number; examples: string[] }> };

const Card = ({ l, v, cls = "text-slate-100", border = "" }: { l: string; v: React.ReactNode; cls?: string; border?: string }) => (
  <div className={`rounded-xl border border-slate-800 ${border} bg-slate-900 p-3.5 shadow-sm`}>
    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{l}</div>
    <div className={`mt-1 text-lg font-extrabold tabular-nums ${cls}`}>{v ?? "–"}</div>
  </div>
);

export default function Monitor() {
  const st = useJSON<Status>("monitor/status.json");
  const va = useJSON<Validation>("monitor/validation.json");
  const cov = useJSON<Coverage>("monitor/valuation_coverage.json");
  const fs = useJSON<FieldSamples>("monitor/field_samples.json");
  const hc = useJSON<HistCov>("monitor/history_coverage.json");
  const era = useJSON<Era>("monitor/era_comparison.json");

  const [fmQuery, setFmQuery] = useState("");
  const [fmStatus, setFmStatus] = useState<"all" | "mapped" | "missing">("all");
  const [logQuery, setLogQuery] = useState("");

  const s = st.data;
  const failCount = s?.failures?.length ?? 0;
  const errCount = va.data?.series_with_errors ?? 0;
  const staleCount = va.data?.series_stale_over_10d ?? 0;
  const totalIssues = failCount + errCount;

  const fieldRows = useMemo(() => {
    if (!fs.data?.samples) return [];
    return Object.entries(fs.data.samples).flatMap(([sym, d]) =>
      Object.entries(d.fields).map(([field, x]) => ({ sym, period: d.period, field, ...x }))
    );
  }, [fs.data]);

  const mappedCount = useMemo(() => fieldRows.filter((r) => !!r.matched).length, [fieldRows]);
  const missingCount = fieldRows.length - mappedCount;

  const filteredFields = useMemo(() => {
    const q = fmQuery.trim().toLowerCase();
    return fieldRows.filter((r) => {
      if (fmStatus === "mapped" && !r.matched) return false;
      if (fmStatus === "missing" && r.matched) return false;
      if (!q) return true;
      return `${r.sym} ${r.field} ${r.matched ?? ""}`.toLowerCase().includes(q);
    });
  }, [fieldRows, fmQuery, fmStatus]);

  const filteredIssues = useMemo(() => {
    const issues = va.data?.issues ?? [];
    const q = logQuery.trim().toLowerCase();
    if (!q) return issues;
    return issues.filter((i) => `${i.level} ${i.symbol} ${i.msg}`.toLowerCase().includes(q));
  }, [va.data, logQuery]);

  return (
    <Page title="Data monitoring">
      {st.loading ? <Loading what="status" /> : !s ? <p className="text-sm text-slate-400">No status file yet – run the daily workflow once.</p> : (
        <>
          {/* Overall Pipeline Status Pill */}
          <div className="-mt-2 flex flex-wrap items-center gap-2">
            {totalIssues === 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-800/80 dark:bg-emerald-950/60 dark:text-emerald-300">
                <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
                All Pipelines Healthy
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 dark:border-rose-800/80 dark:bg-rose-950/60 dark:text-rose-300">
                <span className="h-2 w-2 rounded-full bg-rose-500" aria-hidden />
                {totalIssues} Pipeline Issues
              </span>
            )}
          </div>

          {/* 8 Top System KPI Cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card l="Latest trading date" v={s.latest_trading_date} />
            <Card l="Last data change (UTC)" v={s.last_data_change_utc} />
            <Card l="Stocks collected" v={s.n_stocks} />
            <Card l="Indexes collected" v={s.n_indexes} />
            <Card l="Updated last run" v={s.collect?.updated} />
            <Card l="Price adjustments detected" v={s.collect?.adjusted} />
            <Card
              l="Failures"
              v={failCount}
              cls={failCount === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}
              border={failCount > 0 ? "border-rose-400 dark:border-rose-800" : ""}
            />
            <Card
              l="Stale series (>10d)"
              v={staleCount}
              cls={staleCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-slate-100"}
            />
          </div>

          {/* Valuation Coverage Card */}
          {cov.data && (
            <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-sm">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200">Valuation coverage</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {([
                  ["Stocks with fundamentals", cov.data.fundamentals_files, 100, "bg-blue-600"],
                  ["Valid P/E now", cov.data.pe_valid_now, cov.data.fundamentals_files ? (cov.data.pe_valid_now / cov.data.fundamentals_files) * 100 : 0, "bg-emerald-500"],
                  ["Valid P/B now", cov.data.pb_valid_now, cov.data.fundamentals_files ? (cov.data.pb_valid_now / cov.data.fundamentals_files) * 100 : 0, "bg-teal-500"],
                  ["Loss-making now", cov.data.loss_making_now, cov.data.fundamentals_files ? (cov.data.loss_making_now / cov.data.fundamentals_files) * 100 : 0, "bg-amber-500"],
                ] as const).map(([label, val, pct, barCls]) => (
                  <div key={label} className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
                    <div className="mt-1 flex items-baseline justify-between gap-2">
                      <span className="text-xl font-extrabold tabular-nums text-slate-100">{val}</span>
                      <span className="text-[11px] font-medium tabular-nums text-slate-400">{pct.toFixed(1)}%</span>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                      <div className={`h-full rounded-full ${barCls}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <details className="group rounded-lg border border-slate-800 bg-slate-950/70 px-3.5 py-2 text-xs">
                  <summary className="flex cursor-pointer list-none items-center justify-between font-semibold text-slate-200">
                    <span>Latest period with 4 consecutive quarters of profit ({Object.keys(cov.data.latest_ttm_period).length} periods)</span>
                    <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="mt-2 leading-relaxed text-slate-400 tabular-nums">
                    {Object.entries(cov.data.latest_ttm_period).map(([k, n]) => `${k}: ${n}`).join(" · ") || "none"}
                  </p>
                </details>

                {Object.entries(cov.data.ttm_diagnosis ?? {}).map(([k, v]) => (
                  <details key={k} className="group rounded-lg border border-amber-200/80 bg-amber-50/70 px-3.5 py-2 text-xs dark:border-amber-800/60 dark:bg-amber-950/40">
                    <summary className="flex cursor-pointer list-none items-center justify-between font-semibold text-amber-900 dark:text-amber-200">
                      <span>Why no TTM — {k.replace(/_/g, " ")} ({v.count} stocks)</span>
                      <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
                    </summary>
                    <p className="mt-2 leading-relaxed text-amber-800 dark:text-amber-300">{v.examples.join(" | ")}</p>
                  </details>
                ))}

                {([
                  ["invalid_dates", "Invalid report dates (run Fundamentals update with rebuild_only)"],
                  ["no_ttm", "No TTM profit (needs 4 consecutive quarters)"],
                  ["no_net_income", "No net profit line found"],
                  ["no_equity", "No equity line found"],
                  ["no_shares", "No share count (contributed capital) found"],
                  ["no_prices", "No stored prices"],
                ] as const).map(([k, l]) => (cov.data![k]?.count ?? 0) > 0 && (
                  <details key={k} className="group rounded-lg border border-amber-200/80 bg-amber-50/70 px-3.5 py-2 text-xs dark:border-amber-800/60 dark:bg-amber-950/40">
                    <summary className="flex cursor-pointer list-none items-center justify-between font-semibold text-amber-900 dark:text-amber-200">
                      <span>{l} ({cov.data![k]!.count} stocks)</span>
                      <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
                    </summary>
                    <p className="mt-2 leading-relaxed text-amber-800 dark:text-amber-300">{cov.data![k]!.examples.join(", ")}</p>
                  </details>
                ))}
              </div>
            </section>
          )}

          {/* History Coverage & Before vs After 2020 (2-Column Grid) */}
          <div className="grid gap-4 lg:grid-cols-2">
            {hc.data && (
              <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-sm">
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200">History coverage</h2>
                <div className="flex flex-wrap gap-2 text-xs tabular-nums">
                  <span className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-slate-300">Requested: <b className="text-slate-100">{hc.data.requested_start}</b></span>
                  <span className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-slate-300">Prices: <b className="text-slate-100">{hc.data.actual_start_year.prices ?? "–"}</b></span>
                  <span className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-slate-300">VNINDEX: <b className="text-slate-100">{hc.data.benchmark_first_bar ?? "–"}</b></span>
                  <span className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-slate-300">Statements: <b className="text-slate-100">{hc.data.actual_start_year.statements ?? "–"}</b></span>
                  <span className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-slate-300">Breadth: <b className="text-slate-100">{hc.data.actual_start_year.breadth ?? "–"}</b></span>
                  <span className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-slate-300">Valuation: <b className="text-slate-100">{hc.data.actual_start_year.valuation ?? "–"}</b></span>
                </div>
                <p className="text-xs text-slate-400 tabular-nums">
                  Valuation starts: whole market <b className="text-slate-200">{hc.data.valuation_start_market ?? "–"}</b> · HOSE <b className="text-slate-200">{hc.data.valuation_start_hose ?? "–"}</b> ·{" "}
                  <b className="text-slate-200">{hc.data.prices_stocks.reached_requested_start}</b> of <b className="text-slate-200">{hc.data.prices_stocks.symbols}</b> stocks reach requested start.
                </p>
                <details className="group rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs">
                  <summary className="flex cursor-pointer list-none items-center justify-between font-semibold text-slate-300">
                    <span>First-year breakdown (prices &amp; statements)</span>
                    <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="mt-2 space-y-1.5 text-slate-400 tabular-nums">
                    <p><b className="text-slate-200">Statements:</b> {Object.entries(hc.data.fundamentals.first_year_counts ?? {}).map(([y, n]) => `${y}: ${n}`).join(" · ") || "–"}</p>
                    <p><b className="text-slate-200">Prices:</b> {Object.entries(hc.data.prices_stocks.first_year_counts).map(([y, n]) => `${y}: ${n}`).join(" · ")}</p>
                  </div>
                </details>
              </section>
            )}

            {era.data && era.data.highlights.length > 0 && (
              <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-sm">
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                  Before vs after {era.data.split.slice(0, 4)} (generated from the data)
                </h2>
                <ul className="max-h-[320px] divide-y divide-slate-800 overflow-y-auto text-xs">
                  {era.data.highlights.map((h, i) => {
                    const idx = h.indexOf(":");
                    return (
                      <li key={i} className="py-1.5 leading-relaxed text-slate-300 tabular-nums">
                        {idx > 0 ? (
                          <><b className="font-semibold text-slate-100">{h.slice(0, idx + 1)}</b>{h.slice(idx + 1)}</>
                        ) : h}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </div>

          {/* Field Matching (Searchable, Filterable & Bounded Table) */}
          {fieldRows.length > 0 && (
            <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/80 px-4 py-3">
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200">Field matching (sample stocks, latest report)</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
                    <input
                      value={fmQuery}
                      onChange={(e) => setFmQuery(e.target.value)}
                      placeholder="Filter by ticker or field..."
                      aria-label="Filter field matching"
                      className="h-8 w-52 rounded-lg border-slate-700 pl-8 pr-7 text-xs"
                    />
                    {fmQuery && (
                      <button type="button" onClick={() => setFmQuery("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-100">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="flex rounded-lg border border-slate-800 bg-slate-900 p-0.5 text-xs">
                    {([
                      ["all", `All (${fieldRows.length})`],
                      ["mapped", `Mapped (${mappedCount})`],
                      ["missing", `Missing (${missingCount})`],
                    ] as const).map(([k, label]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setFmStatus(k)}
                        className={`rounded-md px-2.5 py-1 font-medium transition ${
                          fmStatus === k
                            ? k === "missing" ? "bg-rose-600 text-white" : "bg-sky-600 text-white"
                            : "text-slate-400 hover:text-slate-100"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="max-h-[460px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur-sm">
                    <tr className="border-b border-slate-800">
                      <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Ticker / Period</th>
                      <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Normalized Field</th>
                      <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Mapped Source Column</th>
                      <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-400">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFields.map((r) => (
                      <tr key={r.sym + r.field} className="border-t border-slate-800 align-top odd:bg-slate-950 even:bg-slate-900">
                        <td className="px-4 py-2 font-semibold text-slate-100">{r.sym} <span className="font-normal text-slate-500">{r.period}</span></td>
                        <td className="px-4 py-2 font-mono text-slate-300">{r.field}</td>
                        <td className="px-4 py-2">
                          {r.matched ? (
                            <span className="font-mono text-emerald-600 dark:text-emerald-400">{r.matched}</span>
                          ) : (
                            <div>
                              <span className="font-semibold text-rose-600 dark:text-rose-400">No match</span>
                              {r.candidates.length > 0 && <div className="mt-1 text-slate-400">candidates: {r.candidates.join(" ; ")}</div>}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {r.matched ? (
                            <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">OK</span>
                          ) : (
                            <span className="rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300">MISSING</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {filteredFields.length === 0 && (
                      <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">No field mappings match.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Collection Failures & Integrity Validation */}
          <div className="space-y-4">
            <section className="rounded-xl border border-slate-800 bg-slate-900 p-4 shadow-sm">
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-200">Collection failures</h2>
              {s.failures?.length ? (
                <div className="max-h-80 overflow-auto rounded-lg border border-slate-800">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-slate-900"><tr><th>Symbol</th><th>Kind</th><th>Error</th></tr></thead>
                    <tbody>{s.failures.map((f, i) => <tr key={i} className="border-t border-slate-800"><td>{f.symbol}</td><td>{f.kind}</td><td className="text-rose-600 dark:text-rose-300">{f.error}</td></tr>)}</tbody>
                  </table>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200/80 bg-emerald-50/70 px-3.5 py-2.5 text-xs font-semibold text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
                  0 Collection Failures — All exchange &amp; index feeds ingested successfully
                </div>
              )}
            </section>

            <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Terminal className="h-4 w-4 text-slate-400" aria-hidden />
                  <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200">Integrity validation</h2>
                  {va.data && (
                    <>
                      <span className="text-xs text-slate-400 tabular-nums">
                        {va.data.series_checked} series checked · {va.data.series_with_errors} errors · {va.data.series_with_warnings} warnings
                      </span>
                      <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${va.data.series_with_errors === 0 ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" : "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"}`}>
                        {va.data.series_with_errors === 0 ? "PASSED" : "FAILED"}
                      </span>
                      {va.data.series_with_warnings > 0 && (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                          <AlertTriangle className="h-3 w-3" aria-hidden />
                          {va.data.series_with_warnings} Warnings
                        </span>
                      )}
                    </>
                  )}
                </div>
                {va.data && va.data.issues.length > 0 && (
                  <input
                    value={logQuery}
                    onChange={(e) => setLogQuery(e.target.value)}
                    placeholder="Filter warnings..."
                    aria-label="Filter integrity warnings"
                    className="h-8 w-48 rounded-lg border-slate-700 px-2.5 text-xs"
                  />
                )}
              </div>

              {va.data ? (
                <>
                  {va.data.fatal.map((m) => <p key={m} className="text-xs font-semibold text-rose-600 dark:text-rose-400">FATAL: {m}</p>)}
                  {filteredIssues.length > 0 && (
                    <div className="max-h-[260px] space-y-1 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs">
                      {filteredIssues.slice(0, 100).map((i, k) => (
                        <div key={k} className="flex items-start gap-2 text-slate-300">
                          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${i.level === "error" ? "bg-rose-500/20 text-rose-400" : "bg-amber-500/20 text-amber-600 dark:text-amber-400"}`}>
                            {i.level === "error" ? "ERR" : "WARN"}
                          </span>
                          <span><b className="text-slate-100">{i.symbol}</b>: {i.msg}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : <p className="text-sm text-slate-500">No validation file yet.</p>}
            </section>
          </div>
        </>
      )}
    </Page>
  );
}
