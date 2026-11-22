# tools/check_frontend.py
"""Checks the website source for the mistakes that make Vercel serve an old site or a 404.

  python tools/check_frontend.py          (also runs from GitHub Actions: "Check frontend")

1. every file the site needs exists (a missing one makes the Vercel build fail, and Vercel then keeps serving the old version)
2. every `@/...` and relative import resolves to a real file
3. files that start with a path comment (`// frontend/...`) really are at that path (catches files uploaded to the wrong folder)
4. leftovers that cause 404s or conflicts (the retired /fundamental route)
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "frontend"
REQUIRED = """app/layout.tsx app/globals.css app/page.tsx app/breadth/page.tsx app/valuation/page.tsx app/screener/page.tsx
app/stock/[symbol]/page.tsx app/monitor/page.tsx components/CandleChart.tsx components/Clock.tsx components/FundamentalView.tsx
components/LineChart.tsx components/Nav.tsx components/Sparkline.tsx components/ThemeProvider.tsx components/ThemeToggle.tsx
components/Ui.tsx lib/data.ts lib/prices.ts lib/ta.ts lib/valuation.ts package.json tailwind.config.ts tsconfig.json
postcss.config.js next.config.mjs""".split()
IMPORT = re.compile(r"""(?:from|import)\s*\(?\s*["']((?:@/|\./|\.\./)[^"']+)["']""")
PATH_COMMENT = re.compile(r"^(?://|#)\s+((?:frontend|backend|tests|tools|\.github)/\S+)\s*$")


def resolve(base: Path, spec: str) -> bool:
    p = FE / spec[2:] if spec.startswith("@/") else (base.parent / spec).resolve()
    return any((p.parent / (p.name + ext)).exists() for ext in ("", ".ts", ".tsx", ".js", ".json", ".css")) or any((p / f"index{e}").exists() for e in (".ts", ".tsx"))


def main() -> int:
    problems: list[str] = []
    if not FE.exists():
        print("FAIL: no frontend/ folder at the repo root")
        return 1
    for rel in REQUIRED:
        if not (FE / rel).exists():
            problems.append(f"MISSING  frontend/{rel}  (the site cannot build without it)")
    pkg = json.loads((FE / "package.json").read_text(encoding="utf-8")) if (FE / "package.json").exists() else {}
    if "lucide-react" not in pkg.get("dependencies", {}):
        problems.append("package.json: dependency 'lucide-react' is missing (icons, clock) -> build fails")
    for f in sorted(FE.rglob("*")):
        if not f.is_file() or "node_modules" in f.parts or ".next" in f.parts or f.suffix not in (".ts", ".tsx"):
            continue
        text = f.read_text(encoding="utf-8")
        for spec in IMPORT.findall(text):
            if not resolve(f, spec):
                problems.append(f"BROKEN IMPORT  {f.relative_to(ROOT).as_posix()} imports '{spec}' but that file does not exist")
    for f in sorted(ROOT.rglob("*")):
        if not f.is_file() or any(x in f.parts for x in ("node_modules", ".next", ".git", "data")) or f.suffix not in (".ts", ".tsx", ".py", ".yml"):
            continue
        first = f.read_text(encoding="utf-8", errors="ignore").split("\n", 1)[0]
        m = PATH_COMMENT.match(first)
        if m and m.group(1) != f.relative_to(ROOT).as_posix():
            problems.append(f"MISPLACED  the file says it belongs at '{m.group(1)}' but it is at '{f.relative_to(ROOT).as_posix()}'")
    if (FE / "app" / "fundamental").exists():
        print("WARNING: frontend/app/fundamental/ is the retired route. It does no harm, but you can delete it "
              "(Fundamentals now lives in the Stock analysis page).\n")
    nav = (FE / "components" / "Nav.tsx")
    if nav.exists() and "view=fundamental" not in nav.read_text(encoding="utf-8"):
        problems.append("OLD Nav.tsx: the Fundamentals tab still points to /fundamental, which no longer exists -> 404. Replace frontend/components/Nav.tsx")
    if problems:
        print(f"{len(problems)} problem(s) found:\n")
        print("\n".join(" - " + p for p in problems))
        return 1
    print("OK: all required frontend files exist, every import resolves, and no file is misplaced.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
