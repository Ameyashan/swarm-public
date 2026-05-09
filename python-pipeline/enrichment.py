"""Enrich detector_hits with research from the Perplexity Sonar API.

For each hit (deduped by portfolio_company_canonical to avoid redundant
research), runs FOUR focused Sonar calls — news, litigation, sponsor,
management — parses the JSON, and writes a row to public.enrichments.

Usage:
    python3 enrichment.py                       # last 30 days, skip already-enriched
    python3 enrichment.py --days-back 365       # cover everything
    python3 enrichment.py --limit 5             # smoke test
    python3 enrichment.py --dry-run             # don't write to DB
    python3 enrichment.py --no-dedupe           # one Sonar batch per hit (expensive)

Output: progress per hit, a summary table, and three example enrichments
(plus an approximate API cost estimate).

PERPLEXITY_API_KEY must be present in .env.local or the environment.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import requests
from dotenv import load_dotenv
from supabase import Client, create_client

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(message)s",
)
logger = logging.getLogger("enrichment")
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("hpack").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("urllib3").setLevel(logging.WARNING)


SONAR_API_URL = "https://api.perplexity.ai/chat/completions"
SONAR_MODEL = "sonar-pro"
SONAR_TIMEOUT_S = 45

# Approximate cost per Sonar Pro request, used only for cost reporting.
# https://docs.perplexity.ai/guides/pricing - sonar-pro is roughly
# $3 / 1M input tokens, $15 / 1M output tokens, plus $5 per 1k requests.
# Each enrichment call here uses small prompts and ~500 token responses,
# so we use a flat estimate per call.
SONAR_EST_COST_PER_CALL = 0.012


# ---------------------------------------------------------------------------
# Supabase / env plumbing
# ---------------------------------------------------------------------------


def _get_supabase() -> Client:
    if "NEXT_PUBLIC_SUPABASE_URL" not in os.environ:
        load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env.local"))
    url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)


def _get_api_key() -> str:
    if "PERPLEXITY_API_KEY" not in os.environ:
        load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env.local"))
    key = os.environ.get("PERPLEXITY_API_KEY")
    if not key:
        raise RuntimeError(
            "PERPLEXITY_API_KEY missing. Set it in .env.local or the environment."
        )
    return key


# ---------------------------------------------------------------------------
# Sonar API
# ---------------------------------------------------------------------------


def _strip_json(text: str) -> str:
    """Pull the first JSON object/array out of a model response.

    Sonar tends to wrap JSON in markdown fences or add prose; this cleans that
    up. We try, in order:
      1. ```json ... ``` block
      2. ```  ... ``` block
      3. First {...} or [...] balanced span
      4. Whole string
    """
    if not text:
        return ""
    # 1: fenced json
    m = re.search(r"```json\s*(.+?)```", text, re.DOTALL | re.IGNORECASE)
    if m:
        return m.group(1).strip()
    # 2: bare fence
    m = re.search(r"```\s*(.+?)```", text, re.DOTALL)
    if m:
        return m.group(1).strip()
    # 3: first balanced span
    for opener, closer in [("[", "]"), ("{", "}")]:
        i = text.find(opener)
        if i == -1:
            continue
        depth = 0
        for j in range(i, len(text)):
            c = text[j]
            if c == opener:
                depth += 1
            elif c == closer:
                depth -= 1
                if depth == 0:
                    return text[i : j + 1]
    return text.strip()


def _sonar_call(api_key: str, prompt: str, timeout: int = SONAR_TIMEOUT_S) -> Dict[str, Any]:
    """Single Sonar Pro call. Returns {parsed: <json|None>, raw: str, citations: [...], error: str|None, calls: 1}."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": SONAR_MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a research assistant. Reply with valid JSON only — no "
                    "prose, no markdown fences. If you have nothing to report, "
                    "return an empty array [] or null per the prompt."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        "return_citations": True,
        "temperature": 0.1,
    }
    try:
        resp = requests.post(SONAR_API_URL, headers=headers, json=body, timeout=timeout)
    except requests.RequestException as e:
        return {"parsed": None, "raw": "", "citations": [], "error": f"request_failed: {e}", "calls": 1}

    if resp.status_code >= 400:
        snippet = resp.text[:200] if resp.text else ""
        return {
            "parsed": None,
            "raw": "",
            "citations": [],
            "error": f"http_{resp.status_code}: {snippet}",
            "calls": 1,
        }

    try:
        data = resp.json()
    except json.JSONDecodeError as e:
        return {"parsed": None, "raw": resp.text, "citations": [], "error": f"non_json_response: {e}", "calls": 1}

    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        return {"parsed": None, "raw": json.dumps(data)[:500], "citations": [], "error": "missing_content", "calls": 1}

    citations = data.get("citations") or []

    cleaned = _strip_json(content)
    parsed: Any = None
    parse_err: Optional[str] = None
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as e:
        parse_err = f"json_decode_failed: {e}"

    return {"parsed": parsed, "raw": content, "citations": citations, "error": parse_err, "calls": 1}


# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------


def _prompt_news(company: str) -> str:
    return (
        f"Find news articles from the past 180 days about {company}, a private "
        f"mid-market company. Focus on: layoffs, executive departures, customer "
        f"losses, restructuring talks, missed earnings, or operational issues. "
        f"Return up to 5 items as JSON: "
        f'[{{"title": "...", "source": "...", "url": "...", "date": "YYYY-MM-DD", "summary": "..."}}]. '
        f"If no relevant news found, return []."
    )


def _prompt_litigation(company: str) -> str:
    return (
        f"Find any litigation, court filings, or legal proceedings involving "
        f"{company} in the past 12 months. Search PACER, court records, and news. "
        f"Return up to 5 items as JSON: "
        f'[{{"case_name": "...", "court": "...", "filing_date": "YYYY-MM-DD", "summary": "...", "url": "..."}}]. '
        f"Return [] if nothing found."
    )


def _prompt_sponsor(company: str) -> str:
    return (
        f"Identify the private equity sponsor that owns {company}. Provide the "
        f"PE firm name, when they acquired the company, and any relevant fund. "
        f'Return JSON: {{"sponsor_name": "...", "acquisition_year": 2020, "fund_name": "...", "source_url": "..."}}. '
        f'If unknown, return {{"sponsor_name": null}}.'
    )


def _prompt_management(company: str) -> str:
    return (
        f"Find any executive departures or leadership changes at {company} in "
        f"the past 12 months. Return JSON: "
        f'[{{"role": "...", "name": "...", "change_type": "departure|appointment|other", "date": "YYYY-MM-DD", "source_url": "..."}}]. '
        f"Return [] if none found."
    )


# ---------------------------------------------------------------------------
# Public API: enrich_hit
# ---------------------------------------------------------------------------


def _normalize_news(parsed: Any) -> List[Dict[str, Any]]:
    if not isinstance(parsed, list):
        return []
    return parsed[:5]


def _normalize_litigation(parsed: Any) -> List[Dict[str, Any]]:
    if not isinstance(parsed, list):
        return []
    return parsed[:5]


def _normalize_sponsor(parsed: Any) -> Dict[str, Any]:
    if isinstance(parsed, dict):
        return parsed
    return {"sponsor_name": None}


def _normalize_management(parsed: Any) -> List[Dict[str, Any]]:
    if not isinstance(parsed, list):
        return []
    return parsed[:10]


