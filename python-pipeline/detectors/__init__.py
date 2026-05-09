"""Detector package — each module exposes ``run(sb, observations, filings_url_map)``
and returns a list of detector_hits row dicts (without ``id`` / ``created_at``).

Detectors are pure: they do not write to the DB. ``run_detectors.py`` collects
hits from each module and performs idempotent inserts.
"""

DETECTOR_NAMES = ("mark_drift_down", "pik_creep", "cross_fund_divergence")
