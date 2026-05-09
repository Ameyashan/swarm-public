"""Parser for Ares Capital Corporation (ARCC) Consolidated Schedule of Investments.

ARCC's SoI is filed as a single very wide HTML table. Layout (cell indices are
raw <td> positions, not colspan-collapsed columns):

    cell 0  Company name (or empty for continuation tranches)
    cell 2  Business Description
    cell 4  Investment type (e.g. "First lien senior secured loan")
    cell 6  Coupon (e.g. "8.66 %" or "9.45 % ( 2.88 % PIK)")
    cell 7  Reference (e.g. "SOFR (Q)")
    cell 8  Spread
    cell 10 Acquisition Date (MM/YYYY)
    cell 12 Maturity Date    (MM/YYYY)
    cell 14 Shares/Units (equity rows)
    cells right of 14: Principal, Amortized Cost, Fair Value, % NA + footnotes

Industry sections start with a single-cell row containing the industry name
(e.g. "Software and Services"). Subtotal rows have only 2 numeric cells and
are skipped. Footnote ``(8)`` indicates non-accrual; ``PIK`` in the coupon
text indicates payment-in-kind.

The parser returns one observation per investment line item. Continuation
tranches (rows where cell 0 is empty) inherit the most recent company name.

Only positions for Ares Capital Corporation 10-Q / 10-K filings are
expected — other BDCs use different layouts and need their own parser.
"""

from __future__ import annotations

import logging
import re
import warnings
from typing import Any

from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning

# ARCC inline-XBRL filings parse fine with the lxml HTML parser; silence the
# noisy XML-vs-HTML warning so logs stay readable.
warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

logger = logging.getLogger(__name__)

# ---- Helpers ---------------------------------------------------------------

# Footnote regex: matches things like "(2)(8)(13)" or "(8)" or "(2)(6)".
_FOOTNOTE_RE = re.compile(r"\((\d+[a-z]?)\)")
_NUMBER_RE = re.compile(r"-?\(?\$?\s*[\d,]*\.?\d+\)?")


def _to_number(raw: str | None) -> float | None:
    """Parse a financial number. Returns None if not parseable.

    Strips $, commas, and whitespace. Treats parens as negative
    (standard accounting convention).
    """
    if raw is None:
        return None
    s = raw.strip()
    if not s or s in {"$", "—", "-", "*"}:
        return None
    negative = s.startswith("(") and s.endswith(")")
    s = s.strip("()$ ").replace(",", "").replace("$", "").strip()
    if not s or not re.search(r"\d", s):
        return None
    try:
        val = float(s)
        return -val if negative else val
    except ValueError:
        return None


def _to_pct(raw: str | None) -> float | None:
    """Parse a percentage like '8.66 %' → 8.66. Returns None if unparseable."""
    if raw is None:
        return None
    m = re.search(r"-?\d+\.?\d*", raw.replace(",", ""))
    if not m:
        return None
    try:
        return float(m.group())
    except ValueError:
        return None


def _maturity_to_iso(raw: str | None) -> str | None:
    """Convert MM/YYYY (e.g. '10/2029') to an ISO date pinned to month-end's
    convention: we store the first day of that month since EDGAR only gives
    month-precision. Returns None if format doesn't match.
    """
    if not raw:
        return None
    m = re.match(r"\s*(\d{1,2})\s*/\s*(\d{4})\s*$", raw)
    if not m:
        return None
    month, year = int(m.group(1)), int(m.group(2))
    if not (1 <= month <= 12):
        return None
    return f"{year:04d}-{month:02d}-01"


def _cell_texts(row) -> list[str]:
    """Return raw <td>/<th> texts in order. Preserves empty cells."""
    return [c.get_text(" ", strip=True) for c in row.find_all(["td", "th"])]


def _row_footnotes(row) -> set[str]:
    """All footnote markers appearing anywhere in the row, e.g. {'2','8','13'}."""
    text = row.get_text(" ", strip=True)
    return set(_FOOTNOTE_RE.findall(text))


def _strip_footnotes(s: str | None) -> str | None:
    if s is None:
        return None
    return _FOOTNOTE_RE.sub("", s).strip() or None


_SOI_HEADER_NEEDLES = (
    "Company",
    "Investment",
    "Coupon",
    "Amortized Cost",
    "Fair Value",
)


