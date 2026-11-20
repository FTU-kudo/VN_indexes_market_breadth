from backend import config as C
from backend.classification import load_classification
from backend.store import write_if_changed


def _setup(d):
    stocks = [{"symbol": s, "exchange": ex, "type": "ST", "indexes": ix} for s, ex, ix in [
        ("VCB", "HOSE", ["VNINDEX", "VNFIN"]), ("VIC", "HOSE", ["VNINDEX", "VNREAL"]), ("VHM", "HOSE", ["VNINDEX", "VNREAL"]),
        ("DPM", "HOSE", ["VNINDEX", "VNMAT"]), ("ABC", "UPCOM", [])]]
    write_if_changed(d / "stocks.json", stocks)
    write_if_changed(d / "indexes.json", [{"code": c, "name": c, "order": i} for i, c in enumerate(["VNINDEX", "VNFIN", "VNREAL", "VNMAT"])])
    write_if_changed(d / "constituents.json", {"indexes": {"VNINDEX": ["VCB", "VIC", "VHM", "DPM"], "VNFIN": ["VCB"], "VNREAL": ["VIC", "VHM"], "VNMAT": ["DPM"]}})


def test_fallback_to_sector_indexes_special_group_and_unclassified(data_dir):
    _setup(data_dir)
    c = load_classification().set_index("symbol")
    assert c.loc["VCB", "sector"] == "Financials" and c.loc["VCB", "group"] == "Financials"
    assert c.loc["VIC", "sector"] == "Real Estate" and c.loc["VIC", "group"] == "Vingroup Ecosystem"   # special group wins
    assert c.loc["ABC", "sector"] == C.UNCLASSIFIED and c["group"].notna().all()                       # every stock has one group


def test_reference_csv_overrides_with_loose_headers(data_dir):
    _setup(data_dir)
    (data_dir / "reference").mkdir()
    (data_dir / "reference" / "sectors.csv").write_text(
        "Ticker,Sector,Industry,Group\nVCB,Banking,Banking,Banking\nDPM,Chemicals,Fertilizers,\nabc,Retail,Retail,Retail\n", encoding="utf-8")
    c = load_classification().set_index("symbol")
    assert (c.loc["VCB", "sector"], c.loc["VCB", "group"]) == ("Banking", "Banking")
    assert c.loc["DPM", "group"] == "Chemicals" and c.loc["DPM", "industry"] == "Fertilizers"          # empty group -> sector
    assert c.loc["ABC", "sector"] == "Retail"                                                           # case-insensitive symbol
    assert c.loc["VHM", "group"] == "Vingroup Ecosystem"
