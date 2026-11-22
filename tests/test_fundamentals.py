# tests/test_fundamentals.py
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


# ---- real Vietstock labels carry formula codes ("(400=410+420)") and enumerators ("D.", "XI.")
def _row(rt, vi, v, nid=1, en=None, y=2026, q=3):
    from datetime import date
    return {"report_type": rt, "year": y, "term": q, "period_end": date(y, q * 3, 30), "published": None, "audited": None,
            "component": "x", "norm_id": nid, "name_vi": vi, "name_en": en, "value": v}


def test_labels_with_formula_suffixes_and_enumerators():
    from backend.field_map import norm
    assert norm("D - VỐN CHỦ SỞ HỮU (400 = 410 + 420)") == "vốn chủ sở hữu"
    assert norm("XI. Lợi nhuận sau thuế của cổ đông của công ty mẹ (61)") == "lợi nhuận sau thuế của cổ đông của công ty mẹ"
    assert norm("Lưu chuyển tiền thuần trong kỳ (50=20+30+40)") == "lưu chuyển tiền thuần trong kỳ"
    kq = [_row("KQKD", "Lợi nhuận sau thuế thu nhập doanh nghiệp (60=50-51-52)", 100.0, 1),
          _row("KQKD", "Lợi nhuận sau thuế của cổ đông không kiểm soát (62)", 7.0, 2),
          _row("KQKD", "Lợi nhuận sau thuế của cổ đông của công ty mẹ (61)", 93.0, 3)]
    assert pick(kq, "net_income_parent")[0] == 93.0                      # not the total, not the minority line
    assert pick(kq[:2], "net_income_parent")[0] is None                   # minority line alone is never "parent profit"
    assert pick(kq[:2], "net_income_total")[0] == 100.0                   # falls back to total profit only via the total rule
    only_cd = [_row("KQKD", "Lợi nhuận sau thuế của cổ đông (61)", 55.0), _row("KQKD", "Lợi nhuận sau thuế của cổ đông không kiểm soát", 5.0, 2)]
    assert pick(only_cd, "net_income_parent")[0] == 55.0                  # name without "công ty mẹ" (as in the ANV notebook)
    cd = [_row("CDKT", "TỔNG CỘNG TÀI SẢN (270)", 900.0, 1), _row("CDKT", "NỢ PHẢI TRẢ (300)", 400.0, 2),
          _row("CDKT", "D - VỐN CHỦ SỞ HỮU (400=410+420)", 500.0, 3), _row("CDKT", "Vốn góp của chủ sở hữu (411)", 200.0, 4),
          _row("CDKT", "Lợi ích của cổ đông không kiểm soát (429)", 20.0, 5), _row("CDKT", "TỔNG CỘNG NGUỒN VỐN (440)", 900.0, 6),
          _row("CDKT", "Nợ phải trả và vốn chủ sở hữu", 900.0, 7)]
    assert pick(cd, "equity_total")[0] == 500.0 and pick(cd, "charter_capital")[0] == 200.0 and pick(cd, "minority_interest")[0] == 20.0
    bank = [_row("CDKT", "VỐN CHỦ SỞ HỮU", 50.0), _row("CDKT", "Vốn điều lệ", 30.0, 2)]
    assert pick(bank, "equity_total")[0] == 50.0 and pick(bank, "charter_capital")[0] == 30.0


def test_rebuild_from_statements_without_api(data_dir):
    from backend.collect_fundamentals import rebuild_all, rebuild_symbol
    rows = []
    for y, q in [(2025, 3), (2025, 4), (2026, 1), (2026, 2), (2026, 3)]:
        rows += [_row("KQKD", "Lợi nhuận sau thuế của cổ đông của công ty mẹ (61)", 10.0 * q, 3, y=y, q=q),
                 _row("CDKT", "VỐN CHỦ SỞ HỮU (400=410+420)", 500.0, 3, y=y, q=q), _row("CDKT", "Vốn góp của chủ sở hữu (411)", 200.0, 4, y=y, q=q)]
    write_if_changed(data_dir / "statements" / "AAA.json", {"symbol": "AAA", **build_statements(rows)})
    assert rebuild_symbol("AAA") == ()                                    # nothing missing in the latest quarter
    j = read_json(data_dir / "fundamentals" / "AAA.json")
    last = j["quarters"][-1]
    assert last["net_income_parent"] == 30.0 * C.FUND_UNIT and last["equity_parent"] == 500.0 * C.FUND_UNIT
    assert last["shares"] == 200.0 * C.FUND_UNIT / C.PAR_VALUE_VND
    info = rebuild_all(["AAA", "NOPE"])
    assert info["rebuilt"] == 1 and info["missing_latest"].get("no_statements") == 1
    from backend.statements import statements_to_rows
    assert len(statements_to_rows(read_json(data_dir / "statements" / "AAA.json"))) == len(rows)


