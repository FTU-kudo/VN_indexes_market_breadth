"""Universe discovery + incremental OHLCV collection.

Exit codes: 0 ok | 1 partial failures (data still usable, commit it) | 2 fatal (nothing usable, stop).

Usage:
  python -m backend.collect_data                 # daily incremental run
  python -m backend.collect_data --full          # full re-download from 2020-01-01
  python -m backend.collect_data --symbols VIC,VNINDEX
  python -m backend.collect_data --universe-only

Design notes
* The latest trading session is *data-driven*: it is the last bar of VNINDEX. Weekends and Vietnamese
  holidays simply produce no new bar, so nothing is requested and nothing is committed.
* Bars dated "today" are discarded before the session is final (15:15 ICT) so a partial bar is never stored.
* Each run re-fetches OVERLAP_DAYS of history. If overlapping closes disagree with what is stored
  (dividend / bonus-share adjustment of the vendor's history) the symbol is fully re-downloaded.
* Every symbol is written atomically and independently, so an interrupted run is simply resumed by the next one.
"""
from __future__ import annotations

import argparse
import logging
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import date, datetime, timedelta

import pandas as pd

from . import config as C
from .store import load_prices, read_json, save_prices, update_status, utc_now_iso, write_if_changed
from .yuanta_api import YuantaAPIError, YuantaClient, history_end_epoch, now_vn, session_is_final

log = logging.getLogger("collect")


# ---------------------------------------------------------------- helpers
def bars_to_df(bars: list[dict]) -> pd.DataFrame:
    if not bars:
        return pd.DataFrame({k: pd.Series(dtype="float64") for k in "ohlcv"}, index=pd.DatetimeIndex([], name="date"))
    df = pd.DataFrame(bars)
    df["date"] = pd.to_datetime(df["date"])
    return df.set_index("date")[list("ohlcv")].sort_index()


def diff_constituents(old: dict[str, list[str]], new: dict[str, list[str]]) -> list[dict]:
    """Membership changes between two snapshots (only indexes present in both)."""
    out = []
    for code in sorted(set(old) & set(new)):
        a, b = set(old[code]), set(new[code])
        if a != b:
            out.append({"index": code, "added": sorted(b - a), "removed": sorted(a - b)})
    return out


@dataclass
class SyncResult:
    symbol: str
    kind: str
    status: str            # up_to_date | updated | unchanged | adjusted | empty | failed
    new_bars: int = 0
    error: str | None = None


# ---------------------------------------------------------------- per-symbol sync
def sync_symbol(client: YuantaClient, kind: str, symbol: str, now: datetime,
                latest_date: date | None, full: bool = False) -> SyncResult:
    try:
        existing = load_prices(kind, symbol)
        have = not existing.empty
        if have and not full and latest_date is not None and existing.index[-1].date() >= latest_date:
            return SyncResult(symbol, kind, "up_to_date")

        start = C.START_DATE
        if have and not full:
            start = max(C.START_DATE, existing.index[-1].date() - timedelta(days=C.OVERLAP_DAYS))
        end_epoch = history_end_epoch(now)
        final = session_is_final(now)

        def fetch(s: date) -> pd.DataFrame:
            bars = client.history(symbol, s, end_epoch)
            if not final:
                bars = [b for b in bars if b["date"] < now.date()]
            return bars_to_df(bars)

        new = fetch(start)
        if new.empty:
            return SyncResult(symbol, kind, "unchanged" if have else "empty")

        adjusted = False
        if have and not full:
            common = existing.index.intersection(new.index)
            if len(common):
                rel = (existing.loc[common, "c"] / new.loc[common, "c"] - 1).abs()
                adjusted = bool((rel > C.ADJUSTMENT_TOL).any())
        if adjusted:
            log.warning("%s: overlap mismatch -> full re-download (likely price adjustment)", symbol)
            merged = fetch(C.START_DATE)
        else:
            merged = pd.concat([existing[~existing.index.isin(new.index)], new]).sort_index()
        n_new = int(len(merged.index.difference(existing.index)))
        changed = save_prices(kind, symbol, merged)
        return SyncResult(symbol, kind, "adjusted" if adjusted else ("updated" if changed else "unchanged"), n_new)
    except (YuantaAPIError, OSError, KeyError, ValueError) as e:
        return SyncResult(symbol, kind, "failed", error=str(e)[:300])


