"""Shared row-level filters for detectors.

Some upstream parsers (notably OBDC's) occasionally emit subtotal /
roll-up rows like 'Total Investments' or 'Total non-controlled/non-affiliated
debt investments' as if they were portfolio companies. These show up in
observations.portfolio_company_canonical and pollute detector outputs by
generating huge spurious 'mark drift' hits as the totals naturally move.

is_subtotal_name() catches the obvious patterns. We deliberately keep this
narrow — only block rows whose canonical name STARTS WITH 'total ',
'subtotal', or 'net ', because real borrowers can have these words mid-name
('Net Health Acquisition Corp.', 'BJ's Total Care'). The rule is anchored
at start-of-string and excludes a few known false positives.
"""
from __future__ import annotations

_SAFE_PREFIXES = (
    "net health",
    "net element",
    "net suite",
    "netsuite",
)

# Pre-existing GBDC parser bug: when a row has only an investment-type label
# in the company-name cell (no actual borrower name), the canonical value
# becomes the bucket label itself ("One stop", "LLC interest", "Common stock",
# etc.). These are not real borrowers — they're an upstream parser leak that
# will appear in many borrowers' detector hits. Filter them defensively here
# until the parser is fixed.
_BUCKET_LABEL_LEAKS = frozenset({
    "one stop",
    "senior loan",
    "senior secured",
    "second lien",
    "unitranche",
    "llc units",
    "llc interest",
    "llc interests",
    "lp interest",
    "lp interests",
    "lp units",
    "common stock",
    "preferred stock",
    "common units",
    "preferred units",
    "warrant",
    "warrants",
    "member units",
    "limited partnership interest",
    "limited partnership interests",
})


def is_subtotal_name(name: str | None) -> bool:
    """Return True if ``name`` looks like a parser-leaked subtotal, roll-up
    row, or investment-type bucket label leaked into the borrower column."""
    if not name:
        return False
    s = name.strip().lower()
    if not s:
        return False
    if s in _BUCKET_LABEL_LEAKS:
        return True
    # Anchored prefixes
    if s.startswith("total ") or s.startswith("subtotal"):
        return True
    if s.startswith("net "):
        # 'Net Health Acquisition Corp.' is a real borrower; whitelist
        for safe in _SAFE_PREFIXES:
            if s.startswith(safe):
                return False
        # 'Net change in unrealized appreciation/(depreciation) ...' etc.
        return True
    return False
