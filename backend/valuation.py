"""P/E and P/B engine. Pure functions (no I/O) so everything is unit-testable.

Fundamentals schema (one file per stock, data/fundamentals/<SYM>.json), money in VND, consolidated figures:
  {"symbol": "VIC", "basis": "consolidated", "cumulative": false,
   "quarters": [{"period_end": "2025-09-30", "published": "2025-10-25",
                 "net_income_parent": 1.2e12, "equity_parent": 9.0e13, "shares": 3.8e9}, ...]}
  net_income_parent : profit attributable to the parent's shareholders for that quarter
                      (or year-to-date if "cumulative" is true - converted by ytd_to_quarterly)
  equity_parent     : equity attributable to the parent, at period end (excludes minority interests)
  shares            : shares outstanding at period end
  published         : date the filing became public. Valuation on date t only uses filings with published <= t.

Method
  market cap = price x PRICE_UNIT_VND x shares            P/E = market cap / TTM net income (> 0 only)
  TTM        = sum of four *consecutive* single quarters  P/B = market cap / equity (> 0 only)
  shares_mode "latest": latest share count x split-adjusted price (consistent if history prices are adjusted);
  shares_mode "pit"   : share count of the filing in force x raw price.
Loss-makers get no P/E (they are counted separately), never a fabricated value.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config as C


def _qkey(period_end: pd.Series) -> pd.Series:
    d = pd.to_datetime(period_end)
    return d.dt.year * 4 + (d.dt.month - 1) // 3


def ytd_to_quarterly(period_end: pd.Series, ytd: pd.Series) -> pd.Series:
    """Year-to-date figures -> single quarters. Q1 is itself; later quarters need the previous quarter, else NaN."""
    d = pd.DataFrame({"pe": pd.to_datetime(period_end), "v": pd.to_numeric(ytd, errors="coerce")})
    d = d.sort_values("pe")
    key, q = _qkey(d["pe"]), (d["pe"].dt.month - 1) // 3 + 1
    single = np.where(q == 1, d["v"], np.where(key - key.shift(1) == 1, d["v"] - d["v"].shift(1), np.nan))
    return pd.Series(single, index=d.index).sort_index()


def prepare_fundamentals(quarters: list[dict], cumulative: bool = False) -> pd.DataFrame:
    """Raw quarter records -> one row per filing: published, period_end, ni_ttm, equity, shares (sorted by published)."""
    q = pd.DataFrame(quarters)
    if q.empty:
        return pd.DataFrame(columns=["published", "period_end", "ni_ttm", "equity", "shares"])
    q["period_end"], q["published"] = pd.to_datetime(q["period_end"]), pd.to_datetime(q["published"])
    q = q.sort_values("period_end").drop_duplicates("period_end", keep="last").reset_index(drop=True)
    ni = ytd_to_quarterly(q["period_end"], q["net_income_parent"]) if cumulative else pd.to_numeric(q["net_income_parent"], errors="coerce")
    key = _qkey(q["period_end"])
    ttm = ni.rolling(4).sum().where(key - key.shift(3) == 3)   # four consecutive quarters, otherwise unknown
    out = pd.DataFrame({"published": q["published"], "period_end": q["period_end"], "ni_ttm": ttm,
                        "equity": pd.to_numeric(q["equity_parent"], errors="coerce"),
                        "shares": pd.to_numeric(q["shares"], errors="coerce")})
    out = out.dropna(subset=["published"]).sort_values("published").drop_duplicates("published", keep="last")
    return out.reset_index(drop=True)


def valuation_for_symbol(price: pd.Series, f: pd.DataFrame, shares_mode: str | None = None,
                         price_unit: float | None = None, max_age_days: int | None = None) -> pd.DataFrame:
    """Daily valuation for one stock. `price` is a date-indexed close; `f` comes from prepare_fundamentals."""
    shares_mode = shares_mode or C.VALUATION_SHARES_MODE
    price_unit = C.PRICE_UNIT_VND if price_unit is None else price_unit
    max_age_days = C.MAX_FILING_AGE_DAYS if max_age_days is None else max_age_days
    p = price.dropna().rename("price").rename_axis("date").reset_index().sort_values("date")
    if f.empty or p.empty:
        return pd.DataFrame(columns=["price", "mcap", "ni_ttm", "equity", "pe", "pb", "loss", "age_days"])
    m = pd.merge_asof(p, f.rename(columns={"published": "filed"}), left_on="date", right_on="filed", direction="backward")
    m = m.set_index("date", drop=False)   # keep every Series below on the same (date) index
    shares = f["shares"].dropna().iloc[-1] if shares_mode == "latest" and f["shares"].notna().any() else m["shares"]
    mcap = m["price"] * price_unit * shares
    age = (m["date"] - m["filed"]).dt.days
    fresh = age <= max_age_days
    ni, eq = m["ni_ttm"].where(fresh), m["equity"].where(fresh)
    out = pd.DataFrame({"price": m["price"], "mcap": mcap.where(fresh), "ni_ttm": ni, "equity": eq,
                        "pe": (mcap / ni).where(ni > 0), "pb": (mcap / eq).where(eq > 0),
                        "loss": (ni <= 0).where(ni.notna()), "age_days": age})
    return out


def aggregate_group(M: dict[str, pd.DataFrame], cols: list[str], min_n: int | None = None) -> pd.DataFrame:
    """Group statistics per date from wide matrices (dates x symbols): mcap, ni_ttm, equity, pe, pb."""
    min_n = C.MIN_GROUP_SIZE if min_n is None else min_n
    sub = {k: v.reindex(columns=cols) for k, v in M.items()}
    pe, pb, mcap, ni, eq = sub["pe"], sub["pb"], sub["mcap"], sub["ni_ttm"], sub["equity"]
    out: dict[str, pd.Series] = {}
    out["n_priced"] = mcap.notna().sum(axis=1)
    for name, x in (("pe", pe), ("pb", pb)):
        n = x.notna().sum(axis=1)
        out[f"n_{name}"] = n
        for label, fn in (("median", lambda d: d.median(axis=1)), ("p25", lambda d: d.quantile(0.25, axis=1)), ("p75", lambda d: d.quantile(0.75, axis=1))):
            out[f"{label}_{name}"] = fn(x).where(n >= min_n)
    pos = (ni > 0) & mcap.notna()
    out["agg_pe"] = (mcap.where(pos).sum(axis=1) / ni.where(pos).sum(axis=1)).where(pos.sum(axis=1) >= min_n)
    pose = (eq > 0) & mcap.notna()
    out["agg_pb"] = (mcap.where(pose).sum(axis=1) / eq.where(pose).sum(axis=1)).where(pose.sum(axis=1) >= min_n)
    known = ni.notna()
    out["n_loss"] = (ni <= 0).sum(axis=1)
    out["pct_loss"] = (out["n_loss"] / known.sum(axis=1).replace(0, np.nan) * 100).where(known.sum(axis=1) >= min_n)
    out["mcap_total"] = mcap.sum(axis=1, min_count=1)
    return pd.DataFrame(out)
