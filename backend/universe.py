"""Stock -> exchange / index / sector mapping, built from data/stocks.json + constituents.json (written by collect_data)."""
from __future__ import annotations

import pandas as pd

from . import config as C
from .store import read_json

# Headline benchmark indexes; every other index returned by Yuanta is treated as a sector / thematic index.
MAIN_INDEXES = ["VNINDEX", "VN30", "VN100", "VNMID", "VNSML", "VNALL", "VNXALL", "VNX50", "HNXINDEX", "HNX30", "UPCOMINDEX"]


def load_universe(equities_only: bool = True) -> pd.DataFrame:
    """One row per stock: symbol, exchange, type, indexes, main_indexes, sector_indexes, primary_sector.

    primary_sector = the *largest* sector index containing the stock (broadest industry = most peers).
    """
    stocks = read_json(C.DATA / "stocks.json", []) or []
    cons = (read_json(C.DATA / "constituents.json", {}) or {}).get("indexes", {})
    size = {code: len(m) for code, m in cons.items()}
    rows = []
    for s in stocks:
        if equities_only and s["type"] not in C.EQUITY_SYMBOL_TYPES:
            continue
        idx = list(s.get("indexes", []))
        sect = sorted((i for i in idx if i not in MAIN_INDEXES), key=lambda i: (-size.get(i, 0), i))
        rows.append({"symbol": s["symbol"], "exchange": s["exchange"], "type": s["type"], "indexes": idx,
                     "main_indexes": [i for i in idx if i in MAIN_INDEXES], "sector_indexes": sect,
                     "primary_sector": sect[0] if sect else None})
    return pd.DataFrame(rows, columns=["symbol", "exchange", "type", "indexes", "main_indexes", "sector_indexes", "primary_sector"])


def peers_of(symbol: str, uni: pd.DataFrame | None = None, level: str = "sector") -> list[str]:
    """Other stocks sharing the primary sector index ("sector"), the exchange ("exchange") or any index ("index")."""
    uni = load_universe() if uni is None else uni
    me = uni[uni["symbol"] == symbol]
    if me.empty:
        return []
    me = me.iloc[0]
    if level == "sector":
        m = uni["primary_sector"].eq(me["primary_sector"]) if pd.notna(me["primary_sector"]) else pd.Series(False, index=uni.index)
    elif level == "exchange":
        m = uni["exchange"].eq(me["exchange"])
    else:
        m = uni["indexes"].apply(lambda xs: bool(set(xs) & set(me["indexes"])))
    return sorted(set(uni.loc[m, "symbol"]) - {symbol})