def _is_soi_table(table) -> bool:
    """True if a table's first few rows contain the SoI header signature."""
    for row in table.find_all("tr")[:5]:
        text = row.get_text(" ", strip=True)
        if all(n in text for n in _SOI_HEADER_NEEDLES):
            return True
    return False


def _find_soi_tables(soup: BeautifulSoup):
    """Return the first contiguous block of SoI-shaped tables.

    ARCC paginates its SoI for print, so the schedule is rendered as 50–70
    sequential ``<table>`` elements that all share the same header. The
    first contiguous block corresponds to the current-period schedule; a
    second block (after a gap of unrelated tables) is the prior-period
    schedule. We only want the first block.
    """
    tables = soup.find_all("table")
    block: list = []
    started = False
    for t in tables:
        if _is_soi_table(t):
            block.append(t)
            started = True
        elif started:
            # Hit a non-SoI table after starting → end of current-period block.
            break
    return block


def _is_repeated_header_row(cells: list[str]) -> bool:
    """Detect the page-header row that ARCC re-emits at the top of every
    paginated SoI table. Avoids treating it as data.
    """
    if not cells:
        return False
    joined = " ".join(c for c in cells if c)
    return all(n in joined for n in _SOI_HEADER_NEEDLES)


def _is_industry_header(cells: list[str]) -> str | None:
    """Industry headers are rows where exactly one cell has non-empty text and
    that text isn't a numeric or investment-type-looking value."""
    non_empty = [c for c in cells if c]
    if len(non_empty) != 1:
        return None
    val = non_empty[0]
    # Heuristic: industry headers don't start with $ or digits and contain
    # words (not "Total ..." or "$..." totals).
    if val.startswith("$") or _to_number(val) is not None:
        return None
    if val.lower().startswith(("total ", "subtotal", "less:")):
        return None
    # An investment-type string like "First lien senior secured loan" appears
    # in cell 4 of a multi-cell row, not alone, so a single-cell row is safe
    # to treat as an industry banner.
    return val


def _extract_numbers_after(cells: list[str], start: int) -> list[float]:
    """Pull numeric values from cells[start:] in order, skipping $/empty/footnote-only cells."""
    nums: list[float] = []
    for c in cells[start:]:
        if not c:
            continue
        if c == "$":
            continue
        if _FOOTNOTE_RE.fullmatch(c):
            continue
        # A cell may contain only footnote markers like "(2)(9)" — skip.
        stripped = _FOOTNOTE_RE.sub("", c).strip()
        if not stripped:
            continue
        n = _to_number(stripped)
        if n is not None:
            nums.append(n)
    return nums


# ---- Public API ------------------------------------------------------------


def parse(html: str) -> list[dict[str, Any]]:
    """Parse the ARCC Consolidated Schedule of Investments out of filing HTML.

    Returns a list of observation dicts with the schema used by the
    `observations` table. Numeric fields are floats (in millions, as filed);
    callers shouldn't multiply/scale them — store as-is. Fields that can't be
    parsed are set to None and a warning is logged.
    """
    soup = BeautifulSoup(html, "lxml")
    tables = _find_soi_tables(soup)
    if not tables:
        logger.warning("No Consolidated Schedule of Investments tables found.")
        return []

    logger.info("Parsing %d contiguous SoI tables.", len(tables))

    observations: list[dict[str, Any]] = []
    current_industry: str | None = None
    current_company: str | None = None
    r_idx = 0

    for table in tables:
        for row in table.find_all("tr"):
            r_idx += 1
            obs = _parse_row(
                row=row,
                r_idx=r_idx,
                current_industry=current_industry,
                current_company=current_company,
            )
            if obs is None:
                continue
            # _parse_row may update industry/company state.
            current_industry = obs["_state_industry"]
            current_company = obs["_state_company"]
            if obs.get("_emit"):
                observations.append(obs["_record"])

    return observations


