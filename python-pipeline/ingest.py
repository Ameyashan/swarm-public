"""Orchestrator: pull recent BDC 10-Q + 10-K filings from EDGAR, parse the
Schedule of Investments via the per-fund dispatcher, and persist filings +
observations into Supabase.

Usage:
    python ingest.py                  # ingest 8 most recent of each form for ALL funds
    python ingest.py --dry-run        # parse and report; do not write to Supabase
    python ingest.py --tickers ARCC OBDC   # limit to specific tickers
    python ingest.py --per-form 4     # override filings-per-form

Environment variables (loaded from ../.env.local):
    NEXT_PUBLIC_SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY  (bypasses RLS for inserts)
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import traceback
from collections import defaultdict
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from supabase import Client, create_client

import edgar_client
import soi_parser_dispatch as dispatch

# ---- Setup -----------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("ingest")

REPO_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(REPO_ROOT / ".env.local")

DEFAULT_FILINGS_PER_FORM = 8


def _supabase_client() -> Client:
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError(
            "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and "
            "SUPABASE_SERVICE_ROLE_KEY in .env.local."
        )
    return create_client(url, key)


def _load_funds(sb: Client | None, tickers_filter: list[str] | None) -> list[dict[str, Any]]:
    """Load funds from Supabase or fall back to dispatcher's supported list.

    When `sb` is None (dry-run with no DB access) we still need CIKs, so we
    require a live Supabase connection to discover funds. The tickers_filter
    is applied case-insensitively.
    """
    if sb is None:
        raise RuntimeError(
            "Loading funds requires a Supabase connection. Pass --dry-run "
            "with credentials available, or remove --dry-run."
        )
    res = sb.table("funds").select("*").execute()
    funds = res.data or []
    if tickers_filter:
        wanted = {t.upper() for t in tickers_filter}
        funds = [f for f in funds if f["ticker"].upper() in wanted]
    return funds


def _filing_already_ingested(sb: Client, accession_number: str) -> bool:
    res = (
        sb.table("filings")
        .select("id")
        .eq("accession_number", accession_number)
        .limit(1)
        .execute()
    )
    return bool(res.data)


def _insert_filing(
    sb: Client,
    *,
    fund_ticker: str,
    filing_type: str,
    filing_date: str,
    period_end: str | None,
    accession_number: str,
    primary_doc_url: str,
    parse_status: str,
    parse_method: str,
) -> str | None:
    res = (
        sb.table("filings")
        .insert(
            {
                "fund_ticker": fund_ticker,
                "filing_type": filing_type,
                "filing_date": filing_date,
                "period_end": period_end,
                "accession_number": accession_number,
                "primary_doc_url": primary_doc_url,
                "parse_status": parse_status,
                "parse_method": parse_method,
            }
        )
        .execute()
    )
    if not res.data:
        logger.error("Insert into filings returned no rows for %s", accession_number)
        return None
    return res.data[0]["id"]


def _update_filing_status(
    sb: Client, filing_id: str, *, parse_status: str
) -> None:
    sb.table("filings").update({"parse_status": parse_status}).eq(
        "id", filing_id
    ).execute()


def _bulk_insert_observations(
    sb: Client,
    *,
    filing_id: str,
    fund_ticker: str,
    period_end: str | None,
    primary_doc_url: str,
    records: list[dict[str, Any]],
) -> int:
    if not records:
        return 0
    payload = [
        {
            "filing_id": filing_id,
            "fund_ticker": fund_ticker,
            "period_end": period_end,
            "portfolio_company_raw": r["portfolio_company_raw"],
            "industry": r["industry"],
            "investment_type": r["investment_type"],
            "interest_rate_text": r["interest_rate_text"],
            "interest_rate_pct": r["interest_rate_pct"],
            "pik_rate_pct": r["pik_rate_pct"],
            "maturity_date": r["maturity_date"],
            "principal_amount": r["principal_amount"],
            "cost": r["cost"],
            "fair_value": r["fair_value"],
            "accrual_status": r["accrual_status"],
            "is_pik": r["is_pik"],
            "source_page_url": primary_doc_url,
            "parse_confidence": "auto",
        }
        for r in records
    ]
    inserted = 0
    chunk_size = 500
    for i in range(0, len(payload), chunk_size):
        chunk = payload[i : i + chunk_size]
        res = sb.table("observations").insert(chunk).execute()
        inserted += len(res.data or [])
    return inserted


# ---- Per-fund processing ---------------------------------------------------


def _process_fund(
    *,
    fund: dict[str, Any],
    sb: Client | None,
    dry_run: bool,
    filings_per_form: int,
) -> dict[str, Any]:
    """Process one fund. Returns a per-fund summary dict.

    Continues on per-filing failures (network, parse, insert). Skips the
    fund entirely only when no parser is registered for the ticker.
    """
    ticker = fund["ticker"].upper()
    cik = fund["cik"]
    summary: dict[str, Any] = {
        "ticker": ticker,
        "cik": cik,
        "candidates": 0,
        "skipped_existing": 0,
        "ingested": 0,
        "observations": 0,
        "failures": [],
        "parser_implemented": dispatch.is_implemented(ticker),
    }

    # Ensure parser exists. If not, mark the entire fund as failure but
    # don't crash.
    try:
        parse_fn = dispatch.get_parser(ticker)
    except NotImplementedError as e:
        logger.warning("[%s] no parser registered: %s", ticker, e)
        summary["failures"].append({
            "accession": "(all)",
            "stage": "dispatch",
            "error": "parser_not_registered",
        })
        return summary

    parse_method = f"adapter:{parse_fn.__module__}"

    logger.info("=" * 60)
    logger.info("[%s] starting (parser=%s, implemented=%s)",
                ticker, parse_fn.__module__, summary["parser_implemented"])

    # ---- Discover filings --------------------------------------------------
    try:
        tenq = edgar_client.get_recent_filings(cik, "10-Q", limit=filings_per_form)
        tenk = edgar_client.get_recent_filings(cik, "10-K", limit=filings_per_form)
    except Exception as e:
        logger.error("[%s] EDGAR discovery failed: %s", ticker, e)
        summary["failures"].append({
            "accession": "(discovery)",
            "stage": "edgar_discovery",
            "error": str(e),
        })
        return summary

    filings = sorted(tenq + tenk, key=lambda f: f["filing_date"], reverse=True)
    summary["candidates"] = len(filings)
    logger.info("[%s] %d candidate filings (%d 10-Q, %d 10-K)",
                ticker, len(filings), len(tenq), len(tenk))

    # ---- Per-filing loop ---------------------------------------------------
    for f in filings:
        accn = f["accession_number"]
        form = f["form"]
        period = f.get("period_of_report")
        try:
            primary_doc_url = edgar_client.filing_doc_url(
                cik, accn, f["primary_document"]
            )
        except Exception as e:
            logger.error("[%s] %s: doc URL build failed: %s", ticker, accn, e)
            summary["failures"].append({
                "accession": accn, "stage": "doc_url", "error": str(e),
            })
            continue

        logger.info("[%s] %s %s filed=%s period=%s",
                    ticker, form, accn, f["filing_date"], period)

        if not dry_run and sb is not None and _filing_already_ingested(sb, accn):
            logger.info("  skip: already ingested")
            summary["skipped_existing"] += 1
            continue

        # Download
        try:
            html = edgar_client.get_filing_html(cik, accn, f["primary_document"])
        except Exception as e:
            logger.error("  download failed: %s", e)
            summary["failures"].append({
                "accession": accn, "stage": "download", "error": str(e),
            })
            continue

        # Parse
        try:
            records = parse_fn(html)
        except Exception as e:
            logger.error("  parse raised: %s", e)
            logger.debug("  traceback:\n%s", traceback.format_exc())
            summary["failures"].append({
                "accession": accn, "stage": "parse", "error": str(e),
            })
            if not dry_run and sb is not None:
                _insert_filing(
                    sb,
                    fund_ticker=ticker,
                    filing_type=form,
                    filing_date=f["filing_date"],
                    period_end=period,
                    accession_number=accn,
                    primary_doc_url=primary_doc_url,
                    parse_status="failed",
                    parse_method=parse_method,
                )
            continue

        if not records:
            logger.warning("  no observations parsed")
            summary["failures"].append({
                "accession": accn,
                "stage": "parse",
                "error": "no_observations (parser stub or SoI not found)",
            })
            if not dry_run and sb is not None:
                _insert_filing(
                    sb,
                    fund_ticker=ticker,
                    filing_type=form,
                    filing_date=f["filing_date"],
                    period_end=period,
                    accession_number=accn,
                    primary_doc_url=primary_doc_url,
                    parse_status="failed",
                    parse_method=parse_method,
                )
            continue

        n_companies = len({r["portfolio_company_raw"] for r in records})
        logger.info("  parsed %d observations across %d portfolio companies",
                    len(records), n_companies)

        if dry_run:
            summary["ingested"] += 1
            summary["observations"] += len(records)
            continue

        assert sb is not None
        try:
            filing_id = _insert_filing(
                sb,
                fund_ticker=ticker,
                filing_type=form,
                filing_date=f["filing_date"],
                period_end=period,
                accession_number=accn,
                primary_doc_url=primary_doc_url,
                parse_status="pending",
                parse_method=parse_method,
            )
            if filing_id is None:
                raise RuntimeError("filings insert returned no id")
            inserted = _bulk_insert_observations(
                sb,
                filing_id=filing_id,
                fund_ticker=ticker,
                period_end=period,
                primary_doc_url=primary_doc_url,
                records=records,
            )
            _update_filing_status(sb, filing_id, parse_status="parsed")
            logger.info("  inserted %d observations (filing_id=%s)",
                        inserted, filing_id)
            summary["ingested"] += 1
            summary["observations"] += inserted
        except Exception as e:
            logger.error("  insert failed: %s", e)
            logger.debug("  traceback:\n%s", traceback.format_exc())
            summary["failures"].append({
                "accession": accn, "stage": "insert", "error": str(e),
            })
            continue

    return summary


# ---- Reporting -------------------------------------------------------------


def _print_final_report(per_fund: list[dict[str, Any]], dry_run: bool) -> None:
    print()
    print("=" * 78)
    print(" INGESTION SUMMARY  (mode={})".format("DRY RUN" if dry_run else "WRITE"))
    print("=" * 78)
    header = (
        f"  {'Ticker':<6} {'Impl':<5} {'Cand':>5} {'Skip':>5} "
        f"{'Ingested':>9} {'Observations':>13} {'Failures':>9}"
    )
    print(header)
    print("  " + "-" * (len(header) - 2))
    totals = defaultdict(int)
    for s in per_fund:
        impl = "yes" if s["parser_implemented"] else "no"
        print(
            f"  {s['ticker']:<6} {impl:<5} "
            f"{s['candidates']:>5} {s['skipped_existing']:>5} "
            f"{s['ingested']:>9} {s['observations']:>13} "
            f"{len(s['failures']):>9}"
        )
        totals["candidates"] += s["candidates"]
        totals["skipped_existing"] += s["skipped_existing"]
        totals["ingested"] += s["ingested"]
        totals["observations"] += s["observations"]
        totals["failures"] += len(s["failures"])
    print("  " + "-" * (len(header) - 2))
    print(
        f"  {'TOTAL':<6} {'':<5} "
        f"{totals['candidates']:>5} {totals['skipped_existing']:>5} "
        f"{totals['ingested']:>9} {totals['observations']:>13} "
        f"{totals['failures']:>9}"
    )

    # Per-fund failure detail
    any_failures = False
    for s in per_fund:
        if not s["failures"]:
            continue
        any_failures = True
        print()
        print(f"  Failures for {s['ticker']}:")
        for f in s["failures"]:
            print(f"    - {f['accession']} @ {f['stage']}: {f['error'][:120]}")
    if not any_failures:
        print()
        print("  No failures.")
    print("=" * 78)


# ---- Main ------------------------------------------------------------------


def run(*, dry_run: bool, tickers_filter: list[str] | None,
        filings_per_form: int) -> int:
    sb: Client | None = None
    try:
        sb = _supabase_client()
    except Exception as e:
        if dry_run:
            logger.warning("Supabase unavailable (%s); proceeding without DB.", e)
        else:
            raise

    funds = _load_funds(sb, tickers_filter)
    if not funds:
        logger.error("No funds matched. tickers_filter=%s", tickers_filter)
        return 2
    logger.info("Loaded %d fund(s): %s", len(funds),
                ", ".join(f["ticker"] for f in funds))

    per_fund_summaries: list[dict[str, Any]] = []
    for fund in funds:
        try:
            s = _process_fund(
                fund=fund,
                sb=sb,
                dry_run=dry_run,
                filings_per_form=filings_per_form,
            )
        except Exception as e:
            # Catch-all so one fund can't kill the rest of the run.
            logger.error("[%s] unexpected error: %s", fund["ticker"], e)
            logger.debug("  traceback:\n%s", traceback.format_exc())
            s = {
                "ticker": fund["ticker"].upper(),
                "cik": fund["cik"],
                "candidates": 0,
                "skipped_existing": 0,
                "ingested": 0,
                "observations": 0,
                "failures": [{
                    "accession": "(unhandled)",
                    "stage": "fund_loop",
                    "error": str(e),
                }],
                "parser_implemented": dispatch.is_implemented(fund["ticker"]),
            }
        per_fund_summaries.append(s)

    _print_final_report(per_fund_summaries, dry_run)
    any_fail = any(s["failures"] for s in per_fund_summaries)
    return 0 if not any_fail else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse but do not write to Supabase.",
    )
    parser.add_argument(
        "--tickers",
        nargs="+",
        default=None,
        help="Optional list of tickers to limit ingestion to (e.g. ARCC OBDC).",
    )
    parser.add_argument(
        "--per-form",
        type=int,
        default=DEFAULT_FILINGS_PER_FORM,
        help=f"How many of each form (10-Q, 10-K) to pull "
             f"(default {DEFAULT_FILINGS_PER_FORM}).",
    )
    args = parser.parse_args()
    sys.exit(run(
        dry_run=args.dry_run,
        tickers_filter=args.tickers,
        filings_per_form=args.per_form,
    ))