# ---------------------------------------------------------------- universe discovery
def discover_universe(client: YuantaClient, failures: list[dict]) -> dict:
    prev_stocks = read_json(C.DATA / "stocks.json", []) or []
    prev_const = (read_json(C.DATA / "constituents.json", {}) or {}).get("indexes", {})

    indexes = client.list_indexes()
    if not indexes:
        raise YuantaAPIError("list_index returned no indexes")

    stocks: dict[str, dict] = {}
    for ex in C.EXCHANGES:
        try:
            for s in client.list_stocks(exchange=ex):
                rec = stocks.setdefault(s["symbol"], {"symbol": s["symbol"], "type": s["type"],
                                                      "exchange": C.EXCHANGE_LABEL.get(s["exchange"] or ex, s["exchange"] or ex)})
                if rec["exchange"] != C.EXCHANGE_LABEL.get(ex, ex):
                    log.warning("%s listed under several exchanges (%s, %s)", s["symbol"], rec["exchange"], ex)
        except YuantaAPIError as e:
            failures.append({"symbol": f"exchange={ex}", "kind": "universe", "error": str(e)[:300]})

    if prev_stocks and len(stocks) < 0.7 * len(prev_stocks):  # partial outage guard: never shrink the universe blindly
        failures.append({"symbol": "stocks", "kind": "universe",
                         "error": f"only {len(stocks)} stocks vs {len(prev_stocks)} stored; kept previous universe"})
        stocks = {s["symbol"]: {k: s[k] for k in ("symbol", "type", "exchange")} for s in prev_stocks}

    constituents: dict[str, list[str]] = {}
    for ix in indexes:
        try:
            members = sorted({s["symbol"] for s in client.list_stocks(index_code=ix["code"])})
            constituents[ix["code"]] = members
        except YuantaAPIError as e:
            failures.append({"symbol": f"index_code={ix['code']}", "kind": "constituents", "error": str(e)[:300]})
            if ix["code"] in prev_const:
                constituents[ix["code"]] = prev_const[ix["code"]]

    by_stock: dict[str, list[str]] = {}
    for code, members in constituents.items():
        for sym in members:
            by_stock.setdefault(sym, []).append(code)
            if sym not in stocks:  # constituent not in any exchange list (rare): keep, exchange unknown
                stocks[sym] = {"symbol": sym, "type": None, "exchange": None}
    stock_list = [{**stocks[s], "indexes": sorted(by_stock.get(s, []))} for s in sorted(stocks)]

    write_if_changed(C.DATA / "indexes.json", indexes)
    write_if_changed(C.DATA / "stocks.json", stock_list)
    write_if_changed(C.DATA / "constituents.json",
                     {"basis": "current_snapshot_from_list_stock_info", "indexes": constituents})

    # Point-in-time membership log: the API only exposes *current* constituents, so history starts today.
    hist_path = C.DATA / "constituents_history.json"
    hist = read_json(hist_path)
    today = now_vn().date().isoformat()
    if hist is None:
        write_if_changed(hist_path, {"initial_date": today, "initial": constituents, "changes": []})
    else:
        last = {k: list(v) for k, v in hist["initial"].items()}
        for ch in hist["changes"]:
            s = set(last.get(ch["index"], []))
            last[ch["index"]] = sorted((s | set(ch["added"])) - set(ch["removed"]))
        new_changes = [{"date": today, **c} for c in diff_constituents(last, constituents)]
        if new_changes:
            hist["changes"].extend(new_changes)
            write_if_changed(hist_path, hist)

    return {"indexes": indexes, "stocks": stock_list}


