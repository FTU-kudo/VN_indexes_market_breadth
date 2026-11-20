from datetime import date

import pandas as pd
import pytest

from backend import config as C
from backend.calculate_valuation import main as valuation_main
from backend.collect_fundamentals import build_quarters, looks_cumulative, merge_quarters, sync_symbol
from backend.field_map import NORM_ID_OVERRIDE, norm, pick
from backend.fundamentals_api import expected_latest_quarter, parse_report, prev_quarter, walk_back
from backend.peers import peer_snapshot
from backend.statements import build_statements, merge_statements
from backend.store import read_json, save_prices, write_if_changed
from backend.universe import load_universe, peers_of

# Line items as the prototype's code expects them (title.data[] periods, detail[].data[] items with parallel value[]).
KQKD_ITEMS = [("Lợi nhuận sau thuế thu nhập doanh nghiệp", "ni_total"),
              ("Lợi nhuận sau thuế của cổ đông công ty mẹ", "ni_parent"), ("Lãi cơ bản trên cổ phiếu", "eps")]
CDKT_ITEMS = [("TỔNG CỘNG TÀI SẢN", "assets"), ("D - VỐN CHỦ SỞ HỮU", "equity"), ("Lợi ích cổ đông không kiểm soát", "mi"),
              ("Vốn góp của chủ sở hữu", "cc"), ("Nợ phải trả và vốn chủ sở hữu", "liab_eq")]


def quarter_values(y, q, base=100.0):
    k = (y - 2018) * 4 + q
    return {"ni_total": base * k + 7, "ni_parent": base * k, "eps": 1.0, "assets": 1e6, "equity": 5000.0 + 10 * k,
            "mi": 200.0, "cc": 1000.0, "liab_eq": 9e5}


class FakeClient:
    """Mimics the API: the 5 quarters ending at the anchor, newest first. `ignore_anchor` simulates no paging."""
    def __init__(self, last=(2026, 3), ignore_anchor=False):
        self.last, self.ignore_anchor, self.calls = last, ignore_anchor, []

    def report(self, stock, rtype, y, q):
        self.calls.append((stock, rtype, y, q))
        if self.ignore_anchor:
            y, q = self.last
        if (y, q) > self.last:          # the API cannot return quarters that do not exist yet
            y, q = self.last
        periods, cur = [], (y, q)
        for _ in range(5):
            periods.append(cur)
            cur = prev_quarter(*cur)
        title = [{"year_period": py, "term_code": f"Q{pq}", "period_begin": f"{py}-01-01", "period_end": f"{py}-{pq*3:02d}-28", "audited_status_en": "Reviewed"} for py, pq in periods]
        items = KQKD_ITEMS if rtype == "KQKD" else CDKT_ITEMS
        data = [{"norm_id": 100 + i, "field_name": n, "field_name_en": None, "value": [quarter_values(py, pq)[key] for py, pq in periods]}
                for i, (n, key) in enumerate(items)]
        return {"title": {"data": title}, "detail": [{"report_component_name_en": "X", "data": data}]}


def test_norm_and_pick_vietnamese_labels():
    assert norm("XI. Lợi nhuận  sau thuế") == "lợi nhuận sau thuế" and norm("D - VỐN CHỦ SỞ HỮU") == "vốn chủ sở hữu"
    rows = parse_report(FakeClient().report("ANV", "KQKD", 2026, 3), "KQKD")
    cur = [r for r in rows if (r["year"], r["term"]) == (2026, 3)]
    v, src = pick(cur, "net_income_parent")
    assert v == quarter_values(2026, 3)["ni_parent"] and "mẹ" in src            # parent line, not the total line
    cdkt = parse_report(FakeClient().report("ANV", "CDKT", 2026, 3), "CDKT")
    cur = [r for r in cdkt if (r["year"], r["term"]) == (2026, 3)]
    assert pick(cur, "equity_total")[0] == quarter_values(2026, 3)["equity"]      # not "Nợ phải trả và vốn chủ sở hữu"
    assert pick(cur, "charter_capital")[0] == 1000.0 and pick(cur, "minority_interest")[0] == 200.0
    NORM_ID_OVERRIDE["net_income_parent"] = 100                                    # pin by norm_id -> total-profit row
    try:
        assert pick([r for r in rows if (r["year"], r["term"]) == (2026, 3)], "net_income_parent")[0] == quarter_values(2026, 3)["ni_total"]
    finally:
        NORM_ID_OVERRIDE.clear()


def test_parse_report_handles_nulls_and_odd_periods():
    resp = {"title": {"data": [{"year_period": 2026, "term_code": "Q3", "period_end": "2026-09-30T00:00:00"},
                               {"year_period": 2026, "term_code": "YTD"}, {"year_period": 2026, "term_code": "Q2"}]},
            "detail": [{"data": [{"norm_id": 1, "field_name": "x", "value": [5, 9, None]}]}]}
    rows = parse_report(resp, "KQKD")
    assert [(r["term"], r["value"]) for r in rows] == [(3, 5.0), (2, None)]       # 'YTD' period skipped, null kept as None
    assert rows[0]["period_end"] == date(2026, 9, 30) and rows[1]["period_end"] == date(2026, 6, 30)


