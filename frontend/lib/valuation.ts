// frontend/lib/valuation.ts
// Browser port of backend/valuation.py (point-in-time TTM earnings, market cap / earnings, market cap / equity).
// Keep the two in step: tests/test_valuation.py documents the rules this mirrors.
export type Quarter = { period_end: string; published: string; net_income_parent: number | null; equity_parent: number | null; shares: number | null };
export type Filing = { published: string; periodEnd: string; niTtm: number | null; equity: number | null; shares: number | null };
export type ValPoint = { date: string; price: number; mcap: number | null; ni: number | null; eq: number | null; pe: number | null; pb: number | null };

const qkey = (iso: string) => +iso.slice(0, 4) * 4 + Math.floor((+iso.slice(5, 7) - 1) / 3);
const DAY = 86_400_000;

/** One entry per filing: TTM net income needs four consecutive single quarters, otherwise it is unknown (never guessed). */
export function prepareFilings(quarters: Quarter[], cumulative = false): Filing[] {
  const byEnd = new Map(quarters.map((q) => [q.period_end, q]));
  const qs = [...byEnd.values()].sort((a, b) => (a.period_end < b.period_end ? -1 : 1));
  const key = qs.map((q) => qkey(q.period_end));
  const ni: (number | null)[] = qs.map((q, i) => {
    const v = q.net_income_parent;
    if (!cumulative || v === null) return v;
    if ((new Date(q.period_end).getUTCMonth()) < 3) return v;                       // Q1 is itself
    const prev = qs[i - 1];
    return i > 0 && key[i] - key[i - 1] === 1 && prev.net_income_parent !== null ? v - prev.net_income_parent : null;
  });
  const out = new Map<string, Filing>();
  qs.forEach((q, i) => {
    let ttm: number | null = null;
    if (i >= 3 && key[i] - key[i - 3] === 3) {
      const w = ni.slice(i - 3, i + 1);
      if (w.every((x) => x !== null)) ttm = (w as number[]).reduce((a, b) => a + b, 0);
    }
    if (q.published) out.set(q.published, { published: q.published, periodEnd: q.period_end, niTtm: ttm, equity: q.equity_parent, shares: q.shares });
  });
  return [...out.values()].sort((a, b) => (a.published < b.published ? -1 : 1));
}

/** Daily P/E and P/B. `priceUnit` converts the stored price (thousand VND) to VND; shares = latest filing's (matches shares_mode "latest"). */
export function valuationSeries(dates: string[], closes: number[], filings: Filing[], priceUnit = 1000, maxAgeDays = 400): ValPoint[] {
  const shares = [...filings].reverse().find((f) => f.shares !== null)?.shares ?? null;
  const out: ValPoint[] = [];
  let j = -1;
  for (let i = 0; i < dates.length; i++) {
    while (j + 1 < filings.length && filings[j + 1].published <= dates[i]) j++;
    const f = j >= 0 ? filings[j] : null;
    const fresh = f !== null && (Date.parse(dates[i]) - Date.parse(f.published)) / DAY <= maxAgeDays;
    const mcap = fresh && shares !== null ? closes[i] * priceUnit * shares : null;
    const ni = fresh ? f!.niTtm : null, eq = fresh ? f!.equity : null;
    out.push({ date: dates[i], price: closes[i], mcap, ni, eq,
      pe: mcap !== null && ni !== null && ni > 0 ? mcap / ni : null, pb: mcap !== null && eq !== null && eq > 0 ? mcap / eq : null });
  }
  return out;
}