# ---- English labels are the primary key; Vietnamese is only a fallback
def test_english_first_matching_and_vietnamese_fallback():
    # the Vietnamese labels here are deliberately misleading: English decides
    mixed = [_row("KQKD", "Lợi nhuận gộp (20)", 999.0, 1, en="Net profit after tax of minority interests"),
             _row("KQKD", "Lợi nhuận khác", 93.0, 2, en="Profit after tax attributable to shareholders of the parent company"),
             _row("KQKD", "Chi phí khác", 100.0, 3, en="Net profit after tax")]
    v, src = pick(mixed, "net_income_parent")
    assert v == 93.0 and src.startswith("[EN]")
    assert pick(mixed, "net_income_total")[0] == 100.0
    cd = [_row("CDKT", "Tài sản ngắn hạn", 500.0, 1, en="TOTAL OWNERS' EQUITY"), _row("CDKT", "Nợ", 900.0, 2, en="Total liabilities and owners' equity"),
          _row("CDKT", "Hàng tồn kho", 200.0, 3, en="Contributed capital"), _row("CDKT", "Phải thu", 20.0, 4, en="Non-controlling interests")]
    assert pick(cd, "equity_total")[0] == 500.0 and pick(cd, "charter_capital")[0] == 200.0 and pick(cd, "minority_interest")[0] == 20.0
    cd2 = [_row("CDKT", "Vốn chủ sở hữu", 77.0, 1, en="Owner's equity")]
    assert pick(cd2, "equity_total")[0] == 77.0                              # apostrophe variants are equal
    only_vi = [_row("KQKD", "Lợi nhuận sau thuế của cổ đông của công ty mẹ (61)", 55.0, 1, en=None)]
    v, src = pick(only_vi, "net_income_parent")
    assert v == 55.0 and src.startswith("[VI fallback]")                      # no English label -> Vietnamese is used


def test_period_dates_in_any_format_never_become_1970():
    from datetime import date
    from backend.fundamentals_api import parse_date, parse_report, sane_period_end
    from backend.yuanta_api import vn_midnight_epoch
    target = date(2026, 9, 30)
    ms = vn_midnight_epoch(target) * 1000
    for raw in ("2026-09-30", "2026-09-30T00:00:00", "30/09/2026", 20260930, "20260930", ms, str(ms), vn_midnight_epoch(target), f"/Date({ms})/"):
        assert parse_date(raw) == target, raw
    assert parse_date(0) is None and parse_date(None) is None and parse_date("junk") is None
    assert sane_period_end(2026, 3, date(1970, 1, 1)) == date(2026, 9, 30)    # implausible date -> the quarter label wins
    assert sane_period_end(2026, 3, date(2026, 9, 29)) == date(2026, 9, 29)
    resp = {"title": {"data": [{"year_period": 2026, "term_code": "Q3", "period_end": ms}, {"year_period": 2026, "term_code": "Q2", "period_end": 0}]},
            "detail": [{"data": [{"norm_id": 1, "field_name": "x", "value": [1, 2]}]}]}
    assert [r["period_end"] for r in parse_report(resp, "KQKD")] == [date(2026, 9, 30), date(2026, 6, 30)]


def test_corrupted_statement_dates_are_healed_and_ttm_and_pe_work(data_dir):
    from backend.collect_fundamentals import rebuild_symbol
    from backend.valuation import prepare_fundamentals, valuation_for_symbol
    import pandas as pd
    rows = []
    for y, q in [(2025, 3), (2025, 4), (2026, 1), (2026, 2), (2026, 3)]:
        rows += [_row("KQKD", "x", 10.0, 3, en="Net profit after tax of parent company", y=y, q=q),
                 _row("CDKT", "y", 500.0, 3, en="Owners' equity", y=y, q=q), _row("CDKT", "z", 200.0, 4, en="Contributed capital", y=y, q=q)]
    st = build_statements(rows)
    for p in st["periods"]:
        p["end"] = "1970-01-01"                                              # what the old parser stored for every period
    write_if_changed(data_dir / "statements" / "AAA.json", {"symbol": "AAA", **st})
    assert rebuild_symbol("AAA") == ()
    j = read_json(data_dir / "fundamentals" / "AAA.json")
    assert [q["period_end"] for q in j["quarters"]] == ["2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"]
    assert all(p["end"] >= "2025" for p in read_json(data_dir / "statements" / "AAA.json")["periods"])   # file repaired on disk
    f = prepare_fundamentals(j["quarters"])
    assert f["ni_ttm"].iloc[-1] == 40.0 * C.FUND_UNIT                          # four quarters of 10
    px = pd.Series([20.0], index=pd.to_datetime(["2026-11-20"]))
    v = valuation_for_symbol(px, f)
    assert v["pe"].notna().all() and v["pb"].notna().all()
