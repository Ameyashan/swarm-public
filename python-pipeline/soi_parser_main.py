"""Parser for Main Street Capital (MAIN) Schedule of Investments.

Structural notes vs. ARCC
-------------------------
1. MAIN's SoI is paginated across ~57 sequential <table> elements. Each table
   repeats the column header in row 1.
2. Header row has 14 named columns (a clean, well-labeled table):
       cell  0  Portfolio Company name
       cell  1  Footnote tag
       cell  2  Business Description
       cell  3  Type of Investment
       cell  4  Footnote tag (e.g. "(9)")
       cell  5  Investment Date
       cell  6  Shares/Units
       cell  7  Total Rate (e.g. "12.36 %")
       cell  8  Reference Rate and Spread label  (e.g. "SF+")
       cell  9  Reference rate spread (e.g. "8.50 %")  -- NOT a separate cell;
                actual layout is more verbose. See below.
       cell 10  PIK Rate
       cell 11  Maturity Date
       cell 12  Principal
       cell 13  Cost
       cell 14  Fair Value
3. ACTUAL row layouts vary subtly by row type. Empirically:
   - "Portfolio company name row" — cells 0=name, 1=footnote, 2=description,
     all other cells empty. This sets the current company state. NO data here.
   - "Tranche row" — cell 0 empty; data starts at cell 3.
       cell  3 = type ("Secured Debt", "Preferred Equity", "Member Units", ...)
       cell  4 = footnote(s) like "(9)"
       cell  5 = investment date
       cell  6 = shares/units (often blank for debt rows)
       cell  7 = total rate (e.g. "12.36 %") OR blank for equity
       cell  8 = ref rate label e.g. "SF+"
       cell  9 = ref rate spread (e.g. "8.50 %")
       cell 10 = PIK rate (e.g. "12.31 %")
       cell 11 = maturity date
       The trailing 3 numeric SLOTS are Principal, Cost, Fair Value.
   - "Subtotal row" — empty cell 0..3; only one number near the right —
     these are control-group subtotals (skip).
   - "Section header row" — single non-empty cell with text like
     "Control Investments (5)", "Affiliate Investments", "Non-Control / Non-
     Affiliate Investments". These don't represent industry but they're
     useful as the relationship-type field.
4. Footnote convention (from filing legend):
       (8)  -- non-income producing security        (NOT non-accrual)
       (9)  -- collateral for credit facility       (NOT non-accrual)
       Investments on non-accrual are flagged in legend with footnote "(25)".
   So MAIN's non-accrual footnote is **(25)**, separately verified by
   inspection of MAIN's filing notes.
5. Industry banner: MAIN does NOT label industries in the SoI. We leave
   industry=None for MAIN — industry classification comes from the business
   description text on the company name row (kept as `business_description`
   future enhancement).

Validation target (Q1 2026 10-Q):
   - Filing self-reports total FV = $5,674,751 thousand
"""

from __future__ import annotations

import logging
from typing import Any

from bs4 import BeautifulSoup

import soi_helpers as h

logger = logging.getLogger(__name__)


_HEADER_TOKENS = ("Portfolio Company", "Type of Investment", "Fair Value")
_NON_ACCRUAL_FOOTNOTE = "25"

_SECTION_BANNERS = (
    "control investments",
    "affiliate investments",
    "non-control",
    "other portfolio",
    "non control",
)

# Phrases that indicate the end of the current-period SoI block (next block
# is the comparative prior period).  MAIN's filing puts both periods in the
# same DOM, contiguous, with no clear heading between them — we use these
# textual terminators instead.
_PERIOD_TERMINATORS = (
    "total money market funds",
    "total investments",
    "total portfolio",
)


def _is_soi_table(table) -> bool:
    head_text = " ".join(
        r.get_text(" ", strip=True) for r in table.find_all("tr")[:5]
    )
    return all(tok in head_text for tok in _HEADER_TOKENS)


def _is_repeated_header_row(cells: list[str]) -> bool:
    if not cells:
        return False
    joined = " ".join(c for c in cells if c)
    return "Portfolio Company" in joined and "Fair Value" in joined


def _is_section_banner(cells: list[str]) -> bool:
    non_empty = [c for c in cells if c.strip()]
    if len(non_empty) != 1:
        return False
    low = non_empty[0].lower()
    return any(b in low for b in _SECTION_BANNERS)


def _is_company_row(cells: list[str]) -> bool:
    """A 'company name row' has cell 0 with text AND cell 2 (description)
    has text, AND cells 3+ are mostly empty (no rate, no maturity, no $).
    """
    if not cells or not cells[0].strip():
        return False
    # First-cell non-empty + cell 3 (Type) is empty + no rate/maturity
    type_cell = cells[3] if len(cells) > 3 else ""
    return not type_cell.strip()


