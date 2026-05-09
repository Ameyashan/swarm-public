"""Shared helpers for SoI (Schedule of Investments) parsers.

The per-fund parser files import from here so we only fix bugs in one place.
"""

from __future__ import annotations

import re
import warnings
from typing import Any, Iterable

from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning

# All BDC inline-XBRL filings parse fine with the lxml HTML parser.
warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

# Footnote markers like "(8)" or "(2)(8)" or "(13a)".
FOOTNOTE_RE = re.compile(r"\((\d+[a-z]?)\)")
PCT_RE = re.compile(r"-?\d+\.?\d*\s*%")
DATE_MM_YYYY_RE = re.compile(r"\s*(\d{1,2})\s*/\s*(\d{4})\s*$")
DATE_M_D_YYYY_RE = re.compile(r"\s*(\d{1,2})\s*/\s*(\d{1,2})\s*/\s*(\d{4})\s*$")


def to_number(raw: str | None) -> float | None:
    """Parse a financial number. Strips $, commas, whitespace.
    Treats parens as negative (accounting convention).
    Returns None if not parseable.
    """
    if raw is None:
        return None
    s = raw.strip()
    if not s or s in {"$", "—", "-", "–", "*", "n/a", "N/A"}:
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


def to_pct(raw: str | None) -> float | None:
    """Parse a percentage like '8.66 %' or '12.36%'  → 8.66 / 12.36."""
    if raw is None:
        return None
    cleaned = raw.replace(",", "").strip()
    m = re.search(r"-?\d+\.?\d*", cleaned)
    if not m:
        return None
    try:
        return float(m.group())
    except ValueError:
        return None


def maturity_to_iso(raw: str | None) -> str | None:
    """Convert 'MM/YYYY' or 'MM/DD/YYYY' to ISO date.

    For MM/YYYY we pin to the first day of the month (EDGAR is month-precision).
    """
    if not raw:
        return None
    text = raw.strip()
    m = DATE_M_D_YYYY_RE.match(text)
    if m:
        month, day, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= month <= 12 and 1 <= day <= 31:
            return f"{year:04d}-{month:02d}-{day:02d}"
    m = DATE_MM_YYYY_RE.match(text)
    if m:
        month, year = int(m.group(1)), int(m.group(2))
        if 1 <= month <= 12:
            return f"{year:04d}-{month:02d}-01"
    return None


def cell_texts(row) -> list[str]:
    """Return raw <td>/<th> texts in DOM order. Preserves empty cells."""
    return [c.get_text(" ", strip=True) for c in row.find_all(["td", "th"])]


def row_footnotes(row_or_text) -> set[str]:
    """All footnote markers in a row, returned as a set of strings."""
    if hasattr(row_or_text, "get_text"):
        text = row_or_text.get_text(" ", strip=True)
    else:
        text = row_or_text or ""
    return set(FOOTNOTE_RE.findall(text))


def strip_footnotes(s: str | None) -> str | None:
    if s is None:
        return None
    cleaned = FOOTNOTE_RE.sub("", s).strip()
    return cleaned or None


def is_blank_row(cells: list[str]) -> bool:
    return not any(c.strip() for c in cells)


def cell_has_text(cells: list[str], idx: int) -> bool:
    return idx < len(cells) and bool(cells[idx].strip())


def find_tables_with_header(
    soup: BeautifulSoup,
    *,
    required_tokens: Iterable[str],
    max_header_rows: int = 4,
) -> list:
    """Find <table>s whose first few rows contain ALL `required_tokens`.

    Returns the contiguous *first* block of such tables (subsequent blocks are
    typically prior-period repeats). Tokens are matched case-sensitively as
    substrings of joined row text.
    """
    tokens = list(required_tokens)
    candidates = []
    for t in soup.find_all("table"):
        head_text = " ".join(
            r.get_text(" ", strip=True)
            for r in t.find_all("tr")[:max_header_rows]
        )
        if all(tok in head_text for tok in tokens):
            candidates.append(t)
    return candidates


def first_contiguous_block(soup: BeautifulSoup, predicate) -> list:
    """Walk all <table>s in document order, collecting the first contiguous run
    where `predicate(table)` is True. Stops at the first False after the run
    has started. This is how ARCC's paginated SoI is identified.
    """
    block: list = []
    started = False
    for t in soup.find_all("table"):
        if predicate(t):
            block.append(t)
            started = True
        elif started:
            break
    return block


