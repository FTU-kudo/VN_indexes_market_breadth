"""Download quarterly statements (income statement + balance sheet) for every stock and store the valuation inputs.

  python -m backend.collect_fundamentals                 # incremental: only stocks missing the expected latest quarter
  python -m backend.collect_fundamentals --full          # re-download history back to FUND_FLOOR_YEAR
  python -m backend.collect_fundamentals --symbols ANV,VCB

Output per stock: data/fundamentals/<SYM>.json (schema documented in backend/valuation.py), money in VND.
Not in the API, so assumed: filing date (period end + regulatory deadline), shares (= contributed capital / par value).
Exit codes: 0 ok | 1 partial failures | 2 nothing usable.
"""
from __future__ import annotations

import argparse
import logging
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import date, timedelta

from . import config as C
from .field_map import pick
from .fundamentals_api import FundamentalsClient, assumed_publish, expected_latest_quarter, walk_back
from .statements import build_statements, merge_statements
from .store import read_json, update_status, utc_now_iso, write_if_changed
from .universe import load_universe
from .yuanta_api import YuantaAPIError, now_vn

log = logging.getLogger("fundamentals")
CHECKED_PATH = lambda: C.DATA / "monitor" / "fundamentals_checked.json"  # noqa: E731


@dataclass
class Result:
    symbol: str
    status: str            # up_to_date | skipped_recent | updated | unchanged | empty | failed
    error: str | None = None
    missing: tuple = ()    # fields absent in the latest stored quarter


def build_quarters(rows: list[dict]) -> tuple[list[dict], dict]:
    """Parsed long rows (both statements) -> quarter records in VND + the line items each field came from."""
    by: dict[tuple[int, int], list[dict]] = {}
    for r in rows:
        by.setdefault((r["year"], r["term"]), []).append(r)
    out, sources = [], {}
    for (y, q), rs in sorted(by.items()):
        ni, ni_src = pick(rs, "net_income_parent")
        if ni is None:
            ni, ni_src = pick(rs, "net_income_total")
            ni_src = f"FALLBACK total profit: {ni_src}" if ni_src else None
        eq, eq_src = pick(rs, "equity_total")
        mi, _ = pick(rs, "minority_interest")
        cc, cc_src = pick(rs, "charter_capital")
        if ni is None and eq is None and cc is None:
            continue
        end = rs[0]["period_end"]
        pub = next((r["published"] for r in rs if r["published"]), None) or assumed_publish(end, q)
        out.append({"period_end": end.isoformat(), "published": pub.isoformat(),
                    "net_income_parent": None if ni is None else ni * C.FUND_UNIT,
                    "equity_parent": None if eq is None else (eq - (mi or 0.0)) * C.FUND_UNIT,
                    "shares": None if cc is None or cc <= 0 else cc * C.FUND_UNIT / C.PAR_VALUE_VND})
        sources = {"net_income_parent": ni_src, "equity": eq_src, "charter_capital": cc_src}
    return out, sources


def merge_quarters(old: list[dict], new: list[dict]) -> list[dict]:
    """Union by period_end; fresh non-null values replace stored ones (restatements), nulls never erase data."""
    by = {q["period_end"]: dict(q) for q in old}
    for q in new:
        cur = by.setdefault(q["period_end"], dict(q))
        cur.update({k: v for k, v in q.items() if v is not None})
    return [by[k] for k in sorted(by)]


