# backend/era_compare.py
"""Before / after comparison of the stored history, split at config.ERA_SPLIT (default 2020-01-01).

  python -m backend.era_compare     -> data/monitor/era_comparison.json (+ printed highlights)
Every sentence in `highlights` is generated from the numbers; nothing is hand-written. Needs prices, breadth and valuation files.
"""
from __future__ import annotations

import logging
import math
import sys

import numpy as np
import pandas as pd

from . import config as C
from .store import load_prices, read_json, write_if_changed

SPLIT = pd.Timestamp(C.ERA_SPLIT)


def _stats(x: pd.Series) -> dict | None:
    x = pd.to_numeric(x, errors="coerce").dropna()
    if x.empty:
        return None
    return {"mean": round(float(x.mean()), 2), "median": round(float(x.median()), 2), "min": round(float(x.min()), 2),
            "max": round(float(x.max()), 2), "days": int(len(x)), "first": x.index[0].strftime("%Y-%m-%d"), "last": x.index[-1].strftime("%Y-%m-%d")}


def price_era(c: pd.Series, v: pd.Series) -> dict | None:
    if len(c) < 30:
        return None
    r = np.log(c).diff().dropna()
    yrs = (c.index[-1] - c.index[0]).days / 365.25
    return {"first": c.index[0].strftime("%Y-%m-%d"), "last": c.index[-1].strftime("%Y-%m-%d"), "start_level": round(float(c.iloc[0]), 2),
            "end_level": round(float(c.iloc[-1]), 2), "cagr_pct": round(((c.iloc[-1] / c.iloc[0]) ** (1 / yrs) - 1) * 100, 2) if yrs >= 1 else None,
            "volatility_pct": round(float(r.std() * math.sqrt(C.TRADING_DAYS) * 100), 2),
            "max_drawdown_pct": round(float((c / c.cummax() - 1).min() * 100), 2), "avg_daily_volume": round(float(v.mean())), "days": int(len(c))}


def _series(path) -> pd.DataFrame | None:
    j = read_json(path)
    if not j or not j.get("dates"):
        return None
    return pd.DataFrame(j["series"], index=pd.to_datetime(j["dates"]))