# ---------------------------------------------------------------- main
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true", help="re-download complete history")
    ap.add_argument("--symbols", default="", help="comma separated subset (stocks and/or index codes)")
    ap.add_argument("--universe-only", action="store_true")
    ap.add_argument("--workers", type=int, default=C.MAX_WORKERS)
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)

    client, now = YuantaClient(), now_vn()
    failures: list[dict] = []
    try:
        uni = discover_universe(client, failures)
    except YuantaAPIError as e:
        log.error("FATAL: universe discovery failed: %s", e)
        return 2
    if not uni["stocks"]:
        log.error("FATAL: no stocks discovered. Failures: %s", failures[:5])
        return 2
    type_counts = Counter(str(s["type"]) for s in uni["stocks"])
    log.info("universe: %d indexes, %d listed symbols, types=%s", len(uni["indexes"]), len(uni["stocks"]), dict(type_counts))
    if args.universe_only:
        return 0

    subset = {s.strip().upper() for s in args.symbols.split(",") if s.strip()}
    index_codes = [i["code"] for i in uni["indexes"] if not subset or i["code"] in subset]
    equities = [s["symbol"] for s in uni["stocks"] if s["type"] in C.EQUITY_SYMBOL_TYPES and (not subset or s["symbol"] in subset)]

    # 1) benchmark first -> latest trading session
    bench_ok, bench_res = True, None
    if C.BENCHMARK in index_codes or not subset:
        r = bench_res = sync_symbol(client, "indexes", C.BENCHMARK, now, None, args.full)
        if r.status == "failed":
            bench_ok = False
            failures.append({"symbol": r.symbol, "kind": "indexes", "error": r.error})
    bench = load_prices("indexes", C.BENCHMARK)
    latest = bench.index[-1].date() if not bench.empty else None
    log.info("benchmark %s: %s (%d new bars)", C.BENCHMARK, bench_res.status if bench_res else "skipped", bench_res.new_bars if bench_res else 0)
    log.info("latest trading session (VNINDEX): %s", latest)

    # 2) everything else
    tasks = [("indexes", c) for c in index_codes if c != C.BENCHMARK] + [("stocks", s) for s in equities]
    results: list[SyncResult] = []
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as ex:
        futs = [ex.submit(sync_symbol, client, k, s, now, latest, args.full) for k, s in tasks]
        for i, f in enumerate(as_completed(futs), 1):
            r = f.result()
            results.append(r)
            if r.status == "failed":
                failures.append({"symbol": r.symbol, "kind": r.kind, "error": r.error})
            if i % 200 == 0:
                log.info("progress %d/%d", i, len(tasks))

    counts = Counter(r.status for r in results)
    attempted = len(results) - counts["up_to_date"]
    log.info("results: %s | new bars: %d", dict(counts), sum(r.new_bars for r in results))
    data_changed = any(r.status in ("updated", "adjusted") for r in results + ([bench_res] if bench_res else []))

    prev = read_json(C.DATA / "monitor" / "status.json", {}) or {}
    failures = sorted(failures, key=lambda f: (f["kind"], f["symbol"]))
    update_status({
        "latest_trading_date": latest.isoformat() if latest else None,
        "last_data_change_utc": utc_now_iso() if data_changed else prev.get("last_data_change_utc"),
        "n_indexes": len(index_codes), "n_stocks": len(equities),
        "universe": {"indexes_listed": len(uni["indexes"]), "symbols_listed": len(uni["stocks"]),
                     "symbol_types": dict(sorted(type_counts.items())), "equity_types_used": sorted(C.EQUITY_SYMBOL_TYPES)},
        "collect": {"requested": len(tasks), "up_to_date": counts["up_to_date"], "updated": counts["updated"],
                    "adjusted": counts["adjusted"], "empty": counts["empty"], "failed": len(failures)},
        "failures": failures[:200],
    })
    for f in failures[:10]:
        log.error("failure: %s %s -> %s", f["kind"], f["symbol"], f["error"])
    if not bench_ok:
        log.error("benchmark %s failed", C.BENCHMARK)
        return 1 if not bench.empty else 2   # 2 = nothing usable stored at all
    if attempted and len(failures) / max(attempted, 1) > 0.2:
        log.error("failure rate too high: %d/%d", len(failures), attempted)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
