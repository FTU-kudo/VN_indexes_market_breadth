from datetime import date, datetime

from backend import config as C
from backend.yuanta_api import session_is_final, ts_to_date, vn_midnight_epoch


def test_vn_midnight_epoch():
    # 2020-01-01 00:00 ICT == 2019-12-31 17:00 UTC
    assert vn_midnight_epoch(date(2020, 1, 1)) == 1577811600
    assert vn_midnight_epoch(date(2020, 1, 1)) == 1577836800 - 7 * 3600


def test_bar_timestamp_to_trade_date():
    # values seen in the real VIC / VNINDEX captures (00:00 UTC stamps)
    assert ts_to_date(1577923200) == date(2020, 1, 2)
    assert ts_to_date(1578009600) == date(2020, 1, 3)
    assert ts_to_date(1578268800) == date(2020, 1, 6)       # Monday: weekend skipped
    assert ts_to_date(1578268800 - 7 * 3600) == date(2020, 1, 6)  # 00:00 ICT stamps agree


def test_session_final():
    mk = lambda *a: datetime(*a, tzinfo=C.TZ)  # noqa: E731
    assert not session_is_final(mk(2026, 11, 17, 10, 0))   # Tuesday mid-session
    assert not session_is_final(mk(2026, 11, 17, 15, 0))
    assert session_is_final(mk(2026, 11, 17, 16, 0))
    assert session_is_final(mk(2026, 11, 14, 10, 0))       # Saturday