def looks_cumulative(quarters: list[dict]) -> bool:
    """Heuristic: net income rising Q1<Q2<Q3<Q4 within most years suggests year-to-date figures."""
    years: dict[str, dict[int, float]] = {}
    for q in quarters:
        if q["net_income_parent"] is not None:
            years.setdefault(q["period_end"][:4], {})[(int(q["period_end"][5:7]) - 1) // 3 + 1] = q["net_income_parent"]
    full = [v for v in years.values() if len(v) == 4 and all(x > 0 for x in v.values())]
    return bool(full) and sum(v[1] < v[2] < v[3] < v[4] for v in full) / len(full) >= 0.8


def sync_symbol(client, sym: str, today: date, full: bool = False, checked: dict | None = None) -> Result:
    path = C.DATA / "fundamentals" / f"{sym}.json"
    stmt_path = C.DATA / "statements" / f"{sym}.json"
    try:
        old = read_json(path) or {}
        quarters = old.get("quarters", [])
        expected = expected_latest_quarter(today)
        have = max(((int(q["period_end"][:4]), (int(q["period_end"][5:7]) - 1) // 3 + 1) for q in quarters
                    if q.get("net_income_parent") is not None), default=None)
        if not full and have and have >= expected and stmt_path.exists():
            return Result(sym, "up_to_date")
        last_check = (checked or {}).get(sym)
        if not full and quarters and last_check and (today - date.fromisoformat(last_check)).days < C.FUND_RECHECK_DAYS:
            return Result(sym, "skipped_recent")
        rows: list[dict] = []
        deep = full or not quarters or not stmt_path.exists()      # first statement download for this stock -> whole history
        for rtype in C.FUND_REPORTS:
            if deep:
                rows += walk_back(client, sym, rtype, expected)
            else:   # one 5-quarter window is enough for new filings and restatements
                rows += walk_back(client, sym, rtype, expected, max_batches=1)
        new, sources = build_quarters(rows)
        if not new:
            return Result(sym, "empty")
        merged = merge_quarters(quarters, new)
        latest = merged[-1]
        missing = tuple(k for k in ("net_income_parent", "equity_parent", "shares") if latest.get(k) is None)
        payload = {"symbol": sym, "basis": "as returned by Vietstock via Yuanta (consolidated vs separate not verified)",
                   "published_basis": "assumed: period end + regulatory deadline", "unit": "VND",
                   "sources": sources, "quarters": merged}
        changed = write_if_changed(path, payload)
        stmt = merge_statements(read_json(stmt_path) or {}, build_statements(rows))
        changed |= write_if_changed(stmt_path, {"symbol": sym, "unit": "VND million (ratios as provided)", **stmt})
        return Result(sym, "updated" if changed else "unchanged", missing=missing)
    except (YuantaAPIError, OSError, KeyError, ValueError) as e:
        return Result(sym, "failed", error=str(e)[:300])


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true")
    ap.add_argument("--symbols", default="")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--limit", type=int, default=0, help="first N symbols only (trial runs)")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)

    uni = load_universe()
    syms = list(uni["symbol"])
    if args.symbols:
        want = {s.strip().upper() for s in args.symbols.split(",") if s.strip()}
        syms = [s for s in syms if s in want] or sorted(want)
    if args.limit:
        syms = syms[: args.limit]
    if not syms:
        log.error("no stocks in data/stocks.json - run collect_data first")
        return 2

    today = now_vn().date()
    checked = read_json(CHECKED_PATH(), {}) or {}
    client, results = FundamentalsClient(), []
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as ex:
        futs = [ex.submit(sync_symbol, client, s, today, args.full, checked) for s in syms]
        for i, f in enumerate(as_completed(futs), 1):
            results.append(f.result())
            if i % 100 == 0:
                log.info("progress %d/%d", i, len(syms))

    cnt = Counter(r.status for r in results)
    for r in results:
        if r.status in ("updated", "unchanged", "empty", "failed"):   # symbols we actually requested today
            checked[r.symbol] = today.isoformat()
    write_if_changed(CHECKED_PATH(), dict(sorted(checked.items())))
    miss = Counter(m for r in results for m in r.missing)
    fails = sorted(({"symbol": r.symbol, "error": r.error} for r in results if r.status == "failed"), key=lambda x: x["symbol"])
    suspect = sum(looks_cumulative((read_json(C.DATA / "fundamentals" / f"{r.symbol}.json") or {}).get("quarters", []))
                  for r in results if r.status in ("updated", "unchanged"))
    log.info("results %s | missing fields %s | looks-cumulative %d", dict(cnt), dict(miss), suspect)
    update_status({"fundamentals": {"universe": len(syms), **dict(cnt), "missing_fields": dict(miss),
                                    "suspect_cumulative": suspect, "failed_list": fails[:100]}})
    ok = cnt["updated"] + cnt["unchanged"] + cnt["up_to_date"] + cnt["skipped_recent"]
    if ok == 0:
        return 2
    return 1 if cnt["failed"] / max(len(syms) - cnt["up_to_date"] - cnt["skipped_recent"], 1) > 0.2 else 0


if __name__ == "__main__":
    raise SystemExit(main())
