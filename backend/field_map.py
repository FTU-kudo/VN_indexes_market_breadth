# backend/field_map.py
"""Turns Vietstock statement line items into the few numbers valuation needs.

Vietstock labels often end with a formula code, e.g. "VỐN CHỦ SỞ HỮU (400=410+420)" or "Lưu chuyển tiền thuần trong kỳ
(50=20+30+40)", and start with an enumerator ("D.", "XI.", "11."). `norm` strips both before matching.
Matching is by name (Vietnamese or English). Pin an exact row with NORM_ID_OVERRIDE = {"net_income_parent": 123, ...}
once `python -m backend.discover_fields` (or Data monitor -> Field matching) shows the real norm_id.
"""
from __future__ import annotations

import re
import unicodedata

NORM_ID_OVERRIDE: dict[str, int] = {}

_ENUM = re.compile(r"^\s*(?:\(?[ivxlc]+\)?|[a-z]|\d+(?:\.\d+)*)\s*[\.\-\):]\s*", re.I)
_TRAIL = re.compile(r"\s*(?:\([^()]*\)|\[[^\[\]]*\]|\*+)\s*$")


def norm(s: str | None) -> str:
    """lower-case, NFC; trailing formula codes "(400=410+420)" and leading enumerators "D." / "XI." removed."""
    s = unicodedata.normalize("NFC", s or "").lower().strip()
    for _ in range(3):
        s = _TRAIL.sub("", s)
    for _ in range(2):
        s = _ENUM.sub("", s)
    return re.sub(r"\s+", " ", s).strip()


def _c(*pats: str) -> list[re.Pattern]:
    return [re.compile(unicodedata.normalize("NFC", p), re.I) for p in pats]


NOT_PARENT = r"(?!.*(không kiểm soát|thiểu số|chưa phân phối|kỳ trước|lũy kế|non-?controlling|minority|undistributed))"

# (report type, ordered patterns). First pattern that matches any line wins.
FIELDS: dict[str, tuple[str, list[re.Pattern]]] = {
    "net_income_parent": ("KQKD", _c(
        r"^lợi nhuận sau thuế" + NOT_PARENT + r".*(công ty mẹ|ngân hàng mẹ|chủ sở hữu của công ty mẹ)",
        r"^lợi nhuận (sau thuế )?(của )?cổ đông" + NOT_PARENT + r".*(mẹ)",
        r"^lợi nhuận sau thuế" + NOT_PARENT + r".*cổ đông",
        r"(profit|income|earnings).*after.*tax" + NOT_PARENT + r".*(parent|shareholders|owners|equity holders)",
        r"attributable to (the )?(owners|shareholders|equity holders)" + NOT_PARENT)),
    "net_income_total": ("KQKD", _c(
        r"^lợi nhuận sau thuế thu nhập doanh nghiệp$", r"^lợi nhuận sau thuế(?: tndn)?$", r"^lợi nhuận kế toán sau thuế$",
        r"^(net )?profit after (corporate income )?tax$", r"^profit after tax", r"^net (profit|income)$")),
    "equity_total": ("CDKT", _c(
        r"^vốn chủ sở hữu$", r"^vốn chủ sở hữu(?!.*(nợ phải trả|nguồn vốn))",
        r"^total (owners'? |shareholders'? )?equity$", r"^(owners'?|shareholders'?) equity$", r"^equity$")),
    "minority_interest": ("CDKT", _c(
        r"lợi ích (của )?cổ đông (không kiểm soát|thiểu số)", r"^cổ đông (không kiểm soát|thiểu số)", r"non-?controlling interests?", r"minority interests?")),
    "charter_capital": ("CDKT", _c(
        r"^vốn góp của chủ sở hữu$", r"^vốn đầu tư của chủ sở hữu$", r"^vốn điều lệ$", r"^vốn góp( của chủ sở hữu)?", r"^vốn đầu tư của chủ sở hữu",
        r"^vốn điều lệ", r"^cổ phiếu phổ thông(?: có quyền biểu quyết)?$", r"^cổ phiếu phổ thông",
        r"^(contributed|owner'?s invested|paid-?in|share|charter) capital", r"^common (shares|stock)")),
}
LABEL_TOKENS = {
    "net_income_parent": ["lợi nhuận sau thuế", "profit after tax"], "net_income_total": ["lợi nhuận sau thuế", "profit after tax"],
    "equity_total": ["vốn chủ sở hữu", "equity"], "minority_interest": ["không kiểm soát", "thiểu số", "minority", "non-controlling"],
    "charter_capital": ["vốn góp", "vốn đầu tư", "vốn điều lệ", "cổ phiếu phổ thông", "capital"],
}


def pick(rows: list[dict], field: str) -> tuple[float | None, str | None]:
    """(value, source label) for `field` among the parsed rows of ONE period; (None, None) if not found."""
    rtype, pats = FIELDS[field]
    cand = [r for r in rows if r["report_type"] == rtype and r["value"] is not None]
    nid = NORM_ID_OVERRIDE.get(field)
    if nid is not None:
        for r in cand:
            if r["norm_id"] == nid:
                return r["value"], f"{r['name_vi']} (norm {nid})"
    for p in pats:
        for r in cand:
            if p.search(norm(r["name_vi"])) or p.search(norm(r["name_en"])):
                return r["value"], f"{r['name_vi'] or r['name_en']} (norm {r['norm_id']})"
    return None, None


def diagnose(rows: list[dict]) -> dict:
    """For ONE period: which label each field matched, and for unmatched fields the labels that looked related."""
    out = {}
    for f, (rtype, _) in FIELDS.items():
        v, src = pick(rows, f)
        cands = sorted({f"{r['name_vi']} | {r['name_en']} (norm {r['norm_id']})" for r in rows if r["report_type"] == rtype
                        and any(t in norm(r["name_vi"]) or t in norm(r["name_en"]) for t in LABEL_TOKENS[f])})
        out[f] = {"matched": src, "value": v, "candidates": [] if src else cands[:12]}
    return out
