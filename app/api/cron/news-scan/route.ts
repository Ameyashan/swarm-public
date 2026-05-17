import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  classifyByRules,
  classifyByLlm,
  shouldLlmClassify,
  type NewsItem,
  type Score,
} from "@/lib/nav/news"

// News scan — runs weekdays at 14:30 UTC (30 min before mark-positions).
// Pipeline:
//   1. Load the borrower universe (distinct names from position_benchmark_map
//      for GSCR + GSBD).
//   2. Pull recent 8-Ks for borrowers that have an SEC CIK (see SKETCH note).
//   3. Pull headlines from the configured feed (GDELT in v1).
//   4. Upsert into news_items, deduped on (source, source_id).
//   5. Score each new item (rules first; LLM fallback gated by
//      shouldLlmClassify to keep cost bounded).
//   6. Insert qualifying scores (severity ≥ 70) into detector_hits with
//      detector_name='news_event'. The existing daily NAV runner picks these
//      up via its 5-day lookback and converts severity into idio_shock_pct.
//
// SKETCH STATUS: ingestion fetchers are stubbed. To finish:
//   - Wire fetchEdgar8Ks() to python-pipeline/edgar_client (port to TS) or
//     call a small Python service. Map borrower → CIK via a borrower_cik
//     table (does not yet exist).
//   - Wire fetchHeadlines() to GDELT (free, no key) or swap the URL for a
//     paid feed. Borrower alias matching is the hard part; reuse whatever
//     normalization python-pipeline/entity_resolution.py settles on.
//   - Decide if ANTHROPIC_API_KEY is present in the runtime; the LLM branch
//     no-ops without it.

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = req.headers.get("authorization")
  if (header === `Bearer ${secret}`) return true
  const qp = req.nextUrl.searchParams.get("secret")
  return qp === secret
}

function supa() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

async function loadUniverse(funds: string[]): Promise<string[]> {
  const sb = supa()
  const { data, error } = await sb
    .from("position_benchmark_map")
    .select("portfolio_company_canonical")
    .in("fund_ticker", funds)
  if (error) throw new Error(`universe load: ${error.message}`)
  return Array.from(new Set((data ?? []).map((r: any) => r.portfolio_company_canonical)))
}

// ─── STUB ── EDGAR 8-K fetcher ────────────────────────────────────────────
async function fetchEdgar8Ks(_borrowers: string[]): Promise<NewsItem[]> {
  // TODO: borrower → CIK lookup, then EDGAR submissions JSON + 8-K parsing
  // to extract item_codes. See python-pipeline/edgar_client.py for the
  // rate-limit + User-Agent pattern that already works.
  return []
}

// ─── STUB ── Headline feed fetcher (GDELT default) ────────────────────────
async function fetchHeadlines(_borrowers: string[]): Promise<NewsItem[]> {
  // TODO: GDELT DOC API — https://api.gdeltproject.org/api/v2/doc/doc
  // Query per borrower (or batched OR-query) with mode=ArtList, format=JSON,
  // timespan=1d. Map article.title → NewsItem, dedupe by article.url as
  // source_id. Borrower matching needs alias logic; reuse the canonical name
  // resolution used elsewhere in the pipeline.
  return []
}

async function callClaude(prompt: string): Promise<string> {
  // Lazy import so the route doesn't fail when the SDK isn't installed.
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error("ANTHROPIC_API_KEY unset")
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 120,
      messages: [{ role: "user", content: prompt }],
    }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`anthropic: ${json?.error?.message ?? res.status}`)
  return json.content?.[0]?.text ?? ""
}

async function scoreItem(item: NewsItem): Promise<Score> {
  const r = classifyByRules(item)
  if (r) return r
  if (!shouldLlmClassify(item)) return { severity_100: 0, reason: "skipped (no risk keyword)", method: "skip", matched: null }
  if (!process.env.ANTHROPIC_API_KEY) return { severity_100: 0, reason: "llm disabled", method: "skip", matched: null }
  try {
    return await classifyByLlm(item, callClaude)
  } catch (err) {
    return { severity_100: 0, reason: `llm error: ${err instanceof Error ? err.message : err}`, method: "skip", matched: null }
  }
}

async function handle(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const sb = supa()
  const funds = ["GSCR", "GSBD"]
  const summary = {
    items_seen: 0,
    items_inserted: 0,
    hits_inserted: 0,
    llm_calls: 0,
    errors: [] as string[],
  }
  try {
    const borrowers = await loadUniverse(funds)
    const items = [
      ...(await fetchEdgar8Ks(borrowers)),
      ...(await fetchHeadlines(borrowers)),
    ]
    summary.items_seen = items.length
    if (items.length === 0) return NextResponse.json(summary)

    // Upsert news_items (dedupe on source+source_id via unique constraint).
    const { data: inserted, error: insErr } = await sb
      .from("news_items")
      .upsert(items, { onConflict: "source,source_id", ignoreDuplicates: true })
      .select("id, source, source_id, portfolio_company_canonical, title, url, published_at")
    if (insErr) summary.errors.push(`news_items upsert: ${insErr.message}`)
    const fresh = inserted ?? []
    summary.items_inserted = fresh.length

    // Score + write detector_hits for severity ≥ 70.
    const hits: Array<Record<string, any>> = []
    for (const row of fresh) {
      const item = items.find((i) => i.source === row.source && (i as any).source_id === row.source_id)
      if (!item) continue
      const s = await scoreItem(item)
      if (s.method === "llm") summary.llm_calls++
      if (s.severity_100 < 70) continue
      hits.push({
        detector_name: "news_event",
        fund_ticker: item.fund_ticker ?? null,
        portfolio_company_canonical: item.portfolio_company_canonical,
        severity_score: s.severity_100 / 100, // runner accepts 0..1 or 0..100
        hit_data: {
          source: item.source,
          title: item.title,
          published_at: item.published_at,
          method: s.method,
          matched: s.matched,
          reason: s.reason,
          news_item_id: row.id,
        },
        cited_source_urls: item.url ? [item.url] : [],
      })
    }
    if (hits.length > 0) {
      const { error: hitErr } = await sb.from("detector_hits").insert(hits)
      if (hitErr) summary.errors.push(`detector_hits insert: ${hitErr.message}`)
      else summary.hits_inserted = hits.length
    }
    return NextResponse.json(summary, { status: summary.errors.length ? 207 : 200 })
  } catch (err) {
    return NextResponse.json(
      { ...summary, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}

export async function GET(req: NextRequest) { return handle(req) }
export async function POST(req: NextRequest) { return handle(req) }
