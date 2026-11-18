"""Yuanta ysradar client + pure response parsers.

Verified shapes (browser captures):
  list_index      -> {"success": true, "response": [{"IndexCode","IndexName","OrderID","IsShow",...}]}
  list_stock_info -> {"success": true, "response": [{"StockCode","Exchange","SymbolType",...}]}
  history         -> {"s": "ok", "bars": [{"t","o","h","l","c","v"}]}   (t = 00:00 UTC of the trade date)
The history parser also accepts the classic TradingView UDF layout {"s","t":[],"o":[],...}.
"""
from __future__ import annotations

import logging
import math
import os
import re
from datetime import date, datetime, timedelta
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from . import config as C

log = logging.getLogger(__name__)


class YuantaAPIError(Exception):
    pass


# ---------------------------------------------------------------- time helpers
def vn_midnight_epoch(d: date) -> int:
    """Unix seconds of 00:00 Asia/Ho_Chi_Minh on date d."""
    return int(datetime(d.year, d.month, d.day, tzinfo=C.TZ).timestamp())


def now_vn() -> datetime:
    return datetime.now(C.TZ)


def ts_to_date(t: int | float) -> date:
    """Trade date of a bar timestamp, read in Vietnam time.

    Yuanta stamps bars at 00:00 UTC (= 07:00 ICT) of the trade date; converting in ICT gives the
    right date for that stamp and for a 00:00-ICT stamp, so both conventions are safe.
    """
    return datetime.fromtimestamp(int(t), tz=C.TZ).date()


def history_end_epoch(now: datetime | None = None) -> int:
    """`to` for the history endpoint: 00:00 ICT two days ahead, i.e. safely past the end of today.

    `to=<now>` returned no bar for the current day when requested from GitHub Actions (browser requests with a
    future `to` did return it), so servers seem to hold a daily bar back until `to` passes the end of its day.
    Asking for the future is harmless: it only caps the range, and unfinished bars are dropped by the collector.
    """
    d = (now or now_vn()).astimezone(C.TZ).date()
    return vn_midnight_epoch(d + timedelta(days=2))


def session_is_final(now: datetime | None = None) -> bool:
    now = (now or now_vn()).astimezone(C.TZ)
    return now.weekday() >= 5 or now.time() >= C.SESSION_FINAL_AT


# ---------------------------------------------------------------- parsers
def _payload_list(payload: Any, what: str) -> list[dict]:
    if not isinstance(payload, dict) or not payload.get("success", False):
        raise YuantaAPIError(f"{what}: unsuccessful payload: {str(payload)[:200]}")
    resp = payload.get("response")
    if resp is None:
        return []
    if not isinstance(resp, list):
        raise YuantaAPIError(f"{what}: 'response' is not a list")
    return resp


def parse_index_list(payload: Any) -> list[dict]:
    out, seen = [], set()
    for r in _payload_list(payload, "list_index"):
        code = str(r.get("IndexCode", "")).strip()
        if not code or code in seen or not re.match(C.SAFE_NAME, code):
            continue
        seen.add(code)
        out.append({"code": code, "name": r.get("IndexName") or code, "order": r.get("OrderID")})
    return sorted(out, key=lambda x: (x["order"] is None, x["order"] or 0, x["code"]))


def parse_stock_list(payload: Any) -> list[dict]:
    out, seen = [], set()
    for r in _payload_list(payload, "list_stock_info"):
        sym = str(r.get("StockCode", "")).strip().upper()
        if not sym or sym in seen or not re.match(C.SAFE_NAME, sym):
            continue
        seen.add(sym)
        out.append({"symbol": sym, "exchange": r.get("Exchange"), "type": r.get("SymbolType")})
    return out


