import numpy as np
import pandas as pd

from backend import config as C
from backend.calculate_breadth import aggregate, build_matrices, symbol_features
from backend.collect_data import diff_constituents


def _closes(n=40):
    idx = pd.bdate_range("2020-01-02", periods=n)
    up = pd.Series(np.linspace(10, 20, n), index=idx)
    down = pd.Series(np.linspace(20, 10, n), index=idx)
    return idx, {f"U{i}": up * (1 + i * 0.01) for i in range(4)} | {f"D{i}": down * (1 + i * 0.01) for i in range(2)}


def test_ma_breadth_counts_and_percent(monkeypatch):
    monkeypatch.setattr(C, "MIN_GROUP_SIZE", 3)
    idx, closes = _closes()
    M = build_matrices(closes, idx)
    df = aggregate(M, list(closes), C.COMPOSITE_WEIGHTS)
    last = df.iloc[-1]
    assert last["above_10_cnt"] == 4 and last["below_10_cnt"] == 2
    assert abs(last["above_10_pct"] - 400 / 6) < 1e-6 and abs(last["below_10_pct"] - 200 / 6) < 1e-6
    assert np.isnan(last["above_50_pct"])          # only 40 bars: no MA50 -> no fabricated value
    assert last["n_with_price"] == 6


def test_advance_decline_and_line(monkeypatch):
    monkeypatch.setattr(C, "MIN_GROUP_SIZE", 3)
    idx, closes = _closes()
    closes["FLAT"] = pd.Series(15.0, index=idx)
    M = build_matrices(closes, idx)
    df = aggregate(M, list(closes), C.COMPOSITE_WEIGHTS)
    row = df.iloc[10]
    assert (row["adv"], row["dec"], row["unch"], row["net_adv"]) == (4, 2, 1, 2)
    assert row["ad_ratio"] == 2.0
    assert df["ad_line"].iloc[-1] == 2 * (len(df) - 1)   # first calendar day has no return


def test_missing_bar_is_excluded_not_filled(monkeypatch):
    monkeypatch.setattr(C, "MIN_GROUP_SIZE", 3)
    idx, closes = _closes()
    closes["U0"] = closes["U0"].drop(idx[30])
    M = build_matrices(closes, idx)
    assert M["has_price"].loc[idx[30], "U0"] == 0
    assert np.isnan(M["above_10"].loc[idx[30], "U0"])
    assert np.isnan(M["pos1"].loc[idx[31], "U0"])        # return needs both days


def test_new_highs_exclude_today_from_reference_window():
    idx = pd.bdate_range("2020-01-02", periods=30)
    c = pd.Series(np.r_[np.full(25, 10.0), 11.0, 11.0, 12.0, 9.0, 12.5], index=idx)
    f = symbol_features(c, idx)
    assert f["hi20"].iloc[25] == 1 and f["hi20"].iloc[26] == 0   # equal to prior high is not a new high
    assert f["hi20"].iloc[27] == 1 and f["lo20"].iloc[28] == 1 and f["hi20"].iloc[29] == 1
    assert np.isnan(f["hi20"].iloc[10])


def test_composite_bounds_and_weights(monkeypatch):
    monkeypatch.setattr(C, "MIN_GROUP_SIZE", 3)
    idx = pd.bdate_range("2020-01-02", periods=320)
    rng = np.random.default_rng(0)
    closes = {f"S{i}": pd.Series(20 * np.exp(np.cumsum(rng.normal(0.0005, 0.02, 320))), index=idx) for i in range(8)}
    M = build_matrices(closes, idx)
    df = aggregate(M, list(closes), C.COMPOSITE_WEIGHTS)
    comp = df["composite"].dropna()
    assert len(comp) > 50 and comp.between(0, 100).all()
    only_rsi = aggregate(M, list(closes), {"ma": 0, "ad": 0, "hl": 0, "macd": 0, "rsi": 1.0})
    assert np.allclose(only_rsi["composite"].dropna(), only_rsi["pct_rsi_gt50"].dropna())


def test_constituent_diff():
    d = diff_constituents({"VN30": ["A", "B"], "X": ["Q"]}, {"VN30": ["B", "C"], "Y": ["Z"]})
    assert d == [{"index": "VN30", "added": ["C"], "removed": ["A"]}]
