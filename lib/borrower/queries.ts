import "server-only"
import { cache } from "react"
import { createClient } from "@/lib/supabase/server"
import {
  GOLDMAN_FUNDS,
  type DetectorHitRow,
  type EnrichmentJoined,
  type LitigationItem,
  type ManagementChangeItem,
  type NewsItem,
  sevScore100,
} from "@/lib/briefing/queries"

export { GOLDMAN_FUNDS }

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type BorrowerMarkPoint = {
  fund_ticker: string
  period_end: string
  fv_dollars: number
  cost_dollars: number
  mark_pct: number | null
}

export type BorrowerMarkSeries = {
  fund_ticker: string
  is_goldman: boolean
  points: BorrowerMarkPoint[]
}

export type BorrowerLatestMark = {
  fund_ticker: string
  period_end: string | null
  fv_dollars: number
  cost_dollars: number
  mark_pct: number | null
  delta_vs_peer_pp: number | null // signed, in percentage points
  is_goldman: boolean
  accrual_status: string | null
  is_pik: boolean | null
}

export type BorrowerMeta = {
  canonical_name: string
  sponsor: string | null
  industry: string | null
  has_goldman: boolean
  funds_holding: string[]
  latest_period: string | null
  cross_fund_spread_pp: number | null
  worst_mark: BorrowerLatestMark | null
  best_mark: BorrowerLatestMark | null
  peer_median_mark_pct: number | null
  any_non_accrual: boolean
  any_pik: boolean
  has_critical_hit: boolean
  recent_hit_count: number
}

export type BorrowerEventPin = {
  id: string
  kind: "litigation" | "management" | "news"
  date: string
  title: string
}

export type BorrowerLeadingIndicator = {
  id: string
  kind: "litigation" | "management" | "news"
  date: string | null
  title: string
  body: string
  source_url: string | null
  source_label: string | null
  category_label: string // e.g. "trade secret", "appointment", "layoffs"
}

export type SponsorCrossCheckRow = {
  borrower: string
  fund_ticker: string | null
  latest_mark_pct: number | null
  fv_change_pct: number | null
  accrual_status: string | null
  severity_100: number
}

export type ImpliedNextMark = {
  leader_fund: string | null
  leader_mark_pct: number | null
  leader_periods_ahead: number
  goldman_next: Array<{ fund_ticker: string; current_mark_pct: number | null; implied_pct: number | null }>
  implied_loss_dollars: number | null
  rationale: string
  confidence: "low" | "moderate" | "high"
}

export type BorrowerBacktest = {
  scope: "all" | "borrower-specific"
  n_spread_events: number
  n_with_litigation_prior: number
  pct_with_litigation_prior: number | null
  n_with_management_prior: number
  pct_with_management_prior: number | null
  n_with_news_prior: number
  pct_with_news_prior: number | null
  methodology_note: string
}

export type BorrowerXray = {
  meta: BorrowerMeta
  series: BorrowerMarkSeries[]
  events: BorrowerEventPin[]
  leading_indicators: BorrowerLeadingIndicator[]
  latest_marks: BorrowerLatestMark[]
  sponsor_cross_check: SponsorCrossCheckRow[]
  implied: ImpliedNextMark | null
  backtest: BorrowerBacktest | null
  quarters_rendered: number
  note: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function asString(v: any): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === "string") return v.trim() || null
  return null
}

function asNumber(v: any): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]
}

function isGoldman(ticker: string | null): boolean {
  return ticker === "GSCR" || ticker === "GSBD"
}

// ─────────────────────────────────────────────────────────────────────────────
// Borrower mark history (cross-fund, by period)
// ─────────────────────────────────────────────────────────────────────────────

type RawObsRow = {
  fund_ticker: string | null
  period_end: string | null
  fair_value: number | string | null
  cost: number | string | null
  is_pik: boolean | null
  accrual_status: string | null
}

const CUTOFF = "2024-03-31"

async function fetchObservations(name: string): Promise<RawObsRow[]> {
  const supabase = createClient()
  // 1) Exact canonical match (the common case).
  const exact = await supabase
    .from("observations")
    .select("fund_ticker, period_end, fair_value, cost, is_pik, accrual_status")
    .eq("portfolio_company_canonical", name)
    .gte("period_end", CUTOFF)
    .order("period_end", { ascending: true })
    .limit(10000)
  if (exact.error) {
    console.error("borrower fetchObservations err", name, exact.error)
    return []
  }
  if ((exact.data ?? []).length > 0) return exact.data as RawObsRow[]

  // 2) Fuzzy prefix fallback — handles cases where the URL slug is missing
  //    a corporate suffix (e.g., "MRI Software" → "MRI Software LLC") or
  //    only the first word of the canonical name was passed.
  const fuzzy = await supabase
    .from("observations")
    .select("fund_ticker, period_end, fair_value, cost, is_pik, accrual_status")
    .ilike("portfolio_company_canonical", `${name}%`)
    .gte("period_end", CUTOFF)
    .order("period_end", { ascending: true })
    .limit(10000)
  if (fuzzy.error) {
    console.error("borrower fetchObservations fuzzy err", name, fuzzy.error)
    return []
  }
  if ((fuzzy.data ?? []).length > 0) {
    console.warn("borrower fetchObservations · fuzzy match used", name)
  }
  return (fuzzy.data ?? []) as RawObsRow[]
}

