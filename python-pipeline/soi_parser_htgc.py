"""Parser stub for Hercules Capital (HTGC) Schedule of Investments.

Status
------
NOT YET IMPLEMENTED. This module satisfies the dispatcher contract by
exporting `parse(html)` but logs a TODO and returns an empty list. The
upstream pipeline records this as parse_status='failed' with reason
'parser_not_implemented'.

Structural notes from filing profile
------------------------------------
- HTGC reports investments by industry then by issuer.
- Investment-type column distinguishes "Senior Secured Loan", "Equity",
  "Warrants" (HTGC has unusually heavy warrant/equity weighting).
- Numeric columns observed in profiling: Principal Amount, Cost,
  Fair Value, % of Net Assets. Amortization tracked separately for
  warrants.
- HTGC includes a "Maturity Date" column but warrants/equities print
  acquisition date instead.
- Footnotes use parenthetical numerals; (1)-(7) are most common.
  Non-accrual footnote needs verification — profile run did not surface
  a single canonical legend marker.
- Filing emits subtotals at industry, issuer, and section levels.

Implementation TODO
-------------------
1. Run profile_htgc.py against bdc_filings/HTGC_10Q.htm to lock down
   column indexes (cell map differs from ARCC/OBDC/MAIN/GBDC).
2. Decide on the FV column anchor; HTGC may keep "% NAV" between Cost
   and Fair Value (similar to GBDC) or as a trailing column (similar to
   ARCC). extract_value_slots(min_idx=...) approach should still work.
3. Identify non-accrual footnote marker (probably "(7)" or "(8)";
   verify against legend).
4. Validate FV total against the filing's reported total investments
   FV figure (TBD from filing).
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def parse(html: str) -> list[dict[str, Any]]:
    logger.warning("HTGC parser not yet implemented; returning empty list.")
    return []