def emit_record(
    *,
    company: str | None,
    industry: str | None,
    investment_type: str | None,
    interest_rate_text: str | None = None,
    interest_rate_pct: float | None = None,
    pik_rate_pct: float | None = None,
    is_pik: bool = False,
    maturity_date: str | None = None,
    principal_amount: float | None = None,
    cost: float | None = None,
    fair_value: float | None = None,
    accrual_status: str = "accrual",
) -> dict[str, Any]:
    """Build the canonical observation dict the ingest pipeline expects.

    Centralizing this means schema drift is impossible across parsers.
    """
    return {
        "portfolio_company_raw": company,
        "industry": industry,
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


def extract_numeric_columns(
    cells: list[str],
    *,
    min_idx: int = 0,
) -> list[tuple[int, float]]:
    """Return (cell_idx, numeric_value) pairs for cells[min_idx:] that parse
    as numbers. Skips $ markers, footnotes-only cells, and percentages.
    Useful for "find the 3 numeric columns from the right" heuristics.
    """
    out: list[tuple[int, float]] = []
    for i in range(min_idx, len(cells)):
        c = cells[i]
        if not c or c == "$":
            continue
        if FOOTNOTE_RE.fullmatch(c):
            continue
        if "%" in c:
            continue
        stripped = FOOTNOTE_RE.sub("", c).strip()
        if not stripped:
            continue
        n = to_number(stripped)
        if n is not None:
            out.append((i, n))
    return out


# Currency / spacer markers that occupy a cell but don't constitute a value
# slot. Em-dash, en-dash, hyphen, asterisk are sentinels for "intentionally
# blank — this column has no value for this row" — they DO count as slots.
_VALUE_SLOT_SENTINELS = {"\u2014", "\u2013", "-", "*", "N/A", "n/a"}
_SPACER_CELLS = {"", "$", "\u00a3", "\u20ac", "\u00a5", "\u20a3"}  # $ £ € ¥ ₣


def extract_value_slots(
    cells: list[str],
    *,
    min_idx: int = 0,
    skip_pct_tail: bool = True,
) -> list[tuple[int, float | None]]:
    """Return ordered (cell_idx, value-or-None) tuples for cells representing
    a numeric "slot" — a column position whose content is either a number
    OR an explicit em-dash ("\u2014") meaning intentionally blank.

    This is the robust way to anchor (par, cost, fair_value) extraction:
    take the LAST 3 entries returned. An em-dash slot maps to None.

    Skips:
      - empty cells (HTML spacing)
      - currency markers ($, \u00a3, \u20ac)
      - footnote-only cells like "(8)"
      - if `skip_pct_tail`: a trailing pair of cells that look like "x.x" + "%"
        (industry-percent-of-NAV column) is dropped from consideration.
    """
    # First pass: identify cell indices that should be treated as part of a
    # "% NAV" pair — some funds (e.g. GBDC) split a percentage into
    # `[<number>, '%']` two-cell pair where the number alone has no sign.
    pct_pair_idx: set[int] = set()
    for i in range(min_idx, len(cells)):
        c = cells[i].strip() if cells[i] else ""
        if c == "%":
            # Walk back to nearest non-empty / non-spacer cell.
            j = i - 1
            while j >= min_idx and (not cells[j].strip() or cells[j].strip() in _SPACER_CELLS):
                j -= 1
            if j >= min_idx:
                cj = cells[j].strip()
                if cj and to_number(cj) is not None and "%" not in cj:
                    pct_pair_idx.add(j)

    # Scan all candidate slot cells.
    raw: list[tuple[int, float | None]] = []
    for i in range(min_idx, len(cells)):
        c = cells[i].strip() if cells[i] else ""
        if c in _SPACER_CELLS:
            continue
        if FOOTNOTE_RE.fullmatch(c):
            continue
        if c in _VALUE_SLOT_SENTINELS:
            raw.append((i, None))
            continue
        if "%" in c:
            # Percentage cells are NOT value slots (they're rate/NAV columns).
            continue
        if i in pct_pair_idx:
            continue
        stripped = FOOTNOTE_RE.sub("", c).strip()
        if not stripped:
            continue
        n = to_number(stripped)
        if n is not None:
            raw.append((i, n))
        # else: text we don't recognize — ignore
    return raw


def extract_combined_rate(
    *,
    cash_rate: str | None = None,
    pik_rate: str | None = None,
    ref_rate: str | None = None,
    spread: str | None = None,
    all_in_rate: str | None = None,
) -> tuple[str | None, float | None, float | None, bool]:
    """Build (interest_rate_text, interest_rate_pct, pik_rate_pct, is_pik).

    Some funds split coupon into separate cash/PIK/spread/floor cells; this
    consolidates them into the canonical dict shape.
    """
    parts: list[str] = []
    if all_in_rate:
        parts.append(all_in_rate.strip())
    if cash_rate and cash_rate not in parts:
        parts.append(f"Cash: {cash_rate.strip()}")
    if pik_rate:
        parts.append(f"PIK: {pik_rate.strip()}")
    if ref_rate or spread:
        ref = (ref_rate or "").strip()
        sp = (spread or "").strip()
        if ref and sp:
            parts.append(f"{ref} {sp}".strip())
        elif ref:
            parts.append(ref)
        elif sp:
            parts.append(sp)

    text = " | ".join(p for p in parts if p) or None

    is_pik = bool(pik_rate and to_pct(pik_rate) is not None) or "PIK" in (text or "")
    pik_pct = to_pct(pik_rate) if pik_rate else None
    if is_pik and pik_pct is None:
        m = re.search(r"([\d.]+)\s*%\s*PIK", text or "")
        if m:
            pik_pct = to_number(m.group(1))

    main_pct = to_pct(all_in_rate) if all_in_rate else to_pct(cash_rate) if cash_rate else None

    return text, main_pct, pik_pct, is_pik
