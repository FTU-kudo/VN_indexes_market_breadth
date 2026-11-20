"""Stock -> sector / industry / group, used to split valuation into groups that can be excluded.

Sources, in order of precedence
  1. data/reference/sectors.csv (optional, yours): columns symbol, sector, industry, group
     (header names are matched loosely: ticker/code, nganh, ... see ALIASES). `group` is the partition label.
  2. Yuanta sector indexes (VNFIN, VNIT, ...): the stock's largest sector index, shown with a readable name.
  3. "Unclassified".
Special groups (config.SPECIAL_GROUPS, e.g. Vingroup) override everything so they can be excluded as one block.
group = special group, else the CSV `group`, else the sector.  Every stock gets exactly one group (a partition).
"""
from __future__ import annotations

import csv

import pandas as pd

from . import config as C
from .store import read_json
from .universe import load_universe

SECTOR_INDEX_NAMES = {
    "VNFIN": "Financials", "VNIT": "Information Technology", "VNCOND": "Consumer Discretionary", "VNCONS": "Consumer Staples",
    "VNENE": "Energy", "VNHEAL": "Health Care", "VNIND": "Industrials", "VNMAT": "Materials", "VNREAL": "Real Estate", "VNUTI": "Utilities",
}
ALIASES = {
    "symbol": {"symbol", "ticker", "stock_code", "stockcode", "code", "ma", "mã"},
    "sector": {"sector", "sector_name", "icb_sector", "nganh", "ngành"},
    "industry": {"industry", "industry_name", "sub_industry", "sub-industry", "icb_industry"},
    "group": {"group", "special_group", "nhom", "nhóm"},
}


def read_reference() -> dict[str, dict[str, str]]:
    path = C.DATA / "reference" / "sectors.csv"
    if not path.exists():
        return {}
    out: dict[str, dict[str, str]] = {}
    with path.open(encoding="utf-8-sig", newline="") as fh:
        rd = csv.DictReader(fh)
        col = {}
        for h in rd.fieldnames or []:
            for key, names in ALIASES.items():
                if h and h.strip().lower() in names and key not in col:
                    col[key] = h
        if "symbol" not in col:
            return {}
        for r in rd:
            sym = (r.get(col["symbol"]) or "").strip().upper()
            if sym:
                out[sym] = {k: (r.get(col[k]) or "").strip() for k in ("sector", "industry", "group") if k in col}
    return out


def load_classification() -> pd.DataFrame:
    uni = load_universe()
    ref = read_reference()
    names = {i["code"]: i.get("name") for i in (read_json(C.DATA / "indexes.json", []) or [])}
    special = {sym: grp for grp, syms in C.SPECIAL_GROUPS.items() for sym in syms}
    rows = []
    for u in uni.itertuples():
        r = ref.get(u.symbol, {})
        idx = u.primary_sector if pd.notna(u.primary_sector) else None      # NaN would otherwise be truthy
        from_index = (SECTOR_INDEX_NAMES.get(idx) or names.get(idx) or idx) if idx else None
        sector = r.get("sector") or from_index or C.UNCLASSIFIED
        group = special.get(u.symbol) or r.get("group") or sector
        rows.append({"symbol": u.symbol, "exchange": u.exchange, "sector": sector, "industry": r.get("industry", ""), "group": group})
    return pd.DataFrame(rows, columns=["symbol", "exchange", "sector", "industry", "group"])
