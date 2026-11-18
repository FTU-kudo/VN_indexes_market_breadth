from datetime import date, datetime

import pandas as pd

from backend import config as C
from backend.collect_data import sync_symbol
from backend.store import load_prices
from backend.yuanta_api import history_end_epoch, vn_midnight_epoch


class FakeClient:
    """Serves bars from an in-memory list; records requested start dates."""
    def __init__(self, bars):
        self.bars, self.calls, self.ends = bars, [], []

    def history(self, symbol, start, end_epoch=None):
        self.calls.append(start)
        self.ends.append(end_epoch)
        return [b for b in self.bars if b["date"] >= start]


def bars(n, start=date(2026, 10, 1), scale=1.0):
    days = pd.bdate_range(start, periods=n)
    return [{"date": d.date(), "o": 10 * scale, "h": 11 * scale, "l": 9 * scale, "c": (10 + i * 0.1) * scale, "v": 1000.0}
            for i, d in enumerate(days)]


NOW = datetime(2026, 11, 17, 16, 30, tzinfo=C.TZ)   # after close


def test_first_run_then_incremental_and_idempotent(data_dir):
    all_bars = bars(30)
    fc = FakeClient(all_bars[:20])
    assert sync_symbol(fc, "stocks", "AAA", NOW, None, False).status == "updated"
    assert fc.calls[0] == C.START_DATE
    fc2 = FakeClient(all_bars)
    r = sync_symbol(fc2, "stocks", "AAA", NOW, all_bars[-1]["date"], False)
    assert r.status == "updated" and r.new_bars == 10
    assert fc2.calls[0] == all_bars[19]["date"] - pd.Timedelta(days=C.OVERLAP_DAYS)  # overlap window
    assert len(load_prices("stocks", "AAA")) == 30
    # same data again -> up to date, nothing requested
    fc3 = FakeClient(all_bars)
    assert sync_symbol(fc3, "stocks", "AAA", NOW, all_bars[-1]["date"], False).status == "up_to_date" and not fc3.calls
    # forced re-run with identical data -> unchanged, no file rewritten
    assert sync_symbol(fc3, "stocks", "AAA", NOW, None, False).status == "unchanged"


def test_price_adjustment_triggers_full_redownload(data_dir):
    raw = bars(30)
    sync_symbol(FakeClient(raw[:20]), "stocks", "AAA", NOW, None, False)
    adjusted = bars(30, scale=0.5)                    # vendor re-based the whole history
    fc = FakeClient(adjusted)
    r = sync_symbol(fc, "stocks", "AAA", NOW, adjusted[-1]["date"], False)
    assert r.status == "adjusted" and fc.calls[-1] == C.START_DATE
    df = load_prices("stocks", "AAA")
    assert len(df) == 30 and abs(df["c"].iloc[0] - 5.0) < 1e-9


def test_partial_bar_dropped_before_close(data_dir):
    midday = datetime(2026, 11, 17, 11, 0, tzinfo=C.TZ)
    b = bars(5, start=date(2026, 11, 11))            # ends on 2026-11-17 (today)
    assert b[-1]["date"] == date(2026, 11, 17)
    sync_symbol(FakeClient(b), "stocks", "AAA", midday, None, False)
    assert load_prices("stocks", "AAA").index[-1].date() == date(2026, 11, 16)


def test_failure_is_reported_not_raised(data_dir):
    from backend.yuanta_api import YuantaAPIError

    class Bad:
        def history(self, *a, **k):
            raise YuantaAPIError("boom")
    r = sync_symbol(Bad(), "stocks", "AAA", NOW, None, False)
    assert r.status == "failed" and "boom" in r.error


def test_storage_partitioned_by_year_and_valid_json(data_dir):
    b = bars(10, start=date(2025, 12, 22))
    sync_symbol(FakeClient(b), "indexes", "VNINDEX", NOW, None, False)
    files = sorted(p.name for p in (data_dir / "prices" / "indexes" / "VNINDEX").glob("*.json"))
    assert files == ["2025.json", "2026.json"]


def test_history_end_is_beyond_the_end_of_today(data_dir):
    fc = FakeClient(bars(5))
    sync_symbol(fc, "stocks", "AAA", NOW, None, False)
    assert fc.ends[0] == history_end_epoch(NOW)
    assert fc.ends[0] >= vn_midnight_epoch(date(2026, 11, 19))   # not "now": a bar for today must not be held back
