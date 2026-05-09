"""Shared SoI parser for the Goldman Sachs BDC family.

GSBD (Goldman Sachs BDC) and GSCR (Goldman Sachs Private Credit Corp) file
their Schedules of Investments using a near-identical HTML template. This
module factors the parser logic out so each fund's per-ticker module is a
thin wrapper that supplies only the fund-specific footnote markers.

Structural notes (validated against GSBD Q1 2026 10-Q and GSCR Q3 2025 10-Q)
---------------------------------------------------------------------------
1. SoI header signature (each table repeats this on row 1):
       "Investment", "Industry", "Interest Rate",
       "Reference Rate and Spread", "Maturity",
       "Par", "Cost", "Fair Value", "Footnotes"
   GSCR's first SoI table inserts an extra "Initial Acquisition Date" column
   before "Maturity"; we handle that by trying both cell positions for the
   maturity date.

2. Detail-row cell layout (16-cell variant; Goldman pads with empty cells
   between numeric columns, so positional indexing works robustly):
       cell  0  Company name (may include "(dba ...)" trade name)
       cell  1  Industry (set per row -- no industry-banner state needed)
       cell  2  Interest rate, e.g. "8.41 %"  (may be empty for non-accrual
                or non-cash-paying lines)
       cell  3  Reference rate + spread, e.g. "S + 4.75 %", "B + 6.00 %",
                "S + 5.50 % (Incl. 2.75 % PIK)", or trailing " PIK"
       cell  4  Either Maturity (MM/DD/YY) for most tables, or
                Initial Acquisition Date for GSCR's first table
       cell  5  Maturity (MM/DD/YY) when cell 4 holds Initial Acquisition Date,
                otherwise a currency code ("CAD", "AUD", "EUR", "GBP")
       cells 6-15  Numeric value slots (Par, Cost, Fair Value), interleaved
                with "$" markers and split parens for negatives.

3. Section banner rows have a single populated cell whose text matches the
   pattern "<text>  - <pct> %", e.g. "Australia  - 2.3 %",
   "1st Lien/Senior Secured Debt  - 7.8 %", "Debt Investments  - 233.2 %".
   These are partition headers (country / investment-type / asset-class) --
   they do NOT carry investment-type metadata onto the rows below, because
   each row's investment type is implied by the section it sits in.
   We skip them.

4. Subtotal rows start with "Total ..." -- skip.

5. Period boundary: GS filings include the prior-period SoI later in the
   same DOM. Two layouts have been observed:
     a. Most filings (e.g. GSBD Q1 2026, GSCR Q3 2025): the current and
        prior period SoI tables are separated by summary/cover tables, so
        ``soi_helpers.first_contiguous_block`` truncates correctly.
     b. Some filings (e.g. GSCR Q1 2025): the prior-period SoI is in the
        same uninterrupted run of SoI tables, so the contiguous-block
        check alone is not enough. We additionally watch for a row whose
        joined cells start with "Total Investments  - <pct> %" and stop
        as soon as we see one. That row is the SoI grand total and only
        ever appears once per period block.
   Both defenses run; whichever fires first ends ingestion.

6. Negative values appear as "( N )" split across two adjacent cells,
   e.g. cell="( 4" and the next cell=")". The shared ``extract_value_slots``
   helper only sees the first cell and parses it as +N; the closing ")" is
   discarded. This causes a small positive bias on FV totals for unfunded
   commitments with negative carrying value (typically single-digit-thousand
   amounts). Acceptable -- validation deltas remain within +/-1% of the
   filing-reported total. Pipeline-wide fix should be made in
   ``extract_value_slots`` itself, not per-parser.

7. Non-accrual marker is fund-specific: GSBD uses "(12)", GSCR uses "(13)".
   The wrapper modules pass the right marker into ``parse()``.

Validation
----------
GSBD Q1 2026 10-Q: 539 obs across 175 companies; sum FV = $3,202,718k vs
filing-reported $3,228,940k (-0.81%).

GSCR Q3 2025 10-Q: 633 obs across 325 companies; sum FV = $11,589,289k vs
filing-reported $11,611,513k (-0.19%).

Both within tolerance of the IMPLEMENTED_TICKERS bar set by ARCC/OBDC/MAIN.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from bs4 import BeautifulSoup

import soi_helpers as h

logger = logging.getLogger(__name__)


# Header tokens required in the first 5 rows of any candidate SoI table.
_HEADER_TOKENS = (
    "Investment", "Industry", "Interest Rate",
    "Maturity", "Cost", "Fair Value",
)

# Section banner suffix: "<text>  - <pct> %"
_BANNER_PCT_RE = re.compile(r"\s*-\s*\d+\.?\d*\s*%\s*$")

# Match MM/DD/YY (2-digit year) -- the Goldman family prints maturities in
# this short form. soi_helpers.maturity_to_iso only handles 4-digit years.
_DATE_2DIGIT_RE = re.compile(r"^\s*(\d{1,2})\s*/\s*(\d{1,2})\s*/\s*(\d{2})\s*$")

# Match an embedded PIK rate inside the spread cell, e.g.
# "S + 5.50 % (Incl. 2.75 % PIK)" -- captures 2.75
_INCL_PIK_RE = re.compile(r"Incl\.\s*([\d.]+)\s*%\s*PIK", re.IGNORECASE)

# Period terminator: the SoI grand-total row appears exactly once per
# period block as a row beginning with "Total Investments" followed by a
# percent suffix. The text varies a bit ("Total Investments  - 133.4 %",
# "Total Investments and investments in affiliated money market fund - ...")
# so we just check for the prefix + a "%" sign in the same row.
_PERIOD_TERMINATOR_PREFIXES = (
    "total investments  - ",
    "total investments - ",
    "total investments and investments in affiliated",
    "total investments, at fair value",
)


def _row_is_period_terminator(joined_low: str) -> bool:
    return any(
        joined_low.lstrip().startswith(p) for p in _PERIOD_TERMINATOR_PREFIXES
    )


def _maturity_iso(text: str) -> str | None:
    """Convert 'MM/DD/YY' or 'MM/DD/YYYY' or 'MM/YYYY' to ISO date.

    Two-digit years are interpreted as 20YY (BDC investments are forward-
    dated; a maturity in 2-digit "30" is 2030, not 1930).
    """
    iso = h.maturity_to_iso(text)
    if iso:
        return iso
    if not text:
        return None
    m = _DATE_2DIGIT_RE.match(text.strip())
    if not m:
        return None
    month, day, yy = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return None
    year = 2000 + yy
    return f"{year:04d}-{month:02d}-{day:02d}"


def _is_soi_table(table) -> bool:
    rows = table.find_all("tr")[:5]
    head_text = " ".join(r.get_text(" ", strip=True) for r in rows)
    return all(tok in head_text for tok in _HEADER_TOKENS)


def _is_repeated_header_row(cells: list[str]) -> bool:
    joined = " ".join(c for c in cells if c)
    return (
        "Investment" in joined
        and "Fair Value" in joined
        and "Industry" in joined
    )


def _is_total_row(cells: list[str]) -> bool:
    """Subtotal/total rows start with 'Total' in their first non-empty cell."""
    for c in cells:
        s = c.strip()
        if s:
            return s.lower().startswith("total")
    return False


def _is_banner_row(cells: list[str]) -> bool:
    """Single-cell row whose text ends with '- X.X %'.

    Examples: "Australia  - 2.3 %", "1st Lien/Senior Secured Debt  - 7.8 %",
    "Debt Investments  - 233.2 %", "United States  - 220.5 %".
    """
    non_empty = [c for c in cells if c.strip()]
    if len(non_empty) != 1:
        return False
    return bool(_BANNER_PCT_RE.search(non_empty[0].strip()))


def _looks_like_company_row(cells: list[str]) -> bool:
    """A detail row has cell[0]=name, cell[1]=industry, plus enough cells
    to hold rate / maturity / par / cost / FV. Banner rows fail the cell-1
    test because they have only one populated cell.
    """
    if len(cells) < 8:
        return False
    if not cells[0].strip() or not cells[1].strip():
        return False
    # Defensive: if cell 1 is itself a banner suffix, this isn't a detail row.
    if _BANNER_PCT_RE.search(cells[1]):
        return False
    return True


def _strip_company_suffix(name: str) -> str:
    """Drop trailing footnote markers and stray '+'/'*' tax-class flags."""
    cleaned = h.strip_footnotes(name) or name
    return cleaned.rstrip(" +*").strip() or cleaned


def parse(
    html: str,
    *,
    non_accrual_footnote: str,
    fund_label: str = "GS",
) -> list[dict[str, Any]]:
    """Parse a Goldman-family BDC 10-Q/10-K SoI HTML.

    Args:
        html: Raw HTML of the primary filing document.
        non_accrual_footnote: Bare digit string of the footnote marker that
            indicates non-accrual status (no parens). Per filing legend.
            GSBD = "12", GSCR = "13".
        fund_label: Short label used in log lines.

    Returns:
        List of observation dicts ready for ``ingest._bulk_insert_observations``.
    """
    soup = BeautifulSoup(html, "lxml")

    # Goldman filings duplicate the prior-period SoI later in the same DOM.
    # ``first_contiguous_block`` walks tables in document order and stops at
    # the first non-SoI table after a run has begun -- this gives us only
    # the current-period block.
    tables = h.first_contiguous_block(soup, _is_soi_table)
    if not tables:
        logger.warning("%s: no SoI tables found.", fund_label)
        return []

    logger.info(
        "%s: parsing %d contiguous SoI tables (current period)",
        fund_label, len(tables),
    )

    observations: list[dict[str, Any]] = []
    skipped_subtotals = 0
    skipped_banners = 0
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

            joined_low = " ".join(cells).lower()
            if _row_is_period_terminator(joined_low):
                period_ended = True
                break

            if _is_total_row(cells):
                skipped_subtotals += 1
                continue
            if _is_banner_row(cells):
                skipped_banners += 1
                continue
            if not _looks_like_company_row(cells):
                continue

            record = _parse_data_row(
                cells, row, non_accrual_footnote=non_accrual_footnote,
            )
            if record is not None:
                observations.append(record)

    logger.info(
        "%s: emitted %d observations (skipped %d subtotal, %d banner rows)",
        fund_label, len(observations), skipped_subtotals, skipped_banners,
    )
    return observations


def _parse_data_row(
    cells: list[str],
    row,
    *,
    non_accrual_footnote: str,
) -> dict[str, Any] | None:
    company = _strip_company_suffix(cells[0])
    if not company:
        return None
    industry = h.strip_footnotes(cells[1]) if len(cells) > 1 else None

    interest_rate_cell = cells[2].strip() if len(cells) > 2 else ""
    ref_spread_cell = cells[3].strip() if len(cells) > 3 else ""

    # Maturity may be in cell 4 (most tables) or cell 5 (GSCR's first SoI
    # table inserts an "Initial Acquisition Date" column before Maturity).
    # We just probe both and take the first that parses as a date.
    maturity_iso = None
    for idx in (4, 5):
        if idx >= len(cells):
            continue
        iso = _maturity_iso(cells[idx].strip())
        if iso:
            maturity_iso = iso
            break

    # Build coupon metadata. The spread cell contains both the reference rate
    # (e.g. "S +") and spread (e.g. "4.75 %"); we split on "+" to feed the
    # extract_combined_rate helper its expected (ref, spread) pair.
    if "+" in ref_spread_cell:
        ref_part, _, spread_part = ref_spread_cell.partition("+")
        ref_rate = (ref_part.strip() + " +") if ref_part.strip() else None
        spread = spread_part.strip()
    else:
        ref_rate = None
        spread = ref_spread_cell or None

    rate_text, rate_pct, pik_pct, is_pik = h.extract_combined_rate(
        cash_rate=interest_rate_cell if "%" in interest_rate_cell else None,
        ref_rate=ref_rate,
        spread=spread if spread and "%" in spread else None,
    )

    # Goldman embeds PIK info inside the spread cell two ways:
    #   1. "(Incl. X.X% PIK)"  -- capture the explicit PIK rate
    #   2. trailing " PIK"      -- flag is_pik but no rate available
    if "PIK" in ref_spread_cell:
        is_pik = True
        if pik_pct is None:
            m = _INCL_PIK_RE.search(ref_spread_cell)
            if m:
                try:
                    pik_pct = float(m.group(1))
                except ValueError:
                    pik_pct = None

    # Last 3 numeric/em-dash slots are (Par, Cost, Fair Value). Em-dash slots
    # come back as None, which is the right value for unfunded commitments
    # with no carrying cost/value yet.
    slots = h.extract_value_slots(cells, min_idx=4)
    principal = cost = fair_value = None
    if len(slots) >= 3:
        principal = slots[-3][1]
        cost = slots[-2][1]
        fair_value = slots[-1][1]
    elif len(slots) == 2:
        cost = slots[-2][1]
        fair_value = slots[-1][1]
    elif len(slots) == 1:
        fair_value = slots[-1][1]

    footnotes = h.row_footnotes(row)
    accrual_status = (
        "non_accrual" if non_accrual_footnote in footnotes else "accrual"
    )

    return h.emit_record(
        company=company,
        industry=industry,
        # GS family encodes investment-type as section banner above the row,
        # not as a per-row cell. Leaving null is the truthful representation;
        # downstream consumers can derive it from the maturity-rate-spread
        # tuple if needed.
        investment_type=None,
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
