"""Historical market breadth for the whole market, each exchange and every index with constituents.

Method (all causal, no look-ahead):
* Master calendar = VNINDEX trading dates. A stock without a bar on a date is simply *absent* from that
  day's counts (never forward-filled); denominators are the number of members with a valid value.
* Moving averages / RSI / MACD are computed on each stock's own bars, then aligned to the calendar.
* 1/5/20-day returns are close/close.shift(k) on the calendar, so they are NaN if either day is missing.
* "New N-day high" = close > max(close of the previous N bars)  (today excluded); 52-week = 252 bars.
* Membership = CURRENT constituents (the API exposes nothing historical) -> survivorship-biased; labelled in output.
"""
from __future__ import annotations

import argparse
import logging
import re
import sys

import numpy as np
import pandas as pd

from . import config as C
from .indicators import macd, rsi, sma
from .store import load_prices, read_json, series_list, write_if_changed

log = logging.getLogger("breadth")
BASIS_CURRENT = ("current constituents/listings: delisted stocks are absent and past index membership is not "
                 "point-in-time, so history is survivorship-biased")


# ---------------------------------------------------------------- per-symbol features
def symbol_features(c: pd.Series, master: pd.DatetimeIndex) -> dict[str, pd.Series]:
    f: dict[str, pd.Series] = {}

    def flag(cond: pd.Series, valid: pd.Series) -> pd.Series:
        return cond.astype("float64").where(valid)

    for n in C.MA_WINDOWS:
        s = sma(c, n)
        ok = s.notna()
        f[f"above_{n}"] = flag(c > s, ok)
        both = ok & s.shift(1).notna()
        f[f"xup_{n}"] = flag((c > s) & (c.shift(1) <= s.shift(1)), both)
        f[f"xdn_{n}"] = flag((c < s) & (c.shift(1) >= s.shift(1)), both)
    line, sig, _ = macd(c)
    f["macd_bull"] = flag(line > sig, sig.notna())
    r = rsi(c, 14)
    f["rsi50"], f["rsi70"], f["rsi30"] = flag(r > 50, r.notna()), flag(r > 70, r.notna()), flag(r < 30, r.notna())
    for n, name in ((20, "20"), (50, "50"), (C.TRADING_DAYS, "252")):
        pmax, pmin = c.shift(1).rolling(n, min_periods=n).max(), c.shift(1).rolling(n, min_periods=n).min()
        f[f"hi{name}"], f[f"lo{name}"] = flag(c > pmax, pmax.notna()), flag(c < pmin, pmin.notna())
    out = {k: v.reindex(master) for k, v in f.items()}
    cm = c.reindex(master)
    out["has_price"] = cm.notna().astype("float64")
    for k, lag in ((1, 1), (5, 5), (20, 20)):
        ret = cm / cm.shift(lag) - 1
        ok = ret.notna()
        out[f"pos{k}"] = (ret > 0).astype("float64").where(ok)
        if k == 1:
            out["neg1"] = (ret < 0).astype("float64").where(ok)
            out["zero1"] = (ret == 0).astype("float64").where(ok)
    return out


def build_matrices(closes: dict[str, pd.Series], master: pd.DatetimeIndex) -> dict[str, pd.DataFrame]:
    acc: dict[str, dict[str, pd.Series]] = {}
    for sym, c in closes.items():
        for k, s in symbol_features(c, master).items():
            acc.setdefault(k, {})[sym] = s
    return {k: pd.DataFrame(v, index=master).astype("float32") for k, v in acc.items()}


