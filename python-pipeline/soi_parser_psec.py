"""Parser stub for Prospect Capital (PSEC) Schedule of Investments.

Status
------
NOT YET IMPLEMENTED. Returns empty list; upstream pipeline records
parse_status='failed' with reason 'parser_not_implemented'.

Structural notes from filing profile
------------------------------------
- PSEC's SoI is very large (300+ portfolio companies) and split across
  many `<table>` blocks. Investment categories are: First Lien Term Loan,
  Second Lien Term Loan, Subordinated, Equity, CLO Debt, CLO Equity,
  Structured Subordinated.
- PSEC uniquely reports CLO equity tranches with their own column block
  (Effective Yield, etc.).
- Numeric columns: Principal, Amortized Cost, Fair Value, % of Net Assets.
- Maturity column present for debt rows; equity/CLO rows omit it.
- Footnotes: legend includes accrued PIK markers and CLO-specific
  refinements; non-accrual marker needs verification.

Implementation TODO
-------------------
1. Profile bdc_filings/PSEC_10Q.htm header tokens.
2. Special-case the CLO sections: they may have a different column count
   that breaks slot-based extraction.
3. Identify the per-section subtotal vs detail-row signal — PSEC tends to
   format subtotals with an italic style not visible in cell text.
4. Validate FV total vs. filing's reported figure (TBD).
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def parse(html: str) -> list[dict[str, Any]]:
    logger.warning("PSEC parser not yet implemented; returning empty list.")
    return []
