"""Mark Drift Down detector.

For each fund, for each pair of consecutive periods, find positions where the
SAME canonical borrower exists in both periods, fair_value declined more than
5% from the prior period, and accrual_status is 'accrual' (not non-accrual)
in the current period.

Severity = abs(fv_change_pct) so a 30% drop -> 0.30.

If a borrower has multiple positions in the same fund/period (e.g. first lien
+ unfunded commitment), we aggregate fair_value at the (fund, period, canonical)
grain before comparing — this avoids spurious hits from a position being split
or merged across periods.

If any underlying position in the current period is non_accrual, we treat the
aggregate as non_accrual and skip.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Dict, List, Tuple

from detectors._filters import is_subtotal_name

DETECTOR_NAME = "mark_drift_down"
THRESHOLD_PCT = 0.05  # 5%
# Fair-value is stored in THOUSANDS of dollars (the unit BDCs disclose in),
# so 1_000.0 here means "$1M of prior FV".
MIN_PRIOR_FV_THOUSANDS = 1_000.0  # $1M floor on prior FV — suppresses
                                  # unfunded-commitment noise where a position
                                  # runs from $40k to $0 and produces a 100%
                                  # "drift" that isn't real distress.


def run(observations: List[dict], filing_url_map: Dict[Tuple[str, str], str]) -> List[dict]:
    """Build hits.

    Args:
        observations: rows from observations with at minimum:
            fund_ticker, period_end (date string), portfolio_company_canonical,
            fair_value (numeric or None), accrual_status (str or None).
        filing_url_map: maps (fund_ticker, period_end_str) -> primary_doc_url.

    Returns:
        List of dicts with keys matching detector_hits columns.
    """
    # Aggregate fair_value to (fund, period, canonical). Track whether ANY
    # position for that key is non_accrual.
    Bucket = Tuple[str, str, str]  # (fund, period, canonical)
    fv_sum: Dict[Bucket, float] = defaultdict(float)
    has_nonaccrual: Dict[Bucket, bool] = defaultdict(bool)
    n_positions: Dict[Bucket, int] = defaultdict(int)

    for o in observations:
        canon = o.get("portfolio_company_canonical")
        fund = o.get("fund_ticker")
        period = o.get("period_end")
        fv = o.get("fair_value")
        if not canon or not fund or not period or fv is None:
            continue
        if is_subtotal_name(canon):
            continue  # Defense vs upstream parser leaks (e.g. OBDC subtotals)
        try:
            fv_f = float(fv)
        except (TypeError, ValueError):
            continue
        key = (fund, period, canon)
        fv_sum[key] += fv_f
        n_positions[key] += 1
        if (o.get("accrual_status") or "").lower() == "non_accrual":
            has_nonaccrual[key] = True

    # Group by (fund, canonical) -> sorted list of (period, fv_total, any_nonaccrual)
    by_pos: Dict[Tuple[str, str], List[Tuple[str, float, bool]]] = defaultdict(list)
    for (fund, period, canon), total in fv_sum.items():
        by_pos[(fund, canon)].append((period, total, has_nonaccrual[(fund, period, canon)]))

    hits: List[dict] = []
    for (fund, canon), recs in by_pos.items():
        recs.sort(key=lambda x: x[0])  # period ascending (ISO date strings sort correctly)
        # Walk consecutive pairs
        for i in range(1, len(recs)):
            prior_period, fv_prior, _ = recs[i - 1]
            curr_period, fv_current, curr_nonaccrual = recs[i]
            if fv_prior <= 0 or fv_current is None:
                continue
            if curr_nonaccrual:
                # Skip — borrower already on non-accrual; not the signal we want
                continue
            if fv_prior < MIN_PRIOR_FV_THOUSANDS:
                continue  # too small to be meaningful
            change_pct = (fv_current - fv_prior) / fv_prior  # negative for drop
            if change_pct >= -THRESHOLD_PCT:
                continue  # not enough of a drop (or it's an increase)

            severity = abs(change_pct)
            prior_url = filing_url_map.get((fund, prior_period))
            curr_url = filing_url_map.get((fund, curr_period))
            cited = [u for u in (prior_url, curr_url) if u]
            hits.append({
                "detector_name": DETECTOR_NAME,
                "fund_ticker": fund,
                "portfolio_company_canonical": canon,
                "current_period_end": curr_period,
                "prior_period_end": prior_period,
                "severity_score": round(severity, 6),
                "hit_data": {
                    "fv_prior": round(fv_prior, 2),
                    "fv_current": round(fv_current, 2),
                    "fv_change_pct": round(change_pct, 6),
                    "accrual_status": "accrual",
                    "prior_filing_url": prior_url,
                    "current_filing_url": curr_url,
                },
                "cited_source_urls": cited,
            })

    return hits
