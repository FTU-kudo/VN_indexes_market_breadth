# backend/calculate_valuation.py
"""Daily P/E and P/B for every stock, scope (market / exchange / index) and group, from prices + data/fundamentals/*.json.

Outputs
  data/valuation/snapshot.json   latest valuation per stock, with exchange / sector / industry / group
  data/valuation/<SCOPE>.json    per scope (MARKET, HOSE, HNX, UPCOM, every index): whole-scope statistics plus `parts`,
                                 the per-group additive components behind the "exclude groups" view
  data/valuation/index.json      list of scopes + method notes
Does nothing (exit 0) until fundamentals files exist. Optional classification file: data/reference/sectors.csv.
"""
from __future__ import annotations

import logging
import sys
from collections import Counter

import pandas as pd

from . import config as C
from .calculate_breadth import build_groups
from .classification import load_classification
from .store import load_prices, read_json, series_list, write_if_changed
from .valuation import aggregate_group, partition_components, prepare_fundamentals, valuation_for_symbol

log = logging.getLogger("valuation")
PART_DECIMALS = {"n_pe": 0, "n_pb": 0, "mcap_pe": 3, "ni": 3, "mcap_pb": 3, "eq": 3, "med_pe": 2, "med_pb": 2}


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
    cls = load_classification().set_index("symbol")
    group_of = cls["group"].to_dict()

    frames: dict[str, pd.DataFrame] = {}
    snap = []
    cov = {"no_prices": [], "no_net_income": [], "no_equity": [], "no_shares": [], "no_ttm": [], "invalid_dates": []}
    last_ni_period: Counter = Counter()
    for fp in files:
        j = read_json(fp)
        sym = (j or {}).get("symbol")
        if not sym or not j.get("quarters"):
            continue
        px = load_prices("stocks", sym)
        qs = j["quarters"]
        if any(q["period_end"] < "1990-01-01" for q in qs):
            cov["invalid_dates"].append(sym)
        if not any(q.get("net_income_parent") is not None for q in qs):
            cov["no_net_income"].append(sym)
        if not any(q.get("equity_parent") is not None for q in qs):
            cov["no_equity"].append(sym)
        if not any(q.get("shares") is not None for q in qs):
            cov["no_shares"].append(sym)
        if px.empty:
            cov["no_prices"].append(sym)
            continue
        f = prepare_fundamentals(j["quarters"], C.FUND_CUMULATIVE or bool(j.get("cumulative")))
        if f["ni_ttm"].notna().any():
            pe_end = f.loc[f["ni_ttm"].notna(), "period_end"].iloc[-1]
            last_ni_period[f"{pe_end.year}Q{(pe_end.month - 1) // 3 + 1}"] += 1
        else:
            cov["no_ttm"].append(sym)
        v = valuation_for_symbol(px["c"], f)
        if v.empty:
            continue
        frames[sym] = v
        last = v.dropna(subset=["price"]).iloc[-1]
        c = cls.loc[sym] if sym in cls.index else None
        snap.append({"symbol": sym, "date": v.index[-1].strftime("%Y-%m-%d"),
                     "exchange": None if c is None else c["exchange"], "sector": C.UNCLASSIFIED if c is None else c["sector"],
                     "industry": "" if c is None else c["industry"], "group": C.UNCLASSIFIED if c is None else c["group"],
                     "close_vnd": last["price"] * C.PRICE_UNIT_VND, "price": last["price"], "mcap": last["mcap"],
                     "pe": last["pe"], "pb": last["pb"], "ni_ttm": last["ni_ttm"], "equity": last["equity"],
                     "loss": None if pd.isna(last["loss"]) else bool(last["loss"]),
                     "filing_age_days": None if pd.isna(last["age_days"]) else int(last["age_days"]),
                     "stale": bool(pd.notna(last["age_days"]) and last["age_days"] > C.STALE_FILING_DAYS)})
    if not frames:
        log.warning("fundamentals present but no stock matched stored prices")
        return 0
    M = {k: pd.DataFrame({s: v[k].astype("float64") for s, v in frames.items()}).reindex(master)
         for k in ("mcap", "ni_ttm", "equity", "pe", "pb")}
    now = pd.DataFrame(snap)
    coverage = {"fundamentals_files": len(files), "stocks_valued": len(frames),
                "latest_ttm_period": dict(sorted(last_ni_period.items())),
                "pe_valid_now": int(now["pe"].notna().sum()), "pb_valid_now": int(now["pb"].notna().sum()),
                "loss_making_now": int(now["loss"].fillna(False).sum()), "stale_filing_now": int(now["stale"].sum()),
                **{k: {"count": len(v), "examples": sorted(v)[:15]} for k, v in cov.items()}}
    write_if_changed(C.DATA / "monitor" / "valuation_coverage.json", coverage)
    log.info("coverage: valid P/E %d, valid P/B %d of %d stocks; latest TTM period %s", coverage["pe_valid_now"], coverage["pb_valid_now"],
             len(frames), coverage["latest_ttm_period"])
    method = {"shares_mode": C.VALUATION_SHARES_MODE, "price_unit_vnd": C.PRICE_UNIT_VND, "basis": "as returned by Vietstock via Yuanta",
              "pe": "market cap / TTM net income (positive only)", "pb": "market cap / parent equity (positive only)",
              "weighted": "sum of market cap / sum of earnings (or equity) over positive members = capitalization-weighted",
              "membership": "current constituents (survivorship-biased)", "special_groups": C.SPECIAL_GROUPS,
              "parts_unit": "billion VND"}
    write_if_changed(C.DATA / "valuation" / "snapshot.json", {"method": method, "rows": sorted(snap, key=lambda r: r["symbol"])})

    listing = []
    for g in build_groups(stocks, cons, indexes):
        cols = [m for m in g["members"] if m in frames]
        if len(cols) < C.MIN_GROUP_SIZE:
            continue
        df = aggregate_group(M, cols)
        df = df[df["n_pe"] + df["n_pb"] > 0]
        if df.empty:
            continue
        parts = {name: p.reindex(df.index) for name, p in partition_components(M, cols, group_of).items()}
        parts = {name: p for name, p in parts.items() if (p["n_pe"] + p["n_pb"]).fillna(0).sum() > 0}
        payload = {"id": g["id"], "label": g["label"], "kind": g["kind"], "method": method, "n_members": len(g["members"]),
                   "n_members_with_fundamentals": len(cols), "dates": [d.strftime("%Y-%m-%d") for d in df.index],
                   "series": {c: series_list(df[c], 2) for c in df.columns},
                   "parts": {name: {c: series_list(p[c], PART_DECIMALS[c]) for c in PART_DECIMALS} for name, p in sorted(parts.items())}}
        write_if_changed(C.DATA / "valuation" / f"{g['id']}.json", payload)
        last = df.iloc[-1]
        listing.append({"id": g["id"], "label": g["label"], "kind": g["kind"], "n_members": len(cols),
                        "last_date": df.index[-1].strftime("%Y-%m-%d"),
                        "median_pe": None if pd.isna(last["median_pe"]) else round(float(last["median_pe"]), 2),
                        "median_pb": None if pd.isna(last["median_pb"]) else round(float(last["median_pb"]), 2)})
    write_if_changed(C.DATA / "valuation" / "index.json", {"groups": listing, "method": method})
    log.info("valuation: %d stocks, %d scopes", len(frames), len(listing))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
