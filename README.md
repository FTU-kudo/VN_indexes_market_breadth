# Vietnam Market Intelligence

Daily Vietnamese equity data (Yuanta `ysradar` APIs) → GitHub JSON files → technical indicators + market breadth → Next.js dashboard on Vercel.
No database: **the repository is the data store**; GitHub Actions is the scheduler; the dashboard reads `raw.githubusercontent.com`.

```
backend/   yuanta_api.py  collect_data.py  calculate_indicators.py  calculate_breadth.py  validate_data.py  indicators.py  store.py  config.py
tests/     29 pytest tests (API parsing, timestamps, indicators incl. no-look-ahead, breadth, incremental sync)
data/      written by the workflows (see "Data layout")
frontend/  Next.js 14 + TypeScript + Tailwind + lightweight-charts
.github/workflows/  daily_update.yml  manual_backfill.yml
```

## Setup (about 10 minutes)
1. Create a **public** GitHub repo (raw URLs must be readable without a token) and push this folder.
2. *Settings → Actions → General → Workflow permissions* → **Read and write**.
3. *Actions → Manual backfill → Run workflow* (full = true). First run downloads 2020-01-01 → today for every symbol.
4. Vercel → *Add New Project* → import the repo → **Root Directory = `frontend`**. Add env var
   `NEXT_PUBLIC_DATA_BASE_URL = https://raw.githubusercontent.com/<OWNER>/<REPO>/main/data`. Deploy.
   `frontend/vercel.json` skips builds for data-only commits, so daily data pushes do not redeploy.
5. From then on `daily_update.yml` runs Mon–Fri 09:00 UTC (16:00 Vietnam), commits only when data changed.

Local: `pip install -r requirements.txt && pytest && python -m backend.collect_data && python -m backend.calculate_indicators && python -m backend.calculate_breadth && python -m backend.validate_data`.
Frontend: `cd frontend && cp .env.example .env.local && npm install && npm run dev`.

## What was verified, and what was not
Verified from real browser captures of the three endpoints: JSON shapes (`{success,response[]}`; history `{s:"ok",bars:[{t,o,h,l,c,v}]}`), `t` = 00:00 UTC of the trade date, index/stock field names, `exchange=HSX` and `index_code=VN100` parameters. The parsers' unit tests use records copied from those captures.

**Not verified (the build sandbox could not reach `ysradar.yuanta.com.vn`; the code has not made a live call):**
- `exchange=HNX` / `exchange=UPCOM` values, and whether every index code from `list_index` works as a `history` symbol or `index_code`. Failures are logged per symbol to `data/monitor/status.json` and shown on the Monitor page; nothing is guessed.
- Which `SymbolType` values exist besides `"ST"`. Only `ST` is treated as an equity (`EQUITY_SYMBOL_TYPES` in `config.py`). The first run records the full type distribution in `status.json → universe.symbol_types`; widen the set if ETFs or others should be included.
- Rate limits. Concurrency is 8 workers with exponential back-off; lower `MAX_WORKERS` if you see 429s.
- **Price adjustment.** VIC's first 2020 bar is 51.06, far below its traded price then, so the history looks *adjusted* (and in thousand VND). Adjusted history changes retroactively, which would corrupt an append-only store. Each run therefore re-fetches the last 15 days and compares closes; any mismatch (> 0.01%) triggers a full re-download of that symbol. A halted stock with no bars in the overlap window cannot be checked, so run the manual backfill (full) occasionally, e.g. monthly.

## Data layout
| Path | Content |
|---|---|
| `data/indexes.json`, `stocks.json`, `constituents.json` | discovered universe (stocks carry exchange, SymbolType, index memberships) |
| `data/constituents_history.json` | first snapshot + dated add/remove log (history begins at the first run) |
| `data/prices/{stocks,indexes}/<SYM>/<year>.json` | columnar OHLCV `{d,o,h,l,c,v}`; past years are immutable unless an adjustment is detected |
| `data/indicators/snapshot_{stocks,indexes}.json` | latest value of ~70 indicators per symbol (screener, stock table) |
| `data/indicators/indexes/<CODE>.json` | last 500 bars of every indicator per index |
| `data/breadth/<GROUP>.json`, `index.json` | full daily breadth history for MARKET, HOSE, HNX, UPCOM and every index with constituents |
| `data/monitor/status.json`, `validation.json` | last data change, latest session, counts, failures, integrity results |

