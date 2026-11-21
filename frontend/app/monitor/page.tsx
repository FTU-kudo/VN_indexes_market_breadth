// frontend/app/monitor/page.tsx
"use client";
import { Loading, Page } from "@/components/Ui";
import { Status, Validation, useJSON } from "@/lib/data";

type Coverage = { fundamentals_files: number; stocks_valued: number; pe_valid_now: number; pb_valid_now: number; loss_making_now: number; stale_filing_now: number; latest_ttm_period: Record<string, number>; no_prices: { count: number; examples: string[] }; no_net_income: { count: number; examples: string[] }; no_equity: { count: number; examples: string[] }; no_shares: { count: number; examples: string[] }; no_ttm: { count: number; examples: string[] } };

const Card = ({ l, v }: { l: string; v: React.ReactNode }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><div className="text-xs text-slate-400">{l}</div><div className="text-lg font-semibold">{v ?? "–"}</div></div>
);

export default function Monitor() {
  const st = useJSON<Status>("monitor/status.json");
  const va = useJSON<Validation>("monitor/validation.json");
  const cov = useJSON<Coverage>("monitor/valuation_coverage.json");
  const s = st.data;
  return (
    <Page title="Data monitoring">
      {st.loading ? <Loading what="status" /> : !s ? <p className="text-sm text-slate-400">No status file yet – run the daily workflow once.</p> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card l="Latest trading date" v={s.latest_trading_date} />
            <Card l="Last data change (UTC)" v={s.last_data_change_utc} />
            <Card l="Stocks collected" v={s.n_stocks} />
            <Card l="Indexes collected" v={s.n_indexes} />
            <Card l="Updated last run" v={s.collect?.updated} />
            <Card l="Price adjustments detected" v={s.collect?.adjusted} />
            <Card l="Failures" v={s.failures?.length ?? 0} />
            <Card l="Stale series (>10d)" v={va.data?.series_stale_over_10d} />
          </div>
          {cov.data && (
            <section>
              <h2 className="mb-1 font-semibold">Valuation coverage</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Card l="Stocks with fundamentals" v={cov.data.fundamentals_files} />
                <Card l="Valid P/E now" v={cov.data.pe_valid_now} />
                <Card l="Valid P/B now" v={cov.data.pb_valid_now} />
                <Card l="Loss-making now" v={cov.data.loss_making_now} />
              </div>
              <p className="mt-2 text-xs text-slate-400">Latest period with 4 consecutive quarters of profit (stocks per period): {Object.entries(cov.data.latest_ttm_period).map(([k, n]) => `${k}: ${n}`).join(" · ") || "none"}</p>
              {([["no_ttm", "No TTM profit (needs 4 consecutive quarters)"], ["no_net_income", "No net profit line found"], ["no_equity", "No equity line found"], ["no_shares", "No share count (contributed capital) found"], ["no_prices", "No stored prices"]] as const).map(([k, l]) => cov.data![k].count > 0 && (
                <p key={k} className="text-xs text-slate-400"><b className="text-amber-600 dark:text-amber-300">{l}:</b> {cov.data![k].count} stocks, e.g. {cov.data![k].examples.join(", ")}</p>
              ))}
            </section>
          )}
          <section>
            <h2 className="mb-1 font-semibold">Collection failures</h2>
            {s.failures?.length ? (
              <div className="max-h-80 overflow-auto rounded-xl border border-slate-800"><table className="w-full text-xs"><thead className="bg-slate-900"><tr><th>Symbol</th><th>Kind</th><th>Error</th></tr></thead>
                <tbody>{s.failures.map((f, i) => <tr key={i} className="border-t border-slate-800"><td>{f.symbol}</td><td>{f.kind}</td><td className="text-rose-600 dark:text-rose-300">{f.error}</td></tr>)}</tbody></table></div>
            ) : <p className="text-sm text-emerald-600 dark:text-emerald-400">None in the last run.</p>}
          </section>
          <section>
            <h2 className="mb-1 font-semibold">Integrity validation</h2>
            {va.data ? (
              <>
                <p className="text-sm text-slate-400">{va.data.series_checked} series checked · {va.data.series_with_errors} with errors · {va.data.series_with_warnings} with warnings</p>
                {va.data.fatal.map((m) => <p key={m} className="text-sm text-rose-600 dark:text-rose-400">FATAL: {m}</p>)}
                {va.data.issues.slice(0, 50).map((i, k) => <p key={k} className="text-xs text-slate-400">[{i.level}] {i.symbol}: {i.msg}</p>)}
              </>
            ) : <p className="text-sm text-slate-500">No validation file yet.</p>}
          </section>
        </>
      )}
    </Page>
  );
}
