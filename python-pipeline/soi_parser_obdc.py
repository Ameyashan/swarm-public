"""Parser for Blue Owl Capital Corp (OBDC) Consolidated Schedule of Investments.

Structural notes vs. ARCC
-------------------------
1. OBDC SoI is paginated across ~30-40 sequential <table> elements (similar to
   ARCC). Each repeats the column header.
2. Header row signature: "Company", "Investment", "Ref. Rate", "PIK",
   "Maturity Date", "Amortized Cost", "Fair Value".
3. Hierarchy banners ABOVE industry banners (we skip these — they aren't an
   industry assignment):
       "Non-controlled/non-affiliated portfolio company investments"
       "Debt Investments"  /  "Equity Investments"  /  "Preferred Equity"
   Industry banner is the next single-cell row below.
4. Cell layout (raw <td> indexes — variable due to currency markers and `$`
   spacers, but cell 0..5 are stable):
       cell 0  Company name + footnotes  (or industry/hierarchy banner)
       cell 1  Investment type (e.g. "First lien senior secured loan")
       cell 2  Ref. Rate label  (e.g. "S+", "E+", "N/A")
       cell 3  Cash rate %  (sometimes empty if all-in is in cell 4)
       cell 4  All-in rate % or PIK rate (when no cash rate)
       cell 5  Maturity (MM/YYYY)
       cells 6+ : Par/Shares, Cost, Fair Value -- these wander based on
                  currency symbols and `$` spacers. The robust extractor
                  is "the last 3 numeric values in the row".
5. Subtotal rows have NO company name in cell 0 and end with `2.6` followed
   by `%` -- those are industry-percent-of-NAV totals. Skip them.
6. Footnote conventions (from filing legend):
       (8)  borrower is privately owned, no public market   (NOT non-accrual)
       (9)  loan classified as covenant-lite                (NOT non-accrual)
       (28) Loan was on non-accrual status                  -> non_accrual
   So our non-accrual footnote is **(28)**, not (8) like ARCC.
7. PIK detection: cell 4 contains a separate PIK rate. If cell 4 has a `%`
   AND cell 3 also has a `%`, then row is split-rate cash+PIK and is_pik=True.

Validation target (Q1 2026 10-Q):
   - Filing self-reports total FV = $15,344,201 thousand ($15.3B)
   - Filing self-reports 7 portfolio companies on non-accrual,
     1.0% of portfolio at FV  ($153,316 thousand)
"""

from __future__ import annotations

import logging
from typing import Any

from bs4 import BeautifulSoup

import soi_helpers as h

logger = logging.getLogger(__name__)

# ---- Tables / SoI block detection ------------------------------------------

_HEADER_TOKENS = ("Company", "Investment", "Ref. Rate", "Amortized Cost", "Fair Value")

