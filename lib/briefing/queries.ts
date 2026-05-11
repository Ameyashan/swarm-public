import "server-only"
import { cache } from "react"
import { createClient } from "@/lib/supabase/server"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export const GOLDMAN_FUNDS = ["GSCR", "GSBD"] as const
export type GoldmanFund = (typeof GOLDMAN_FUNDS)[number]

// JSONB shapes from enrichments table. We keep these intentionally loose — the
// upstream pipeline writes the data and we only consume the few well-known
// fields. Each item is treated as optional/nullable to stay safe.
export type LitigationItem = {
  title?: string | null
  url?: string | null
  source?: string | null
  date?: string | null
  summary?: string | null
  description?: string | null
  case?: string | null
  jurisdiction?: string | null
}

export type ManagementChangeItem = {
  name?: string | null
  role?: string | null
  type?: string | null // "departure" | "appointment" | "promotion" etc.
  date?: string | null
  summary?: string | null
  description?: string | null
  url?: string | null
  source?: string | null
}

export type NewsItem = {
  title?: string | null
  url?: string | null
  source?: string | null
  date?: string | null
  summary?: string | null
  sentiment?: string | null // "positive" | "negative" | "neutral" | "watch"
}

export type DetectorHitRow = {
  id: string
  detector_name: string
  fund_ticker: string | null
  portfolio_company_canonical: string | null
  current_period_end: string | null
  prior_period_end: string | null
  severity_score: number | null
  hit_data: Record<string, any> | null
  cited_source_urls: string[] | null
  created_at: string | null
}

export type EnrichmentJoined = {
  detector_hit_id: string
  litigation_items: LitigationItem[] | null
  management_changes: ManagementChangeItem[] | null
  news_items: NewsItem[] | null
  hit: DetectorHitRow | null
}

