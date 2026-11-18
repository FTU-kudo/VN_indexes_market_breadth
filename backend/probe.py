"""Connectivity probe: exercises the real client against the three endpoints and prints what happened."""
from __future__ import annotations

import logging
import sys
from datetime import date, timedelta

from .yuanta_api import YuantaClient, history_end_epoch, now_vn


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s", stream=sys.stdout)
    c, ok = YuantaClient(), True
    steps = [
        ("list_index", lambda: (lambda r: f"{len(r)} indexes, first: {[x['code'] for x in r[:6]]}")(c.list_indexes())),
        ("list_stock_info HSX", lambda: f"{len(c.list_stocks(exchange='HSX'))} stocks"),
        ("list_stock_info HNX", lambda: f"{len(c.list_stocks(exchange='HNX'))} stocks"),
        ("list_stock_info UPCOM", lambda: f"{len(c.list_stocks(exchange='UPCOM'))} stocks"),
        ("list_stock_info index_code=VN100", lambda: f"{len(c.list_stocks(index_code='VN100'))} stocks"),
        ("history VNINDEX", lambda: (lambda b: f"{len(b)} bars, last: {b[-1] if b else None}")(c.history("VNINDEX", now_vn().date() - timedelta(days=30)))),
        ("history VNINDEX, to=now", lambda: (lambda b: f"last bar {b[-1]['date'] if b else None}")(c.history("VNINDEX", now_vn().date() - timedelta(days=10), int(now_vn().timestamp())))),
        ("history VNINDEX, to=future", lambda: (lambda b: f"last bar {b[-1]['date'] if b else None}")(c.history("VNINDEX", now_vn().date() - timedelta(days=10), history_end_epoch()))),
        ("history VIC", lambda: (lambda b: f"{len(b)} bars, last: {b[-1] if b else None}")(c.history("VIC", date(2020, 1, 1)))),
    ]
    for name, fn in steps:
        try:
            print(f"OK   {name}: {fn()}")
        except Exception as e:  # noqa: BLE001 - diagnostic tool
            ok = False
            print(f"FAIL {name}: {e}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
