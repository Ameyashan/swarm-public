"""Run all detectors against the observations table and write hits.

Idempotent: for each detector, deletes existing rows for the periods being
processed before re-inserting. Periods being processed = every distinct
period_end in observations (covers the full dataset on every run).

Usage:
    python3 run_detectors.py            # run all detectors
    python3 run_detectors.py --dry-run  # compute hits, print summary, no DB write
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from collections import Counter, defaultdict
from typing import Dict, List, Tuple

from dotenv import load_dotenv
from supabase import Client, create_client

from detectors import mark_drift_down, pik_creep, cross_fund_divergence

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(message)s",
)
logger = logging.getLogger("run_detectors")
# Quiet down noisy HTTP libs
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("hpack").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)


# ---------------------------------------------------------------------------
# Supabase plumbing (kept consistent with entity_resolution.py)
# ---------------------------------------------------------------------------


def _get_supabase() -> Client:
    if "NEXT_PUBLIC_SUPABASE_URL" not in os.environ:
        load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env.local"))
    url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)


def _fetch_observations(sb: Client, page_size: int = 1000) -> List[dict]:
    """Page through ALL observations needed for the detectors."""
    cols = (
        "fund_ticker, period_end, portfolio_company_canonical, "
        "fair_value, cost, accrual_status, is_pik, "
        "investment_type, principal_amount, maturity_date"
    )
    out: List[dict] = []
    start = 0
    while True:
        res = (
            sb.table("observations")
            .select(cols)
            .range(start, start + page_size - 1)
            .execute()
        )
        batch = res.data or []
        out.extend(batch)
        if len(batch) < page_size:
            break
        start += page_size
    return out


def _fetch_filing_url_map(sb: Client, page_size: int = 1000) -> Dict[Tuple[str, str], str]:
    """Build (fund_ticker, period_end) -> primary_doc_url.

    If multiple filings exist for the same (fund, period) — e.g. an amended
    10-Q/A — keep the most recently-filed one.
    """
    out: Dict[Tuple[str, str], Tuple[str, str]] = {}
    # value = (primary_doc_url, filing_date) so we can prefer the latest
    start = 0
    while True:
        res = (
            sb.table("filings")
            .select("fund_ticker, period_end, primary_doc_url, filing_date, parse_status")
            .range(start, start + page_size - 1)
            .execute()
        )
        batch = res.data or []
        for r in batch:
            if (r.get("parse_status") or "") not in ("ok", "success", "parsed", "complete"):
                # Still include — some pipelines mark differently. We'll just
                # accept anything with a URL and a period.
                pass
            fund = r.get("fund_ticker")
            period = r.get("period_end")
            url = r.get("primary_doc_url")
            fdate = r.get("filing_date") or ""
            if not fund or not period or not url:
                continue
            key = (fund, period)
            existing = out.get(key)
            if existing is None or fdate > existing[1]:
                out[key] = (url, fdate)
        if len(batch) < page_size:
            break
        start += page_size
    return {k: v[0] for k, v in out.items()}


# ---------------------------------------------------------------------------
# Idempotent write
# ---------------------------------------------------------------------------


def _clear_existing_hits(sb: Client, detector_name: str, periods: List[str]) -> int:
    """Delete all existing detector_hits rows for this detector across given
    current_period_end values. Returns rows deleted (best-effort count)."""
    if not periods:
        return 0
    # Supabase REST has URL length limits; chunk the .in_() filter.
    deleted = 0
    chunk = 100
    for i in range(0, len(periods), chunk):
        batch = periods[i : i + chunk]
        res = (
            sb.table("detector_hits")
            .delete()
            .eq("detector_name", detector_name)
            .in_("current_period_end", batch)
            .execute()
        )
        deleted += len(res.data or [])
    return deleted


def _insert_hits(sb: Client, hits: List[dict], batch_size: int = 500) -> int:
    if not hits:
        return 0
    inserted = 0
    for i in range(0, len(hits), batch_size):
        batch = hits[i : i + batch_size]
        res = sb.table("detector_hits").insert(batch).execute()
        inserted += len(res.data or [])
    return inserted


# ---------------------------------------------------------------------------
# Pretty-print summaries
# ---------------------------------------------------------------------------


def _print_summary(name: str, hits: List[dict]) -> None:
    by_fund: Counter = Counter()
    for h in hits:
        by_fund[h.get("fund_ticker") or "(cross-fund)"] += 1
    breakdown = ", ".join(f"{f}={n}" for f, n in by_fund.most_common())
    logger.info("[%s] %d hits (%s)", name, len(hits), breakdown or "no fund breakdown")


def _print_top_mark_drift(hits: List[dict], n: int = 10) -> None:
    top = sorted(hits, key=lambda h: h["severity_score"], reverse=True)[:n]
    print(f"\nTop {n} Mark Drift Down hits (most severe FV drops, accrual status):")
    print(f"  {'fund':6}  {'period':10}  {'sev':>7}  {'fv_prior_$k':>14}  {'fv_curr_$k':>14}  borrower")
    print(f"  {'-'*6}  {'-'*10}  {'-'*7}  {'-'*14}  {'-'*14}  {'-'*40}")
    for h in top:
        d = h["hit_data"]
        print(
            f"  {h['fund_ticker']:6}  {h['current_period_end']:10}  "
            f"{h['severity_score']*100:>6.1f}%  "
            f"{d['fv_prior']/1000:>14,.1f}  {d['fv_current']/1000:>14,.1f}  "
            f"{h['portfolio_company_canonical']}"
        )


def _print_top_pik_creep(hits: List[dict], n: int = 5) -> None:
    top = sorted(hits, key=lambda h: h["severity_score"], reverse=True)[:n]
    print(f"\nTop {n} PIK Creep hits (largest pp jumps in PIK share):")
    print(f"  {'fund':6}  {'period':10}  {'prior':>7}  {'curr':>7}  {'delta_pp':>9}")
    print(f"  {'-'*6}  {'-'*10}  {'-'*7}  {'-'*7}  {'-'*9}")
    for h in top:
        d = h["hit_data"]
        print(
            f"  {h['fund_ticker']:6}  {h['current_period_end']:10}  "
            f"{d['pik_share_prior']*100:>6.2f}%  {d['pik_share_current']*100:>6.2f}%  "
            f"{d['delta_pp']*100:>+8.2f}pp"
        )


def _print_top_divergence(hits: List[dict], n: int = 5) -> None:
    top = sorted(hits, key=lambda h: h["severity_score"], reverse=True)[:n]
    print(f"\nTop {n} Cross-Fund Divergence hits (largest spreads in mark across funds):")
    for h in top:
        d = h["hit_data"]
        funds_str = ", ".join(
            f"{f['ticker']}={f['fv_pct_of_cost']*100:.1f}%" for f in d["funds"]
        )
        print(
            f"  {h['current_period_end']}  spread={d['spread_pp']*100:.1f}pp  "
            f"({d['n_funds']} funds)  {h['portfolio_company_canonical']}"
        )
        print(f"      funds: {funds_str}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Compute hits but don't write.")
    args = parser.parse_args()

    sb = _get_supabase()

    logger.info("Loading observations...")
    obs = _fetch_observations(sb)
    logger.info("Loaded %d observations", len(obs))

    logger.info("Loading filing URL map...")
    url_map = _fetch_filing_url_map(sb)
    logger.info("Loaded %d (fund,period) -> URL entries", len(url_map))

    detectors = [
        ("mark_drift_down", mark_drift_down),
        ("pik_creep", pik_creep),
        ("cross_fund_divergence", cross_fund_divergence),
    ]

    all_hits: Dict[str, List[dict]] = {}
    all_periods = sorted({o.get("period_end") for o in obs if o.get("period_end")})
    logger.info("Periods present in observations: %d (%s .. %s)",
                len(all_periods), all_periods[0] if all_periods else "?", all_periods[-1] if all_periods else "?")

    for name, mod in detectors:
        logger.info("Running detector: %s", name)
        hits = mod.run(obs, url_map)
        all_hits[name] = hits
        _print_summary(name, hits)

    if args.dry_run:
        logger.info("Dry run; skipping DB writes.")
    else:
        for name, _ in detectors:
            hits = all_hits[name]
            logger.info("Clearing existing %s hits across %d periods...", name, len(all_periods))
            n_del = _clear_existing_hits(sb, name, all_periods)
            logger.info("  deleted %d existing rows", n_del)
            logger.info("Inserting %d %s hits...", len(hits), name)
            n_ins = _insert_hits(sb, hits)
            logger.info("  inserted %d rows", n_ins)

    # Final summary
    print("\n" + "=" * 78)
    print(" DETECTOR SUMMARY ")
    print("=" * 78)
    for name, _ in detectors:
        print(f"  {name:25}  {len(all_hits[name]):>6} hits")
    print("=" * 78)

    _print_top_mark_drift(all_hits["mark_drift_down"], n=10)
    _print_top_pik_creep(all_hits["pik_creep"], n=5)
    _print_top_divergence(all_hits["cross_fund_divergence"], n=5)
    print()

    return 0


if __name__ == "__main__":
    sys.exit(main())
