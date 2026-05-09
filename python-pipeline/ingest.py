"""Orchestrator: pull recent ARCC filings from EDGAR, parse the Schedule of
Investments, and persist filings + observations into Supabase.

Usage:
    python ingest.py            # ingest 8 most recent 10-Q + 10-K filings for ARCC
    python ingest.py --dry-run  # parse and report; do not write to Supabase

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
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from supabase import Client, create_client

import edgar_client
import soi_parser_arcc

# ---- Setup -----------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("ingest")

REPO_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(REPO_ROOT / ".env.local")

ARCC_TICKER = "ARCC"
ARCC_CIK = "0001287750"
FILINGS_PER_FORM = 8  # 8 most recent of each form type, per the task brief.


def _supabase_client() -> Client:
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError(
            "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and "
            "SUPABASE_SERVICE_ROLE_KEY in .env.local."
        )
    return create_client(url, key)


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
    # Supabase REST inserts cap around a few hundred rows; chunk to be safe.
    inserted = 0
    chunk_size = 500
    for i in range(0, len(payload), chunk_size):
        chunk = payload[i : i + chunk_size]
        res = sb.table("observations").insert(chunk).execute()
        inserted += len(res.data or [])
    return inserted


# ---- Main ------------------------------------------------------------------


def run(*, dry_run: bool) -> int:
    sb: Client | None = None if dry_run else _supabase_client()
    logger.info(
        "Mode: %s. Pulling %d most recent 10-Q and %d most recent 10-K for %s.",
        "DRY RUN" if dry_run else "WRITE",
        FILINGS_PER_FORM,
        FILINGS_PER_FORM,
        ARCC_TICKER,
    )

    tenq = edgar_client.get_recent_filings(ARCC_CIK, "10-Q", limit=FILINGS_PER_FORM)
    tenk = edgar_client.get_recent_filings(ARCC_CIK, "10-K", limit=FILINGS_PER_FORM)
    filings = sorted(
        tenq + tenk, key=lambda f: f["filing_date"], reverse=True
    )
    logger.info(
        "Found %d candidate filings (%d 10-Q, %d 10-K).",
        len(filings), len(tenq), len(tenk),
    )

    summary = {
        "candidates": len(filings),
        "skipped_existing": 0,
        "ingested": 0,
        "observations": 0,
        "failures": [],
    }

    for f in filings:
        accn = f["accession_number"]
        form = f["form"]
        period = f["period_of_report"]
        primary_doc_url = edgar_client.filing_doc_url(
            ARCC_CIK, accn, f["primary_document"]
        )

        logger.info(
            "[%s] %s filed %s, period_end=%s", form, accn, f["filing_date"], period,
        )

        if not dry_run and sb is not None and _filing_already_ingested(sb, accn):
            logger.info("  skip: filing %s already ingested", accn)
            summary["skipped_existing"] += 1
            continue

        # Download HTML.
        try:
            html = edgar_client.get_filing_html(
                ARCC_CIK, accn, f["primary_document"]
            )
        except Exception as e:
            logger.error("  download failed: %s", e)
            summary["failures"].append({"accession": accn, "stage": "download", "error": str(e)})
            continue

        # Parse SoI.
        try:
            records = soi_parser_arcc.parse(html)
        except Exception as e:
            logger.error("  parse raised: %s", e)
            logger.debug("  traceback:\n%s", traceback.format_exc())
            summary["failures"].append({"accession": accn, "stage": "parse", "error": str(e)})
            if not dry_run and sb is not None:
                # Record the failed attempt.
                _insert_filing(
                    sb,
                    fund_ticker=ARCC_TICKER,
                    filing_type=form,
                    filing_date=f["filing_date"],
                    period_end=period,
                    accession_number=accn,
                    primary_doc_url=primary_doc_url,
                    parse_status="failed",
                    parse_method="soi_parser_arcc",
                )
            continue

        if not records:
            # No SoI table found \u2014 e.g., SoI included by reference. Track but
            # don't crash.
            logger.warning("  no observations parsed for %s", accn)
            summary["failures"].append({
                "accession": accn,
                "stage": "parse",
                "error": "no observations parsed (SoI table not found)",
            })
            if not dry_run and sb is not None:
                _insert_filing(
                    sb,
                    fund_ticker=ARCC_TICKER,
                    filing_type=form,
                    filing_date=f["filing_date"],
                    period_end=period,
                    accession_number=accn,
                    primary_doc_url=primary_doc_url,
                    parse_status="failed",
                    parse_method="soi_parser_arcc",
                )
            continue

        logger.info(
            "  parsed %d observations across %d portfolio companies",
            len(records),
            len({r["portfolio_company_raw"] for r in records}),
        )

        if dry_run:
            summary["ingested"] += 1
            summary["observations"] += len(records)
            continue

        # Persist.
        assert sb is not None
        try:
            filing_id = _insert_filing(
                sb,
                fund_ticker=ARCC_TICKER,
                filing_type=form,
                filing_date=f["filing_date"],
                period_end=period,
                accession_number=accn,
                primary_doc_url=primary_doc_url,
                parse_status="pending",
                parse_method="soi_parser_arcc",
            )
            if filing_id is None:
                raise RuntimeError("filings insert returned no id")

            inserted = _bulk_insert_observations(
                sb,
                filing_id=filing_id,
                fund_ticker=ARCC_TICKER,
                period_end=period,
                primary_doc_url=primary_doc_url,
                records=records,
            )
            _update_filing_status(sb, filing_id, parse_status="parsed")
            logger.info("  inserted %d observations (filing_id=%s)", inserted, filing_id)
            summary["ingested"] += 1
            summary["observations"] += inserted
        except Exception as e:
            logger.error("  insert failed: %s", e)
            logger.debug("  traceback:\n%s", traceback.format_exc())
            summary["failures"].append({"accession": accn, "stage": "insert", "error": str(e)})
            continue

    # ---- Final summary -----------------------------------------------------
    print()
    print("=" * 60)
    print(" INGESTION SUMMARY")
    print("=" * 60)
    print(f"  Candidate filings:    {summary['candidates']}")
    print(f"  Skipped (existing):   {summary['skipped_existing']}")
    print(f"  Ingested this run:    {summary['ingested']}")
    print(f"  Observations written: {summary['observations']}")
    print(f"  Failures:             {len(summary['failures'])}")
    if summary["failures"]:
        print()
        print("  Failure details:")
        for f in summary["failures"]:
            print(
                f"    - {f['accession']} @ {f['stage']}: {f['error'][:120]}"
            )
    print("=" * 60)
    return 0 if not summary["failures"] else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse but do not write to Supabase.",
    )
    args = parser.parse_args()
    sys.exit(run(dry_run=args.dry_run))
