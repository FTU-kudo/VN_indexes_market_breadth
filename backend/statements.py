"""Full financial statements for display: data/statements/<SYM>.json.

{"symbol", "unit", "periods": [{"y","q","end"}...ascending],
 "reports": {"KQKD": [{"id","vi","en","c","v": [one value per period, null if absent]}, ...], "CDKT": [...], "LCTT": [...], "CSTC": [...]}}
Money lines are in VND million as requested from the API; CSTC ratios are stored exactly as returned.
"""
from __future__ import annotations


def _clean(v):
    if v is None:
        return None
    return int(v) if float(v).is_integer() else round(float(v), 3)


def build_statements(rows: list[dict]) -> dict:
    """Parsed long rows (any mix of reports) -> columnar statements."""
    ends = {(r["year"], r["term"]): r["period_end"].isoformat() for r in rows}
    keys = sorted(ends)
    pos = {k: i for i, k in enumerate(keys)}
    reports: dict[str, dict] = {}
    for r in rows:
        lines = reports.setdefault(r["report_type"], {})
        lk = (r["norm_id"], r["name_vi"])
        ln = lines.setdefault(lk, {"id": r["norm_id"], "vi": r["name_vi"], "en": r["name_en"], "c": r["component"], "v": [None] * len(keys)})
        ln["v"][pos[(r["year"], r["term"])]] = _clean(r["value"])
    return {"periods": [{"y": y, "q": q, "end": ends[(y, q)]} for y, q in keys],
            "reports": {rt: list(lines.values()) for rt, lines in reports.items()}}


def merge_statements(old: dict, new: dict) -> dict:
    """Union of periods and line items; fresh non-null values replace stored ones, nulls never erase data."""
    def cells(st: dict) -> tuple[dict, dict]:
        per = {(p["y"], p["q"]): p["end"] for p in st.get("periods", [])}
        rep = {}
        for rt, lines in (st.get("reports") or {}).items():
            d = rep.setdefault(rt, {})
            for ln in lines:
                d[(ln["id"], ln["vi"])] = ({k: ln[k] for k in ("id", "vi", "en", "c")},
                                           {(p["y"], p["q"]): v for p, v in zip(st["periods"], ln["v"])})
        return per, rep

    po, ro = cells(old)
    pn, rn = cells(new)
    per = {**po, **pn}
    keys = sorted(per)
    pos = {k: i for i, k in enumerate(keys)}
    reports = {}
    for rt in list(ro) + [r for r in rn if r not in ro]:
        merged: dict = {}
        for src in (ro.get(rt, {}), rn.get(rt, {})):
            for lk, (meta, vals) in src.items():
                cur = merged.setdefault(lk, [meta, {}])
                cur[1].update({k: v for k, v in vals.items() if v is not None})
                cur[0].update({k: v for k, v in meta.items() if v is not None})
        out = []
        for meta, vals in merged.values():
            v = [None] * len(keys)
            for k, x in vals.items():
                v[pos[k]] = x
            out.append({**meta, "v": v})
        reports[rt] = out
    return {"periods": [{"y": y, "q": q, "end": per[(y, q)]} for y, q in keys], "reports": reports}