def _split(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    return df[df.index < SPLIT], df[df.index >= SPLIT]


def build() -> dict:
    out: dict = {"split": C.ERA_SPLIT.isoformat(), "vnindex": {}, "breadth": {}, "valuation": {}}
    bench = load_prices("indexes", C.BENCHMARK)
    if not bench.empty:
        pre, post = bench[bench.index < SPLIT], bench[bench.index >= SPLIT]
        out["vnindex"] = {"pre": price_era(pre["c"], pre["v"]), "post": price_era(post["c"], post["v"])}
    for scope in ("MARKET",):
        df = _series(C.DATA / "breadth" / f"{scope}.json")
        if df is None:
            continue
        blk = {}
        for name, d in zip(("pre", "post"), _split(df)):
            if d.empty:
                blk[name] = None
                continue
            w200 = d["above_200_pct"].dropna()
            blk[name] = {"first": d.index[0].strftime("%Y-%m-%d"), "last": d.index[-1].strftime("%Y-%m-%d"),
                         "avg_above_ma50_pct": round(float(d["above_50_pct"].mean()), 1), "avg_above_ma200_pct": round(float(w200.mean()), 1) if len(w200) else None,
                         "share_days_ma200_below_20": round(float((w200 < 20).mean() * 100), 1) if len(w200) else None,
                         "avg_composite": round(float(d["composite"].mean()), 1), "stocks_with_prices_at_end": int(d["n_with_price"].iloc[-1])}
        out["breadth"][scope] = blk
    for scope in ("MARKET", "HOSE"):
        df = _series(C.DATA / "valuation" / f"{scope}.json")
        if df is None:
            continue
        out["valuation"][scope] = {}
        for key in ("agg_pe", "agg_pb", "median_pe", "median_pb", "pct_loss"):
            if key in df:
                pre, post = _split(df[[key]])
                out["valuation"][scope][key] = {"pre": _stats(pre[key]), "post": _stats(post[key]), "latest": round(float(df[key].dropna().iloc[-1]), 2) if df[key].notna().any() else None}
    out["highlights"] = highlights(out)
    return out


def _line(label: str, a, b, unit: str = "", dec: int = 1, thr: float = 10.0, words: tuple[str, str] = ("higher", "lower")) -> str | None:
    """One generated sentence. Relative % change only when both values are positive; otherwise the change in points."""
    if a is None or b is None:
        return None
    if a > 0 and b >= 0:
        ch = (b / a - 1) * 100
        diff, same = f"{ch:+.0f}%", abs(ch) < thr
    else:
        d = b - a
        diff, same = f"{d:+.1f} pts", abs(d) < thr / 2
    word = "about the same" if same else (words[0] if b > a else words[1])
    return f"{label}: {a:,.{dec}f}{unit} before {C.ERA_SPLIT.year} vs {b:,.{dec}f}{unit} since — {word} ({diff})."


def highlights(r: dict) -> list[str]:
    h: list[str] = []
    v = r.get("vnindex") or {}
    a, b = v.get("pre"), v.get("post")
    if a and b:
        h.append(f"VNINDEX history: {a['first']} to {a['last']} before the split, {b['first']} to {b['last']} after.")
        for label, k, unit, dec in (("Annualised return (CAGR)", "cagr_pct", "%", 1), ("Annualised volatility", "volatility_pct", "%", 1)):
            s = _line(label, a.get(k), b.get(k), unit, dec, 15.0)
            if s:
                h.append(s)
        if a.get("max_drawdown_pct") is not None and b.get("max_drawdown_pct") is not None:
            h.append(_line("Deepest drawdown", abs(a["max_drawdown_pct"]), abs(b["max_drawdown_pct"]), "%", 1, 15.0, ("deeper", "shallower")))
        s = _line("Average daily volume (shares)", a["avg_daily_volume"] / 1e6, b["avg_daily_volume"] / 1e6, "M", 1, 15.0)
        if s:
            h.append(s)
    br = (r.get("breadth") or {}).get("MARKET") or {}
    a, b = br.get("pre"), br.get("post")
    if a and b:
        for label, k, unit in (("Share of stocks above their 200-day average", "avg_above_ma200_pct", "%"), ("Share above the 50-day average", "avg_above_ma50_pct", "%"),
                               ("Share of days with under 20% above the 200-day average", "share_days_ma200_below_20", "%")):
            s = _line(label, a.get(k), b.get(k), unit, 1, 10.0)
            if s:
                h.append(s)
        h.append(f"Stocks with prices at the end of each era: {a['stocks_with_prices_at_end']} vs {b['stocks_with_prices_at_end']}; "
                 "earlier years contain only stocks that survive today (stronger survivorship bias).")
    for scope, d in (r.get("valuation") or {}).items():
        for key, label in (("agg_pe", "weighted P/E"), ("agg_pb", "weighted P/B"), ("median_pe", "median P/E"), ("pct_loss", "loss-making share")):
            x = d.get(key)
            if x and x.get("pre") and x.get("post"):
                s = _line(f"{scope} {label} (average)", x["pre"]["mean"], x["post"]["mean"], "%" if key == "pct_loss" else "x", 2 if key != "pct_loss" else 1, 10.0)
                if s:
                    h.append(s)
        x = d.get("agg_pe")
        if x and x.get("pre") and x.get("post") and x.get("latest") is not None:
            lo, hi = x["post"]["min"], x["post"]["max"]
            h.append(f"{scope} weighted P/E now {x['latest']:.1f}x; range since {C.ERA_SPLIT.year}: {lo:.1f}x–{hi:.1f}x, range before: {x['pre']['min']:.1f}x–{x['pre']['max']:.1f}x.")
    return h


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)
    res = build()
    write_if_changed(C.DATA / "monitor" / "era_comparison.json", res)
    print("\n".join(" - " + s for s in res["highlights"]) or "no comparison available yet (needs prices, breadth and valuation)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
