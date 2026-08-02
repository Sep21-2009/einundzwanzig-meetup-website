#!/usr/bin/env python3
"""Synchronisiert components/nav.html exakt in alle HTML-Seiten."""
from pathlib import Path
import hashlib, re
ROOT = Path(__file__).resolve().parents[1]
NAV = (ROOT / "components" / "nav.html").read_text(encoding="utf-8").strip()
HASH = hashlib.sha256(NAV.encode()).hexdigest()[:12]
BLOCK = (
    f"<!-- SHARED_NAV_START source=components/nav.html hash={HASH} -->\n"
    f'<div class="site-navigation-host" data-nav-source="components/nav.html" data-nav-hash="{HASH}">\n'
    f"{NAV}\n</div>\n<!-- SHARED_NAV_END -->"
)
PATTERN = re.compile(r"<!-- SHARED_NAV_START.*?<!-- SHARED_NAV_END -->", re.S)
for page in sorted(ROOT.glob("*.html")):
    text = page.read_text(encoding="utf-8")
    updated, count = PATTERN.subn(BLOCK, text, count=1)
    if count != 1:
        raise SystemExit(f"Navigationsblock nicht eindeutig gefunden: {page.name}")
    page.write_text(updated, encoding="utf-8")
    print(f"aktualisiert: {page.name}")