def _is_subtotal_row(cells: list[str]) -> bool:
    """Subtotals: first ~12 cells empty, only 1-2 numbers at the tail."""
    if not cells:
        return False
    if cells[0].strip() or (len(cells) > 3 and cells[3].strip()):
        return False
    nums = h.extract_value_slots(cells, min_idx=0)
    real_nums = [n for _, n in nums if n is not None]
    return 1 <= len(real_nums) <= 2


def parse(html: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "lxml")
    tables = h.first_contiguous_block(soup, _is_soi_table)
    if not tables:
        logger.warning("MAIN: no SoI tables found.")
        return []

    logger.info("MAIN: parsing %d contiguous SoI tables.", len(tables))

    obs: list[dict[str, Any]] = []
    current_company: str | None = None
    current_company_fn: set[str] = set()
    current_section: str | None = None
    skipped_subtotals = 0
    period_ended = False

    for table in tables:
        if period_ended:
            break
        for row in table.find_all("tr"):
            cells = h.cell_texts(row)
            if h.is_blank_row(cells):
                continue
            if _is_repeated_header_row(cells):
                continue
            if _is_section_banner(cells):
                current_section = next(
                    (c for c in cells if c.strip()), None
                )
                continue
            # Period terminator? (e.g. "Total money market funds")
            row_text_low = " ".join(cells).lower()
            if any(term in row_text_low for term in _PERIOD_TERMINATORS):
                period_ended = True
                break

            if _is_subtotal_row(cells):
                skipped_subtotals += 1
                continue

            if _is_company_row(cells):
                # Set current company state.
                name = h.strip_footnotes(cells[0])
                if name:
                    current_company = name
                    current_company_fn = h.row_footnotes(row)
                continue

            # Tranche row.
            if not current_company:
                continue
            type_cell = cells[3] if len(cells) > 3 else ""
            if not type_cell.strip():
                continue

            record = _parse_tranche_row(
                cells, current_company, current_company_fn, row
            )
            if record is not None:
                obs.append(record)

    logger.info(
        "MAIN: emitted %d observations (skipped %d subtotal rows)",
        len(obs), skipped_subtotals,
    )
    return obs


def _parse_tranche_row(
    cells: list[str],
    company: str,
    company_fn: set[str],
    row,
) -> dict[str, Any] | None:
    investment_type = h.strip_footnotes(cells[3]) if len(cells) > 3 else None
    total_rate = cells[7].strip() if len(cells) > 7 else ""
    ref_label = cells[8].strip() if len(cells) > 8 else ""
    ref_spread = cells[9].strip() if len(cells) > 9 else ""
    pik_rate = cells[10].strip() if len(cells) > 10 else ""
    maturity = cells[11].strip() if len(cells) > 11 else ""

    # Some rows shift due to extra footnote cells. If cell 7 is the maturity
    # date (looks like M/D/YYYY), realign:
    # Heuristic only — the headers above match cell 7 = total rate for tranches.

    rate_text, rate_pct, pik_pct, is_pik = h.extract_combined_rate(
        cash_rate=total_rate if "%" in total_rate else None,
        pik_rate=pik_rate if "%" in pik_rate else None,
        ref_rate=ref_label if ref_label else None,
        spread=ref_spread if "%" in ref_spread else None,
    )

    maturity_iso = h.maturity_to_iso(maturity)

    # Trailing 3 SLOTS: Principal, Cost, Fair Value.
    slots = h.extract_value_slots(cells, min_idx=11)
    principal = cost = fair_value = None
    if len(slots) >= 3:
        principal = slots[-3][1]
        cost = slots[-2][1]
        fair_value = slots[-1][1]
    elif len(slots) == 2:
        # Equity rows: Cost + FV (no principal)
        cost = slots[-2][1]
        fair_value = slots[-1][1]
    elif len(slots) == 1:
        # Lone value: cost only — leave FV None
        cost = slots[-1][1]

    # Non-accrual: footnote (25) on the company row OR tranche row.
    row_fn = h.row_footnotes(row)
    accrual_status = (
        "non_accrual"
        if _NON_ACCRUAL_FOOTNOTE in (row_fn | company_fn)
        else "accrual"
    )

    return h.emit_record(
        company=company,
        industry=None,  # MAIN doesn't label industries in SoI
        investment_type=investment_type,
        interest_rate_text=rate_text,
        interest_rate_pct=rate_pct,
        pik_rate_pct=pik_pct,
        is_pik=is_pik,
        maturity_date=maturity_iso,
        principal_amount=principal,
        cost=cost,
        fair_value=fair_value,
        accrual_status=accrual_status,
    )
