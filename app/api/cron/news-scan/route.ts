import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  classifyByRules,
  classifyByLlm,
  shouldLlmClassify,
  type NewsItem,
  type Score,
} from "@/lib/nav/news"
import { getRecent8Ks } from "@/lib/nav/edgar"
import { gdeltDateToIso, searchGdelt, searchTermFor } from "@/lib/nav/gdelt"
import { searchGoogleNews } from "@/lib/nav/google_news"

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
// 300s is Vercel Pro's serverless ceiling. EDGAR (≤20 CIKs) + GDELT + Google
// News run concurrently. Worst observed wall time ~4 min for the full
// universe; tune sharding if your plan caps below 300.
export const maxDuration = 300

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

// EDGAR 8-K fetcher. Pulls borrower→CIK rows then walks recent submissions
// for each CIK, keeping 8-Ks filed within `daysBack`. Empty universe (no
// borrower_cik rows) returns [] silently — that's the normal state until
// the table is seeded.
async function fetchEdgar8Ks(borrowers: string[], daysBack = 5): Promise<NewsItem[]> {
  if (borrowers.length === 0) return []
  const sb = supa()
  const { data, error } = await sb
    .from("borrower_cik")
    .select("portfolio_company_canonical, cik")
    .in("portfolio_company_canonical", borrowers)
  if (error) throw new Error(`borrower_cik load: ${error.message}`)
  const rows = (data ?? []) as Array<{ portfolio_company_canonical: string; cik: string }>
  if (rows.length === 0) return []
  const since = new Date(Date.now() - daysBack * 86_400_000).toISOString().slice(0, 10)
  const out: NewsItem[] = []
  for (const r of rows) {
    try {
      const filings = await getRecent8Ks(r.cik, since, 20)
      for (const f of filings) {
        out.push({
          source: "edgar_8k",
          source_id: f.accession_number,
          portfolio_company_canonical: r.portfolio_company_canonical,
          title: `8-K filed ${f.filing_date}${f.items.length ? ` — items ${f.items.join(", ")}` : ""}`,
          body: null,
          url: f.url,
          item_codes: f.items,
          published_at: `${f.filing_date}T00:00:00Z`,
        })
      }
    } catch (err) {
      // Swallow per-borrower errors so one bad CIK doesn't kill the whole scan.
      // The summary surfaces these via items_seen vs. items_inserted skew.
      console.warn(`edgar fetch failed for ${r.portfolio_company_canonical}:`, err)
    }
  }
  return out
}

// Load (canonical → aliases[]) once so both headline feeds share the lookup.
// Falls back to searchTermFor(canonical) when a borrower has no alias rows.
async function loadAliasMap(borrowers: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  if (borrowers.length === 0) return map
  const sb = supa()
  const { data, error } = await sb
    .from("borrower_alias")
    .select("portfolio_company_canonical, alias")
    .in("portfolio_company_canonical", borrowers)
  if (error) throw new Error(`borrower_alias load: ${error.message}`)
  for (const r of (data ?? []) as Array<{ portfolio_company_canonical: string; alias: string }>) {
    const list = map.get(r.portfolio_company_canonical) ?? []
    list.push(r.alias)
    map.set(r.portfolio_company_canonical, list)
  }
  for (const c of borrowers) if (!map.has(c)) map.set(c, [searchTermFor(c)])
  return map
}

// GDELT DOC API feed. One query per (borrower, alias). Articles deduped via
// news_items (source, source_id).
async function fetchGdelt(aliasMap: Map<string, string[]>): Promise<NewsItem[]> {
  const out: NewsItem[] = []
  for (const [canonical, aliases] of aliasMap) {
    for (const term of aliases) {
      if (!term || term.length < 3) continue
      try {
        const articles = await searchGdelt(term, "1d", 15)
        for (const a of articles) {
          out.push({
            source: "headline_feed",
            source_id: a.url,
            portfolio_company_canonical: canonical,
            title: a.title,
            body: null,
            url: a.url,
            item_codes: null,
            published_at: gdeltDateToIso(a.seendate),
          })
        }
      } catch (err) {
        console.warn(`gdelt fetch failed for ${canonical} (alias="${term}"):`, err)
      }
    }
  }
  return out
}

// Google News RSS feed. Covers private-LBO trade-press headlines that GDELT
// frequently misses. Same dedupe model as fetchGdelt.
async function fetchGoogleNews(aliasMap: Map<string, string[]>): Promise<NewsItem[]> {
  const out: NewsItem[] = []
  for (const [canonical, aliases] of aliasMap) {
    for (const term of aliases) {
      if (!term || term.length < 3) continue
      try {
        const articles = await searchGoogleNews(term, "1d", 15)
        for (const a of articles) {
          out.push({
            source: "google_news",
            source_id: a.url,
            portfolio_company_canonical: canonical,
            title: a.title,
            body: a.source_name ? `[${a.source_name}]` : null,
            url: a.url,
            item_codes: null,
            published_at: a.published_at,
          })
        }
      } catch (err) {
        console.warn(`google news fetch failed for ${canonical} (alias="${term}"):`, err)
      }
    }
  }
  return out
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
    const aliasMap = await loadAliasMap(borrowers)
    // Run all three fetchers concurrently — they hit different hosts and
    // each has its own per-host throttle, so there's no cross-interference.
    const [edgar, gdelt, gnews] = await Promise.all([
      fetchEdgar8Ks(borrowers),
      fetchGdelt(aliasMap),
      fetchGoogleNews(aliasMap),
    ])
    const items = [...edgar, ...gdelt, ...gnews]
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
      const item = items.find((i) => i.source === row.source && i.source_id === row.source_id)
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
