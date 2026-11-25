# backend/history_coverage.py
"""Records how far back the stored data really goes (the API may not reach the requested start).

  python -m backend.history_coverage     -> data/monitor/history_coverage.json (shown on Data monitor and the Valuation page)
"""
from __future__ import annotations

import logging
import sys
from collections import Counter

from . import config as C
from .store import read_json, write_if_changed


def _first_bar(sym_dir) -> str | None:
    files = sorted(sym_dir.glob("*.json"))
    j = read_json(files[0]) if files else None
    return j["d"][0] if j and j.get("d") else None


def _price_block(kind: str) -> dict:
    root = C.DATA / "prices" / kind
    firsts = {}
    for d in sorted(p for p in root.iterdir() if p.is_dir()) if root.exists() else []:
        f = _first_bar(d)
        if f:
            firsts[d.name] = f
    years = Counter(v[:4] for v in firsts.values())
    reached = sum(1 for v in firsts.values() if v <= f"{C.START_DATE.year}-03-31")
    return {"symbols": len(firsts), "earliest_date": min(firsts.values()) if firsts else None,
            "first_year_counts": dict(sorted(years.items())), "reached_requested_start": reached, "first_bar": firsts}


def build() -> dict:
    stocks, indexes = _price_block("stocks"), _price_block("indexes")
    fq = Counter()
    fdir = C.DATA / "fundamentals"
    earliest_q = None
    for f in sorted(fdir.glob("*.json")) if fdir.exists() else []:
        j = read_json(f) or {}
        ends = sorted(q["period_end"] for q in j.get("quarters", []) if q["period_end"] >= "1990-01-01")
        if ends:
            fq[ends[0][:4]] += 1
            earliest_q = ends[0] if earliest_q is None else min(earliest_q, ends[0])
    vidx = read_json(C.DATA / "valuation" / "index.json", {}) or {}
    vscopes = {g["id"]: g.get("first_date") for g in vidx.get("groups", [])}
    vfirst = min((d for d in vscopes.values() if d), default=None)
    bidx = read_json(C.DATA / "breadth" / "index.json", {}) or {}
    bscopes = {g["id"]: g.get("first_date") for g in bidx.get("groups", [])}
    bench = indexes["first_bar"].get(C.BENCHMARK)
    for blk in (stocks, indexes):
        blk.pop("first_bar")
    marker = read_json(C.DATA / "monitor" / "history_start.json", {}) or {}
    yr = lambda d: int(d[:4]) if d else None  # noqa: E731
    return {
        "requested_start": C.START_DATE.isoformat(), "statements_floor_year": C.FUND_FLOOR_YEAR, "marker": marker,
        "prices_stocks": stocks, "prices_indexes": indexes, "benchmark_first_bar": bench,
        "fundamentals": {"stocks": sum(fq.values()), "earliest_period_end": earliest_q, "first_year_counts": dict(sorted(fq.items()))},
        "breadth_first_date": bscopes, "valuation_first_date": vscopes,
        "actual_start_year": {"prices": yr(stocks["earliest_date"]), "benchmark": yr(bench), "statements": yr(earliest_q),
                              "breadth": yr(min((d for d in bscopes.values() if d), default=None)), "valuation": yr(vfirst)},
    }


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)
    cov = build()
    write_if_changed(C.DATA / "monitor" / "history_coverage.json", cov)
    a = cov["actual_start_year"]
    print(f"requested start {cov['requested_start']} | actual start years: prices {a['prices']} (VNINDEX {a['benchmark']}), "
          f"statements {a['statements']}, breadth {a['breadth']}, valuation {a['valuation']}")
    st = cov["prices_stocks"]
    print(f"{st['reached_requested_start']} of {st['symbols']} stocks have prices back to the requested start; first-bar years: {st['first_year_counts']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
