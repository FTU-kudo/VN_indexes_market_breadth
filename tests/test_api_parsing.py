import pytest
from datetime import date

from backend.yuanta_api import YuantaAPIError, parse_history, parse_index_list, parse_stock_list

# records copied from real browser captures of the three endpoints
INDEX_PAYLOAD = {"success": True, "response": [
    {"IndexCode": "VNINDEX", "IndexName": "VN-INDEX", "CurrIndex": 1726.72, "OrderID": 1, "IsShow": False},
    {"IndexCode": "VN30", "IndexName": "VN30", "CurrIndex": 1837.13, "OrderID": 2, "IsShow": False},
    {"IndexCode": "HNXINDEX", "IndexName": "HNXINDEX", "CurrIndex": 248.6, "OrderID": 3, "IsShow": False},
    {"IndexCode": "VN30", "IndexName": "dup", "OrderID": 9}]}
STOCK_PAYLOAD = {"success": True, "response": [
    {"StockCode": "AAA", "Exchange": "HSX", "SymbolType": "ST", "RefP": 6820},
    {"StockCode": "aam", "Exchange": "HSX", "SymbolType": "ST"},
    {"StockCode": "AAA", "Exchange": "HSX", "SymbolType": "ST"},
    {"StockCode": "", "Exchange": "HSX"}]}
HIST_PAYLOAD = {"s": "ok", "bars": [
    {"t": 1578009600, "o": 51.11, "h": 51.24, "l": 50.79, "c": 51.24, "v": 248940},
    {"t": 1577923200, "o": 51.06, "h": 51.11, "l": 50.66, "c": 51.11, "v": 440280},
    {"t": 1578268800, "o": 51.11, "h": 51.11, "l": 50.84, "c": 50.88, "v": 301910}]}


def test_index_list():
    r = parse_index_list(INDEX_PAYLOAD)
    assert [x["code"] for x in r] == ["VNINDEX", "VN30", "HNXINDEX"]
    assert r[0]["name"] == "VN-INDEX"


def test_stock_list_dedup_and_normalise():
    r = parse_stock_list(STOCK_PAYLOAD)
    assert [x["symbol"] for x in r] == ["AAA", "AAM"]
    assert r[0] == {"symbol": "AAA", "exchange": "HSX", "type": "ST"}


def test_unsuccessful_payload_raises():
    with pytest.raises(YuantaAPIError):
        parse_index_list({"success": False})


def test_history_sorted_and_dates():
    bars = parse_history(HIST_PAYLOAD)
    assert [b["date"] for b in bars] == [date(2020, 1, 2), date(2020, 1, 3), date(2020, 1, 6)]
    assert bars[0]["c"] == 51.11 and bars[0]["v"] == 440280


def test_history_drops_bad_bars_and_dedups():
    p = {"s": "ok", "bars": HIST_PAYLOAD["bars"] + [
        {"t": 1578355200, "o": None, "h": 1, "l": 1, "c": 1, "v": 1},
        {"t": 1578441600, "o": 1, "h": 1, "l": 1, "c": 0, "v": 1},
        {"t": 1578528000, "o": 1, "h": 1, "l": 1, "c": 1, "v": -5},
        {"t": 1577923200, "o": 9, "h": 9, "l": 9, "c": 9, "v": 9}]}
    bars = parse_history(p)
    assert len(bars) == 3 and bars[0]["c"] == 9  # duplicate date: last wins


def test_history_udf_and_no_data():
    udf = {"s": "ok", "t": [1577923200], "o": [1.0], "h": [2.0], "l": [0.5], "c": [1.5], "v": [10]}
    assert parse_history(udf)[0]["h"] == 2.0
    assert parse_history({"s": "no_data"}) == []
    with pytest.raises(YuantaAPIError):
        parse_history({"s": "error", "errmsg": "x"})