# ---------------------------------------------------------------- group aggregation
def aggregate(M: dict[str, pd.DataFrame], cols: list[str], weights: dict[str, float]) -> pd.DataFrame:
    def sub(name: str) -> pd.DataFrame:
        return M[name].reindex(columns=cols)

    out: dict[str, pd.Series] = {}
    nv = lambda d: d.notna().sum(axis=1)  # noqa: E731

    def pct(d: pd.DataFrame) -> pd.Series:
        n = nv(d)
        return (d.sum(axis=1).astype("float64") / n.replace(0, np.nan) * 100).where(n >= C.MIN_GROUP_SIZE)

    out["n_with_price"] = sub("has_price").sum(axis=1)
    for n in C.MA_WINDOWS:
        a = sub(f"above_{n}")
        valid, up = nv(a), a.sum(axis=1)
        out[f"above_{n}_cnt"], out[f"below_{n}_cnt"] = up, valid - up
        out[f"above_{n}_pct"] = pct(a)
        out[f"below_{n}_pct"] = (100 - out[f"above_{n}_pct"])
        out[f"cross_up_{n}"], out[f"cross_dn_{n}"] = sub(f"xup_{n}").sum(axis=1), sub(f"xdn_{n}").sum(axis=1)

    adv, dec, unch = sub("pos1").sum(axis=1), sub("neg1").sum(axis=1), sub("zero1").sum(axis=1)
    out.update(adv=adv, dec=dec, unch=unch, net_adv=adv - dec,
               ad_ratio=(adv / dec.replace(0, np.nan)))
    out["ad_line"] = (adv - dec).cumsum()

    for name, key in (("hi20", "hi20"), ("lo20", "lo20"), ("hi50", "hi50"), ("lo50", "lo50"),
                      ("hi52w", "hi252"), ("lo52w", "lo252")):
        out[name] = sub(key).sum(axis=1)

    out["pct_up_1d"], out["pct_up_5d"], out["pct_up_20d"] = pct(sub("pos1")), pct(sub("pos5")), pct(sub("pos20"))
    out["pct_macd_bull"] = pct(sub("macd_bull"))
    out["pct_rsi_gt50"], out["pct_rsi_gt70"], out["pct_rsi_lt30"] = pct(sub("rsi50")), pct(sub("rsi70")), pct(sub("rsi30"))

    # ---- composite score 0..100 (heuristic, configurable weights; not a validated predictor)
    s_ma = pd.concat([out["above_20_pct"], out["above_50_pct"], out["above_200_pct"]], axis=1).mean(axis=1, skipna=False)
    s_ad = (adv / (adv + dec).replace(0, np.nan) * 100).rolling(10, min_periods=5).mean()
    h10, l10 = out["hi50"].rolling(10, min_periods=5).sum(), out["lo50"].rolling(10, min_periods=5).sum()
    s_hl = (h10 / (h10 + l10).replace(0, np.nan) * 100).fillna(50.0).where(nv(sub("hi50")) >= C.MIN_GROUP_SIZE)
    comps = {"ma": s_ma, "ad": s_ad, "hl": s_hl, "macd": out["pct_macd_bull"], "rsi": out["pct_rsi_gt50"]}
    num = sum(weights[k] * comps[k].fillna(0) for k in comps)
    den = sum(weights[k] * comps[k].notna() for k in comps)
    for k, s in comps.items():
        out[f"score_{k}"] = s
    out["composite"] = (num / den.replace(0, np.nan)).where(den >= 0.5 * sum(weights.values()))

    df = pd.DataFrame(out)
    first = df.index[(df["n_with_price"] >= C.MIN_GROUP_SIZE).to_numpy()]
    return df.loc[first[0]:] if len(first) else df.iloc[0:0]


def build_groups(stocks: list[dict], constituents: dict[str, list[str]], indexes: list[dict]) -> list[dict]:
    eq = [s for s in stocks if s["type"] in C.EQUITY_SYMBOL_TYPES]
    groups = [{"id": "MARKET", "label": "Whole market", "kind": "market", "members": [s["symbol"] for s in eq]}]
    for ex in ("HOSE", "HNX", "UPCOM"):
        groups.append({"id": ex, "label": ex, "kind": "exchange",
                       "members": [s["symbol"] for s in eq if s["exchange"] == ex]})
    names = {i["code"]: i["name"] for i in indexes}
    for code, members in sorted(constituents.items()):
        if re.match(C.SAFE_NAME, code) and members:
            groups.append({"id": code, "label": names.get(code, code), "kind": "index", "members": members})
    return groups


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", default="", help="e.g. ma=0.4,ad=0.2,hl=0.1,macd=0.15,rsi=0.15")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)
    weights = dict(C.COMPOSITE_WEIGHTS)
    for kv in filter(None, args.weights.split(",")):
        k, v = kv.split("=")
        if k not in weights:
            raise SystemExit(f"unknown weight {k}")
        weights[k] = float(v)

    stocks = read_json(C.DATA / "stocks.json", []) or []
    cons = (read_json(C.DATA / "constituents.json", {}) or {}).get("indexes", {})
    indexes = read_json(C.DATA / "indexes.json", []) or []
    bench = load_prices("indexes", C.BENCHMARK)
    closes: dict[str, pd.Series] = {}
    for s in stocks:
        if s["type"] in C.EQUITY_SYMBOL_TYPES:
            df = load_prices("stocks", s["symbol"])
            if len(df):
                closes[s["symbol"]] = df["c"]
    if not closes:
        log.error("no stock prices stored")
        return 1
    master = bench.index if not bench.empty else pd.DatetimeIndex(sorted(set().union(*[c.index for c in closes.values()])))
    log.info("%d stocks, %d calendar days", len(closes), len(master))
    M = build_matrices(closes, master)

    listing = []
    for g in build_groups(stocks, cons, indexes):
        cols = [m for m in g["members"] if m in closes]
        if len(cols) < C.MIN_GROUP_SIZE:
            log.info("skip %s (%d members with prices)", g["id"], len(cols))
            continue
        df = aggregate(M, cols, weights)
        if df.empty:
            continue
        payload = {"id": g["id"], "label": g["label"], "kind": g["kind"], "membership_basis": BASIS_CURRENT,
                   "n_members": len(g["members"]), "n_members_with_prices": len(cols),
                   "composite_weights": weights,
                   "dates": [d.strftime("%Y-%m-%d") for d in df.index],
                   "series": {c: series_list(df[c], 2) for c in df.columns}}
        write_if_changed(C.DATA / "breadth" / f"{g['id']}.json", payload)
        last = df.iloc[-1]
        listing.append({"id": g["id"], "label": g["label"], "kind": g["kind"], "n_members": len(cols),
                        "last_date": df.index[-1].strftime("%Y-%m-%d"),
                        "composite": None if pd.isna(last["composite"]) else round(float(last["composite"]), 2),
                        "above_50_pct": None if pd.isna(last["above_50_pct"]) else round(float(last["above_50_pct"]), 2)})
    write_if_changed(C.DATA / "breadth" / "index.json", {"groups": listing, "membership_basis": BASIS_CURRENT})
    log.info("wrote %d breadth groups", len(listing))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