def _num(x: Any) -> float | None:
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def parse_history(payload: Any) -> list[dict]:
    """Clean bars [{date,o,h,l,c,v}] sorted by date, de-duplicated (last wins).

    Bars with missing / non-positive OHLC or negative volume are dropped, never filled.
    """
    if not isinstance(payload, dict):
        raise YuantaAPIError("history: payload is not an object")
    status = payload.get("s")
    if status == "no_data":
        return []
    if status != "ok":
        raise YuantaAPIError(f"history: status {status!r} {payload.get('errmsg', '')}")
    if "bars" in payload:
        raw = payload["bars"] or []
    elif "t" in payload:
        keys = ("t", "o", "h", "l", "c", "v")
        raw = [dict(zip(keys, row)) for row in zip(*(payload[k] for k in keys))]
    else:
        raise YuantaAPIError("history: neither 'bars' nor 't' present")
    by_date: dict[date, dict] = {}
    for b in raw:
        t = b.get("t")
        vals = [_num(b.get(k)) for k in ("o", "h", "l", "c")]
        vol = _num(b.get("v"))
        if t is None or any(x is None or x <= 0 for x in vals) or vol is None or vol < 0:
            continue
        d = ts_to_date(t)
        by_date[d] = {"date": d, "o": vals[0], "h": vals[1], "l": vals[2], "c": vals[3], "v": vol}
    return [by_date[d] for d in sorted(by_date)]


# ---------------------------------------------------------------- edge challenge handling
MAX_CHALLENGE_HOPS = 3
_CHALLENGE_RE = re.compile(r"window\.location\.href\s*=\s*[\"']([^\"']+)[\"']")


def challenge_redirect(body: str) -> str | None:
    """If `body` is the edge's JS redirect page, return the URL to request next, else None.

    Accepted only when it is an HTTPS URL on the Yuanta host carrying a jskey token.
    """
    if "jskey=" not in body[:2000]:
        return None
    m = _CHALLENGE_RE.search(body[:2000])
    if not m:
        return None
    target = m.group(1).replace("\\/", "/")
    host = C.BASE.split("://", 1)[1]
    return target if target.startswith(f"https://{host}/") and "jskey=" in target else None


# ---------------------------------------------------------------- client
def make_session() -> requests.Session:
    s = requests.Session()
    retry = Retry(total=C.HTTP_RETRIES, backoff_factor=1.0, status_forcelist=(429, 500, 502, 503, 504),
                  allowed_methods=("GET",), respect_retry_after_header=True)
    s.mount("https://", HTTPAdapter(max_retries=retry, pool_maxsize=C.MAX_WORKERS * 2))
    s.headers.update({
        "User-Agent": os.environ.get("YUANTA_USER_AGENT", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                                    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
        "Accept": "application/json, text/plain, */*",
        "Referer": C.BASE + "/",
    })
    return s


class YuantaClient:
    def __init__(self, session: requests.Session | None = None, timeout: int = C.HTTP_TIMEOUT):
        self.session = session or make_session()
        self.timeout = timeout

    def _fetch(self, url: str, params: dict | None = None) -> requests.Response:
        try:
            return self.session.get(url, params=params, timeout=self.timeout)
        except requests.RequestException as e:
            raise YuantaAPIError(f"GET {url} {params}: {type(e).__name__}: {e}") from e

    def _get(self, url: str, params: dict | None = None) -> Any:
        r = self._fetch(url, params)
        # The edge in front of ysradar answers unfamiliar clients with a tiny HTML page whose script just
        # redirects to the same URL plus a ?jskey=... token (no computation involved). A browser follows that
        # redirect transparently; do the same, but only to the same host and at most MAX_CHALLENGE_HOPS times.
        for _ in range(MAX_CHALLENGE_HOPS):
            target = challenge_redirect(r.text) if r.status_code == 200 else None
            if not target:
                break
            log.info("following edge challenge redirect (%s)", target.split("?")[0])
            r = self._fetch(target)
        if r.status_code >= 400:  # keep the body: WAF / geo-block pages explain themselves
            raise YuantaAPIError(f"HTTP {r.status_code} {r.reason} for {r.url} :: {r.text[:200]!r}")
        try:
            return r.json()
        except ValueError as e:
            raise YuantaAPIError(f"non-JSON response ({r.headers.get('content-type')}) from {r.url} :: {r.text[:200]!r}") from e

    def list_indexes(self) -> list[dict]:
        return parse_index_list(self._get(C.URL_INDEX_LIST))

    def list_stocks(self, exchange: str | None = None, index_code: str | None = None) -> list[dict]:
        params = {"exchange": exchange} if exchange else {"index_code": index_code}
        return parse_stock_list(self._get(C.URL_STOCK_INFO, params))

    def history(self, symbol: str, start: date, end_epoch: int | None = None) -> list[dict]:
        params = {"symbol": symbol, "resolution": "1D", "from": vn_midnight_epoch(start),
                  "to": end_epoch if end_epoch is not None else history_end_epoch(), "limit": 100000}
        return parse_history(self._get(C.URL_HISTORY, params))
