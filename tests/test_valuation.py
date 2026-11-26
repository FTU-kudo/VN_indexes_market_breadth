# tests/test_valuation.py
import numpy as np
import pandas as pd
import pytest

from backend import config as C
from backend.valuation import aggregate_group, prepare_fundamentals, valuation_for_symbol, ytd_to_quarterly


def Q(period_end, published, ni, eq=1000.0, sh=100.0):
    return {"period_end": period_end, "published": published, "net_income_parent": ni, "equity_parent": eq, "shares": sh}


FOUR = [Q("2024-03-31", "2024-04-20", 10), Q("2024-06-30", "2024-07-20", 20), Q("2024-09-30", "2024-10-20", 30), Q("2024-12-31", "2025-01-30", 40),
        Q("2025-03-31", "2025-04-20", 50)]


def test_ytd_to_quarterly_and_gaps():
    pe = pd.Series(pd.to_datetime(["2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31", "2025-03-31"]))
    assert list(ytd_to_quarterly(pe, pd.Series([10, 25, 45, 70, 12]))) == [10, 15, 20, 25, 12]
    gap = ytd_to_quarterly(pe[[0, 2]].reset_index(drop=True), pd.Series([10, 45]))
    assert gap.iloc[0] == 10 and np.isnan(gap.iloc[1])           # Q2 missing -> Q3 unknown, not fabricated


def test_ttm_needs_four_consecutive_quarters():
    f = prepare_fundamentals(FOUR)
    assert list(f["ni_ttm"].iloc[:3].isna()) == [True, True, True]
    assert f["ni_ttm"].iloc[3] == 100 and f["ni_ttm"].iloc[4] == 140
    gap = prepare_fundamentals([FOUR[0], FOUR[1], FOUR[3], FOUR[4]])
    assert gap["ni_ttm"].isna().all()                              # skipped Q3 -> never summed across the hole


def test_cumulative_input_equals_quarterly_input():
    cum = [Q("2024-03-31", "2024-04-20", 10), Q("2024-06-30", "2024-07-20", 30), Q("2024-09-30", "2024-10-20", 60), Q("2024-12-31", "2025-01-30", 100)]
    assert prepare_fundamentals(cum, cumulative=True)["ni_ttm"].iloc[-1] == prepare_fundamentals(FOUR[:4])["ni_ttm"].iloc[-1] == 100


def test_point_in_time_no_lookahead():
    f = prepare_fundamentals(FOUR)
    px = pd.Series(10.0, index=pd.to_datetime(["2025-01-29", "2025-01-30", "2025-04-19", "2025-04-20"]))
    v = valuation_for_symbol(px, f, shares_mode="pit", price_unit=1.0)
    assert np.isnan(v["ni_ttm"].iloc[0])                           # FY filing not yet public on 29 Jan
    assert v["ni_ttm"].iloc[1] == 100 and v["ni_ttm"].iloc[2] == 100
    assert v["ni_ttm"].iloc[3] == 140                              # Q1-2025 filing public from 20 Apr


def test_pe_pb_math_and_loss_makers():
    f = prepare_fundamentals(FOUR)
    px = pd.Series([10.0], index=pd.to_datetime(["2025-02-10"]))
    v = valuation_for_symbol(px, f, shares_mode="pit", price_unit=1.0)
    assert v["mcap"].iloc[0] == 1000 and v["pe"].iloc[0] == 10 and v["pb"].iloc[0] == 1.0
    lossy = prepare_fundamentals([Q(a, b, -5, eq=-1.0) for a, b, _ in [(x["period_end"], x["published"], 0) for x in FOUR]])
    v = valuation_for_symbol(px, lossy, shares_mode="pit", price_unit=1.0)
    assert np.isnan(v["pe"].iloc[0]) and bool(v["loss"].iloc[0]) and np.isnan(v["pb"].iloc[0])


def test_shares_modes_and_stale_filings():
    rows = [Q("2024-03-31", "2024-04-20", 10, sh=100), Q("2024-06-30", "2024-07-20", 10, sh=100),
            Q("2024-09-30", "2024-10-20", 10, sh=100), Q("2024-12-31", "2025-01-30", 10, sh=200)]
    f = prepare_fundamentals(rows)
    px = pd.Series([1.0, 1.0], index=pd.to_datetime(["2025-02-01", "2026-06-01"]))
    pit = valuation_for_symbol(px, f, shares_mode="pit", price_unit=1.0)
    assert pit["mcap"].iloc[0] == 200
    assert np.isnan(pit["pe"].iloc[1])                             # filing > MAX_FILING_AGE_DAYS old -> no valuation
    assert valuation_for_symbol(px.iloc[:1], f, shares_mode="latest", price_unit=1.0)["mcap"].iloc[0] == 200


def test_aggregate_group():
    d = pd.to_datetime(["2025-02-10"])
    M = {"mcap": pd.DataFrame({"A": [100.0], "B": [200.0], "C": [300.0], "D": [400.0], "E": [500.0], "L": [50.0]}, index=d)}
    M["ni_ttm"] = pd.DataFrame({"A": [10.0], "B": [10.0], "C": [10.0], "D": [10.0], "E": [10.0], "L": [-5.0]}, index=d)
    M["equity"] = M["ni_ttm"] * 10
    M["pe"] = (M["mcap"] / M["ni_ttm"]).where(M["ni_ttm"] > 0)
    M["pb"] = (M["mcap"] / M["equity"]).where(M["equity"] > 0)
    g = aggregate_group(M, list(M["mcap"].columns), min_n=5).iloc[0]
    assert g["median_pe"] == 30 and g["agg_pe"] == 1500 / 50 and g["n_pe"] == 5
    assert g["n_loss"] == 1 and abs(g["pct_loss"] - 100 / 6) < 1e-9
    assert aggregate_group(M, ["A", "B"], min_n=5).iloc[0][["median_pe", "agg_pe"]].isna().all()   # too few members


