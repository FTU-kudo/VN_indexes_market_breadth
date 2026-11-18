"""Compute indicators for every stored index/stock and write snapshots (+ history where configured).

Outputs
  data/indicators/snapshot_indexes.json, snapshot_stocks.json   latest row for every symbol
  data/indicators/indexes/<CODE>.json                          last INDEX_HISTORY_BARS bars, all indicators
  data/indicators/stocks/<SYM>.json                            only if STOCK_HISTORY_BARS > 0
"""
from __future__ import annotations

import logging
import sys

import pandas as pd

from . import config as C
from .indicators import compute_indicators
from .store import list_symbols, load_prices, series_list, write_if_changed

log = logging.getLogger("indicators")


def history_payload(symbol: str, ind: pd.DataFrame, bars: int) -> dict:
    t = ind.tail(bars)
    return {"symbol": symbol, "dates": [d.strftime("%Y-%m-%d") for d in t.index],
            "series": {c: series_list(t[c], 4) for c in t.columns}}


def snapshot_row(symbol: str, ind: pd.DataFrame) -> dict:
    last = ind.iloc[-1]
    row = {"symbol": symbol, "date": ind.index[-1].strftime("%Y-%m-%d"), "bars": int(len(ind))}
    for c, v in last.items():
        row[c] = None if pd.isna(v) else round(float(v), 4)
    return row


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)
    bench_df = load_prices("indexes", C.BENCHMARK)
    bench = bench_df["c"] if not bench_df.empty else None
    if bench is None:
        log.warning("no %s prices: relative strength will be skipped", C.BENCHMARK)
    for kind in ("indexes", "stocks"):
        rows, changed = [], 0
        for sym in list_symbols(kind):
            df = load_prices(kind, sym)
            if len(df) < 2:
                continue
            ind = compute_indicators(df, bench if sym != C.BENCHMARK else None)
            rows.append(snapshot_row(sym, ind))
            bars = C.INDEX_HISTORY_BARS if kind == "indexes" else C.STOCK_HISTORY_BARS
            if bars > 0:
                changed += write_if_changed(C.DATA / "indicators" / kind / f"{sym}.json", history_payload(sym, ind, bars))
        write_if_changed(C.DATA / "indicators" / f"snapshot_{kind}.json", {"rows": rows})
        log.info("%s: %d symbols, %d history files changed", kind, len(rows), changed)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
