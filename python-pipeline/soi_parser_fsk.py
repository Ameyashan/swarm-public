"""Parser stub for FS KKR Capital Corp (FSK) Schedule of Investments.

Status
------
NOT YET IMPLEMENTED. Returns empty list; upstream pipeline records
parse_status='failed' with reason 'parser_not_implemented'.

Structural notes from filing profile
------------------------------------
- FSK is a large diversified BDC; the SoI is paginated across many
  `<table>` blocks similar to GBDC.
- Investment-type column has both "Senior Secured Loan - First Lien"
  and "Senior Secured Loan - Second Lien" plus "Asset Based Finance",
  "Subordinated Debt", "Preferred Equity", "Common Equity",
  "Warrants/Options".
- Numeric columns observed: Principal Amount, Amortized Cost, Fair Value,
  % of Net Assets, % of Investments. The double-percentage layout means
  slot extraction must drop two %-pairs (vs. one for the parsers above).
- Maturity column present; PIK rate listed in a separate column.
- Footnote legend is extensive; non-accrual marker needs verification
  from filing legend page.

Implementation TODO
-------------------
1. Profile FSK_10Q.htm header tokens.
2. Adapt `extract_value_slots` to drop two pct_pair columns (or
   pre-strip both `%` cells before slot extraction).
3. Special-case Asset Based Finance rows — may report yield instead of
   spread.
4. Validate FV total vs. filing's reported total (TBD).

Note: FSK's most recent filing is Q3 2025, not Q1 2026 like the other
funds. Filing manifest reflects this.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def parse(html: str) -> list[dict[str, Any]]:
    logger.warning("FSK parser not yet implemented; returning empty list.")
    return []