def test_walk_back_reaches_floor_and_stops_when_paging_is_ignored():
    rows = walk_back(FakeClient(), "ANV", "KQKD", (2026, 3), floor_year=2019)
    periods = sorted({(r["year"], r["term"]) for r in rows})
    assert periods[0][0] == 2018 or periods[0] == (2019, 1) or periods[0][0] == 2019 and len(periods) >= 29
    assert len(periods) == len(set(periods))                                       # no duplicate periods
    stuck = FakeClient(ignore_anchor=True)
    assert len(walk_back(stuck, "ANV", "KQKD", (2026, 3), floor_year=2010)) > 0 and len(stuck.calls) == 2   # 2nd identical batch -> stop


def test_build_quarters_units_shares_and_assumed_publish():
    rows = parse_report(FakeClient().report("ANV", "KQKD", 2026, 3), "KQKD") + parse_report(FakeClient().report("ANV", "CDKT", 2026, 3), "CDKT")
    qs, src = build_quarters(rows)
    q = [x for x in qs if x["period_end"].startswith("2026-09")][0]
    k = (2026 - 2018) * 4 + 3
    assert q["net_income_parent"] == 100.0 * k * C.FUND_UNIT
    assert q["equity_parent"] == (5000.0 + 10 * k - 200.0) * C.FUND_UNIT           # parent equity = total - minority
    assert q["shares"] == 1000.0 * C.FUND_UNIT / C.PAR_VALUE_VND
    assert q["published"] == "2026-10-28" and "mẹ" in src["net_income_parent"]      # 28 Sep + 30 days (fixture period_end day 28)


def test_expected_latest_quarter_and_merge():
    assert expected_latest_quarter(date(2026, 11, 19)) == (2026, 3)
    assert expected_latest_quarter(date(2026, 4, 10)) == (2025, 4)
    assert expected_latest_quarter(date(2026, 2, 1)) == (2025, 3)
    old = [{"period_end": "2026-06-30", "published": "x", "net_income_parent": 1.0, "equity_parent": 2.0, "shares": 3.0}]
    new = [{"period_end": "2026-06-30", "published": "x", "net_income_parent": 9.0, "equity_parent": None, "shares": None}]
    m = merge_quarters(old, new)
    assert m[0]["net_income_parent"] == 9.0 and m[0]["equity_parent"] == 2.0       # restated value wins, nulls never erase


def test_looks_cumulative():
    def qs(vals):
        return [{"period_end": f"2024-{m:02d}-30", "net_income_parent": v} for m, v in zip((3, 6, 9, 12), vals)]
    assert looks_cumulative(qs([10, 25, 45, 70])) and not looks_cumulative(qs([10, 8, 12, 9]))


def test_sync_symbol_full_then_incremental(data_dir):
    c = FakeClient(last=(2026, 3))
    r = sync_symbol(c, "ANV", date(2026, 11, 19), full=False, checked={})
    assert r.status == "updated" and r.missing == ()
    j = read_json(data_dir / "fundamentals" / "ANV.json")
    assert j["quarters"][-1]["period_end"].startswith("2026-09") and len(j["quarters"]) >= 28
    n = len(c.calls)
    assert sync_symbol(c, "ANV", date(2026, 11, 20), False, {}).status == "up_to_date" and len(c.calls) == n   # nothing requested
    c2 = FakeClient(last=(2026, 4))                                                 # Q4 appears later
    r = sync_symbol(c2, "ANV", date(2027, 4, 5), False, {})
    assert r.status == "updated" and len(c2.calls) == len(C.FUND_REPORTS)          # one window per report, not a re-download
    assert sync_symbol(c, "BBB", date(2026, 11, 19), False, {}).status == "updated"           # Q4 not published yet by the API
    assert sync_symbol(FakeClient(last=(2026, 3)), "BBB", date(2027, 4, 5), False, {"BBB": "2027-04-04"}).status == "skipped_recent"
    fresh = FakeClient(last=(2026, 3))
    assert sync_symbol(fresh, "BBB", date(2027, 4, 5), False, {"BBB": "2027-03-01"}).status == "unchanged" and len(fresh.calls) == len(C.FUND_REPORTS)


def _universe(data_dir):
    stocks = [{"symbol": s, "exchange": "HOSE", "type": "ST", "indexes": ix} for s, ix in [
        ("AAA", ["VNINDEX", "VN30", "VNFIN"]), ("BBB", ["VNINDEX", "VNFIN", "VNFINLEAD"]), ("CCC", ["VNINDEX", "VNFIN"]),
        ("DDD", ["VNINDEX", "VNIT"]), ("EEE", ["VNINDEX", "VNIT"]), ("FFF", ["VNINDEX"])]]
    write_if_changed(data_dir / "stocks.json", stocks)
    write_if_changed(data_dir / "indexes.json", [{"code": c, "name": c, "order": i} for i, c in enumerate(["VNINDEX", "VN30", "VNFIN", "VNFINLEAD", "VNIT"])])
    write_if_changed(data_dir / "constituents.json", {"indexes": {"VNINDEX": [s["symbol"] for s in stocks], "VN30": ["AAA"],
                      "VNFIN": ["AAA", "BBB", "CCC"], "VNFINLEAD": ["BBB"], "VNIT": ["DDD", "EEE"]}})
    return stocks


