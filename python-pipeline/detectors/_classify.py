"""Investment-type bucket classifier shared by detectors.

Buckets are coarse — debt / equity / other / unknown — because raw
investment_type strings differ wildly across funds (ARCC: 173 distinct
strings, GBDC: 45, GSBD/GSCR: NULL for everything). This classifier
collapses them to a stable comparison key.

Rules (in priority order):

1. If investment_type contains any debt-keyword (loan, lien, debt, note,
   bond, debenture, mezzanine, subordinated, term loan, revolver, etc.)
   -> 'debt'
2. If investment_type contains any equity-keyword (stock, units, warrant,
   partnership, LP/LLC interest, equity, preferred, common, member units)
   -> 'equity'
3. If investment_type IS NULL or didn't match above:
       a) If principal_amount > 0 AND maturity_date IS NOT NULL -> 'debt'
          (BDCs only set principal+maturity on debt instruments)
       b) Else -> 'unknown'

Goldman family (GSBD, GSCR) has no investment_type populated, but ~99%
of their observations have principal+maturity, so rule 3a buckets them
correctly as debt.
"""
from __future__ import annotations

import re
from typing import Optional

# Order matters: check debt keywords first because some equity types
# include the word "debt" (e.g. "Convertible debt warrants") — but those
# are rare enough we accept the precedence.
_DEBT_PATTERNS = (
    r"\bloan\b",
    r"\blien\b",
    r"\bdebt\b",
    r"\bnote\b",
    r"\bnotes\b",
    r"\bbond\b",
    r"\bdebenture\b",
    r"\bmezzanine\b",
    r"\bsubordinated\b",
    r"\bsenior\s+secured\b",
    r"\bunsecured\b",
    r"\brevolver\b",
    r"\brevolving\b",
    r"\bdelayed\s+draw\b",
    r"\bterm\s+loan\b",
    r"\bone\s*stop\b",          # GBDC's house brand for unitranche
    r"\bunitranche\b",
    r"\bsenior\s+loan\b",
    r"\bfacility\b",
)

_EQUITY_PATTERNS = (
    r"\bstock\b",
    r"\bunits?\b",
    r"\bwarrants?\b",
    r"\bequity\b",
    r"\bpreferred\b",
    r"\bcommon\b",
    r"\bpartnership\b",
    r"\blp\s+(interest|interests|units?)\b",
    r"\bllc\s+(interest|interests|units?)\b",
    r"\blimited\s+partnership\b",
    r"\bmember\s+(interest|interests|units?)\b",
    r"\bshares?\b",
)

_DEBT_RE = re.compile("|".join(_DEBT_PATTERNS), re.IGNORECASE)
_EQUITY_RE = re.compile("|".join(_EQUITY_PATTERNS), re.IGNORECASE)


def classify(
    investment_type: Optional[str],
    principal_amount: Optional[float] = None,
    maturity_date: Optional[str] = None,
) -> str:
    """Return one of: 'debt', 'equity', 'unknown'.

    Args:
        investment_type: raw string from the SoI; may be None.
        principal_amount: numeric or None.
        maturity_date: ISO date string or None.

    Returns:
        'debt' / 'equity' / 'unknown'
    """
    s = (investment_type or "").strip()

    if s:
        if _DEBT_RE.search(s):
            return "debt"
        if _EQUITY_RE.search(s):
            return "equity"

    # Fallback for NULL or unrecognized types: structural signal.
    has_principal = principal_amount is not None and float(principal_amount) > 0
    has_maturity = bool(maturity_date)
    if has_principal and has_maturity:
        return "debt"

    return "unknown"
