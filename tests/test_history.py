# tests/test_history.py
from datetime import date

import numpy as np
import pandas as pd

from backend import config as C
from backend.collect_data import mark_backfilled, needs_backfill
from backend.era_compare import build as era_build, highlights
from backend.history_coverage import build as cov_build
from backend.store import save_prices, write_if_changed


def _px(start, end, drift=0.0003, seed=1, vol=0.01, v0=1e8):
    idx = pd.bdate_range(start, end)
    r = np.random.default_rng(seed).normal(drift, vol, len(idx))
    c = 500 * np.exp(np.cumsum(r))
    return pd.DataFrame({"o": c, "h": c * 1.01, "l": c * 0.99, "c": c, "v": v0}, index=idx)


def test_default_history_starts_in_2010():
    assert C.START_DATE == date(2010, 1, 1) and C.FUND_FLOOR_YEAR == 2009 and C.FUND_MAX_BATCHES * 5 >= 72


def test_backfill_marker(data_dir):
    assert needs_backfill()                                  # nothing recorded yet -> download from START_DATE once
    mark_backfilled()
    assert not needs_backfill()
    write_if_changed(data_dir / "monitor" / "history_start.json", {"prices_from": "2020-01-01"})
    assert needs_backfill()                                  # history was last fetched from 2020 -> 2010 requires a backfill


def test_history_coverage_reports_actual_start(data_dir):
    save_prices("indexes", "VNINDEX", _px("2012-03-05", "2016-12-30"))        # API only reaches 2012 -> the real start is reported
    save_prices("stocks", "AAA", _px("2010-01-04", "2012-12-31"))
    save_prices("stocks", "BBB", _px("2018-06-01", "2019-12-31"))
    write_if_changed(data_dir / "valuation" / "index.json", {"groups": [{"id": "HOSE", "first_date": "2013-02-28"}, {"id": "MARKET", "first_date": "2013-03-29"}]})
    cov = cov_build()
    assert cov["requested_start"] == "2010-01-01" and cov["benchmark_first_bar"] == "2012-03-05"
    assert cov["prices_stocks"]["earliest_date"] == "2010-01-04" and cov["prices_stocks"]["first_year_counts"] == {"2010": 1, "2018": 1}
    assert cov["prices_stocks"]["reached_requested_start"] == 1
    assert cov["actual_start_year"]["valuation"] == 2013 and cov["actual_start_year"]["benchmark"] == 2012


def test_era_comparison_numbers_and_highlights(data_dir):
    bull = _px("2010-01-04", "2019-12-31", drift=0.0002, seed=2, vol=0.015, v0=50e6)
    after = _px("2020-01-02", "2026-11-20", drift=0.0004, seed=3, vol=0.008, v0=300e6)
    save_prices("indexes", "VNINDEX", pd.concat([bull, after]))
    idx = pd.bdate_range("2010-01-04", "2026-11-20")
    n = len(idx)
    ser = {"above_50_pct": [40.0] * n, "above_200_pct": [30.0 if d.year < 2020 else 45.0 for d in idx], "composite": [50.0] * n, "n_with_price": [300 if d.year < 2020 else 1500 for d in idx]}
    write_if_changed(data_dir / "breadth" / "MARKET.json", {"dates": [d.strftime("%Y-%m-%d") for d in idx], "series": ser})
    pe = [18.0 if d.year < 2020 else 12.0 for d in idx]
    write_if_changed(data_dir / "valuation" / "HOSE.json", {"dates": [d.strftime("%Y-%m-%d") for d in idx],
                     "series": {"agg_pe": pe, "agg_pb": [2.0] * n, "median_pe": pe, "median_pb": [1.5] * n, "pct_loss": [10.0] * n}})
    r = era_build()
    pre, post = r["vnindex"]["pre"], r["vnindex"]["post"]
    assert pre["last"] < "2020-01-01" <= post["first"] and pre["first"] == "2010-01-04"
    assert post["avg_daily_volume"] == 300_000_000 and pre["avg_daily_volume"] == 50_000_000
    assert r["breadth"]["MARKET"]["pre"]["avg_above_ma200_pct"] == 30.0 and r["breadth"]["MARKET"]["post"]["stocks_with_prices_at_end"] == 1500
    assert r["valuation"]["HOSE"]["agg_pe"]["pre"]["mean"] == 18.0 and r["valuation"]["HOSE"]["agg_pe"]["post"]["mean"] == 12.0
    text = " ".join(r["highlights"])
    assert "HOSE weighted P/E (average): 18.00x before 2020 vs 12.00x since — lower (-33%)" in text
    assert "Average daily volume" in text and "higher (+500%)" in text
    assert "about the same" in text                                                 # unchanged metrics are reported as such
    assert highlights({}) == []                                                     # no data -> no invented text


def test_generated_sentences_handle_negative_values_and_drawdowns():
    from backend.era_compare import _line
    assert "higher (+29.2 pts)" in _line("Annualised return (CAGR)", -4.8, 24.4, "%", 1, 15.0)       # negative base: points, right direction
    assert "lower (-10.0 pts)" in _line("x", 5.0, -5.0, "%", 1, 15.0)
    assert "shallower" in _line("Deepest drawdown", 70.2, 48.3, "%", 1, 15.0, ("deeper", "shallower"))
    assert "about the same" in _line("x", 10.0, 10.5, "x", 1, 10.0)
