"""Thin client for SEC EDGAR.

Hits the JSON submissions feed for a CIK and downloads filing HTML. Respects
SEC's 10-requests-per-second rate limit and sends a descriptive User-Agent on
every request, as required by EDGAR access guidelines.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import requests

from config import ARCHIVES_BASE, EDGAR_BASE, USER_AGENT

logger = logging.getLogger(__name__)

# SEC limit is 10 req/sec. We pace at ~7 req/sec to leave headroom.
_MIN_INTERVAL_SEC = 0.15
_last_request_at: float = 0.0


def _throttle() -> None:
    """Sleep so successive requests honor the SEC rate limit."""
    global _last_request_at
    elapsed = time.monotonic() - _last_request_at
    if elapsed < _MIN_INTERVAL_SEC:
        time.sleep(_MIN_INTERVAL_SEC - elapsed)
    _last_request_at = time.monotonic()


def _headers() -> dict[str, str]:
    return {
        "User-Agent": USER_AGENT,
        "Accept-Encoding": "gzip, deflate",
        "Host": None,  # set per-request below
    }


def _get(url: str, *, accept: str = "application/json") -> requests.Response:
    _throttle()
    headers = {
        "User-Agent": USER_AGENT,
        "Accept-Encoding": "gzip, deflate",
        "Accept": accept,
    }
    resp = requests.get(url, headers=headers, timeout=30)
    resp.raise_for_status()
    return resp


def _normalize_cik(cik: str) -> str:
    """SEC submission feed expects 10-digit zero-padded CIK."""
    digits = "".join(c for c in str(cik) if c.isdigit())
    return digits.zfill(10)


def get_recent_filings(
    cik: str,
    filing_type: str | tuple[str, ...] = "10-Q",
    limit: int = 10,
) -> list[dict[str, Any]]:
    """Return up to ``limit`` most recent filings of ``filing_type`` for ``cik``.

    Each result is a dict with keys:
        accession_number, filing_date, period_of_report, primary_document, form

    ``filing_type`` may be a single form string (e.g. ``"10-Q"``) or a tuple
    (e.g. ``("10-Q", "10-K")``). Filings are returned newest-first.
    """
    cik_padded = _normalize_cik(cik)
    url = f"{EDGAR_BASE}/submissions/CIK{cik_padded}.json"
    resp = _get(url, accept="application/json")
    data = resp.json()

    recent = data.get("filings", {}).get("recent", {})
    forms = recent.get("form", [])
    accessions = recent.get("accessionNumber", [])
    filing_dates = recent.get("filingDate", [])
    period_dates = recent.get("reportDate", [])
    primary_docs = recent.get("primaryDocument", [])

    if isinstance(filing_type, str):
        wanted = {filing_type}
    else:
        wanted = set(filing_type)

    out: list[dict[str, Any]] = []
    for i, form in enumerate(forms):
        if form not in wanted:
            continue
        out.append(
            {
                "form": form,
                "accession_number": accessions[i],
                "filing_date": filing_dates[i],
                "period_of_report": period_dates[i] or None,
                "primary_document": primary_docs[i],
            }
        )
        if len(out) >= limit:
            break
    return out


def get_filing_html(cik: str, accession_number: str, primary_document: str) -> str:
    """Fetch the primary HTML document for a filing.

    Builds the canonical Archives URL:
        https://www.sec.gov/Archives/edgar/data/{cik_int}/{accession_no_dashes}/{primary_document}
    """
    cik_int = str(int(_normalize_cik(cik)))  # strip leading zeros for path
    accession_no_dashes = accession_number.replace("-", "")
    url = (
        f"{ARCHIVES_BASE}/edgar/data/{cik_int}/"
        f"{accession_no_dashes}/{primary_document}"
    )
    resp = _get(url, accept="text/html")
    return resp.text


def filing_doc_url(cik: str, accession_number: str, primary_document: str) -> str:
    """Compute the canonical primary-document URL without fetching it."""
    cik_int = str(int(_normalize_cik(cik)))
    accession_no_dashes = accession_number.replace("-", "")
    return (
        f"{ARCHIVES_BASE}/edgar/data/{cik_int}/"
        f"{accession_no_dashes}/{primary_document}"
    )
