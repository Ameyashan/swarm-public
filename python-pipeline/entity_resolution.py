"""Entity resolution for portfolio companies across BDC funds.

Different BDCs spell the same borrower differently:
    "Acme Corporation"
    "Acme Corp"
    "Acme Corp., Inc."

This module collapses those variants to a canonical name so the Cross-Fund
Divergence view can group holdings of the same underlying borrower.

Pipeline:
    1. ``normalize_name(raw)`` lowercases, strips punctuation, drops common
       legal-entity suffixes, collapses whitespace -> opaque key.
    2. ``build_canonical_table()`` reads every distinct ``portfolio_company_raw``
       from ``observations``, groups by normalized key, picks the most common
       original spelling per group as ``canonical_name``, and upserts groups
       with 2+ variants into ``borrower_canonical``.
    3. ``update_observations_canonical(mapping)`` writes the canonical name
       back to ``observations.portfolio_company_canonical`` in batches of 500.

CLI entry point at the bottom runs the full pipeline and prints the report
the user asked for: distinct raw count, canonical count, top 20 by fund span.

Design notes / non-goals:
    * Pure rule-based normalization. No fuzzy matching, no embeddings. Two
      raw names collapse iff their normalized keys are byte-identical.
    * "&" and "and" both fold to "and" so "Smith & Co" == "Smith and Company".
    * We deliberately do NOT strip "Holdings" / "Group" / "Co" mid-token --
      only when they appear as trailing legal-entity tags. "Holdings" inside
      "Apple Bidco Holdings, Inc." is part of the entity name and is stripped;
      "Holdings" in "Holdings Industries Inc." (hypothetical leading) would
      be preserved by the leading-token guard.
    * Borrowers represented as "X and Y" co-borrower constructions are kept
      as-is -- they're a distinct legal exposure, not the same borrower.
    * Single-variant groups (no spelling collapse needed) are still mapped
      raw -> canonical (canonical == raw), so every observation gets a
      canonical value, but they are NOT inserted into ``borrower_canonical``
      per the user spec ("groups with 2+ variations").
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import sys
from collections import Counter, defaultdict
from typing import Dict, Iterable, List, Optional, Tuple

from dotenv import load_dotenv
from supabase import Client, create_client

logger = logging.getLogger("entity_resolution")

# ---------------------------------------------------------------------------
# Normalization
# ---------------------------------------------------------------------------

# Trailing legal-entity tokens stripped during normalization.
# Order doesn't matter; we strip iteratively until no more match.
# Each token is matched as a whole word at the end of the string after
# punctuation-stripping. We keep the canonical token forms here in lowercase.
_SUFFIX_TOKENS = {
    "inc",
    "incorporated",
    "corp",
    "corporation",
    "company",
    "co",
    "llc",
    "llp",
    "lp",
    "lllp",
    "ltd",
    "limited",
    "plc",
    "sa",
    "ag",
    "nv",
    "bv",
    "gmbh",
    "sarl",
    "spa",
    "holdings",
    "holding",
    "group",
}

# Punctuation we replace with whitespace before tokenizing.
# Note: we keep "&" -> " and " as a special case BEFORE punctuation stripping.
_PUNCT_RE = re.compile(r"[^\w\s]", re.UNICODE)
_WS_RE = re.compile(r"\s+")


def normalize_name(raw_name: Optional[str]) -> str:
    """Reduce a raw portfolio-company string to a canonical comparison key.

    Steps:
        1. Lowercase.
        2. Replace "&" with " and " (so "Smith & Co" == "Smith and Company").
        3. Strip all punctuation (commas, periods, slashes, parens, etc).
        4. Collapse whitespace.
        5. Iteratively strip trailing legal-entity suffix tokens
           (inc, corp, llc, lp, ltd, holdings, group, co, ...).
        6. Collapse whitespace one more time.

    Returns an empty string for empty/None input. Never raises.

    Examples:
        >>> normalize_name("Acme Corporation")
        'acme'
        >>> normalize_name("Acme Corp., Inc.")
        'acme'
        >>> normalize_name("Smith & Co.")
        'smith and'
        >>> normalize_name("Apple Bidco Holdings, Inc.")
        'apple bidco'
    """
    if not raw_name:
        return ""

    s = raw_name.lower()
    # & -> and (do this before punctuation strip so "&" doesn't vanish).
    s = s.replace("&", " and ")
    # Strip all punctuation -> spaces.
    s = _PUNCT_RE.sub(" ", s)
    # Collapse whitespace.
    s = _WS_RE.sub(" ", s).strip()

    if not s:
        return ""

    # Iteratively strip trailing suffix tokens. A multi-token name like
    # "acme holdings inc" should collapse to "acme" by peeling
    # "inc" then "holdings".
    tokens = s.split(" ")
    # Don't strip if the entire string IS a suffix token -- otherwise
    # "Holdings Inc." (a hypothetical name) would normalize to "".
    while len(tokens) > 1 and tokens[-1] in _SUFFIX_TOKENS:
        tokens.pop()

    return " ".join(tokens).strip()


# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------


def _get_supabase() -> Client:
    """Build a service-role Supabase client. Loads ``../.env.local`` if needed."""
    if "NEXT_PUBLIC_SUPABASE_URL" not in os.environ:
        # ingest.py loads this from ../.env.local relative to python-pipeline/
        load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env.local"))
    url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)


def _fetch_all_raw_names(sb: Client, page_size: int = 1000) -> List[Tuple[str, str]]:
    """Page through observations and return [(raw_name, fund_ticker), ...].

    PostgREST has no DISTINCT operator, so we pull every row's raw name and
    ticker. ``observations`` has tens of thousands of rows -- well within
    a single-process page-through (a few seconds).
    """
    all_rows: List[Tuple[str, str]] = []
    start = 0
    while True:
        end = start + page_size - 1
        res = (
            sb.table("observations")
            .select("portfolio_company_raw, fund_ticker")
            .range(start, end)
            .execute()
        )
        batch = res.data or []
        if not batch:
            break
        for r in batch:
            raw = r.get("portfolio_company_raw")
            tic = r.get("fund_ticker")
            if raw:
                all_rows.append((raw, tic or ""))
        if len(batch) < page_size:
            break
        start += page_size
    return all_rows


# ---------------------------------------------------------------------------
# Build canonical table
# ---------------------------------------------------------------------------


def build_canonical_table(
    sb: Optional[Client] = None,
    *,
    write: bool = True,
) -> Dict[str, str]:
    """Group raw names by normalize_name() and pick a canonical spelling.

    Args:
        sb: Optional Supabase client. Built from env if not provided.
        write: If False, skip the borrower_canonical upserts (dry-run).

    Returns:
        Dict mapping every distinct ``portfolio_company_raw`` value to its
        chosen canonical spelling. Single-variant groups map raw -> raw.
    """
    if sb is None:
        sb = _get_supabase()

    # Fetch all raw values + their fund tickers (for stats; not used for keying).
    rows = _fetch_all_raw_names(sb)
    logger.info("Loaded %d observation rows from Supabase", len(rows))

    # Count occurrences of each (raw_name) so we can pick the "most common
    # original spelling" within each normalized group.
    raw_counts: Counter = Counter()
    for raw, _tic in rows:
        raw_counts[raw] += 1

    distinct_raw = list(raw_counts.keys())
    logger.info("Distinct raw names: %d", len(distinct_raw))

    # Group by normalized key. Empty-key rows (raw normalizes to "") are
    # passed through 1:1 -- we will not collapse them.
    groups: Dict[str, List[str]] = defaultdict(list)
    passthrough: List[str] = []
    for raw in distinct_raw:
        key = normalize_name(raw)
        if not key:
            passthrough.append(raw)
        else:
            groups[key].append(raw)

    # Pick canonical per group: the raw spelling with the highest
    # observation count (most common in the data). Ties broken by
    # lexicographic order for determinism.
    raw_to_canonical: Dict[str, str] = {}
    multi_variant_groups: List[Tuple[str, List[str]]] = []  # (canonical, alternates)

    for _key, variants in groups.items():
        if len(variants) == 1:
            only = variants[0]
            raw_to_canonical[only] = only
            continue
        # Most common spelling wins. Counter.most_common is by-insertion
        # for ties, so we sort ourselves for determinism.
        variants_sorted = sorted(
            variants,
            key=lambda v: (-raw_counts[v], v),
        )
        canonical = variants_sorted[0]
        alternates = [v for v in variants_sorted if v != canonical]
        for v in variants:
            raw_to_canonical[v] = canonical
        multi_variant_groups.append((canonical, alternates))

    for raw in passthrough:
        raw_to_canonical[raw] = raw

    logger.info(
        "Canonical names: %d (collapsed %d multi-variant groups)",
        len(set(raw_to_canonical.values())),
        len(multi_variant_groups),
    )

    if write and multi_variant_groups:
        _upsert_canonical_rows(sb, multi_variant_groups)

    return raw_to_canonical


def _upsert_canonical_rows(
    sb: Client,
    groups: List[Tuple[str, List[str]]],
    *,
    batch_size: int = 200,
) -> None:
    """Upsert (canonical_name, alternate_names[]) into borrower_canonical.

    Idempotent: re-running overwrites alternate_names with the latest set.
    """
    payload = [
        {"canonical_name": canonical, "alternate_names": alternates}
        for canonical, alternates in groups
    ]
    inserted = 0
    for i in range(0, len(payload), batch_size):
        chunk = payload[i : i + batch_size]
        sb.table("borrower_canonical").upsert(
            chunk, on_conflict="canonical_name"
        ).execute()
        inserted += len(chunk)
        logger.info(
            "Upserted %d / %d borrower_canonical rows",
            inserted,
            len(payload),
        )


# ---------------------------------------------------------------------------
# Update observations
# ---------------------------------------------------------------------------


def update_observations_canonical(
    mapping: Dict[str, str],
    sb: Optional[Client] = None,
    *,
    batch_size: int = 500,
) -> int:
    """Write portfolio_company_canonical to observations rows.

    For each distinct raw_name, issues a single UPDATE setting
    portfolio_company_canonical = <canonical> for all rows with that raw name.
    Batches the distinct (raw, canonical) pairs into chunks of ``batch_size``
    so we don't hold a giant transaction open.

    Returns the number of distinct raw_name groups updated.
    """
    if sb is None:
        sb = _get_supabase()

    # Update one raw_name -> canonical at a time. Each call is itself a
    # bulk UPDATE on the observations table (Supabase ``eq`` filter), so
    # the wire-call count is bounded by the number of distinct raw names,
    # not the number of observation rows. The batch_size controls how
    # often we log progress / yield.
    items = sorted(mapping.items())
    total = len(items)
    logger.info(
        "Updating portfolio_company_canonical across %d distinct raw names",
        total,
    )

    done = 0
    for start in range(0, total, batch_size):
        chunk = items[start : start + batch_size]
        for raw, canonical in chunk:
            sb.table("observations").update(
                {"portfolio_company_canonical": canonical}
            ).eq("portfolio_company_raw", raw).execute()
        done += len(chunk)
        logger.info("  updated %d / %d raw-name groups", done, total)

    return total


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def _report_top_borrowers_by_fund_span(sb: Client, limit: int = 20) -> None:
    """Print top N canonical borrowers ranked by # of distinct fund_tickers.

    Reads observations after canonical column has been written.
    """
    # Page through observations and build (canonical -> set(fund_ticker)).
    spans: Dict[str, set] = defaultdict(set)
    occurrences: Counter = Counter()
    start = 0
    page_size = 1000
    while True:
        end = start + page_size - 1
        res = (
            sb.table("observations")
            .select("portfolio_company_canonical, fund_ticker")
            .range(start, end)
            .execute()
        )
        batch = res.data or []
        if not batch:
            break
        for r in batch:
            canon = r.get("portfolio_company_canonical")
            tic = r.get("fund_ticker")
            if canon and tic:
                spans[canon].add(tic)
                occurrences[canon] += 1
        if len(batch) < page_size:
            break
        start += page_size

    ranked = sorted(
        spans.items(),
        key=lambda kv: (-len(kv[1]), -occurrences[kv[0]], kv[0]),
    )[:limit]

    print()
    print(f"Top {limit} borrowers by # of funds holding them:")
    print(f"  {'#funds':>6}  {'#obs':>6}  borrower")
    print(f"  {'-'*6}  {'-'*6}  {'-'*60}")
    for canon, funds in ranked:
        print(f"  {len(funds):>6}  {occurrences[canon]:>6}  {canon}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: Optional[Iterable[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build mapping and print stats; do NOT write to Supabase.",
    )
    parser.add_argument(
        "--skip-update",
        action="store_true",
        help="Build + upsert borrower_canonical, but skip the observations "
        "UPDATE step. Useful when you only want to refresh the dictionary.",
    )
    parser.add_argument(
        "--top",
        type=int,
        default=20,
        help="Top N borrowers to report by fund span (default: 20).",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
    )

    sb = _get_supabase()

    mapping = build_canonical_table(sb, write=not args.dry_run)

    distinct_raw = len(mapping)
    distinct_canonical = len(set(mapping.values()))
    collapsed = distinct_raw - distinct_canonical

    print()
    print("=" * 64)
    print("Entity resolution summary")
    print("=" * 64)
    print(f"  Distinct raw names:        {distinct_raw}")
    print(f"  Distinct canonical names:  {distinct_canonical}")
    print(f"  Variants collapsed:        {collapsed}")

    if not args.dry_run and not args.skip_update:
        update_observations_canonical(mapping, sb)
        _report_top_borrowers_by_fund_span(sb, limit=args.top)
    else:
        print()
        print("(skip-update or dry-run: observations.portfolio_company_canonical "
              "not written -- top-borrowers report needs canonical column.)")

    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