def test_universe_mapping_and_peers(data_dir):
    _universe(data_dir)
    u = load_universe().set_index("symbol")
    assert u.loc["BBB", "primary_sector"] == "VNFIN"                                # largest sector index, not VNFINLEAD
    assert u.loc["AAA", "main_indexes"] == ["VNINDEX", "VN30"] and pd.isna(u.loc["FFF", "primary_sector"])
    assert peers_of("AAA") == ["BBB", "CCC"] and peers_of("FFF") == [] and peers_of("DDD") == ["EEE"]
    assert "EEE" in peers_of("DDD", level="exchange")


def test_end_to_end_prices_fundamentals_valuation_peers(data_dir, monkeypatch):
    monkeypatch.setattr(C, "MIN_GROUP_SIZE", 2)
    stocks = _universe(data_dir)
    idx = pd.bdate_range("2025-10-01", "2026-11-13")
    save_prices("indexes", "VNINDEX", pd.DataFrame({"o": 1.0, "h": 1.0, "l": 1.0, "c": 1.0, "v": 1.0}, index=idx))
    for i, s in enumerate(stocks):
        save_prices("stocks", s["symbol"], pd.DataFrame({k: 20.0 + i for k in "ohlc"} | {"v": 1000.0}, index=idx))
        assert sync_symbol(FakeClient(), s["symbol"], date(2026, 11, 19), False, {}).status == "updated"
    assert valuation_main() == 0
    snap = {r["symbol"]: r for r in read_json(data_dir / "valuation" / "snapshot.json")["rows"]}
    ttm = sum(100.0 * ((y - 2018) * 4 + q) * C.FUND_UNIT for y, q in ((2026, 3), (2026, 2), (2026, 1), (2025, 4)))   # filings public on 13 Nov
    shares = 1000.0 * C.FUND_UNIT / C.PAR_VALUE_VND
    assert snap["AAA"]["pe"] == pytest.approx(20.0 * C.PRICE_UNIT_VND * shares / ttm, rel=1e-6)
    ids = {g["id"] for g in read_json(data_dir / "valuation" / "index.json")["groups"]}
    assert {"MARKET", "HOSE", "VNINDEX", "VNFIN", "VNIT"} <= ids
    ps = peer_snapshot("AAA").set_index("group")
    assert ps.loc["VNFIN", "n"] == 3 and 0 < ps.loc["VNFIN", "pe_percentile"] <= 100


def test_statements_build_merge_and_storage(data_dir):
    c = FakeClient(last=(2026, 3))
    rows = parse_report(c.report("ANV", "KQKD", 2026, 3), "KQKD") + parse_report(c.report("ANV", "CDKT", 2026, 3), "CDKT")
    st = build_statements(rows)
    assert [(p["y"], p["q"]) for p in st["periods"]] == [(2025, 3), (2025, 4), (2026, 1), (2026, 2), (2026, 3)]
    ni = next(ln for ln in st["reports"]["KQKD"] if "mẹ" in ln["vi"])
    assert ni["v"][-1] == quarter_values(2026, 3)["ni_parent"] and len(ni["v"]) == 5
    # a later window adds Q4 and restates Q3; lines and older periods survive, nulls never erase
    c2 = FakeClient(last=(2026, 4))
    late = parse_report(c2.report("ANV", "KQKD", 2026, 4), "KQKD")
    for r in late:
        if (r["year"], r["term"]) == (2026, 3):
            r["value"] = (r["value"] or 0) + 1
    merged = merge_statements(st, build_statements(late))
    assert (merged["periods"][-1]["y"], merged["periods"][-1]["q"]) == (2026, 4) and len(merged["periods"]) == 6
    ni2 = next(ln for ln in merged["reports"]["KQKD"] if "mẹ" in ln["vi"])
    assert ni2["v"][-2] == quarter_values(2026, 3)["ni_parent"] + 1 and ni2["v"][0] == quarter_values(2025, 3)["ni_parent"]
    assert "CDKT" in merged["reports"]
    # sync writes the statements file and refuses to treat a stock without one as up to date
    assert sync_symbol(FakeClient(), "ZZZ", date(2026, 11, 19), False, {}).status == "updated"
    stm = read_json(data_dir / "statements" / "ZZZ.json")
    assert set(stm["reports"]) == set(C.FUND_REPORTS) and len(stm["periods"]) >= 28
    (data_dir / "statements" / "ZZZ.json").unlink()
    again = FakeClient()
    assert sync_symbol(again, "ZZZ", date(2026, 11, 19), False, {}).status in ("updated", "unchanged") and again.calls
    assert (data_dir / "statements" / "ZZZ.json").exists()
