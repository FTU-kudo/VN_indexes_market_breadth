# tools/check_data.py
"""Verifies the data the website reads: dates, TTM profit, P/E and P/B for sample stocks and for the whole market.

  python tools/check_data.py        (runs in GitHub Actions: "Check frontend")
Exit code 1 when the data would make the Fundamentals / Valuation pages blank or wrong.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
SAMPLE = ["VIC", "VCB", "ANV", "HPG", "FPT", "VNM", "SSI"]


def load(p: Path):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def main() -> int:
    problems: list[str] = []
    fdir = DATA / "fundamentals"
    files = sorted(fdir.glob("*.json")) if fdir.exists() else []
    if not files:
        print("No data/fundamentals yet - run the Fundamentals update workflow first.")
        return 1
    bad_dates, dup_dates, few_q = [], [], []
    for f in files:
        j = load(f) or {}
        ends = [q["period_end"] for q in j.get("quarters", [])]
        if any(e < "1990-01-01" for e in ends):
            bad_dates.append(f.stem)
        if len(set(ends)) != len(ends):
            dup_dates.append(f.stem)
        if 0 < len(ends) < 8:
            few_q.append(f.stem)
    print(f"{len(files)} stocks with fundamentals; {len(bad_dates)} with impossible dates; {len(few_q)} with fewer than 8 quarters")
    if bad_dates:
        problems.append(f"{len(bad_dates)} stocks have report dates before 1990 (e.g. {', '.join(bad_dates[:8])}). "
                        "Run 'Fundamentals update' with rebuild_only ticked.")
    if dup_dates:
        problems.append(f"{len(dup_dates)} stocks have duplicate report dates (e.g. {', '.join(dup_dates[:8])})")

    snap = load(DATA / "valuation" / "snapshot.json")
    rows = {r["symbol"]: r for r in (snap or {}).get("rows", [])}
    if not rows:
        problems.append("data/valuation/snapshot.json is missing or empty")
    else:
        n = len(rows)
        pe = sum(1 for r in rows.values() if r.get("pe") is not None)
        pb = sum(1 for r in rows.values() if r.get("pb") is not None)
        loss = sum(1 for r in rows.values() if r.get("loss"))
        print(f"{n} valued stocks: valid P/E {pe} ({pe / n:.0%}), valid P/B {pb} ({pb / n:.0%}), loss-making {loss}")
        if pe / n < 0.40:
            problems.append(f"only {pe}/{n} stocks have a valid P/E (expected most profitable stocks)")
        if pb / n < 0.50:
            problems.append(f"only {pb}/{n} stocks have a valid P/B")
        print(f"\n{'stock':6} {'latest period':14} {'quarters':9} {'P/E':>8} {'P/B':>8}  group")
        for s in SAMPLE:
            j = load(fdir / f"{s}.json")
            r = rows.get(s)
            if not j:
                print(f"{s:6} (no fundamentals file)")
                continue
            qs = j["quarters"]
            last = qs[-1]["period_end"] if qs else "-"
            pe = f"{r['pe']:.2f}" if r and r.get("pe") is not None else "-"
            pb = f"{r['pb']:.2f}" if r and r.get("pb") is not None else "-"
            print(f"{s:6} {last:14} {len(qs):<9} {pe:>8} {pb:>8}  {r['group'] if r else ''}")
    samples = (load(DATA / "monitor" / "field_samples.json") or {}).get("samples", {})
    if samples:
        print("\nfield matching (sample stocks):")
        for sym, d in samples.items():
            miss = [f for f, x in d["fields"].items() if not x["matched"] and f not in ("net_income_total", "minority_interest")]
            langs = {x["matched"].split("]")[0] + "]" for x in d["fields"].values() if x["matched"]}
            print(f"  {sym:5} {d['period']}: {'MISSING ' + ', '.join(miss) if miss else 'ok'}  via {', '.join(sorted(langs))}")
    if problems:
        print("\nPROBLEMS:\n" + "\n".join(" - " + p for p in problems))
        return 1
    print("\nOK: dates, TTM profit and valuations look healthy.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