def enrich_hit(hit: Dict[str, Any], api_key: Optional[str] = None) -> Dict[str, Any]:
    """Run the four Sonar calls for one detector hit.

    Returns a dict suitable for inserting into public.enrichments:
      {detector_hit_id, news_items, litigation_items, sponsor_info,
       management_changes, research_summary, generated_at}

    `research_summary` rolls up status/error info plus citations as a single
    text blob so it's queryable without parsing JSON.
    """
    if api_key is None:
        api_key = _get_api_key()

    company = hit.get("portfolio_company_canonical")
    if not company:
        # fund-level hit (e.g. pik_creep) — nothing meaningful to research
        return {
            "detector_hit_id": hit["id"],
            "news_items": [],
            "litigation_items": [],
            "sponsor_info": {"sponsor_name": None, "note": "no portfolio company on hit"},
            "management_changes": [],
            "research_summary": "Skipped — fund-level hit with no portfolio company.",
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    company_str = str(company).strip()
    # Run the four Sonar calls in parallel to keep each hit under ~3-5s.
    prompts = {
        "news": _prompt_news(company_str),
        "litigation": _prompt_litigation(company_str),
        "sponsor": _prompt_sponsor(company_str),
        "management": _prompt_management(company_str),
    }
    calls: Dict[str, Dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=4) as ex:
        futs = {label: ex.submit(_sonar_call, api_key, p) for label, p in prompts.items()}
        for label, fut in futs.items():
            try:
                calls[label] = fut.result()
            except Exception as e:  # noqa: BLE001
                calls[label] = {"parsed": None, "raw": "", "citations": [], "error": f"future_failed: {e}", "calls": 1}

    news = _normalize_news(calls["news"]["parsed"])
    litigation = _normalize_litigation(calls["litigation"]["parsed"])
    sponsor = _normalize_sponsor(calls["sponsor"]["parsed"])
    management = _normalize_management(calls["management"]["parsed"])

    # Roll up status + a few citations into a research_summary text blob.
    summary_parts = [f"Company researched: {company_str}"]
    for label, c in calls.items():
        if c["error"]:
            summary_parts.append(f"  {label}: ERROR — {c['error']}")
        else:
            summary_parts.append(f"  {label}: ok")
    cite_pool: List[str] = []
    for c in calls.values():
        for url in (c.get("citations") or [])[:3]:
            if isinstance(url, str) and url not in cite_pool:
                cite_pool.append(url)
    if cite_pool:
        summary_parts.append("Citations:")
        for u in cite_pool[:8]:
            summary_parts.append(f"  - {u}")

    return {
        "detector_hit_id": hit["id"],
        "news_items": news,
        "litigation_items": litigation,
        "sponsor_info": sponsor,
        "management_changes": management,
        "research_summary": "\n".join(summary_parts),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# Bulk runner
# ---------------------------------------------------------------------------


def _fetch_pending_hits(
    sb: Client,
    days_back: int,
    page_size: int = 1000,
) -> List[Dict[str, Any]]:
    """Hits from the past N days that don't have a corresponding enrichments row."""
    since = (datetime.now(timezone.utc) - timedelta(days=days_back)).isoformat()
    out: List[Dict[str, Any]] = []
    start = 0
    while True:
        res = (
            sb.table("detector_hits")
            .select(
                "id, detector_name, fund_ticker, portfolio_company_canonical, "
                "current_period_end, severity_score, hit_data, cited_source_urls, created_at"
            )
            .gte("created_at", since)
            .order("severity_score", desc=True)
            .range(start, start + page_size - 1)
            .execute()
        )
        batch = res.data or []
        out.extend(batch)
        if len(batch) < page_size:
            break
        start += page_size

    if not out:
        return []

    # Filter out hits that already have an enrichments row.
    enriched_ids: set = set()
    start = 0
    while True:
        res = (
            sb.table("enrichments")
            .select("detector_hit_id")
            .range(start, start + page_size - 1)
            .execute()
        )
        batch = res.data or []
        for r in batch:
            if r.get("detector_hit_id"):
                enriched_ids.add(r["detector_hit_id"])
        if len(batch) < page_size:
            break
        start += page_size

    return [h for h in out if h["id"] not in enriched_ids]


def _dedupe_by_company(
    hits: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], Dict[str, List[str]]]:
    """Return (representative_hits, sibling_map).

    representative_hits: one hit per distinct portfolio_company_canonical
        (keeps highest-severity). Hits with NULL company kept individually.
    sibling_map: {representative_hit_id -> [other_hit_ids that share the company]}
        so we can fan the same enrichment row out to siblings if desired.
    """
    by_company: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    no_company: List[Dict[str, Any]] = []
    for h in hits:
        c = h.get("portfolio_company_canonical")
        if c:
            by_company[c].append(h)
        else:
            no_company.append(h)

    reps: List[Dict[str, Any]] = []
    siblings: Dict[str, List[str]] = {}
    for company, group in by_company.items():
        # Pick highest severity_score; tie-break on most recent created_at.
        group.sort(
            key=lambda h: (
                -(h.get("severity_score") or 0),
                -(0 if not h.get("created_at") else 1),
                h.get("created_at") or "",
            )
        )
        rep = group[0]
        reps.append(rep)
        siblings[rep["id"]] = [g["id"] for g in group[1:]]
    reps.extend(no_company)
    return reps, siblings


def enrich_all_recent_hits(
    days_back: int = 30,
    *,
    limit: Optional[int] = None,
    dedupe_by_company: bool = True,
    fan_out_siblings: bool = True,
    delay_s: float = 1.0,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """Enrich pending detector_hits and write to public.enrichments.

    Returns a stats dict with totals and example records.
    """
    api_key = _get_api_key()
    sb = _get_supabase()

    pending = _fetch_pending_hits(sb, days_back=days_back)
    logger.info("Pending hits in last %d days: %d", days_back, len(pending))

    if dedupe_by_company:
        reps, siblings = _dedupe_by_company(pending)
        logger.info(
            "After dedupe by company: %d representative hits (covering %d sibling hits)",
            len(reps),
            sum(len(v) for v in siblings.values()),
        )
    else:
        reps = pending
        siblings = {}

    if limit is not None:
        reps = reps[:limit]
        logger.info("Limit applied: processing %d reps", len(reps))

    total_calls = 0
    queued = 0
    inserted = 0
    errors_by_hit: Dict[str, str] = {}
    examples: List[Dict[str, Any]] = []

    for i, hit in enumerate(reps, 1):
        company = hit.get("portfolio_company_canonical") or "(no company)"
        t0 = time.time()
        try:
            row = enrich_hit(hit, api_key=api_key)
        except Exception as e:  # noqa: BLE001
            logger.exception("enrich_hit failed for %s: %s", hit["id"], e)
            errors_by_hit[hit["id"]] = str(e)
            continue
        if hit.get("portfolio_company_canonical"):
            total_calls += 4
        elapsed = time.time() - t0

        rows = [row]
        if fan_out_siblings and hit["id"] in siblings:
            for sib_id in siblings[hit["id"]]:
                clone = dict(row)
                clone["detector_hit_id"] = sib_id
                rows.append(clone)
        queued += len(rows)

        # Insert immediately so partial progress is durable across restarts.
        # Use upsert on detector_hit_id (unique index) so a crash + re-run
        # never produces duplicate enrichment rows.
        if not dry_run:
            try:
                res = (
                    sb.table("enrichments")
                    .upsert(rows, on_conflict="detector_hit_id")
                    .execute()
                )
                inserted += len(res.data or [])
            except Exception as e:  # noqa: BLE001
                logger.exception("Upsert failed for hit %s: %s", hit["id"], e)
                errors_by_hit[hit["id"]] = f"insert_failed: {e}"

        logger.info(
            "[%d/%d] %s — %s — sev=%.3f — %.1fs — wrote %d row(s)",
            i,
            len(reps),
            hit.get("detector_name"),
            company,
            float(hit.get("severity_score") or 0),
            elapsed,
            len(rows),
        )

        if len(examples) < 3 and hit.get("portfolio_company_canonical"):
            examples.append({"hit": hit, "enrichment": row})

        if delay_s > 0 and i < len(reps):
            time.sleep(delay_s)

    if dry_run:
        logger.info("Dry run; would insert %d enrichment rows.", queued)

    est_cost = total_calls * SONAR_EST_COST_PER_CALL
    return {
        "pending_hits": len(pending),
        "reps_processed": len(reps),
        "rows_to_insert": queued,
        "rows_inserted": inserted,
        "total_sonar_calls": total_calls,
        "est_cost_usd": est_cost,
        "errors": errors_by_hit,
        "examples": examples,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _print_examples(examples: List[Dict[str, Any]]) -> None:
    if not examples:
        print("\n(No examples to display.)")
        return
    print("\n" + "=" * 78)
    print(" EXAMPLE ENRICHMENTS ")
    print("=" * 78)
    for n, ex in enumerate(examples, 1):
        h = ex["hit"]
        e = ex["enrichment"]
        print(f"\n--- Example {n}: {h.get('portfolio_company_canonical')} "
              f"({h.get('detector_name')}, fund={h.get('fund_ticker')}) ---")
        print(f"News items: {len(e['news_items'])}")
        for item in e["news_items"][:2]:
            if isinstance(item, dict):
                print(f"  - {item.get('date', '?')}: {item.get('title', '')[:100]}")
                if item.get("summary"):
                    print(f"      {str(item['summary'])[:160]}")
        print(f"Litigation: {len(e['litigation_items'])}")
        for item in e["litigation_items"][:2]:
            if isinstance(item, dict):
                print(f"  - {item.get('case_name', '')[:100]} ({item.get('court', '')})")
        sp = e["sponsor_info"] or {}
        print(f"Sponsor: {sp.get('sponsor_name') or '(unknown)'}"
              + (f" (acquired {sp.get('acquisition_year')})" if sp.get("acquisition_year") else ""))
        print(f"Management changes: {len(e['management_changes'])}")
        for item in e["management_changes"][:2]:
            if isinstance(item, dict):
                print(f"  - {item.get('change_type', '?')}: {item.get('name', '')} "
                      f"({item.get('role', '')}) on {item.get('date', '?')}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days-back", type=int, default=30)
    parser.add_argument("--limit", type=int, default=None,
                        help="Only process the first N representative hits.")
    parser.add_argument("--no-dedupe", action="store_true",
                        help="Disable per-company dedupe (one Sonar batch per hit).")
    parser.add_argument("--no-fan-out", action="store_true",
                        help="When deduping, don't write the enrichment to sibling hits.")
    parser.add_argument("--delay", type=float, default=1.0,
                        help="Seconds to sleep between hits (default 1.0).")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    stats = enrich_all_recent_hits(
        days_back=args.days_back,
        limit=args.limit,
        dedupe_by_company=not args.no_dedupe,
        fan_out_siblings=not args.no_fan_out,
        delay_s=args.delay,
        dry_run=args.dry_run,
    )

    print("\n" + "=" * 78)
    print(" ENRICHMENT SUMMARY ")
    print("=" * 78)
    print(f"  Pending hits considered : {stats['pending_hits']}")
    print(f"  Representative hits run : {stats['reps_processed']}")
    print(f"  Rows queued for insert  : {stats['rows_to_insert']}")
    print(f"  Rows inserted           : {stats['rows_inserted']}")
    print(f"  Total Sonar API calls   : {stats['total_sonar_calls']}")
    print(f"  Estimated API cost      : ${stats['est_cost_usd']:.2f}  "
          f"(at ~${SONAR_EST_COST_PER_CALL:.3f}/call)")
    if stats["errors"]:
        print(f"  Errors                  : {len(stats['errors'])}")
        for hid, msg in list(stats["errors"].items())[:5]:
            print(f"    {hid}: {msg[:120]}")
    print("=" * 78)

    _print_examples(stats["examples"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
