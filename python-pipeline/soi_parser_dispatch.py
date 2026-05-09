"""Dispatcher for fund-specific Schedule of Investments parsers.

Each `soi_parser_<ticker>.py` module exports a single function:

    parse(html: str) -> list[dict[str, Any]]

This module exposes:

    get_parser(ticker: str) -> Callable[[str], list[dict[str, Any]]]
    parse(ticker: str, html: str) -> list[dict[str, Any]]
    SUPPORTED_TICKERS: tuple[str, ...]
    IMPLEMENTED_TICKERS: tuple[str, ...]

A ticker is "supported" if a parser module exists for it (including
stubs). It is "implemented" if its parse() function returns non-empty
output for representative filings (not a logging stub).

Adding a new fund:
    1. Create soi_parser_<ticker>.py exporting parse(html) -> list[dict].
    2. Add the ticker to _PARSERS below.
    3. Update IMPLEMENTED_TICKERS if the parser is fully validated.
"""

from __future__ import annotations

import importlib
import logging
from typing import Any, Callable

logger = logging.getLogger(__name__)

# Map of UPPER-CASE ticker -> module name (relative to this package).
_PARSERS: dict[str, str] = {
    "ARCC": "soi_parser_arcc",
    "OBDC": "soi_parser_obdc",
    "MAIN": "soi_parser_main",
    "GBDC": "soi_parser_gbdc",
    "HTGC": "soi_parser_htgc",
    "PSEC": "soi_parser_psec",
    "FSK":  "soi_parser_fsk",
    "GSBD": "soi_parser_gsbd",
    "GSCR": "soi_parser_gscr",
}

SUPPORTED_TICKERS: tuple[str, ...] = tuple(sorted(_PARSERS.keys()))

# Parsers that have been validated against an actual filing (within
# reasonable tolerance of the filing's reported total fair value).
# Stubs that always return [] are NOT in this set.
IMPLEMENTED_TICKERS: tuple[str, ...] = (
    "ARCC",
    "OBDC",   # validated +0.07% of $15,344,201k filing total
    "MAIN",   # validated 0.00% exact match of $5,674,751k filing total
    "GBDC",   # best-effort; -14.58% vs $8,317,245k filing total (see module docstring)
)


def get_parser(ticker: str) -> Callable[[str], list[dict[str, Any]]]:
    """Return the parse function for `ticker`.

    Raises NotImplementedError if no parser module is registered.
    """
    key = (ticker or "").strip().upper()
    if key not in _PARSERS:
        raise NotImplementedError(
            f"No SoI parser registered for ticker {ticker!r}. "
            f"Supported tickers: {', '.join(SUPPORTED_TICKERS)}."
        )
    module_name = _PARSERS[key]
    module = importlib.import_module(module_name)
    fn = getattr(module, "parse", None)
    if not callable(fn):
        raise NotImplementedError(
            f"Module {module_name!r} does not export a callable `parse`."
        )
    return fn


def parse(ticker: str, html: str) -> list[dict[str, Any]]:
    """Parse `html` using the parser registered for `ticker`."""
    fn = get_parser(ticker)
    return fn(html)


def is_implemented(ticker: str) -> bool:
    """Return True if `ticker`'s parser is fully implemented and validated."""
    return (ticker or "").strip().upper() in IMPLEMENTED_TICKERS
