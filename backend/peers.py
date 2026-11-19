"""Compare a stock's P/E and P/B with its benchmark / peer groups.

  python -m backend.peers VIC                  # latest snapshot vs every group the stock belongs to
  python -m backend.peers VIC --history out.csv  # daily P/E, P/B vs each group's median
Groups = whole market, its exchange, every index it belongs to (main indexes and sector indexes).
Needs data/valuation/ (calculate_valuation) first.
"""
from __future__ import annotations

import argparse

import numpy as np
import pandas as pd

from . import config as C
from .calculate_breadth import build_groups
from .fundamentals_api import expected_latest_quarter  # noqa: F401  (re-exported for convenience)
from .store import load_prices, read_json
from .valuation import prepare_fundamentals, valuation_for_symbol


def groups_for(symbol: str) -> list[dict]:
    stocks = read_json(C.DATA / "stocks.json", []) or []
    cons = (read_json(C.DATA / "constituents.json", {}) or {}).get("indexes", {})
    indexes = read_json(C.DATA / "indexes.json", []) or []
    return [g for g in build_groups(stocks, cons, indexes) if symbol in g["members"]]


def peer_snapshot(symbol: str) -> pd.DataFrame:
    """Latest P/E and P/B of `symbol` against each group: group median, premium/discount, and rank percentile."""
    snap = pd.DataFrame((read_json(C.DATA / "valuation" / "snapshot.json", {}) or {}).get("rows", []))
    if snap.empty or symbol not in set(snap["symbol"]):
        return pd.DataFrame()
    snap = snap.set_index("symbol")
    me = snap.loc[symbol]
    rows = []
    for g in groups_for(symbol):
        sub = snap.reindex([m for m in g["members"] if m in snap.index])
        row = {"group": g["id"], "kind": g["kind"], "n": len(sub)}
        for k in ("pe", "pb"):
            vals = sub[k].dropna()
            med = vals.median() if len(vals) else np.nan
            row.update({f"stock_{k}": me[k], f"median_{k}": med,
                        f"{k}_vs_median_pct": (me[k] / med - 1) * 100 if pd.notna(me[k]) and pd.notna(med) and med else np.nan,
                        f"{k}_percentile": (vals <= me[k]).mean() * 100 if pd.notna(me[k]) and len(vals) else np.nan})
        rows.append(row)
    return pd.DataFrame(rows)


def stock_vs_peers(symbol: str) -> pd.DataFrame:
    """Daily P/E, P/B of one stock next to the median P/E, P/B of each group it belongs to."""
    j = read_json(C.DATA / "fundamentals" / f"{symbol}.json") or {}
    px = load_prices("stocks", symbol)
    if not j.get("quarters") or px.empty:
        return pd.DataFrame()
    f = prepare_fundamentals(j["quarters"], C.FUND_CUMULATIVE or bool(j.get("cumulative")))
    out = valuation_for_symbol(px["c"], f)[["price", "pe", "pb"]]
    for g in groups_for(symbol):
        v = read_json(C.DATA / "valuation" / f"{g['id']}.json")
        if not v:
            continue
        s = pd.DataFrame(v["series"], index=pd.to_datetime(v["dates"]))
        out[f"{g['id']}_median_pe"], out[f"{g['id']}_median_pb"] = s["median_pe"], s["median_pb"]
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("symbol")
    ap.add_argument("--history", default="", help="write the daily comparison to this CSV")
    a = ap.parse_args(argv)
    sym = a.symbol.upper()
    snap = peer_snapshot(sym)
    if snap.empty:
        print(f"{sym}: no valuation snapshot (needs fundamentals + calculate_valuation)")
        return 1
    with pd.option_context("display.width", 200, "display.max_columns", 20, "display.float_format", "{:,.2f}".format):
        print(snap.to_string(index=False))
    if a.history:
        stock_vs_peers(sym).to_csv(a.history)
        print("wrote", a.history)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
