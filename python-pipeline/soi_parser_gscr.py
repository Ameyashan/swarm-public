"""Parser stub for Goldman Sachs Capital Real Estate (GSCR) Schedule of Investments.

Status
------
NOT YET IMPLEMENTED. Returns empty list; upstream pipeline records
parse_status='failed' with reason 'parser_not_implemented'.

Structural notes from filing profile
------------------------------------
- GSCR (also referenced as Goldman Sachs Private Credit Corp) is a
  newer, smaller fund. The SoI fits in fewer tables than the other
  funds — closer to MAIN's structure.
- Investment-type column observed: "First Lien Senior Secured Debt",
  "Second Lien Senior Secured Debt", "Mezzanine Debt", "Equity",
  "Preferred Equity".
- Numeric columns: Principal, Cost, Fair Value, % of Net Assets.
- Maturity column present.
- Filing emits at least three subtotal levels (industry, type, section).

Implementation TODO
-------------------
1. Profile GSCR_10Q.htm header tokens.
2. Verify column indexes (likely similar to GBDC since both are GS funds
   with parallel formatting templates).
3. Identify non-accrual footnote marker.
4. Validate FV total vs. filing's reported total (TBD).

Note: GSCR's most recent filing is Q3 2025, not Q1 2026.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def parse(html: str) -> list[dict[str, Any]]:
    logger.warning("GSCR parser not yet implemented; returning empty list.")
    return []
