import numpy as np
import pandas as pd

from backend import indicators as I
from conftest import make_ohlcv


def test_sma_ema_basic():
    s = pd.Series(np.arange(1.0, 11.0))
    assert I.sma(s, 5).iloc[4] == 3.0 and np.isnan(I.sma(s, 5).iloc[3])
    e = I.ema(s, 3)
    alpha = 2 / 4
    manual = s.iloc[0]
    for x in s.iloc[1:3]:
        manual = alpha * x + (1 - alpha) * manual
    assert np.isnan(e.iloc[1]) and abs(e.iloc[2] - manual) < 1e-12


def test_rsi_extremes():
    up = pd.Series(np.arange(1.0, 40.0))
    assert I.rsi(up, 14).iloc[-1] == 100.0
    assert I.rsi(-up + 100, 14).iloc[-1] == 0.0
    flat = pd.Series(np.ones(40))
    assert I.rsi(flat, 14).iloc[-1] == 50.0
    r = I.rsi(make_ohlcv()["c"], 14).dropna()
    assert ((r >= 0) & (r <= 100)).all()


def test_macd_identity():
    c = make_ohlcv()["c"]
    line, sig, hist = I.macd(c)
    assert np.allclose(hist.dropna(), (line - sig).dropna())
    assert np.allclose(line.dropna(), (I.ema(c, 12) - I.ema(c, 26)).dropna())


def test_bounded_oscillators_and_bands():
    df = make_ohlcv()
    ind = I.compute_indicators(df)
    assert ind["stoch_k"].dropna().between(0, 100).all()
    assert ind["willr_14"].dropna().between(-100, 0).all()
    assert ind["mfi_14"].dropna().between(0, 100).all()
    assert ind["adx_14"].dropna().between(0, 100).all()
    ok = ind.dropna(subset=["bb_upper"])
    assert (ok["bb_upper"] >= ok["bb_mid"]).all() and (ok["bb_mid"] >= ok["bb_lower"]).all()
    assert (ind["drawdown"].dropna() <= 1e-9).all()
    assert (ind["max_dd_252"].dropna() <= 1e-9).all()


def test_obv_and_ad_line():
    df = pd.DataFrame({"o": [1, 1, 1, 1.0], "h": [2, 2, 2, 2.0], "l": [1, 1, 1, 1.0],
                       "c": [1.5, 2.0, 1.0, 1.0], "v": [10, 20, 30, 40.0]},
                      index=pd.bdate_range("2020-01-02", periods=4))
    ind = I.compute_indicators(df)
    assert list(ind["obv"]) == [0, 20, -10, -10]
    # CLV: 0, +1, -1, -1 ... first bar (c-l)-(h-c) = 0.5-0.5 = 0
    assert list(ind["ad_line"]) == [0, 20, -10, -50]


def test_psar_and_supertrend_directions():
    up = make_ohlcv(200, seed=3, drift=0.01, vol=0.004)
    ind = I.compute_indicators(up)
    assert ind["psar_dir"].dropna().isin([1, -1]).all()
    assert ind["supertrend_dir"].iloc[-1] == 1 and ind["psar_dir"].iloc[-1] == 1
    assert ind["psar"].iloc[-1] < up["c"].iloc[-1]
    assert ind["supertrend"].iloc[-1] < up["c"].iloc[-1]


def test_relative_strength():
    df = make_ohlcv(300, seed=5)
    bench = make_ohlcv(300, seed=6)["c"]
    ind = I.compute_indicators(df, bench)
    exp = df["c"].pct_change(20) * 100 - bench.pct_change(20) * 100
    assert np.allclose(ind["rs_20"].dropna(), exp.dropna())
    assert "rs_20" not in I.compute_indicators(df).columns


def test_no_look_ahead_every_column():
    """Indicators computed on a truncated history must equal the full-history values on those bars."""
    df = make_ohlcv(450, seed=11)
    bench = make_ohlcv(450, seed=12)["c"]
    full = I.compute_indicators(df, bench)
    for cut in (250, 333, 449):
        part = I.compute_indicators(df.iloc[:cut], bench.iloc[:cut])
        pd.testing.assert_frame_equal(part, full.iloc[:cut], check_exact=False, rtol=1e-9, atol=1e-9)


def test_missing_values_are_not_fabricated():
    ind = I.compute_indicators(make_ohlcv(60))
    assert ind["sma_200"].isna().all() and ind["sma_50"].iloc[:49].isna().all()
    assert ind["ichi_senkou_b"].isna().all()   # needs 52+26 bars
