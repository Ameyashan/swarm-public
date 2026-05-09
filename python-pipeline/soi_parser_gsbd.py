"""Parser stub for Goldman Sachs BDC (GSBD) Schedule of Investments.

Status
------
NOT YET IMPLEMENTED. Returns empty list; upstream pipeline records
parse_status='failed' with reason 'parser_not_implemented'.

Structural notes from filing profile
------------------------------------
- GSBD's SoI uses a column layout closer to ARCC than to GBDC. Single
  `<table>` per section is common, with sections: Debt Investments,
  Equity Investments, Investment Funds.
- Investment-type column distinguishes "1st Lien/Senior Secured Debt",
  "2nd Lien/Senior Secured Debt", "Unsecured Debt", "Preferred Stock",
  "Common Stock", "Warrants".
- Numeric columns: Principal, Cost, Fair Value, % of Net Assets.
- PIK column is separate from the cash interest column.
- Footnotes use parenthetical numerals; legend defines (1) through (15)
  approximately. Non-accrual marker needs verification.

Implementation TODO
-------------------
1. Profile GSBD_10Q.htm header tokens.
2. Verify column order: ARCC-style (P, C, %NAV, FV) vs. GBDC-style
   (P, C, %NAV, FV with extra spacer cells).
3. Identify non-accrual footnote.
4. Validate FV total vs. filing's reported total (TBD).
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def parse(html: str) -> list[dict[str, Any]]:
    logger.warning("GSBD parser not yet implemented; returning empty list.")
    return []