function aggregateMarkSeries(rows: RawObsRow[]): {
  series: BorrowerMarkSeries[]
  periods: string[]
} {
  // Bucket by fund_ticker x period_end (handle multi-tranche positions by sum).
  type Bucket = { fv: number; cost: number }
  const map = new Map<string, Map<string, Bucket>>() // fund -> period -> bucket
  const periodSet = new Set<string>()
  for (const r of rows) {
    if (!r.fund_ticker || !r.period_end) continue
    const fund = r.fund_ticker
    const period = r.period_end
    periodSet.add(period)
    if (!map.has(fund)) map.set(fund, new Map())
    const periodMap = map.get(fund)!
    if (!periodMap.has(period)) periodMap.set(period, { fv: 0, cost: 0 })
    const b = periodMap.get(period)!
    // observations.fair_value / cost are stored in thousands of dollars;
    // multiply by 1000 here so downstream components show real magnitudes.
    const fv = Number(r.fair_value ?? 0) * 1000
    const cost = Number(r.cost ?? 0) * 1000
    if (Number.isFinite(fv)) b.fv += fv
    if (Number.isFinite(cost)) b.cost += cost
  }

  const series: BorrowerMarkSeries[] = []
  Array.from(map.entries()).forEach(([fund, periodMap]) => {
    const points: BorrowerMarkPoint[] = []
    const periods = Array.from(periodMap.keys()).sort()
    for (const p of periods) {
      const b = periodMap.get(p)!
      const mark = b.cost > 0 ? (b.fv / b.cost) * 100 : null
      points.push({
        fund_ticker: fund,
        period_end: p,
        fv_dollars: Math.round(b.fv),
        cost_dollars: Math.round(b.cost),
        mark_pct: mark === null ? null : Math.round(mark * 10) / 10,
      })
    }
    series.push({ fund_ticker: fund, is_goldman: isGoldman(fund), points })
  })

  // Sort series: Goldman funds first (GSCR, GSBD), then by total FV at latest period desc.
  const fundOrderKey = (s: BorrowerMarkSeries): number => {
    if (s.fund_ticker === "GSCR") return -2
    if (s.fund_ticker === "GSBD") return -1
    return 0
  }
  series.sort((a, b) => {
    const ka = fundOrderKey(a)
    const kb = fundOrderKey(b)
    if (ka !== kb) return ka - kb
    const aFv = a.points[a.points.length - 1]?.fv_dollars ?? 0
    const bFv = b.points[b.points.length - 1]?.fv_dollars ?? 0
    return bFv - aFv
  })

  return { series, periods: Array.from(periodSet).sort() }
}

// ─────────────────────────────────────────────────────────────────────────────
// Latest marks + peer median deltas
// ─────────────────────────────────────────────────────────────────────────────

function computeLatestMarks(
  series: BorrowerMarkSeries[],
  rawRows: RawObsRow[],
): {
  latest: BorrowerLatestMark[]
  latestPeriod: string | null
  spreadPp: number | null
  peerMedian: number | null
} {
  if (series.length === 0) {
    return { latest: [], latestPeriod: null, spreadPp: null, peerMedian: null }
  }
  // Determine the overall latest period across all funds.
  let latestPeriod: string | null = null
  for (const s of series) {
    for (const p of s.points) {
      if (latestPeriod === null || p.period_end > latestPeriod) latestPeriod = p.period_end
    }
  }
  if (!latestPeriod) {
    return { latest: [], latestPeriod: null, spreadPp: null, peerMedian: null }
  }

  // For each fund, pick its most recent point at-or-before the overall latest period.
  // (Some funds may not report at the latest period — fall back to their own latest.)
  type Row = BorrowerLatestMark
  const rows: Row[] = []
  for (const s of series) {
    if (s.points.length === 0) continue
    // Prefer the exact latest period; else the fund's own latest point.
    let chosen = s.points.find((p) => p.period_end === latestPeriod) ?? null
    if (!chosen) chosen = s.points[s.points.length - 1]
    if (!chosen) continue
    const accrual = pickLatestAccrual(rawRows, s.fund_ticker, chosen.period_end)
    const pik = pickLatestPik(rawRows, s.fund_ticker, chosen.period_end)
    rows.push({
      fund_ticker: s.fund_ticker,
      period_end: chosen.period_end,
      fv_dollars: chosen.fv_dollars,
      cost_dollars: chosen.cost_dollars,
      mark_pct: chosen.mark_pct,
      delta_vs_peer_pp: null,
      is_goldman: s.is_goldman,
      accrual_status: accrual,
      is_pik: pik,
    })
  }

  // Compute peer median on all funds with a usable mark_pct in this snapshot.
  const marks = rows.map((r) => r.mark_pct).filter((x): x is number => x !== null)
  const peerMedian = median(marks)
  if (peerMedian !== null) {
    for (const r of rows) {
      if (r.mark_pct === null) continue
      r.delta_vs_peer_pp = Math.round((r.mark_pct - peerMedian) * 10) / 10
    }
  }

  const spreadPp = marks.length >= 2 ? Math.round((Math.max(...marks) - Math.min(...marks)) * 10) / 10 : null

  // Sort: Goldman first, then by FV desc.
  rows.sort((a, b) => {
    if (a.is_goldman !== b.is_goldman) return a.is_goldman ? -1 : 1
    return b.fv_dollars - a.fv_dollars
  })

  return { latest: rows, latestPeriod, spreadPp, peerMedian }
}

