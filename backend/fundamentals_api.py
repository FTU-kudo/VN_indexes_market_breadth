"""Yuanta (Vietstock) financial-statement client, response parser and walk-back pagination.

Request/response layout is taken from the ANV prototype:
  GET .../financial_statement/report?lang=vi&report_term_type=2&report_type=KQKD&stock_code=ANV
      &term_code=Q3&year_period=2026&unit=1000000&page_index=1&page_size=5
  -> {"success": true, "response": {"title": {"data": [{"year_period","term_code","period_begin","period_end",
        "audited_status_en", ...}]}, "detail": [{"report_component_name_en", "data": [{"norm_id","field_name",
        "field_name_en","value":[one per period]}]}]}}
page_index/page_size do not page: every call returns the 5 quarters ending at (year_period, term_code), so history is
fetched by re-anchoring one quarter before the oldest period received (walk_back).
"""
from __future__ import annotations

import calendar
import logging
from datetime import date, datetime, timedelta

import pandas as pd

from . import config as C
from .yuanta_api import YuantaAPIError, YuantaClient

log = logging.getLogger(__name__)
_PUB_KEYS = ("publish", "release", "announc", "disclos", "submit")


# ---------------------------------------------------------------- quarter arithmetic
def prev_quarter(year: int, q: int) -> tuple[int, int]:
    return (year - 1, 4) if q == 1 else (year, q - 1)


def quarter_end(year: int, q: int) -> date:
    m = q * 3
    return date(year, m, calendar.monthrange(year, m)[1])


def assumed_publish(period_end: date, q: int) -> date:
    """Conservative public date: quarter end + regulatory deadline (the API exposes no filing date)."""
    return period_end + timedelta(days=C.PUBLISH_LAG_DAYS[q])


def expected_latest_quarter(today: date) -> tuple[int, int]:
    """Most recent quarter whose assumed publication date has passed."""
    y, q = today.year, (today.month - 1) // 3 + 1
    for _ in range(8):
        if assumed_publish(quarter_end(y, q), q) <= today:
            return y, q
        y, q = prev_quarter(y, q)
    return y, q


def _date(v) -> date | None:
    d = pd.to_datetime(v, errors="coerce")
    return None if pd.isna(d) else d.date()


# ---------------------------------------------------------------- parsing
def parse_report(resp: dict, report_type: str) -> list[dict]:
    """Long rows: one per (period, line item). Missing values stay None."""
    periods = ((resp or {}).get("title") or {}).get("data") or []
    meta = []
    for p in periods:
        term = str(p.get("term_code", ""))
        if not (term.startswith("Q") and term[1:].isdigit()) or not str(p.get("year_period", "")).isdigit():
            meta.append(None)
            continue
        y, q = int(p["year_period"]), int(term[1:])
        pub = next((_date(v) for k, v in p.items() if any(t in k.lower() for t in _PUB_KEYS) and _date(v)), None)
        meta.append({"year": y, "term": q, "period_end": _date(p.get("period_end")) or quarter_end(y, q),
                     "published": pub, "audited": p.get("audited_status_en")})
    rows = []
    for comp in (resp or {}).get("detail") or []:
        for item in comp.get("data") or []:
            vals = item.get("value") or []
            for i, m in enumerate(meta):
                if m is None:
                    continue
                v = pd.to_numeric(vals[i], errors="coerce") if i < len(vals) else None
                rows.append({**m, "report_type": report_type, "component": comp.get("report_component_name_en"),
                             "norm_id": item.get("norm_id"), "name_vi": item.get("field_name"), "name_en": item.get("field_name_en"),
                             "value": None if v is None or pd.isna(v) else float(v)})
    return rows


# ---------------------------------------------------------------- client
class FundamentalsClient(YuantaClient):
    def report(self, stock: str, report_type: str, year: int, q: int) -> dict:
        js = self._get(C.URL_FIN_REPORT, {
            "lang": "vi", "page_index": 1, "page_size": 5, "report_term_type": 2, "report_type": report_type,
            "stock_code": stock, "term_code": f"Q{q}", "unit": C.FUND_UNIT, "year_period": year})
        if not isinstance(js, dict) or not js.get("success"):
            raise YuantaAPIError(f"{report_type} {stock} {year}Q{q}: {str(js)[:200]}")
        return js.get("response") or {}


def walk_back(client, stock: str, report_type: str, anchor: tuple[int, int],
              floor_year: int | None = None, max_batches: int | None = None) -> list[dict]:
    """Fetch 5-quarter windows, each anchored one quarter before the oldest period already seen."""
    floor_year = C.FUND_FLOOR_YEAR if floor_year is None else floor_year
    max_batches = C.FUND_MAX_BATCHES if max_batches is None else max_batches
    out, seen, prev = [], set(), None
    y, q = anchor
    for _ in range(max_batches):
        rows = parse_report(client.report(stock, report_type, y, q), report_type)
        periods = sorted({(r["year"], r["term"]) for r in rows})
        if not periods or periods == prev:
            break
        prev = periods
        new = [p for p in periods if p not in seen]
        if not new:
            break
        seen.update(periods)
        out.extend(r for r in rows if (r["year"], r["term"]) in new)
        if periods[0][0] <= floor_year:
            break
        y, q = prev_quarter(*periods[0])
    return out