def _parse_row(
    *,
    row,
    r_idx: int,
    current_industry: str | None,
    current_company: str | None,
) -> dict[str, Any] | None:
    """Process one <tr>. Returns None to skip the row entirely.

    The returned dict carries forward updated state (``_state_industry``,
    ``_state_company``) and, when an observation should be emitted, includes
    ``_emit=True`` and ``_record``.
    """
    cells = _cell_texts(row)

    # Skip the page-header row that recurs on every paginated table.
    if _is_repeated_header_row(cells):
        return {"_state_industry": current_industry, "_state_company": current_company, "_emit": False}
    if not any(cells):
        return {"_state_industry": current_industry, "_state_company": current_company, "_emit": False}

    # Industry banner row?
    ind = _is_industry_header(cells)
    if ind is not None:
        return {"_state_industry": ind, "_state_company": current_company, "_emit": False}

    # Read cell-0; if non-empty, it's a new company (else continuation tranche).
    cell0 = cells[0] if len(cells) > 0 else ""
    if cell0:
        current_company = _strip_footnotes(cell0)

    # Cell 4 must hold an investment type for this to be an investment row.
    cell4 = cells[4] if len(cells) > 4 else ""
    if not cell4:
        # Subtotal / blank / spacer row — skip silently.
        return {"_state_industry": current_industry, "_state_company": current_company, "_emit": False}

    investment_type = _strip_footnotes(cell4)
    coupon_text = cells[6] if len(cells) > 6 else ""
    reference = cells[7] if len(cells) > 7 else ""
    spread = cells[8] if len(cells) > 8 else ""
    maturity = cells[12] if len(cells) > 12 else ""

    # Human-readable interest rate string preserves all source detail.
    rate_parts: list[str] = []
    if coupon_text:
        rate_parts.append(coupon_text)
    if reference and spread:
        rate_parts.append(f"{reference} + {spread}")
    elif reference:
        rate_parts.append(reference)
    interest_rate_text = " | ".join(rate_parts) if rate_parts else None

    # Coupon shape: '9.45 % ( 2.88 % PIK)' — first % is all-in rate, inner is PIK.
    is_pik = "PIK" in (coupon_text or "")
    pik_rate_pct: float | None = None
    if is_pik:
        m = re.search(r"([\d.]+)\s*%\s*PIK", coupon_text)
        if m:
            pik_rate_pct = _to_number(m.group(1))
    first_pct = re.search(r"([\d.]+)\s*%", coupon_text or "")
    interest_rate_pct = _to_number(first_pct.group(1)) if first_pct else None

    maturity_date = _maturity_to_iso(maturity)

    # Numeric tail of the row.
    tail_nums = _extract_numbers_after(cells, 14)
    principal_amount: float | None = None
    cost: float | None = None
    fair_value: float | None = None

    if interest_rate_pct is not None:
        # Loan-shaped row → (principal, cost, fair_value).
        if len(tail_nums) >= 3:
            principal_amount, cost, fair_value = tail_nums[0], tail_nums[1], tail_nums[2]
        elif len(tail_nums) == 2:
            # Some preferred-equity-with-coupon rows surface only 2 numbers.
            cost, fair_value = tail_nums[0], tail_nums[1]
        else:
            # Zero-funded commitment (revolver / delayed-draw with em-dash
            # placeholders) — leave numeric fields as None. This is expected
            # in ARCC SoIs and isn't a parse error.
            logger.debug(
                "Row %d (%s): zero-funded loan commitment, no numeric tail.",
                r_idx, current_company,
            )
    else:
        # Equity row → cost + fair_value (shares ignored as a value field).
        if len(tail_nums) >= 2:
            cost, fair_value = tail_nums[-2], tail_nums[-1]

    # Accrual status from footnotes attached to the row.
    footnotes = _row_footnotes(row)
    accrual_status = "non_accrual" if "8" in footnotes else "accrual"

    if current_company is None:
        logger.warning(
            "Row %d has investment data but no company context; skipping.", r_idx,
        )
        return {"_state_industry": current_industry, "_state_company": current_company, "_emit": False}

    record = {
        "portfolio_company_raw": current_company,
        "industry": current_industry,
        "investment_type": investment_type,
        "interest_rate_text": interest_rate_text,
        "interest_rate_pct": interest_rate_pct,
        "pik_rate_pct": pik_rate_pct,
        "maturity_date": maturity_date,
        "principal_amount": principal_amount,
        "cost": cost,
        "fair_value": fair_value,
        "accrual_status": accrual_status,
        "is_pik": is_pik,
    }
    return {
        "_state_industry": current_industry,
        "_state_company": current_company,
        "_emit": True,
        "_record": record,
    }
