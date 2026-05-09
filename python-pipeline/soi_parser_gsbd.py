"""Parser for Goldman Sachs BDC, Inc. (GSBD) Schedule of Investments.

Status: implemented and validated against Q1 2026 10-Q (-0.81% vs filing
total).

GSBD shares the SoI HTML template with GSCR (both filed via Goldman's same
inline-XBRL builder), so the actual parsing logic lives in
``soi_parser_gs_common.parse``. This module supplies only the GSBD-specific
non-accrual footnote marker so it stays trivial and any future schema drift
needs only one fix.

GSBD non-accrual footnote: (12).
    Footnote text in filing: "(12) The investment is on non-accrual status."
"""

from __future__ import annotations

from typing import Any

import soi_parser_gs_common as gs


_NON_ACCRUAL_FOOTNOTE = "12"


def parse(html: str) -> list[dict[str, Any]]:
    return gs.parse(
        html,
        non_accrual_footnote=_NON_ACCRUAL_FOOTNOTE,
        fund_label="GSBD",
    )
