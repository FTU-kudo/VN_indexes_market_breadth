import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    from backend import config as C
    monkeypatch.setattr(C, "DATA", tmp_path)
    return tmp_path


def make_ohlcv(n=400, seed=1, start="2020-01-02", drift=0.0004, vol=0.02):
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range(start, periods=n, name="date")
    c = 50 * np.exp(np.cumsum(rng.normal(drift, vol, n)))
    o = c * (1 + rng.normal(0, 0.003, n))
    h = np.maximum(o, c) * (1 + np.abs(rng.normal(0, 0.005, n)))
    l = np.minimum(o, c) * (1 - np.abs(rng.normal(0, 0.005, n)))
    v = rng.integers(100_000, 900_000, n).astype(float)
    return pd.DataFrame({"o": o, "h": h, "l": l, "c": c, "v": v}, index=idx)
