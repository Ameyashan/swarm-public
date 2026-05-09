"""Parser for Goldman Sachs Private Credit Corp. (GSCR) Schedule of Investments.

Status: implemented and validated against Q3 2025 10-Q (-0.19% vs filing
total).

GSCR shares the SoI HTML template with GSBD (both filed via Goldman's same
inline-XBRL builder), so the actual parsing logic lives in
``soi_parser_gs_common.parse``. This module supplies only the GSCR-specific
non-accrual footnote marker so it stays trivial and any future schema drift
needs only one fix.

GSCR-specific quirk: the very first SoI table in some filings inserts an
"Initial Acquisition Date" column before "Maturity". The shared parser
handles that by probing both candidate cell positions for the maturity
date.

GSCR non-accrual footnote: (13).
    Footnote text in filing: "(13) The investment is on non-accrual status."
"""

from __future__ import annotations

from typing import Any

import soi_parser_gs_common as gs


_NON_ACCRUAL_FOOTNOTE = "13"


def parse(html: str) -> list[dict[str, Any]]:
    return gs.parse(
        html,
        non_accrual_footnote=_NON_ACCRUAL_FOOTNOTE,
        fund_label="GSCR",
    )
