"""Cross-Fund Divergence detector.

For each canonical borrower held by N >= 2 funds in the same period, compute
fair_value as % of cost (mark) for each fund's holding, then take the spread
(max - min) of those marks. Fire when spread exceeds 15 percentage points.

Within a single (fund, period, canonical) we aggregate fair_value and cost
across positions (e.g. first lien + revolver) before computing the mark.
We require positive cost on both sides to compute a meaningful mark.

current_period_end is set to the period being evaluated; prior_period_end is
left null since this is a single-period (cross-sectional) detector.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Dict, List, Tuple

DETECTOR_NAME = "cross_fund_divergence"
SPREAD_THRESHOLD_PP = 0.15  # 15 percentage points (in fraction units)
MIN_FUNDS = 2


def run(observations: List[dict], filing_url_map: Dict[Tuple[str, str], str]) -> List[dict]:
    """Build cross-fund divergence hits."""
    # Aggregate to (fund, period, canonical) -> [total_fv, total_cost]
    agg: Dict[Tuple[str, str, str], List[float]] = defaultdict(lambda: [0.0, 0.0])
    for o in observations:
        canon = o.get("portfolio_company_canonical")
        fund = o.get("fund_ticker")
        period = o.get("period_end")
        fv = o.get("fair_value")
        cost = o.get("cost")
        if not canon or not fund or not period:
            continue
        try:
            fv_f = float(fv) if fv is not None else None
            cost_f = float(cost) if cost is not None else None
        except (TypeError, ValueError):
            continue
        if fv_f is None or cost_f is None:
            continue
        agg[(fund, period, canon)][0] += fv_f
        agg[(fund, period, canon)][1] += cost_f

    # Reorganize by (period, canonical) -> list of (fund, mark, fv, cost)
    by_pc: Dict[Tuple[str, str], List[Tuple[str, float, float, float]]] = defaultdict(list)
    for (fund, period, canon), (fv_sum, cost_sum) in agg.items():
        if cost_sum <= 0:
            continue
        mark = fv_sum / cost_sum
        by_pc[(period, canon)].append((fund, mark, fv_sum, cost_sum))

    hits: List[dict] = []
    for (period, canon), entries in by_pc.items():
        if len(entries) < MIN_FUNDS:
            continue
        marks = [m for _, m, _, _ in entries]
        spread = max(marks) - min(marks)
        if spread <= SPREAD_THRESHOLD_PP:
            continue

        # Sort funds for stable output (highest mark first)
        entries.sort(key=lambda x: x[1], reverse=True)
        funds_payload = [
            {
                "ticker": fund,
                "fv_pct_of_cost": round(mark, 6),
                "fair_value": round(fv, 2),
                "cost": round(cost, 2),
            }
            for fund, mark, fv, cost in entries
        ]
        cited = []
        for fund, _, _, _ in entries:
            url = filing_url_map.get((fund, period))
            if url:
                cited.append(url)

        hits.append({
            "detector_name": DETECTOR_NAME,
            "fund_ticker": None,  # cross-fund event: no single fund
            "portfolio_company_canonical": canon,
            "current_period_end": period,
            "prior_period_end": None,
            "severity_score": round(spread, 6),
            "hit_data": {
                "funds": funds_payload,
                "spread_pp": round(spread, 6),
                "n_funds": len(entries),
            },
            "cited_source_urls": cited,
        })

    return hits
