"""PIK Creep detector — fund-level.

For each fund, for each period, compute
    pik_share = sum(fair_value where is_pik=true) / sum(fair_value)

For each pair of consecutive periods, fire if pik_share rose by more than
2 percentage points. portfolio_company_canonical is null for these hits.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Dict, List, Tuple

DETECTOR_NAME = "pik_creep"
DELTA_PP_THRESHOLD = 0.02  # 2 percentage points (in fraction units)


def run(observations: List[dict], filing_url_map: Dict[Tuple[str, str], str]) -> List[dict]:
    """Build PIK creep hits."""
    # Aggregate by (fund, period): total_fv, pik_fv
    totals: Dict[Tuple[str, str], List[float]] = defaultdict(lambda: [0.0, 0.0])
    # totals[key] = [total_fv, pik_fv]

    for o in observations:
        fund = o.get("fund_ticker")
        period = o.get("period_end")
        fv = o.get("fair_value")
        if not fund or not period or fv is None:
            continue
        try:
            fv_f = float(fv)
        except (TypeError, ValueError):
            continue
        if fv_f <= 0:
            # Negative / zero FV skews share calculations (e.g. unfunded
            # commitments with negative carrying value). Exclude from both
            # numerator and denominator.
            continue
        key = (fund, period)
        totals[key][0] += fv_f
        if o.get("is_pik") is True:
            totals[key][1] += fv_f

    # Group by fund -> sorted (period, total_fv, pik_fv)
    by_fund: Dict[str, List[Tuple[str, float, float]]] = defaultdict(list)
    for (fund, period), (total_fv, pik_fv) in totals.items():
        if total_fv > 0:
            by_fund[fund].append((period, total_fv, pik_fv))

    hits: List[dict] = []
    for fund, recs in by_fund.items():
        recs.sort(key=lambda x: x[0])
        for i in range(1, len(recs)):
            prior_period, prior_total, prior_pik = recs[i - 1]
            curr_period, curr_total, curr_pik = recs[i]
            prior_share = prior_pik / prior_total if prior_total else 0.0
            curr_share = curr_pik / curr_total if curr_total else 0.0
            delta = curr_share - prior_share
            if delta <= DELTA_PP_THRESHOLD:
                continue

            prior_url = filing_url_map.get((fund, prior_period))
            curr_url = filing_url_map.get((fund, curr_period))
            cited = [u for u in (prior_url, curr_url) if u]
            hits.append({
                "detector_name": DETECTOR_NAME,
                "fund_ticker": fund,
                "portfolio_company_canonical": None,
                "current_period_end": curr_period,
                "prior_period_end": prior_period,
                "severity_score": round(delta, 6),
                "hit_data": {
                    "pik_share_prior": round(prior_share, 6),
                    "pik_share_current": round(curr_share, 6),
                    "delta_pp": round(delta, 6),
                    "total_fv": round(curr_total, 2),
                    "prior_filing_url": prior_url,
                    "current_filing_url": curr_url,
                },
                "cited_source_urls": cited,
            })

    return hits