### Deliberate deviations from the brief
- **Stock indicator history is not stored** (only the latest-row snapshot). ~1,500 stocks × 1,700 bars × 70 indicators would be ~180 M values rewritten and re-diffed in Git. Chart overlays (SMA, BB, RSI, MACD) are computed in the browser from OHLCV (`frontend/lib/ta.ts`, mirrors the Python). Set `STOCK_HISTORY_BARS` in `config.py` to store a rolling window per stock if you want it. Indexes keep 500 bars.
- Breadth is recomputed from full history every run (idempotent), but it is cheap because only snapshots/aggregates are written.
- Schedule is Mon–Fri only. Holidays need no calendar: the latest session is the last VNINDEX bar, and a day without a new bar requests nothing and commits nothing. (GitHub disables scheduled workflows after 60 days without repository activity; data commits count, but a long gap would need a manual re-enable.)

### Storage estimate (estimate, not measured on real data)
~1,500 equities × ~1,700 bars × ~45 B ≈ 100–120 MB raw JSON, roughly 30–40 MB compressed in Git. A synthetic test (300 symbols, 4-decimal random prices, pessimistic) wrote 34 MB. Daily growth is a few hundred KB; only the current-year file per symbol is rewritten. Stay well below GitHub's ~1 GB guidance; no Git LFS needed.

## Breadth methodology
- Calendar = VNINDEX trading dates. A stock without a bar is excluded from that day's numerator **and** denominator (never forward-filled). Percentages need ≥ 5 valid members.
- MA/RSI/MACD are computed on each stock's own bars. 1/5/20-day returns use calendar-aligned closes (NaN if either day is missing). Advancing/declining/unchanged = sign of the 1-day return.
- New N-day high/low: close above/below the max/min of the **previous** N closes (today excluded); 52-week = 252 bars.
- A/D line = cumulative (advancing − declining) from the group's first date.
- **Survivorship bias:** the API only lists current stocks and current constituents, so every group uses *current* membership for all history and excludes delisted names. This is stamped in each breadth file (`membership_basis`) and shown on the Breadth page. `constituents_history.json` begins recording real changes from the first run onward.
- **Composite score (0–100)** = weighted mean of five components, renormalised over those available: MA (mean % above MA20/50/200) 0.35, A/D (10-day mean of adv/(adv+dec)) 0.20, highs/lows (10-day 50d-high share) 0.15, % MACD bullish 0.15, % RSI>50 0.15. Weights live in `config.py` or `python -m backend.calculate_breadth --weights ma=0.4,ad=0.2,hl=0.1,macd=0.15,rsi=0.15`. It is a descriptive heuristic; its predictive value has **not** been tested.

## Indicator reference (all causal; verified by a truncation test that compares every column)
SMA/EMA 5,10,20,50,100,200 (EMA `adjust=False`, first value after n bars) · RSI 6/9/14/21 (Wilder, α=1/n) · MACD 12/26/9 · Stochastic %K14/%D3 · Williams %R 14 · ROC 12 · ADX/DI± 14 (Wilder) · Parabolic SAR (0.02/0.02/0.2) · Supertrend (ATR 10, ×3) · Ichimoku 9/26/52 (cloud shown at its plotted date, i.e. shifted +26; Chikou span omitted because it needs future data) · ATR 14 · Bollinger 20,2 (population σ), %B, width · historical volatility 20/60 (log returns, ×√252, %) · drawdown from running peak and 252-bar max drawdown · OBV · volume SMA 10/20/50 and ratio to SMA20 · MFI 14 · accumulation/distribution line · performance 5/10/20/50/100/200 bars · relative strength = stock performance − VNINDEX performance (percentage points) plus `rs_ratio` = close / VNINDEX close. OBV, A/D line and the running-peak drawdown depend on the series start (2020-01-02 or IPO date).

## Operations
- Re-run after a bad day: Actions → *Manual backfill* (optionally `symbols=VIC,VHM`, `full=true`).
- Pipeline order: universe → incremental OHLCV → indicators → breadth → validate → commit. Validation failures (VNINDEX missing/stale > 14 days, > 5% of series with errors, missing derived files) block the commit step.
- Partial collection failures do not discard successful symbols; the job still ends red if the benchmark failed or > 20% of requests failed.
- Runs are serialised by a `concurrency` group; reruns are idempotent (files are rewritten only when bytes change, writes are atomic).
