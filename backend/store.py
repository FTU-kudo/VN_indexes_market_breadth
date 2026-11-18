"""Compact, deterministic JSON storage. Files are only rewritten when their content changes."""
from __future__ import annotations

import json
import math
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from . import config as C

PRICE_COLS = ["o", "h", "l", "c", "v"]


def _clean(o: Any) -> Any:
    if isinstance(o, float):
        return None if not math.isfinite(o) else o
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, np.generic):
        return _clean(o.item())
    return o


def dumps(obj: Any) -> str:
    return json.dumps(_clean(obj), separators=(",", ":"), ensure_ascii=False)


def series_list(s: pd.Series, nd: int = 4) -> list:
    """Series -> JSON-safe list; NaN/inf -> None, floats rounded."""
    x = pd.to_numeric(s, errors="coerce").astype("float64").replace([np.inf, -np.inf], np.nan).round(nd)
    return [None if pd.isna(v) else (int(v) if float(v).is_integer() and abs(v) < 1e15 else float(v)) for v in x]


def write_if_changed(path: Path, obj: Any) -> bool:
    text = dumps(obj)
    path = Path(path)
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, path)  # atomic: an interrupted run never leaves a half-written file
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    return True


def read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


# ---------------------------------------------------------------- prices (partitioned by year)
def price_dir(kind: str, symbol: str) -> Path:
    assert kind in ("stocks", "indexes") and re.match(C.SAFE_NAME, symbol), (kind, symbol)
    return C.DATA / "prices" / kind / symbol


def load_prices(kind: str, symbol: str) -> pd.DataFrame:
    d = price_dir(kind, symbol)
    frames = []
    for f in sorted(d.glob("*.json")) if d.exists() else []:
        j = read_json(f)
        if not j or not j.get("d"):
            continue
        frames.append(pd.DataFrame({k: j[k] for k in PRICE_COLS}, index=pd.to_datetime(j["d"])))
    if not frames:
        return pd.DataFrame({k: pd.Series(dtype="float64") for k in PRICE_COLS},
                            index=pd.DatetimeIndex([], name="date"))
    df = pd.concat(frames)
    df = df[~df.index.duplicated(keep="last")].sort_index()
    df.index.name = "date"
    return df.astype("float64")


def save_prices(kind: str, symbol: str, df: pd.DataFrame) -> bool:
    """One file per calendar year; returns True if anything changed on disk."""
    d = price_dir(kind, symbol)
    changed, keep = False, set()
    for year, g in df.groupby(df.index.year):
        keep.add(f"{year}.json")
        payload = {"symbol": symbol, "kind": kind[:-1], "year": int(year),
                   "d": [x.strftime("%Y-%m-%d") for x in g.index]}
        for c in PRICE_COLS:
            payload[c] = series_list(g[c], 4 if c != "v" else 0)
        changed |= write_if_changed(d / f"{year}.json", payload)
    if d.exists():
        for f in d.glob("*.json"):
            if f.name not in keep:
                f.unlink()
                changed = True
    return changed


def list_symbols(kind: str) -> list[str]:
    root = C.DATA / "prices" / kind
    return sorted(p.name for p in root.iterdir() if p.is_dir()) if root.exists() else []


# ---------------------------------------------------------------- monitoring status
def status_path() -> Path:
    return C.DATA / "monitor" / "status.json"


def update_status(patch: dict) -> bool:
    cur = read_json(status_path(), {}) or {}
    cur.update(patch)
    return write_if_changed(status_path(), cur)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
