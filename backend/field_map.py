# backend/field_map.py
"""Turns Vietstock statement line items into the few numbers valuation needs.

ENGLISH FIRST: every field is looked up by its English label (`name_en`) and only if no English label matches does the
Vietnamese label (`name_vi`) act as a fallback. Both are normalised the same way (see `norm`).

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


def norm_en(s: str | None) -> str:
    """English label: lower-case, apostrophes dropped ("Owners' equity" == "Owner's equity"), codes / enumerators stripped."""
    s = (s or "").replace("\u2019", "'").replace("\u2018", "'").replace("'", "")
    return norm(s)


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
        r"^vốn chủ sở hữu$", r"^vốn và các quỹ$", r"^vốn và quỹ$", r"^vốn chủ sở hữu(?!.*(nợ phải trả|nguồn vốn))",
        r"^total (owners'? |shareholders'? )?equity$", r"^(owners'?|shareholders'?) equity$", r"^equity$")),
    "minority_interest": ("CDKT", _c(
        r"lợi ích (của )?cổ đông (không kiểm soát|thiểu số)", r"^cổ đông (không kiểm soát|thiểu số)", r"non-?controlling interests?", r"minority interests?")),
    "charter_capital": ("CDKT", _c(
        r"^vốn góp của chủ sở hữu$", r"^vốn đầu tư của chủ sở hữu$", r"^vốn điều lệ$", r"^vốn góp( của chủ sở hữu)?", r"^vốn đầu tư của chủ sở hữu",
        r"^vốn điều lệ", r"^cổ phiếu phổ thông(?: có quyền biểu quyết)?$", r"^cổ phiếu phổ thông",
        r"^(contributed|owner'?s invested|paid-?in|share|charter) capital", r"^common (shares|stock)")),
}
NOT_PARENT_EN = r"(?!.*(non-?controlling|minority|undistributed|retained|per share))"
FIELDS_EN: dict[str, tuple[str, list[re.Pattern]]] = {
    "net_income_parent": ("KQKD", _c(
        r"(profit|income|earnings).*after.*tax" + NOT_PARENT_EN + r".*(parent|shareholders|owners|equity holders)",
        r"(parent).*(profit|income|earnings).*(after|net)" + NOT_PARENT_EN,
        r"attributable to (the )?(owners|shareholders|equity holders)" + NOT_PARENT_EN,
        r"^net (profit|income).*(parent)" + NOT_PARENT_EN)),
    "net_income_total": ("KQKD", _c(
        r"^(net )?profit after (corporate income )?tax$", r"^net profit after (corporate income )?tax$", r"^profit after tax",
        r"^profit for the (period|year)$", r"^net (profit|income)$")),
    "equity_total": ("CDKT", _c(
        r"^(total )?(owners |shareholders )?equity$", r"^equity$", r"^owners equity" + r"(?!.*(liabilit|resources))",
        r"^(owners |shareholders )?capital and (reserves|funds)$", r"^equity and (reserves|funds)$")),
    "minority_interest": ("CDKT", _c(r"(minority|non-?controlling) interests?")),
    "charter_capital": ("CDKT", _c(
        r"^(owners )?(contributed|invested|paid-?in|charter|share) capital$", r"^(contributed|invested|paid-?in|charter|share) capital",
        r"^common (stock|shares)( with voting rights)?$", r"^ordinary shares")),
}
# Totals used only to DERIVE equity (total assets - total liabilities) when no equity line is recognised (banks, odd layouts).
FIELDS["total_assets"] = ("CDKT", _c(r"^tổng (cộng )?tài sản$", r"^tài sản$(?!.*nợ)"))
FIELDS["total_liabilities"] = ("CDKT", _c(r"^(tổng (cộng )?)?nợ phải trả$", r"^tổng nợ$"))
FIELDS_EN["total_assets"] = ("CDKT", _c(r"^total assets$", r"^total (resources|asset)$", r"^assets$"))
FIELDS_EN["total_liabilities"] = ("CDKT", _c(r"^total liabilities$", r"^liabilities$", r"^total debts?$"))
LABEL_TOKENS = {
    "net_income_parent": ["lợi nhuận sau thuế", "profit after tax"], "net_income_total": ["lợi nhuận sau thuế", "profit after tax"],
    "equity_total": ["vốn chủ sở hữu", "equity"], "minority_interest": ["không kiểm soát", "thiểu số", "minority", "non-controlling"],
    "charter_capital": ["vốn góp", "vốn đầu tư", "vốn điều lệ", "cổ phiếu phổ thông", "capital"],
    "total_assets": ["tổng", "total assets"], "total_liabilities": ["nợ phải trả", "liabilities"],
}


def pick(rows: list[dict], field: str) -> tuple[float | None, str | None]:
    """(value, source label) for `field` among the parsed rows of ONE period; (None, None) if not found.

    Order: pinned norm_id -> English label -> Vietnamese label (fallback only).
    """
    rtype, pats_vi = FIELDS[field]
    pats_en = FIELDS_EN[field][1]
    cand = [r for r in rows if r["report_type"] == rtype and r["value"] is not None]
    nid = NORM_ID_OVERRIDE.get(field)
    if nid is not None:
        for r in cand:
            if r["norm_id"] == nid:
                return r["value"], f"[norm_id] {r['name_en'] or r['name_vi']} ({nid})"
    for p in pats_en:
        for r in cand:
            if r["name_en"] and p.search(norm_en(r["name_en"])):
                return r["value"], f"[EN] {r['name_en']} (norm {r['norm_id']})"
    for p in pats_vi:
        for r in cand:
            if r["name_vi"] and p.search(norm(r["name_vi"])):
                return r["value"], f"[VI fallback] {r['name_vi']} (norm {r['norm_id']})"
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