function pickLatestAccrual(
  raw: RawObsRow[],
  fund: string,
  period: string,
): string | null {
  const row = raw.find((r) => r.fund_ticker === fund && r.period_end === period)
  return asString(row?.accrual_status ?? null)
}
function pickLatestPik(
  raw: RawObsRow[],
  fund: string,
  period: string,
): boolean | null {
  const matching = raw.filter((r) => r.fund_ticker === fund && r.period_end === period)
  if (matching.length === 0) return null
  return matching.some((r) => r.is_pik === true)
}

// ─────────────────────────────────────────────────────────────────────────────
// Borrower meta (sponsor, sector, hits)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchBorrowerCanonical(name: string): Promise<{
  sponsor: string | null
  industry: string | null
} | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from("borrower_canonical")
    .select("sponsor, industry, sector")
    .eq("canonical_name", name)
    .limit(1)
  if (error) return null
  const row = (data?.[0] ?? null) as
    | { sponsor: string | null; industry: string | null; sector: string | null }
    | null
  if (!row) return null
  return {
    sponsor: asString(row.sponsor),
    industry: asString(row.industry) ?? asString(row.sector),
  }
}

async function fetchBorrowerHits(name: string, limit = 200): Promise<DetectorHitRow[]> {
  const supabase = createClient()
  const selectCols =
    "id, detector_name, fund_ticker, portfolio_company_canonical, current_period_end, prior_period_end, severity_score, hit_data, cited_source_urls, created_at"
  const exact = await supabase
    .from("detector_hits")
    .select(selectCols)
    .eq("portfolio_company_canonical", name)
    .order("current_period_end", { ascending: false, nullsFirst: false })
    .limit(limit)
    .returns<DetectorHitRow[]>()
  if (exact.error) {
    console.error("borrower fetchBorrowerHits err", name, exact.error)
    return []
  }
  if ((exact.data ?? []).length > 0) return exact.data ?? []

  // Fuzzy fallback — same rationale as fetchObservations.
  const fuzzy = await supabase
    .from("detector_hits")
    .select(selectCols)
    .ilike("portfolio_company_canonical", `${name}%`)
    .order("current_period_end", { ascending: false, nullsFirst: false })
    .limit(limit)
    .returns<DetectorHitRow[]>()
  if (fuzzy.error) {
    console.error("borrower fetchBorrowerHits fuzzy err", name, fuzzy.error)
    return []
  }
  return fuzzy.data ?? []
}

function deriveSponsorFromHits(hits: DetectorHitRow[]): string | null {
  for (const h of hits) {
    const hd = h.hit_data ?? {}
    const s =
      asString(hd.sponsor) ||
      asString(hd.sponsor_name) ||
      asString(hd.private_equity_sponsor) ||
      null
    if (s) return s
  }
  return null
}

