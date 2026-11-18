"""Central configuration. Everything tunable lives here."""
from __future__ import annotations

import os
from datetime import date, time
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("DATA_DIR", ROOT / "data"))
TZ = ZoneInfo("Asia/Ho_Chi_Minh")

# ---- Yuanta endpoints (response shapes verified from browser captures) ----
BASE = "https://ysradar.yuanta.com.vn"
URL_INDEX_LIST = f"{BASE}/api/v3/market_data/price_board/index/list_index"
URL_STOCK_INFO = f"{BASE}/api/v3/market_data/price_board/stock/list_stock_info"
URL_HISTORY = f"{BASE}/v2/tradingview/history"

START_DATE = date(2020, 1, 1)
EXCHANGES = ["HSX", "HNX", "UPCOM"]          # API codes; HSX == HOSE
EXCHANGE_LABEL = {"HSX": "HOSE", "HNX": "HNX", "UPCOM": "UPCOM"}
# SymbolType values treated as ordinary equities. The first run logs the distribution of
# every SymbolType seen (data/monitor/status.json -> universe.symbol_types); widen if needed.
EQUITY_SYMBOL_TYPES = {"ST"}
BENCHMARK = "VNINDEX"

# ---- HTTP ----
HTTP_TIMEOUT = 30
HTTP_RETRIES = 5
MAX_WORKERS = 8

# ---- Session timing ----
SESSION_FINAL_AT = time(15, 15)   # bars dated "today" are dropped before this time
OVERLAP_DAYS = 15                 # re-fetched each run to detect price adjustments
ADJUSTMENT_TOL = 1e-4             # relative close mismatch that triggers full re-download

# ---- Indicator storage ----
TRADING_DAYS = 252
INDEX_HISTORY_BARS = 500          # bars of indicator history stored per index
STOCK_HISTORY_BARS = 0            # 0 = stocks keep only the latest-row snapshot (see README)

# ---- Breadth ----
MA_WINDOWS = [10, 20, 50, 100, 200]
MIN_GROUP_SIZE = 5                # groups with fewer members that have prices are skipped
COMPOSITE_WEIGHTS = {"ma": 0.35, "ad": 0.20, "hl": 0.15, "macd": 0.15, "rsi": 0.15}

SAFE_NAME = r"^[A-Za-z0-9_.\-]{1,32}$"
