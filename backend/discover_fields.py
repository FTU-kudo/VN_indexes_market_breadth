"""Inspect what the statement API actually returns, and whether field_map finds the numbers valuation needs.

  python -m backend.discover_fields --symbols ANV,VCB,SSI,VIC,FPT,HPG
Prints, per stock, which line item each field matched (or MISSING), the period-level keys the API provides
(look for a filing-date key!) and writes fundamental_fields.csv listing every distinct line item seen.
"""
from __future__ import annotations

import argparse
import csv
import sys
from collections import Counter

from . import config as C
from .field_map import FIELDS, pick
from .fundamentals_api import FundamentalsClient, expected_latest_quarter, parse_report
from .yuanta_api import YuantaAPIError, now_vn


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", default="ANV,VCB,SSI,VIC,FPT,HPG")
    ap.add_argument("--csv", default="fundamental_fields.csv")
    args = ap.parse_args(argv)
    client, anchor = FundamentalsClient(), expected_latest_quarter(now_vn().date())
    seen: Counter = Counter()
    print(f"anchor quarter: {anchor[0]}Q{anchor[1]}")
    for sym in [s.strip().upper() for s in args.symbols.split(",") if s.strip()]:
        rows = []
        for rtype in C.FUND_REPORTS:
            try:
                resp = client.report(sym, rtype, *anchor)
            except YuantaAPIError as e:
                print(f"{sym} {rtype}: FAILED {e}")
                continue
            pts = (resp.get("title") or {}).get("data") or []
            if pts and sym == args.symbols.split(",")[0].strip().upper():
                print(f"period keys ({rtype}): {sorted(pts[0].keys())}")
            rows += parse_report(resp, rtype)
        for r in rows:
            seen[(r["report_type"], r["component"], r["norm_id"], r["name_vi"], r["name_en"])] += 1
        newest = max(((r["year"], r["term"]) for r in rows), default=None)
        cur = [r for r in rows if newest and (r["year"], r["term"]) == newest]
        print(f"\n{sym}  latest period in response: {newest}")
        for f in FIELDS:
            v, src = pick(cur, f)
            print(f"   {f:18s} {'MISSING' if src is None else f'{v:,.0f}  <- {src}'}")
    with open(args.csv, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(["report", "component", "norm_id", "name_vi", "name_en", "rows_seen"])
        for k, n in sorted(seen.items(), key=lambda kv: (kv[0][0], str(kv[0][1]), str(kv[0][2]))):
            w.writerow([*k, n])
    print(f"\nwrote {args.csv} ({len(seen)} distinct line items)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
