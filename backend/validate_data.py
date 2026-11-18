"""Integrity checks over stored prices + derived files. Exit 1 on fatal problems. Output is deterministic."""
from __future__ import annotations

import sys
from datetime import date, timedelta

import pandas as pd

from . import config as C
from .store import list_symbols, load_prices, read_json, write_if_changed

TOL = 1e-6


def check_frame(df: pd.DataFrame, today: date) -> tuple[list[str], list[str]]:
    errors, warns = [], []
    if df.empty:
        return ["empty series"], warns
    if not df.index.is_monotonic_increasing or df.index.has_duplicates:
        errors.append("dates not strictly increasing")
    if df.index[0].date() < C.START_DATE:
        errors.append(f"bar before {C.START_DATE}")
    if df.index[-1].date() > today:
        errors.append("bar dated in the future")
    if df.isna().any().any():
        errors.append("NaN values")
    if (df[["o", "h", "l", "c"]] <= 0).any().any():
        errors.append("non-positive price")
    if (df["v"] < 0).any():
        errors.append("negative volume")
    bad_hi = int((df["h"] < df[["o", "c", "l"]].max(axis=1) - TOL).sum())
    bad_lo = int((df["l"] > df[["o", "c", "h"]].min(axis=1) + TOL).sum())
    if bad_hi or bad_lo:
        warns.append(f"OHLC inconsistent on {bad_hi + bad_lo} bars")
    return errors, warns


def main() -> int:
    today = pd.Timestamp.now(tz=C.TZ).date()
    issues, n, n_err, n_warn, stale = [], 0, 0, 0, 0
    status = read_json(C.DATA / "monitor" / "status.json", {}) or {}
    latest = status.get("latest_trading_date")
    for kind in ("indexes", "stocks"):
        for sym in list_symbols(kind):
            n += 1
            e, w = check_frame(load_prices(kind, sym), today)
            n_err += bool(e)
            n_warn += bool(w)
            for m in e:
                issues.append({"symbol": sym, "level": "error", "msg": m})
            for m in w:
                issues.append({"symbol": sym, "level": "warning", "msg": m})
            if latest and not e:
                last = load_prices(kind, sym).index[-1].date()
                stale += last < date.fromisoformat(latest) - timedelta(days=10)

    fatal = []
    bench = load_prices("indexes", C.BENCHMARK)
    if bench.empty:
        fatal.append(f"{C.BENCHMARK} has no data")
    elif today - bench.index[-1].date() > timedelta(days=14):
        fatal.append(f"{C.BENCHMARK} stale: last bar {bench.index[-1].date()}")
    if n and n_err / n > 0.05:
        fatal.append(f"{n_err}/{n} series have errors")
    for f in ("snapshot_indexes.json", "snapshot_stocks.json"):
        if not (C.DATA / "indicators" / f).exists():
            fatal.append(f"missing indicators/{f}")
    if not (C.DATA / "breadth" / "index.json").exists():
        fatal.append("missing breadth/index.json")

    write_if_changed(C.DATA / "monitor" / "validation.json", {
        "series_checked": n, "series_with_errors": n_err, "series_with_warnings": n_warn,
        "series_stale_over_10d": stale, "fatal": fatal,
        "issues": sorted(issues, key=lambda i: (i["level"], i["symbol"]))[:100]})
    for m in fatal:
        print("FATAL:", m, file=sys.stderr)
    print(f"validated {n} series: {n_err} with errors, {n_warn} with warnings, {stale} stale")
    return 1 if fatal else 0


if __name__ == "__main__":
    raise SystemExit(main())
