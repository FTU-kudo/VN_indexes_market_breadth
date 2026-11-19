"""Technical indicators (pandas/NumPy). Every function is causal: value at bar t uses bars <= t only.

Input frame: DatetimeIndex, columns o,h,l,c,v (float, no NaN rows - missing bars are never filled).
Formulas and parameters are documented in README.md ("Indicator reference").
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config as C

MA_PERIODS = [5, 10, 20, 50, 100, 200]
RSI_PERIODS = [6, 9, 14, 21]
PERF_PERIODS = [5, 10, 20, 50, 100, 200]


def sma(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n, min_periods=n).mean()


def ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False, min_periods=n).mean()


def wilder(s: pd.Series, n: int) -> pd.Series:
    """Wilder smoothing: EMA with alpha = 1/n."""
    return s.ewm(alpha=1.0 / n, adjust=False, min_periods=n).mean()


def rsi(c: pd.Series, n: int = 14) -> pd.Series:
    d = c.diff()
    ag, al = wilder(d.clip(lower=0), n), wilder((-d).clip(lower=0), n)
    out = 100 - 100 / (1 + ag / al.replace(0, np.nan))
    out[(al == 0) & (ag > 0)] = 100.0
    out[(al == 0) & (ag == 0)] = 50.0
    return out.where(ag.notna() & al.notna())


def macd(c: pd.Series, fast=12, slow=26, sig=9) -> tuple[pd.Series, pd.Series, pd.Series]:
    line = ema(c, fast) - ema(c, slow)
    signal = ema(line, sig)
    return line, signal, line - signal


def true_range(h, l, c) -> pd.Series:
    pc = c.shift(1)
    return pd.concat([h - l, (h - pc).abs(), (l - pc).abs()], axis=1).max(axis=1, skipna=False)


def atr(h, l, c, n=14) -> pd.Series:
    return wilder(true_range(h, l, c), n)


def adx(h, l, c, n=14):
    up, dn = h.diff(), -l.diff()
    plus_dm = pd.Series(np.where((up > dn) & (up > 0), up, 0.0), index=h.index).where(up.notna())
    minus_dm = pd.Series(np.where((dn > up) & (dn > 0), dn, 0.0), index=h.index).where(dn.notna())
    a = atr(h, l, c, n)
    pdi, mdi = 100 * wilder(plus_dm, n) / a, 100 * wilder(minus_dm, n) / a
    dx = 100 * (pdi - mdi).abs() / (pdi + mdi).replace(0, np.nan)
    return wilder(dx, n), pdi, mdi


def stochastic(h, l, c, k=14, d=3):
    hh, ll = h.rolling(k, min_periods=k).max(), l.rolling(k, min_periods=k).min()
    pk = 100 * (c - ll) / (hh - ll).replace(0, np.nan)
    return pk, pk.rolling(d, min_periods=d).mean()


def williams_r(h, l, c, n=14) -> pd.Series:
    hh, ll = h.rolling(n, min_periods=n).max(), l.rolling(n, min_periods=n).min()
    return -100 * (hh - c) / (hh - ll).replace(0, np.nan)


def parabolic_sar(h, l, c, af0=0.02, step=0.02, afmax=0.2) -> tuple[np.ndarray, np.ndarray]:
    """Wilder Parabolic SAR. Returns (sar, direction) with direction +1 bullish / -1 bearish."""
    h, l, c = (np.asarray(x, dtype="float64") for x in (h, l, c))
    n = len(c)
    sar_out, dir_out = np.full(n, np.nan), np.zeros(n)
    if n < 3:
        return sar_out, dir_out
    bull = c[1] >= c[0]
    sar = l[0] if bull else h[0]
    ep = max(h[0], h[1]) if bull else min(l[0], l[1])
    af = af0
    sar_out[1], dir_out[1] = sar, 1 if bull else -1
    for i in range(2, n):
        sar = sar + af * (ep - sar)
        if bull:
            sar = min(sar, l[i - 1], l[i - 2])
            if l[i] < sar:
                bull, sar, ep, af = False, ep, l[i], af0
            elif h[i] > ep:
                ep, af = h[i], min(af + step, afmax)
        else:
            sar = max(sar, h[i - 1], h[i - 2])
            if h[i] > sar:
                bull, sar, ep, af = True, ep, h[i], af0
            elif l[i] < ep:
                ep, af = l[i], min(af + step, afmax)
        sar_out[i], dir_out[i] = sar, 1 if bull else -1
    return sar_out, dir_out


def supertrend(h, l, c, n=10, mult=3.0) -> tuple[np.ndarray, np.ndarray]:
    """Supertrend with Wilder ATR(n). Returns (line, direction)."""
    a = atr(h, l, c, n).to_numpy()
    hv, lv, cv = (np.asarray(x, dtype="float64") for x in (h, l, c))
    m = len(cv)
    st, dr = np.full(m, np.nan), np.zeros(m)
    valid = np.flatnonzero(~np.isnan(a))
    if len(valid) == 0:
        return st, dr
    s0 = valid[0]
    hl2 = (hv + lv) / 2
    ub, lb = hl2 + mult * a, hl2 - mult * a
    fub, flb = ub.copy(), lb.copy()
    dr[s0] = 1 if cv[s0] >= hl2[s0] else -1
    st[s0] = flb[s0] if dr[s0] == 1 else fub[s0]
    for i in range(s0 + 1, m):
        fub[i] = ub[i] if (ub[i] < fub[i - 1] or cv[i - 1] > fub[i - 1]) else fub[i - 1]
        flb[i] = lb[i] if (lb[i] > flb[i - 1] or cv[i - 1] < flb[i - 1]) else flb[i - 1]
        if dr[i - 1] == 1:
            dr[i] = -1 if cv[i] < flb[i] else 1
        else:
            dr[i] = 1 if cv[i] > fub[i] else -1
        st[i] = flb[i] if dr[i] == 1 else fub[i]
    return st, dr


def mfi(h, l, c, v, n=14) -> pd.Series:
    tp = (h + l + c) / 3
    raw = tp * v
    pos = raw.where(tp > tp.shift(1), 0.0).where(tp.shift(1).notna())
    neg = raw.where(tp < tp.shift(1), 0.0).where(tp.shift(1).notna())
    ps, ns = pos.rolling(n, min_periods=n).sum(), neg.rolling(n, min_periods=n).sum()
    out = 100 - 100 / (1 + ps / ns.replace(0, np.nan))
    out[(ns == 0) & (ps > 0)] = 100.0
    out[(ns == 0) & (ps == 0)] = 50.0
    return out.where(ps.notna())


def compute_indicators(df: pd.DataFrame, bench_close: pd.Series | None = None) -> pd.DataFrame:
    """All indicators for one symbol; same index as df. `bench_close` enables relative strength."""
    o, h, l, c, v = (df[k].astype("float64") for k in "ohlcv")
    X: dict[str, pd.Series | np.ndarray] = {"close": c, "volume": v, "chg_1": c.diff(), "ret_1": c.pct_change() * 100}

    for n in MA_PERIODS:
        X[f"sma_{n}"], X[f"ema_{n}"] = sma(c, n), ema(c, n)
    for n in RSI_PERIODS:
        X[f"rsi_{n}"] = rsi(c, n)
    X["macd"], X["macd_signal"], X["macd_hist"] = macd(c)
    X["stoch_k"], X["stoch_d"] = stochastic(h, l, c)
    X["willr_14"] = williams_r(h, l, c)
    X["roc_12"] = c.pct_change(12) * 100

    X["adx_14"], X["plus_di_14"], X["minus_di_14"] = adx(h, l, c)
    X["psar"], X["psar_dir"] = parabolic_sar(h, l, c)
    X["supertrend"], X["supertrend_dir"] = supertrend(h, l, c)
    tenkan = (h.rolling(9).max() + l.rolling(9).min()) / 2
    kijun = (h.rolling(26).max() + l.rolling(26).min()) / 2
    X["ichi_tenkan"], X["ichi_kijun"] = tenkan, kijun
    # Cloud as plotted AT bar t = values computed 26 bars earlier (no look-ahead). Chikou span is omitted:
    # it is the close shifted *backwards* and would leak future data.
    X["ichi_senkou_a"] = ((tenkan + kijun) / 2).shift(26)
    X["ichi_senkou_b"] = ((h.rolling(52).max() + l.rolling(52).min()) / 2).shift(26)

    X["atr_14"] = atr(h, l, c)
    mid, sd = sma(c, 20), c.rolling(20, min_periods=20).std(ddof=0)
    X["bb_mid"], X["bb_upper"], X["bb_lower"] = mid, mid + 2 * sd, mid - 2 * sd
    X["bb_width"] = (4 * sd / mid) * 100
    X["bb_pctb"] = (c - X["bb_lower"]) / (X["bb_upper"] - X["bb_lower"]).replace(0, np.nan)
    lr = np.log(c / c.shift(1))
    for n in (20, 60):
        X[f"hv_{n}"] = lr.rolling(n, min_periods=n).std(ddof=1) * np.sqrt(C.TRADING_DAYS) * 100
    peak = c.cummax()
    X["drawdown"] = (c / peak - 1) * 100
    X["max_dd_252"] = (c / c.rolling(C.TRADING_DAYS, min_periods=60).max() - 1).rolling(C.TRADING_DAYS, min_periods=60).min() * 100

    X["obv"] = (np.sign(c.diff()).fillna(0) * v).cumsum()
    for n in (10, 20, 50):
        X[f"vol_sma_{n}"] = sma(v, n)
    X["vol_ratio_20"] = v / X["vol_sma_20"]
    X["mfi_14"] = mfi(h, l, c, v)
    rng = (h - l).replace(0, np.nan)
    X["ad_line"] = ((((c - l) - (h - c)) / rng).fillna(0) * v).cumsum()

    for n in PERF_PERIODS:
        X[f"perf_{n}"] = c.pct_change(n) * 100
    if bench_close is not None and len(bench_close):
        b = bench_close.astype("float64")
        bi = b.reindex(c.index)  # benchmark close on the symbol's own dates (no fill)
        X["rs_ratio"] = c / bi
        for n in PERF_PERIODS:
            X[f"rs_{n}"] = X[f"perf_{n}"] - (b.pct_change(n) * 100).reindex(c.index)

    out = pd.DataFrame({k: (pd.Series(v_, index=c.index) if isinstance(v_, np.ndarray) else v_) for k, v_ in X.items()}, index=c.index)
    # SAR / supertrend direction of 0 means "not yet defined"
    for k in ("psar_dir", "supertrend_dir"):
        out[k] = out[k].where(out[k] != 0)
    return out