export type FundPeerStats = {
  fund_ticker: string
  pik_pct: number | null
  na_pct: number | null
  na_count: number | null
  hit_count_latest_q: number | null
  total_fv_dollars: number | null
  period_end: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Convert severity_score (0..1) to a 0..100 integer for display. */
export function sevScore100(raw: number | null | undefined): number {
  const n = Number(raw ?? 0)
  if (!Number.isFinite(n)) return 0
  // Some pipelines store severity as 0..1, others as 0..100. Normalize.
  const v = Math.abs(n)
  return v <= 1 ? Math.round(v * 100) : Math.round(v)
}

/** Severity bucket — strict per spec. */
export function sevBucket(sev100: number): "critical" | "watch" | "info" {
  if (sev100 >= 70) return "critical"
  if (sev100 >= 40) return "watch"
  return "info"
}

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Top severity hits on Goldman funds since a recent cutoff. Used for the
 * editorial headline + the three "what changed" cards.
 */
export const getTopGoldmanHits = cache(async (limit = 12) => {
  const supabase = createClient()
  const { data, error } = await supabase
    .from("detector_hits")
    .select(
      "id, detector_name, fund_ticker, portfolio_company_canonical, current_period_end, prior_period_end, severity_score, hit_data, cited_source_urls, created_at",
    )
    .in("fund_ticker", GOLDMAN_FUNDS as unknown as string[])
    .order("severity_score", { ascending: false })
    .limit(limit)
    .returns<DetectorHitRow[]>()
  if (error) {
    console.error("getTopGoldmanHits error", error)
    return []
  }
  return data ?? []
})

/**
 * Most recent hits on Goldman funds — ordered by current_period_end to surface
 * "what changed in the most recent reporting period".
 */
export const getRecentGoldmanHits = cache(async (limit = 30) => {
  const supabase = createClient()
  const { data, error } = await supabase
    .from("detector_hits")
    .select(
      "id, detector_name, fund_ticker, portfolio_company_canonical, current_period_end, prior_period_end, severity_score, hit_data, cited_source_urls, created_at",
    )
    .in("fund_ticker", GOLDMAN_FUNDS as unknown as string[])
    .order("current_period_end", { ascending: false, nullsFirst: false })
    .order("severity_score", { ascending: false })
    .limit(limit)
    .returns<DetectorHitRow[]>()
  if (error) {
    console.error("getRecentGoldmanHits error", error)
    return []
  }
  return data ?? []
})

/**
 * Enrichment events (litigation / management / news) joined to their detector
 * hits for Goldman positions. Used for the forward-signals strip.
 *
 * Strategy: we cannot do a true SQL JOIN through PostgREST without a foreign
 * key relationship, but we *can* fetch enrichments and then look up their
 * detector_hits by id in a second query. Most enrichment tables in this
 * project are keyed off `detector_hit_id`, which gives us all we need.
 */
export const getGoldmanEnrichmentEvents = cache(async (limit = 40) => {
  const supabase = createClient()

  // 1) Get Goldman detector_hits ordered by severity (so strongest first).
  //    Cap at a generous slice — we only need enough to backfill `limit`
  //    rows after filtering to enrichments with non-empty arrays.
  const { data: goldmanHits, error: hitErr } = await supabase
    .from("detector_hits")
    .select(
      "id, detector_name, fund_ticker, portfolio_company_canonical, current_period_end, prior_period_end, severity_score, hit_data, cited_source_urls, created_at",
    )
    .in("fund_ticker", GOLDMAN_FUNDS as unknown as string[])
    .order("severity_score", { ascending: false, nullsFirst: false })
    .limit(500)
    .returns<DetectorHitRow[]>()

  if (hitErr) {
    console.error("getGoldmanEnrichmentEvents hit error", hitErr)
    return [] as EnrichmentJoined[]
  }
  const hits = goldmanHits ?? []
  if (hits.length === 0) return [] as EnrichmentJoined[]

  // 2) Fetch enrichments for those hit ids (chunked under PostgREST limits).
  type RawEnrich = {
    detector_hit_id: string
    litigation_items: LitigationItem[] | null
    management_changes: ManagementChangeItem[] | null
    news_items: NewsItem[] | null
  }
  const hitIds = hits.map((h) => h.id)
  const enrichRows: RawEnrich[] = []
  for (let i = 0; i < hitIds.length; i += 300) {
    const slice = hitIds.slice(i, i + 300)
    const { data, error } = await supabase
      .from("enrichments")
      .select(
        "detector_hit_id, litigation_items, management_changes, news_items",
      )
      .in("detector_hit_id", slice)
    if (error) {
      console.error("getGoldmanEnrichmentEvents enrich error", error)
      continue
    }
    for (const r of (data ?? []) as RawEnrich[]) enrichRows.push(r)
  }

  const byHitId = new Map<string, DetectorHitRow>(hits.map((h) => [h.id, h]))
  const joined: EnrichmentJoined[] = enrichRows
    .filter((r) => {
      const a = Array.isArray(r.litigation_items) ? r.litigation_items.length : 0
      const b = Array.isArray(r.management_changes) ? r.management_changes.length : 0
      const c = Array.isArray(r.news_items) ? r.news_items.length : 0
      return a + b + c > 0 && byHitId.has(r.detector_hit_id)
    })
    .map((r) => ({
      detector_hit_id: r.detector_hit_id,
      litigation_items: r.litigation_items ?? null,
      management_changes: r.management_changes ?? null,
      news_items: r.news_items ?? null,
      hit: byHitId.get(r.detector_hit_id) ?? null,
    }))
    .sort((a, b) => (b.hit?.severity_score ?? 0) - (a.hit?.severity_score ?? 0))
    .slice(0, limit)

  return joined
})

/**
 * Peer telemetry per fund — PIK share, non-accrual share/count, and total FV
 * at the latest reporting period for each fund. Used by the peer-rank panel.
 */
// The 6-BDC universe the peer telemetry panel always wants. We include
// Goldman first; remaining funds we discover get appended after.
const PEER_UNIVERSE = ["GSCR", "GSBD", "ARCC", "GBDC", "MAIN", "OBDC"]

export const getPeerTelemetry = cache(async () => {
  const supabase = createClient()

  // 1) Discover the live fund universe. Most BDCs in our cohort sit on the
  //    same latest period (e.g., 2026‑03‑31); GSCR may lag by a quarter.
  //    We can't trust a global `.limit(N)` here — the largest funds (GBDC,
  //    ARCC) each have >5k observations at the latest period and would
  //    evict GSCR. Instead we resolve each fund's *own* latest period
  //    independently.
  const { data: tickersData, error: tickersErr } = await supabase
    .from("observations")
    .select("fund_ticker")
    .limit(50000)
  if (tickersErr) {
    console.error("getPeerTelemetry tickers error", tickersErr)
  }
  const discovered = new Set<string>()
  for (const row of (tickersData ?? []) as { fund_ticker: string | null }[]) {
    if (row.fund_ticker) discovered.add(row.fund_ticker)
  }
  const tickers = Array.from(
    new Set([...PEER_UNIVERSE, ...Array.from(discovered)]),
  )

  // 2) Resolve the per-fund latest period, then fetch only that slice.
  type ObsRow = {
    fund_ticker: string
    period_end: string
    fair_value: number | string | null
    is_pik: boolean | null
    accrual_status: string | null
  }

  const latestByFund = new Map<string, string>()
  for (const ticker of tickers) {
    const { data, error } = await supabase
      .from("observations")
      .select("period_end")
      .eq("fund_ticker", ticker)
      .order("period_end", { ascending: false, nullsFirst: false })
      .limit(1)
    if (error) {
      console.error("getPeerTelemetry latest-period err", ticker, error)
      continue
    }
    const p = ((data ?? [])[0] as { period_end?: string } | undefined)?.period_end
    if (p) latestByFund.set(ticker, p)
  }
  if (latestByFund.size === 0) return [] as FundPeerStats[]

  const obsAccum: ObsRow[] = []
  for (const [ticker, period] of Array.from(latestByFund.entries())) {
    const { data, error } = await supabase
      .from("observations")
      .select("fund_ticker, period_end, fair_value, is_pik, accrual_status")
      .eq("fund_ticker", ticker)
      .eq("period_end", period)
    if (error) {
      console.error("getPeerTelemetry obs error", ticker, error)
      continue
    }
    for (const r of (data ?? []) as ObsRow[]) obsAccum.push(r)
  }

  // 3) Aggregate per fund.
  //    NOTE on scale: `observations.fair_value` is stored in **thousands**
  //    of dollars. We multiply by 1000 at this boundary so every downstream
  //    consumer (peer panels, briefing peer-rank, memo) can treat the value
  //    as whole dollars.
  const stats = new Map<string, FundPeerStats>()
  for (const row of obsAccum) {
    const t = row.fund_ticker
    if (!stats.has(t)) {
      stats.set(t, {
        fund_ticker: t,
        pik_pct: 0,
        na_pct: 0,
        na_count: 0,
        hit_count_latest_q: 0,
        total_fv_dollars: 0,
        period_end: row.period_end,
      })
    }
    const s = stats.get(t)!
    const fvThousands = Number(row.fair_value ?? 0)
    if (!Number.isFinite(fvThousands)) continue
    const fv = fvThousands * 1000
    s.total_fv_dollars = (s.total_fv_dollars ?? 0) + fv
    if (row.is_pik) s.pik_pct = (s.pik_pct ?? 0) + fv
    if (row.accrual_status === "non_accrual") {
      s.na_pct = (s.na_pct ?? 0) + fv
      s.na_count = (s.na_count ?? 0) + 1
    }
  }
  const statsArr = Array.from(stats.values())
  for (const s of statsArr) {
    const total = s.total_fv_dollars ?? 0
    s.pik_pct = total > 0 ? ((s.pik_pct ?? 0) / total) * 100 : 0
    s.na_pct = total > 0 ? ((s.na_pct ?? 0) / total) * 100 : 0
  }

  // 4) Hit counts for the latest quarter per fund.
  const { data: hitsData, error: hitsErr } = await supabase
    .from("detector_hits")
    .select("fund_ticker, current_period_end")
    .limit(20000)
  if (!hitsErr) {
    type HitRow = { fund_ticker: string; current_period_end: string }
    for (const row of (hitsData ?? []) as HitRow[]) {
      const s = stats.get(row.fund_ticker)
      if (!s) continue
      if (row.current_period_end && row.current_period_end === s.period_end) {
        s.hit_count_latest_q = (s.hit_count_latest_q ?? 0) + 1
      }
    }
  } else {
    console.error("getPeerTelemetry hits error", hitsErr)
  }

  return Array.from(stats.values()).sort(
    (a, b) => (b.total_fv_dollars ?? 0) - (a.total_fv_dollars ?? 0),
  )
})

/**
 * Litigation → mark-drift follow-up backtest. Computes, across the full
 * detector_hits/enrichments dataset, the fraction of borrower-litigation
 * events that were followed by *any* detector hit on the same name within
 * 9 months (270 days). Also returns the baseline: the same rate computed
 * over all borrower-quarter observations regardless of whether a litigation
 * event preceded them.
 */
export const getLitigationBacktest = cache(async () => {
  const supabase = createClient()

  // Litigation enrichment events — pair each with its hit so we can pull
  // borrower + fund + date.
  const { data: enrichRows, error: enrichErr } = await supabase
    .from("enrichments")
    .select("detector_hit_id, litigation_items")
    .limit(2000)
  if (enrichErr) {
    console.error("getLitigationBacktest enrich err", enrichErr)
    return null
  }

  type EnrichRow = {
    detector_hit_id: string
    litigation_items: LitigationItem[] | null
  }

  const litIds = ((enrichRows ?? []) as EnrichRow[])
    .filter((r) => Array.isArray(r.litigation_items) && r.litigation_items.length > 0)
    .map((r) => r.detector_hit_id)
  if (litIds.length === 0) return null

  type EventHit = {
    portfolio_company_canonical: string | null
    fund_ticker: string | null
    current_period_end: string | null
  }

  // Pull events in chunks to stay under PostgREST limits.
  const chunks: string[][] = []
  const chunkSize = 300
  for (let i = 0; i < litIds.length; i += chunkSize) {
    chunks.push(litIds.slice(i, i + chunkSize))
  }
  const events: EventHit[] = []
  for (const ids of chunks) {
    const { data, error } = await supabase
      .from("detector_hits")
      .select("portfolio_company_canonical, fund_ticker, current_period_end")
      .in("id", ids)
    if (error) {
      console.error("getLitigationBacktest event err", error)
      continue
    }
    for (const r of (data ?? []) as EventHit[]) events.push(r)
  }
  if (events.length === 0) return null

  // For each event, check whether any follow-up hit exists on the same
  // borrower within 270 days. We fetch borrower→hits in one batch.
  const borrowerNames = Array.from(
    new Set(events.map((e) => e.portfolio_company_canonical).filter(Boolean) as string[]),
  )
  if (borrowerNames.length === 0) return null

  type FollowHit = {
    portfolio_company_canonical: string | null
    fund_ticker: string | null
    current_period_end: string | null
  }
  // PostgREST `in` operator caps argument count — chunk borrower names too.
  const followups = new Map<string, FollowHit[]>()
  const nameChunks: string[][] = []
  for (let i = 0; i < borrowerNames.length; i += 200) {
    nameChunks.push(borrowerNames.slice(i, i + 200))
  }
  for (const names of nameChunks) {
    const { data, error } = await supabase
      .from("detector_hits")
      .select("portfolio_company_canonical, fund_ticker, current_period_end")
      .in("portfolio_company_canonical", names)
    if (error) {
      console.error("getLitigationBacktest followup err", error)
      continue
    }
    for (const r of (data ?? []) as FollowHit[]) {
      const k = r.portfolio_company_canonical ?? ""
      if (!followups.has(k)) followups.set(k, [])
      followups.get(k)!.push(r)
    }
  }

  const MS_PER_DAY = 1000 * 60 * 60 * 24
  const WINDOW_DAYS = 270
  let nEvents = 0
  let nWithHit = 0
  for (const ev of events) {
    if (!ev.portfolio_company_canonical || !ev.current_period_end) continue
    nEvents += 1
    const startMs = new Date(ev.current_period_end).getTime()
    if (!Number.isFinite(startMs)) continue
    const endMs = startMs + WINDOW_DAYS * MS_PER_DAY
    const candidates = followups.get(ev.portfolio_company_canonical) ?? []
    const hit = candidates.some((c) => {
      if (!c.current_period_end) return false
      if (c.fund_ticker !== ev.fund_ticker) return false
      const tMs = new Date(c.current_period_end).getTime()
      return Number.isFinite(tMs) && tMs > startMs && tMs <= endMs
    })
    if (hit) nWithHit += 1
  }

  // Baseline: across the broader detector_hits universe, what fraction of
  // borrower-quarter slots experienced a follow-up hit within 270 days?
  // We approximate with a representative sample of recent hits.
  let baselineN = 0
  let baselineWithHit = 0
  {
    const { data: baseRows, error } = await supabase
      .from("detector_hits")
      .select("portfolio_company_canonical, fund_ticker, current_period_end")
      .order("current_period_end", { ascending: false, nullsFirst: false })
      .limit(2000)
    if (!error) {
      type BaseRow = {
        portfolio_company_canonical: string | null
        fund_ticker: string | null
        current_period_end: string | null
      }
      const baseEvents = (baseRows ?? []) as BaseRow[]
      // Build a per-borrower index over the same sample so the comparison is
      // apples-to-apples with the litigation pathway above.
      const baseIdx = new Map<string, BaseRow[]>()
      for (const r of baseEvents) {
        const k = r.portfolio_company_canonical ?? ""
        if (!baseIdx.has(k)) baseIdx.set(k, [])
        baseIdx.get(k)!.push(r)
      }
      for (const ev of baseEvents) {
        if (!ev.portfolio_company_canonical || !ev.current_period_end) continue
        baselineN += 1
        const startMs = new Date(ev.current_period_end).getTime()
        if (!Number.isFinite(startMs)) continue
        const endMs = startMs + WINDOW_DAYS * MS_PER_DAY
        const candidates = baseIdx.get(ev.portfolio_company_canonical) ?? []
        const hit = candidates.some((c) => {
          if (!c.current_period_end) return false
          if (c.fund_ticker !== ev.fund_ticker) return false
          const tMs = new Date(c.current_period_end).getTime()
          return Number.isFinite(tMs) && tMs > startMs && tMs <= endMs
        })
        if (hit) baselineWithHit += 1
      }
    }
  }

  if (nEvents === 0) return null
  const hit_rate_pct = (100 * nWithHit) / nEvents
  const baseline_pct =
    baselineN > 0 ? (100 * baselineWithHit) / baselineN : null
  const lift = baseline_pct && baseline_pct > 0 ? hit_rate_pct / baseline_pct : null

  return {
    n_events: nEvents,
    n_with_followup: nWithHit,
    hit_rate_pct,
    baseline_pct,
    baseline_n: baselineN,
    lift,
  }
})

/**
 * Quarterly "what changed" classification: bucket recent Goldman hits into
 * critical / watch / info using the strict severity thresholds. Caller picks
 * the top hit in each bucket.
 */
export function bucketHits(hits: DetectorHitRow[]) {
  const critical: DetectorHitRow[] = []
  const watch: DetectorHitRow[] = []
  const info: DetectorHitRow[] = []
  for (const h of hits) {
    const sev = sevScore100(h.severity_score)
    const b = sevBucket(sev)
    if (b === "critical") critical.push(h)
    else if (b === "watch") watch.push(h)
    else info.push(h)
  }
  return { critical, watch, info }
}