# Non-industry banner phrases we should NOT promote as industry.
_HIERARCHY_BANNERS = (
    "non-controlled",
    "non controlled",
    "controlled affiliate",
    "affiliated portfolio",
    "debt investments",
    "equity investments",
    "preferred equity",
    "investment funds",
    "joint venture",
    "structured finance",
    "subordinated notes",
    "common equity",
    "lp interests",
    "warrants",
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
    return "Company" in joined and "Ref. Rate" in joined and "Fair Value" in joined


def _is_subtotal_row(cells: list[str]) -> bool:
    """Subtotals have no company in cell 0, but contain a `%` cell — those
    are industry-as-percent-of-NAV totals."""
    if cells and cells[0].strip():
        return False
    has_pct = any(c.strip() == "%" for c in cells)
    has_num = any(h.to_number(c) is not None for c in cells if c)
    return has_pct and has_num


def _classify_banner(cells: list[str]) -> tuple[str, str | None]:
    """Inspect a row that has only one (or two) non-empty cells and decide
    whether it's a hierarchy banner (skip), industry banner (set state), or
    something else.

    Returns (kind, value) where kind ∈ {"hierarchy", "industry", "none"}.
    """
    non_empty = [c for c in cells if c.strip()]
    if len(non_empty) > 2:
        return ("none", None)
    text = non_empty[0] if non_empty else ""
    text_clean = h.strip_footnotes(text) or text
    if not text_clean:
        return ("none", None)
    low = text_clean.lower()
    # Skip subtotal-ish phrasing
    if low.startswith(("total ", "subtotal", "less:", "net ")):
        return ("none", None)
    # Hierarchy phrases
    if any(b in low for b in _HIERARCHY_BANNERS):
        return ("hierarchy", text_clean)
    # Otherwise it's likely an industry banner.
    # Sanity: industry banners don't contain numbers.
    if h.to_number(text_clean) is not None:
        return ("none", None)
    return ("industry", text_clean)


# ---- Public API ------------------------------------------------------------


def parse(html: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "lxml")
    tables = h.first_contiguous_block(soup, _is_soi_table)
    if not tables:
        logger.warning("OBDC: No SoI tables found.")
        return []

    logger.info("OBDC: parsing %d contiguous SoI tables.", len(tables))

    obs: list[dict[str, Any]] = []
    current_industry: str | None = None
    skipped_subtotals = 0

    for table in tables:
        for row in table.find_all("tr"):
            cells = h.cell_texts(row)
            if h.is_blank_row(cells):
                continue
            if _is_repeated_header_row(cells):
                continue
            if _is_subtotal_row(cells):
                skipped_subtotals += 1
                continue

            # Banner row?
            non_empty = [c for c in cells if c.strip()]
            if len(non_empty) <= 2:
                kind, val = _classify_banner(cells)
                if kind == "industry":
                    current_industry = val
                # hierarchy / none → just skip for state purposes
                continue

            record = _parse_data_row(cells, current_industry, row)
            if record is not None:
                obs.append(record)

    logger.info(
        "OBDC: emitted %d observations (skipped %d subtotal rows)",
        len(obs), skipped_subtotals,
    )
    return obs


def _parse_data_row(
    cells: list[str], industry: str | None, row
) -> dict[str, Any] | None:
    cell0 = cells[0] if len(cells) > 0 else ""
    if not cell0.strip():
        # Continuation lines are rare in OBDC; if no company, skip.
        return None

    company = h.strip_footnotes(cell0)
    if not company:
        return None

    investment_type = h.strip_footnotes(cells[1]) if len(cells) > 1 else None
    ref_rate = cells[2].strip() if len(cells) > 2 else ""
    cash_rate = cells[3].strip() if len(cells) > 3 else ""
    pik_or_allin = cells[4].strip() if len(cells) > 4 else ""
    maturity = cells[5].strip() if len(cells) > 5 else ""

    # Determine which of cell 3 / cell 4 is cash vs. all-in vs. PIK.
    # Heuristic: when both have "%", cell 3 is cash and cell 4 is PIK.
    # When only one has "%", that's the all-in rate.
    cash_pct_cell = cash_rate if "%" in cash_rate else ""
    second_pct_cell = pik_or_allin if "%" in pik_or_allin else ""
    is_split_pik = bool(cash_pct_cell and second_pct_cell)

    rate_text, rate_pct, pik_pct, is_pik = h.extract_combined_rate(
        cash_rate=cash_pct_cell or None,
        pik_rate=second_pct_cell if is_split_pik else None,
        ref_rate=ref_rate or None,
        all_in_rate=second_pct_cell if (second_pct_cell and not is_split_pik) else None,
    )

    maturity_iso = h.maturity_to_iso(maturity)

    # Column-anchored extraction: each row has 3 trailing value SLOTS
    # (Par/Shares-Units, Amortized Cost, Fair Value), where each slot is
    # either a number or an em-dash (— means intentionally blank).
    # We extract the last 3 slots from cell index 6+ (past the maturity col).
    slots = h.extract_value_slots(cells, min_idx=6)
    principal: float | None = None
    cost: float | None = None
    fair_value: float | None = None
    if len(slots) >= 3:
        principal = slots[-3][1]
        cost = slots[-2][1]
        fair_value = slots[-1][1]
    elif len(slots) == 2:
        # Some equity rows have only 2 slots (cost + FV)
        cost = slots[-2][1]
        fair_value = slots[-1][1]
    elif len(slots) == 1:
        # Truly degenerate: the lone value is most likely cost.
        # Don't assume it's FV — leave FV as None to avoid overcounting.
        cost = slots[-1][1]
    # else: zero-funded commitment, all None — expected.

    # Non-accrual: footnote (28) on the row.
    footnotes = h.row_footnotes(row)
    accrual_status = "non_accrual" if "28" in footnotes else "accrual"

    return h.emit_record(
        company=company,
        industry=industry,
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
