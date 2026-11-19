"""Turns Vietstock statement line items into the few numbers valuation needs.

Matching is by NAME (Vietnamese or English) because the real norm_id values are not known here. Run
`python -m backend.discover_fields` on a sample (include a bank and a broker), check what matched, then pin exact
rows in NORM_ID_OVERRIDE = {"net_income_parent": 123, ...} (norm_id is more reliable than any name).
"""
from __future__ import annotations

import re
import unicodedata

NORM_ID_OVERRIDE: dict[str, int] = {}

_ENUM = re.compile(r"^\s*(?:\(?[ivxlc]+\)?|[a-z]|\d+(?:\.\d+)*)\s*[\.\-\):]\s*", re.I)


def norm(s: str | None) -> str:
    """lower-case, NFC, enumerators like 'XI.' / '11.' / 'D -' removed, whitespace collapsed."""
    s = unicodedata.normalize("NFC", s or "").lower().strip()
    for _ in range(2):
        s = _ENUM.sub("", s)
    return re.sub(r"\s+", " ", s).strip()


def _c(*pats: str) -> list[re.Pattern]:
    return [re.compile(unicodedata.normalize("NFC", p), re.I) for p in pats]


# (report type, ordered patterns). First pattern that matches any line wins.
FIELDS: dict[str, tuple[str, list[re.Pattern]]] = {
    "net_income_parent": ("KQKD", _c(
        r"lợi nhuận sau thuế.*(công ty mẹ|ngân hàng mẹ|chủ sở hữu của công ty mẹ)",
        r"(profit|income|earnings).*after.*tax.*(parent|owners of the parent|shareholders of the parent)",
        r"attributable to (the )?(owners|shareholders|equity holders) of the parent")),
    "net_income_total": ("KQKD", _c(
        r"^lợi nhuận sau thuế(?: thu nhập doanh nghiệp)?$",
        r"^(net )?profit after (corporate income )?tax$", r"^net (profit|income)$")),
    "equity_total": ("CDKT", _c(
        r"^vốn chủ sở hữu$", r"^total (owners'? |shareholders'? )?equity$", r"^(owners'?|shareholders'?) equity$", r"^equity$")),
    "minority_interest": ("CDKT", _c(
        r"lợi ích (của )?cổ đông (không kiểm soát|thiểu số)", r"non-?controlling interests?", r"minority interests?")),
    "charter_capital": ("CDKT", _c(
        r"^vốn góp của chủ sở hữu$", r"^vốn đầu tư của chủ sở hữu$", r"^vốn điều lệ$",
        r"^cổ phiếu phổ thông(?: có quyền biểu quyết)?$",
        r"^(contributed|owner'?s invested|paid-?in|share|charter) capital$", r"^contributed capital$")),
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
