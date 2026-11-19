"""Daily P/E and P/B for every stock and group, from stored prices + data/fundamentals/*.json.

Outputs
  data/valuation/snapshot.json   latest valuation per stock
  data/valuation/<GROUP>.json    daily history per group (whole market, exchanges, indexes, optional sectors)
  data/valuation/index.json      list of groups + method notes
Does nothing (exit 0) until fundamentals files exist. Optional sector mapping: data/reference/sectors.csv (symbol,sector).
"""
from __future__ import annotations

import csv
import logging
import re
import sys

import pandas as pd

from . import config as C
from .calculate_breadth import build_groups
from .store import load_prices, read_json, series_list, write_if_changed
from .valuation import aggregate_group, prepare_fundamentals, valuation_for_symbol

log = logging.getLogger("valuation")


def sector_groups(stocks: list[dict]) -> list[dict]:
    path = C.DATA / "reference" / "sectors.csv"
    if not path.exists():
        return []
    by: dict[str, list[str]] = {}
    with path.open(encoding="utf-8-sig") as fh:
        for r in csv.DictReader(fh):
            sym, sec = (r.get("symbol") or "").strip().upper(), (r.get("sector") or "").strip()
            if sym and sec:
                by.setdefault(sec, []).append(sym)
    out = []
    for sec, members in sorted(by.items()):
        gid = "SECTOR_" + re.sub(r"[^A-Za-z0-9]+", "_", sec).strip("_")[:24]
        out.append({"id": gid, "label": sec, "kind": "sector", "members": members})
    return out


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)
    fdir = C.DATA / "fundamentals"
    files = sorted(fdir.glob("*.json")) if fdir.exists() else []
    if not files:
        log.info("no fundamentals in %s yet - valuation skipped", fdir)
        return 0
    stocks = read_json(C.DATA / "stocks.json", []) or []
    cons = (read_json(C.DATA / "constituents.json", {}) or {}).get("indexes", {})
    indexes = read_json(C.DATA / "indexes.json", []) or []
    bench = load_prices("indexes", C.BENCHMARK)
    if bench.empty:
        log.error("no %s prices", C.BENCHMARK)
        return 1
    master = bench.index

    frames: dict[str, pd.DataFrame] = {}
    snap = []
    for fp in files:
        j = read_json(fp)
        sym = (j or {}).get("symbol")
        if not sym or not j.get("quarters"):
            continue
        px = load_prices("stocks", sym)
        if px.empty:
            continue
        f = prepare_fundamentals(j["quarters"], C.FUND_CUMULATIVE or bool(j.get("cumulative")))
        v = valuation_for_symbol(px["c"], f)
        if v.empty:
            continue
        frames[sym] = v
        last = v.dropna(subset=["price"]).iloc[-1]
        snap.append({"symbol": sym, "date": v.index[-1].strftime("%Y-%m-%d"), "price": last["price"], "mcap": last["mcap"],
                     "pe": last["pe"], "pb": last["pb"], "ni_ttm": last["ni_ttm"], "equity": last["equity"],
                     "loss": None if pd.isna(last["loss"]) else bool(last["loss"]),
                     "filing_age_days": None if pd.isna(last["age_days"]) else int(last["age_days"]),
                     "stale": bool(pd.notna(last["age_days"]) and last["age_days"] > C.STALE_FILING_DAYS)})
    if not frames:
        log.warning("fundamentals present but no stock matched stored prices")
        return 0
    M = {k: pd.DataFrame({s: v[k].astype("float64") for s, v in frames.items()}).reindex(master)
         for k in ("mcap", "ni_ttm", "equity", "pe", "pb")}
    method = {"shares_mode": C.VALUATION_SHARES_MODE, "price_unit_vnd": C.PRICE_UNIT_VND, "basis": "consolidated, parent shareholders",
              "pe": "market cap / TTM net income (positive only)", "pb": "market cap / parent equity (positive only)",
              "aggregate": "sum of market cap / sum of earnings (or equity) over positive members",
              "membership": "current constituents (survivorship-biased)"}
    write_if_changed(C.DATA / "valuation" / "snapshot.json", {"method": method, "rows": sorted(snap, key=lambda r: r["symbol"])})

    listing = []
    for g in build_groups(stocks, cons, indexes) + sector_groups(stocks):
        cols = [m for m in g["members"] if m in frames]
        if len(cols) < C.MIN_GROUP_SIZE:
            continue
        df = aggregate_group(M, cols)
        df = df[df["n_pe"] + df["n_pb"] > 0]
        if df.empty:
            continue
        payload = {"id": g["id"], "label": g["label"], "kind": g["kind"], "method": method, "n_members": len(g["members"]),
                   "n_members_with_fundamentals": len(cols), "dates": [d.strftime("%Y-%m-%d") for d in df.index],
                   "series": {c: series_list(df[c], 2) for c in df.columns}}
        write_if_changed(C.DATA / "valuation" / f"{g['id']}.json", payload)
        last = df.iloc[-1]
        listing.append({"id": g["id"], "label": g["label"], "kind": g["kind"], "n_members": len(cols),
                        "last_date": df.index[-1].strftime("%Y-%m-%d"),
                        "median_pe": None if pd.isna(last["median_pe"]) else round(float(last["median_pe"]), 2),
                        "median_pb": None if pd.isna(last["median_pb"]) else round(float(last["median_pb"]), 2)})
    write_if_changed(C.DATA / "valuation" / "index.json", {"groups": listing, "method": method})
    log.info("valuation: %d stocks, %d groups", len(frames), len(listing))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