def _matrices(seed=3, n_days=3, n=12):
    rng = np.random.default_rng(seed)
    d = pd.bdate_range("2025-02-03", periods=n_days)
    cols = [f"S{i:02d}" for i in range(n)]
    mcap = pd.DataFrame(rng.uniform(1e12, 9e13, (n_days, n)), index=d, columns=cols)
    ni = pd.DataFrame(rng.normal(3e12, 4e12, (n_days, n)), index=d, columns=cols)
    eq = pd.DataFrame(rng.uniform(-1e12, 5e13, (n_days, n)), index=d, columns=cols)
    return {"mcap": mcap, "ni_ttm": ni, "equity": eq, "pe": (mcap / ni).where(ni > 0), "pb": (mcap / eq).where(eq > 0)}


def test_partition_is_additive_and_matches_weighted_aggregate():
    from backend.valuation import partition_components
    M = _matrices()
    cols = list(M["mcap"].columns)
    group_of = {c: ("Banking" if i % 3 == 0 else "Retail" if i % 3 == 1 else "Vingroup Ecosystem") for i, c in enumerate(cols)}
    parts = partition_components(M, cols, group_of)
    assert set(parts) == {"Banking", "Retail", "Vingroup Ecosystem"}
    whole = aggregate_group(M, cols, min_n=1)
    tot = lambda k: sum(p[k] for p in parts.values())   # noqa: E731
    assert np.allclose(tot("mcap_pe") / tot("ni"), whole["agg_pe"]) and np.allclose(tot("mcap_pb") / tot("eq"), whole["agg_pb"])
    # excluding a group == recomputing on the remaining stocks
    rest = [c for c in cols if group_of[c] != "Banking"]
    ex = aggregate_group(M, rest, min_n=1)
    inc = [parts["Retail"], parts["Vingroup Ecosystem"]]
    assert np.allclose(sum(p["mcap_pe"] for p in inc) / sum(p["ni"] for p in inc), ex["agg_pe"])
    assert np.allclose(sum(p["n_pe"] for p in inc), ((M["ni_ttm"][rest] > 0)).sum(axis=1))
    assert np.allclose(parts["Banking"]["med_pe"], M["pe"][[c for c in cols if group_of[c] == "Banking"]].median(axis=1), equal_nan=True)


def test_coverage_gate_hides_thin_samples():
    import numpy as np
    d = pd.to_datetime(["2015-06-01", "2025-06-01"])
    cols = [f"S{i:02d}" for i in range(20)]
    mcap = pd.DataFrame(1e12, index=d, columns=cols)
    ni = pd.DataFrame(np.nan, index=d, columns=cols)
    ni.iloc[0, :6] = 1e11                      # 2015: only 6 of 20 traded stocks have profit data (30% needed -> 6 is exactly enough)
    ni.iloc[0, 5] = np.nan                     # ... make it 5 of 20 = 25%: below the gate
    ni.iloc[1, :] = 1e11                       # 2025: everyone
    M = {"mcap": mcap, "ni_ttm": ni, "equity": ni * 10, "pe": (mcap / ni).where(ni > 0), "pb": (mcap / (ni * 10)).where(ni > 0), "has_px": pd.DataFrame(1.0, index=d, columns=cols)}
    g = aggregate_group(M, cols, min_n=5, min_cov=0.30)
    assert np.isnan(g["agg_pe"].iloc[0]) and np.isnan(g["median_pe"].iloc[0]) and np.isnan(g["pct_loss"].iloc[0])   # 25% < 30%
    assert g["n_pe"].iloc[0] == 5 and g["n_px"].iloc[0] == 20                                                       # counts still reported
    assert g["agg_pe"].iloc[1] == 10.0 and g["median_pe"].iloc[1] == 10.0
    assert aggregate_group({k: v for k, v in M.items() if k != "has_px"}, cols, min_n=5)["agg_pe"].notna().all()   # old behaviour without has_px


def test_profit_run_stats_explains_missing_ttm():
    from backend.valuation import profit_run_stats
    q = lambda e, v: {"period_end": e, "net_income_parent": v}   # noqa: E731
    none = profit_run_stats([q("2024-03-31", None), q("2024-06-30", None)])
    assert none["n_profit_quarters"] == 0 and none["last_profit_quarter"] is None
    gaps = profit_run_stats([q("2024-03-31", 1), q("2024-06-30", 1), q("2024-12-31", 1), q("2025-03-31", 1), q("2025-09-30", 1)])
    assert gaps["n_profit_quarters"] == 5 and gaps["longest_run"] == 2 and gaps["last_profit_quarter"] == "2025Q3"   # 5 quarters but never 4 in a row
    assert profit_run_stats([q(f"2025-{m:02d}-28", 1) for m in (3, 6, 9, 12)])["longest_run"] == 4