function deriveIndustryFromHits(hits: DetectorHitRow[]): string | null {
  for (const h of hits) {
    const hd = h.hit_data ?? {}
    const s =
      asString(hd.industry) ||
      asString(hd.sector) ||
      asString(hd.gics_industry) ||
      asString(hd.borrower_industry) ||
      null
    if (s) return s
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Events from enrichments joined to this borrower's hits
// ─────────────────────────────────────────────────────────────────────────────

async function fetchBorrowerEnrichments(
  hitIds: string[],
): Promise<EnrichmentJoined[]> {
  if (hitIds.length === 0) return []
  const supabase = createClient()
  // Chunk by 200 for safety (PostgREST `in` arg cap).
  const chunks: string[][] = []
  for (let i = 0; i < hitIds.length; i += 200) {
    chunks.push(hitIds.slice(i, i + 200))
  }
  type Raw = {
    detector_hit_id: string
    litigation_items: LitigationItem[] | null
    management_changes: ManagementChangeItem[] | null
    news_items: NewsItem[] | null
  }
  const all: Raw[] = []
  for (const ids of chunks) {
    const { data, error } = await supabase
      .from("enrichments")
      .select("detector_hit_id, litigation_items, management_changes, news_items")
      .in("detector_hit_id", ids)
    if (error) {
      console.error("borrower fetchBorrowerEnrichments err", error)
      continue
    }
    for (const r of (data ?? []) as Raw[]) all.push(r)
  }
  return all.map((r) => ({
    detector_hit_id: r.detector_hit_id,
    litigation_items: r.litigation_items ?? null,
    management_changes: r.management_changes ?? null,
    news_items: r.news_items ?? null,
    hit: null,
  }))
}

function categoryForLitigation(li: LitigationItem): string {
  const t = (asString(li.title) ?? "").toLowerCase()
  const s = (asString(li.summary) ?? asString(li.description) ?? "").toLowerCase()
  const blob = `${t} ${s}`
  if (blob.includes("trade secret")) return "trade secret"
  if (blob.includes("non-compete") || blob.includes("noncompete")) return "non-compete"
  if (blob.includes("breach of contract") || blob.includes("contract")) return "contract dispute"
  if (blob.includes("eeoc") || blob.includes("discrimination")) return "employment"
  if (blob.includes("class action")) return "class action"
  return "litigation"
}

function categoryForMgmt(mi: ManagementChangeItem): string {
  const t = (asString(mi.type) ?? "").toLowerCase()
  if (t === "departure" || t === "exit") return "departure"
  if (t === "appointment" || t === "hire") return "appointment"
  if (t === "promotion") return "promotion"
  return t || "management change"
}

function categoryForNews(ni: NewsItem): string {
  const sentiment = (asString(ni.sentiment) ?? "").toLowerCase()
  if (sentiment) return sentiment
  return "news"
}

function buildEventPinsAndLeads(enrich: EnrichmentJoined[]): {
  pins: BorrowerEventPin[]
  leads: BorrowerLeadingIndicator[]
} {
  const pins: BorrowerEventPin[] = []
  const leads: BorrowerLeadingIndicator[] = []
  const seenLead = new Set<string>()
  let id = 0
  for (const j of enrich) {
    const lit = Array.isArray(j.litigation_items) ? j.litigation_items : []
    for (const li of lit) {
      const date = asString(li.date)
      const title = asString(li.title) ?? asString(li.case) ?? "Litigation event"
      if (date) {
        pins.push({ id: `pin-${id++}`, kind: "litigation", date, title })
      }
      const key = `lit:${title}`
      if (!seenLead.has(key)) {
        seenLead.add(key)
        leads.push({
          id: `lead-lit-${id}`,
          kind: "litigation",
          date,
          title,
          body:
            asString(li.summary) ??
            asString(li.description) ??
            `Litigation disclosure surfaced via enrichment pipeline.${
              asString(li.jurisdiction) ? ` Jurisdiction: ${asString(li.jurisdiction)}.` : ""
            }`,
          source_url: asString(li.url),
          source_label: asString(li.source) ?? asString(li.case),
          category_label: categoryForLitigation(li),
        })
      }
    }
    const mgmt = Array.isArray(j.management_changes) ? j.management_changes : []
    for (const mi of mgmt) {
      const date = asString(mi.date)
      const who = asString(mi.name)
      const role = asString(mi.role)
      const t = asString(mi.type)
      const title = who
        ? `${who}${role ? ` (${role})` : ""}${t ? ` — ${t}` : ""}`
        : asString(mi.summary) ?? "Management change"
      if (date) pins.push({ id: `pin-${id++}`, kind: "management", date, title })
      const key = `mgmt:${title}`
      if (!seenLead.has(key)) {
        seenLead.add(key)
        leads.push({
          id: `lead-mgmt-${id}`,
          kind: "management",
          date,
          title,
          body:
            asString(mi.summary) ??
            asString(mi.description) ??
            `${who ?? "An executive"} change. Management transitions historically precede mark-drift hits in a meaningful share of cases.`,
          source_url: asString(mi.url),
          source_label: asString(mi.source),
          category_label: categoryForMgmt(mi),
        })
      }
    }
    const news = Array.isArray(j.news_items) ? j.news_items : []
    for (const ni of news) {
      const date = asString(ni.date)
      const title = asString(ni.title) ?? "News event"
      if (date) pins.push({ id: `pin-${id++}`, kind: "news", date, title })
      const key = `news:${title}`
      if (!seenLead.has(key)) {
        seenLead.add(key)
        leads.push({
          id: `lead-news-${id}`,
          kind: "news",
          date,
          title,
          body:
            asString(ni.summary) ??
            "External / press coverage surfaced by the enrichment pipeline.",
          source_url: asString(ni.url),
          source_label: asString(ni.source),
          category_label: categoryForNews(ni),
        })
      }
    }
  }
  // Sort pins by date asc; leads by date desc (most recent first).
  pins.sort((a, b) => a.date.localeCompare(b.date))
  leads.sort((a, b) => {
    const ad = a.date ?? ""
    const bd = b.date ?? ""
    return bd.localeCompare(ad)
  })
  return { pins, leads }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sponsor cross-check
// ─────────────────────────────────────────────────────────────────────────────

async function fetchSponsorCrossCheck(
  borrower: string,
  sponsor: string | null,
): Promise<SponsorCrossCheckRow[]> {
  if (!sponsor) return []
  const supabase = createClient()
  // Pull a wide slice of Goldman detector hits, then filter by sponsor in hit_data.
  // (We may also have sponsor on borrower_canonical, but a hit_data scan is the
  // most reliable cross-cut here.)
  const { data, error } = await supabase
    .from("detector_hits")
    .select(
      "id, detector_name, fund_ticker, portfolio_company_canonical, current_period_end, severity_score, hit_data",
    )
    .in("fund_ticker", GOLDMAN_FUNDS as unknown as string[])
    .order("current_period_end", { ascending: false, nullsFirst: false })
    .limit(4000)
  if (error) {
    console.error("borrower fetchSponsorCrossCheck err", error)
    return []
  }
  type Row = {
    id: string
    detector_name: string
    fund_ticker: string | null
    portfolio_company_canonical: string | null
    current_period_end: string | null
    severity_score: number | null
    hit_data: Record<string, any> | null
  }
  const rows = (data ?? []) as Row[]
  const sponsorLc = sponsor.toLowerCase()
  // Use a separate borrower_canonical scan to widen sponsor matches too.
  const supplemental = await fetchBorrowersBySponsor(sponsor)
  const supplementalSet = new Set(supplemental.map((b) => b.toLowerCase()))

  type Acc = SponsorCrossCheckRow & { _period: string | null }
  const byBorrower = new Map<string, Acc>()
  for (const r of rows) {
    const b = r.portfolio_company_canonical
    if (!b) continue
    if (b === borrower) continue
    const hd = r.hit_data ?? {}
    const hdSponsor =
      asString(hd.sponsor) ||
      asString(hd.sponsor_name) ||
      asString(hd.private_equity_sponsor) ||
      null
    const hdSponsorMatch = hdSponsor !== null && hdSponsor.toLowerCase() === sponsorLc
    const supplementalMatch = supplementalSet.has(b.toLowerCase())
    if (!hdSponsorMatch && !supplementalMatch) continue
    const fv = asNumber(hd.current_fv) ?? asNumber(hd.fv_current) ?? null
    const cost = asNumber(hd.current_cost) ?? asNumber(hd.cost_current) ?? null
    const markPct = fv !== null && cost && cost > 0 ? Math.round((fv / cost) * 1000) / 10 : null
    const fvChange = asNumber(hd.fv_change_pct)
    const accrual = asString(hd.accrual_status) || asString(hd.current_accrual_status)
    const sev = sevScore100(r.severity_score)
    const existing = byBorrower.get(b)
    const candidate: Acc = {
      borrower: b,
      fund_ticker: r.fund_ticker,
      latest_mark_pct: markPct,
      fv_change_pct: fvChange ?? null,
      accrual_status: accrual,
      severity_100: sev,
      _period: r.current_period_end,
    }
    if (!existing) {
      byBorrower.set(b, candidate)
      continue
    }
    // Keep the most recent.
    if ((candidate._period ?? "") > (existing._period ?? "")) {
      byBorrower.set(b, candidate)
    }
  }

  const out: SponsorCrossCheckRow[] = Array.from(byBorrower.values()).map((r) => ({
    borrower: r.borrower,
    fund_ticker: r.fund_ticker,
    latest_mark_pct: r.latest_mark_pct,
    fv_change_pct: r.fv_change_pct,
    accrual_status: r.accrual_status,
    severity_100: r.severity_100,
  }))
  // Sort: non-accrual first, then by abs(fv_change_pct), then severity.
  out.sort((a, b) => {
    const an = a.accrual_status === "non_accrual" ? 1 : 0
    const bn = b.accrual_status === "non_accrual" ? 1 : 0
    if (an !== bn) return bn - an
    const ac = Math.abs(a.fv_change_pct ?? 0)
    const bc = Math.abs(b.fv_change_pct ?? 0)
    if (ac !== bc) return bc - ac
    return b.severity_100 - a.severity_100
  })
  return out.slice(0, 6)
}

async function fetchBorrowersBySponsor(sponsor: string): Promise<string[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from("borrower_canonical")
    .select("canonical_name, sponsor")
    .eq("sponsor", sponsor)
    .limit(50)
  if (error) return []
  type R = { canonical_name: string | null }
  return ((data ?? []) as R[]).map((r) => r.canonical_name).filter(Boolean) as string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Implied next mark (deterministic heuristic)
// ─────────────────────────────────────────────────────────────────────────────

function buildImpliedNextMark(
  series: BorrowerMarkSeries[],
  latest: BorrowerLatestMark[],
  hits: DetectorHitRow[],
): ImpliedNextMark | null {
  if (latest.length < 2) return null
  // Determine the "leader" — non-Goldman fund with the lowest (most conservative) latest mark_pct.
  const candidates = latest.filter((l) => !l.is_goldman && l.mark_pct !== null)
  const goldman = latest.filter((l) => l.is_goldman)
  if (candidates.length === 0 || goldman.length === 0) return null
  const leader = candidates.reduce<BorrowerLatestMark | null>((acc, l) => {
    if (!acc) return l
    if ((l.mark_pct ?? 100) < (acc.mark_pct ?? 100)) return l
    return acc
  }, null)
  if (!leader || leader.mark_pct === null) return null

  // Count how many of the last 6 cross-fund moves the leader was first to mark down.
  // Use the leader's series to count quarters where it cut more than Goldman.
  const leaderSeries = series.find((s) => s.fund_ticker === leader.fund_ticker)
  let leaderFirstCount = 0
  let movesObserved = 0
  if (leaderSeries) {
    for (const goldFund of goldman) {
      const gSeries = series.find((s) => s.fund_ticker === goldFund.fund_ticker)
      if (!gSeries) continue
      const pairs: Array<{ p: string; lead: number; gold: number }> = []
      for (const lp of leaderSeries.points) {
        if (lp.mark_pct === null) continue
        const gp = gSeries.points.find((x) => x.period_end === lp.period_end)
        if (!gp || gp.mark_pct === null) continue
        pairs.push({ p: lp.period_end, lead: lp.mark_pct, gold: gp.mark_pct })
      }
      // Consider consecutive pairs.
      for (let i = 1; i < pairs.length; i++) {
        const prev = pairs[i - 1]
        const cur = pairs[i]
        const leadCut = cur.lead - prev.lead
        const goldCut = cur.gold - prev.gold
        // Cross-fund "move" = either fund cut ≥ 0.5pp.
        if (Math.min(leadCut, goldCut) <= -0.5) {
          movesObserved += 1
          if (leadCut < goldCut) leaderFirstCount += 1
        }
      }
    }
  }
  const lastSix = Math.min(6, movesObserved)

  // Implied next: half-converge each Goldman fund toward the leader's current mark.
  const goldmanNext = goldman.map((g) => {
    if (g.mark_pct === null) {
      return { fund_ticker: g.fund_ticker, current_mark_pct: null, implied_pct: null }
    }
    const gap = (leader.mark_pct as number) - g.mark_pct
    const implied = g.mark_pct + 0.5 * gap
    return {
      fund_ticker: g.fund_ticker,
      current_mark_pct: Math.round(g.mark_pct * 10) / 10,
      implied_pct: Math.round(implied * 10) / 10,
    }
  })

  // Implied combined loss in dollars: (implied - current) * cost.
  let lossDollars = 0
  let lossKnown = false
  for (const g of goldman) {
    const next = goldmanNext.find((x) => x.fund_ticker === g.fund_ticker)
    if (!next || next.implied_pct === null || next.current_mark_pct === null) continue
    if (g.cost_dollars <= 0) continue
    const deltaPct = next.implied_pct - next.current_mark_pct
    const dollarChange = (deltaPct / 100) * g.cost_dollars
    lossDollars += dollarChange
    lossKnown = true
  }

  // Severity / recent event evidence for confidence labeling.
  const recentSev = hits.length > 0 ? Math.max(...hits.map((h) => sevScore100(h.severity_score))) : 0
  let confidence: "low" | "moderate" | "high" = "low"
  if (recentSev >= 70 || (lastSix >= 3 && leaderFirstCount >= 2)) confidence = "high"
  else if (recentSev >= 40 || leaderFirstCount >= 1) confidence = "moderate"

  const rationale =
    lastSix > 0
      ? `${leader.fund_ticker} has been first to mark down in ${leaderFirstCount} of the last ${lastSix} cross-fund moves on this security. If ${leader.fund_ticker} continues to lead, Goldman marks half-converge toward ${leader.fund_ticker}'s current mark.`
      : `${leader.fund_ticker} holds the lowest current mark in the cohort. With limited paired-quarter history, the implied next mark assumes Goldman half-converges toward the cohort leader.`

  return {
    leader_fund: leader.fund_ticker,
    leader_mark_pct: leader.mark_pct === null ? null : Math.round(leader.mark_pct * 10) / 10,
    leader_periods_ahead: lastSix,
    goldman_next: goldmanNext,
    implied_loss_dollars: lossKnown ? Math.round(lossDollars) : null,
    rationale,
    confidence,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reverse backtest
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute: among cross-fund spread events with spread >= 1pp on any borrower,
 * what share were preceded by a litigation enrichment event in the prior 6
 * months on the same borrower. Computed read-only from the existing
 * detector_hits + enrichments universe.
 */
const getBacktestAcrossUniverse = cache(async (): Promise<BorrowerBacktest | null> => {
  const supabase = createClient()
  // 1) Pull all cross-fund_divergence hits in a reasonable slice.
  const { data: xHits, error: xErr } = await supabase
    .from("detector_hits")
    .select("portfolio_company_canonical, current_period_end, hit_data")
    .eq("detector_name", "cross_fund_divergence")
    .order("current_period_end", { ascending: false, nullsFirst: false })
    .limit(4000)
  if (xErr) {
    console.error("backtest xHits err", xErr)
    return null
  }
  type XR = {
    portfolio_company_canonical: string | null
    current_period_end: string | null
    hit_data: Record<string, any> | null
  }
  const spreadEvents = ((xHits ?? []) as XR[]).filter((r) => {
    const sp = asNumber(r.hit_data?.spread_pp)
    // hit_data spread is typically a fraction (0..1). If <=1 treat as fraction; else as pp.
    const ppValue = sp === null ? null : sp <= 1 ? sp * 100 : sp
    return r.portfolio_company_canonical && r.current_period_end && ppValue !== null && ppValue >= 1
  })

  if (spreadEvents.length === 0) {
    return {
      scope: "all",
      n_spread_events: 0,
      n_with_litigation_prior: 0,
      pct_with_litigation_prior: null,
      n_with_management_prior: 0,
      pct_with_management_prior: null,
      n_with_news_prior: 0,
      pct_with_news_prior: null,
      methodology_note:
        "No cross-fund spread events ≥ 1pp present in the detector_hits universe over the available slice.",
    }
  }

  // 2) Pull all enrichments and their hit IDs. Then for each spread event,
  // look up litigation / management / news items dated within the prior 6
  // months on the same borrower.
  const borrowerNames = Array.from(
    new Set(spreadEvents.map((e) => e.portfolio_company_canonical).filter(Boolean) as string[]),
  )
  if (borrowerNames.length === 0) return null

  // Resolve enrichments → borrower via detector_hits join.
  // Pull detector_hits for these borrowers to get a borrower → hit map.
  const hitsByBorrower = new Map<string, { id: string; date: string | null }[]>()
  const nameChunks: string[][] = []
  for (let i = 0; i < borrowerNames.length; i += 200) nameChunks.push(borrowerNames.slice(i, i + 200))
  const hitIds: string[] = []
  for (const ns of nameChunks) {
    const { data, error } = await supabase
      .from("detector_hits")
      .select("id, portfolio_company_canonical, current_period_end")
      .in("portfolio_company_canonical", ns)
    if (error) continue
    type H = { id: string; portfolio_company_canonical: string | null; current_period_end: string | null }
    for (const r of (data ?? []) as H[]) {
      if (!r.portfolio_company_canonical) continue
      hitIds.push(r.id)
      if (!hitsByBorrower.has(r.portfolio_company_canonical))
        hitsByBorrower.set(r.portfolio_company_canonical, [])
      hitsByBorrower
        .get(r.portfolio_company_canonical)!
        .push({ id: r.id, date: r.current_period_end })
    }
  }

  if (hitIds.length === 0) return null

  // Pull enrichments keyed by hit id.
  type ER = {
    detector_hit_id: string
    litigation_items: LitigationItem[] | null
    management_changes: ManagementChangeItem[] | null
    news_items: NewsItem[] | null
  }
  const enrichByHit = new Map<string, ER>()
  const idChunks: string[][] = []
  for (let i = 0; i < hitIds.length; i += 200) idChunks.push(hitIds.slice(i, i + 200))
  for (const ids of idChunks) {
    const { data, error } = await supabase
      .from("enrichments")
      .select("detector_hit_id, litigation_items, management_changes, news_items")
      .in("detector_hit_id", ids)
    if (error) continue
    for (const r of (data ?? []) as ER[]) enrichByHit.set(r.detector_hit_id, r)
  }

  const MS_PER_DAY = 1000 * 60 * 60 * 24
  const WINDOW = 180 * MS_PER_DAY
  let withLit = 0
  let withMgmt = 0
  let withNews = 0
  for (const ev of spreadEvents) {
    const borrower = ev.portfolio_company_canonical!
    const evMs = new Date(ev.current_period_end!).getTime()
    if (!Number.isFinite(evMs)) continue
    const hitsForBorrower = hitsByBorrower.get(borrower) ?? []
    // Window: [evMs - 180d, evMs)
    const enrichmentsForBorrower = hitsForBorrower
      .map((h) => enrichByHit.get(h.id))
      .filter((x): x is ER => Boolean(x))

    let hasLit = false
    let hasMgmt = false
    let hasNews = false
    for (const e of enrichmentsForBorrower) {
      // litigation
      const lit = Array.isArray(e.litigation_items) ? e.litigation_items : []
      for (const li of lit) {
        const d = asString(li.date)
        const t = d ? new Date(d).getTime() : NaN
        if (Number.isFinite(t) && t >= evMs - WINDOW && t < evMs) hasLit = true
      }
      const mgmt = Array.isArray(e.management_changes) ? e.management_changes : []
      for (const mi of mgmt) {
        const d = asString(mi.date)
        const t = d ? new Date(d).getTime() : NaN
        if (Number.isFinite(t) && t >= evMs - WINDOW && t < evMs) hasMgmt = true
      }
      const news = Array.isArray(e.news_items) ? e.news_items : []
      for (const ni of news) {
        const d = asString(ni.date)
        const t = d ? new Date(d).getTime() : NaN
        if (Number.isFinite(t) && t >= evMs - WINDOW && t < evMs) hasNews = true
      }
    }
    if (hasLit) withLit += 1
    if (hasMgmt) withMgmt += 1
    if (hasNews) withNews += 1
  }

  const n = spreadEvents.length
  const pct = (x: number) => Math.round((100 * x) / n)
  return {
    scope: "all",
    n_spread_events: n,
    n_with_litigation_prior: withLit,
    pct_with_litigation_prior: pct(withLit),
    n_with_management_prior: withMgmt,
    pct_with_management_prior: pct(withMgmt),
    n_with_news_prior: withNews,
    pct_with_news_prior: pct(withNews),
    methodology_note: `Computed on ${n} cross-fund spread event${
      n === 1 ? "" : "s"
    } where spread ≥ 1pp at the reporting date. Litigation / management / news priors are counted when an enrichment-dated event falls in the 6 months before the spread event on the same borrower.`,
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Top-level: assemble the borrower x-ray
// ─────────────────────────────────────────────────────────────────────────────

export const getBorrowerXray = cache(
  async (name: string): Promise<BorrowerXray | null> => {
    if (!name || !name.trim()) return null
    const borrower = name.trim()

    const [rawObs, hits, canonical] = await Promise.all([
      fetchObservations(borrower),
      fetchBorrowerHits(borrower),
      fetchBorrowerCanonical(borrower),
    ])

    if (rawObs.length === 0 && hits.length === 0) return null

    const { series, periods } = aggregateMarkSeries(rawObs)
    const { latest, latestPeriod, spreadPp, peerMedian } = computeLatestMarks(series, rawObs)

    const sponsor =
      canonical?.sponsor ??
      deriveSponsorFromHits(hits) ??
      null
    const industry =
      canonical?.industry ??
      deriveIndustryFromHits(hits) ??
      null

    const hasGoldman = series.some((s) => s.is_goldman) ||
      hits.some((h) => isGoldman(h.fund_ticker))

    const fundsHolding = Array.from(new Set(series.map((s) => s.fund_ticker)))

    const anyNonAccrual = latest.some((l) => l.accrual_status === "non_accrual")
    const anyPik = latest.some((l) => l.is_pik === true)

    const recentHitCount = hits.length
    const hasCriticalHit = hits.some((h) => sevScore100(h.severity_score) >= 70)

    const meta: BorrowerMeta = {
      canonical_name: borrower,
      sponsor,
      industry,
      has_goldman: hasGoldman,
      funds_holding: fundsHolding,
      latest_period: latestPeriod,
      cross_fund_spread_pp: spreadPp,
      worst_mark: latest.reduce<BorrowerLatestMark | null>((acc, l) => {
        if (l.mark_pct === null) return acc
        if (!acc || (l.mark_pct < (acc.mark_pct ?? 100))) return l
        return acc
      }, null),
      best_mark: latest.reduce<BorrowerLatestMark | null>((acc, l) => {
        if (l.mark_pct === null) return acc
        if (!acc || (l.mark_pct > (acc.mark_pct ?? 0))) return l
        return acc
      }, null),
      peer_median_mark_pct: peerMedian === null ? null : Math.round(peerMedian * 10) / 10,
      any_non_accrual: anyNonAccrual,
      any_pik: anyPik,
      has_critical_hit: hasCriticalHit,
      recent_hit_count: recentHitCount,
    }

    const enrich = await fetchBorrowerEnrichments(hits.map((h) => h.id))
    const { pins, leads } = buildEventPinsAndLeads(enrich)

    const sponsorCross = await fetchSponsorCrossCheck(borrower, sponsor)
    const implied = buildImpliedNextMark(series, latest, hits)
    const backtest = await getBacktestAcrossUniverse().catch(() => null)

    const quartersRendered = periods.length
    const note =
      quartersRendered < 8
        ? `Showing ${quartersRendered} live quarter${quartersRendered === 1 ? "" : "s"} since ${CUTOFF}. Earlier history is not present in the dataset for this borrower.`
        : null

    return {
      meta,
      series,
      events: pins,
      leading_indicators: leads,
      latest_marks: latest,
      sponsor_cross_check: sponsorCross,
      implied,
      backtest,
      quarters_rendered: quartersRendered,
      note,
    }
  },
)
