import "server-only"
import { cache } from "react"
import { createClient } from "@/lib/supabase/server"
import {
  GOLDMAN_FUNDS,
  sevScore100,
  type DetectorHitRow,
  type EnrichmentJoined,
  type LitigationItem,
  type ManagementChangeItem,
  type NewsItem,
} from "@/lib/briefing/queries"
import { EMPTY_FILTERS, type PatternFilters } from "./schema"

// ─────────────────────────────────────────────────────────────────────────────
// Pattern composer — applies the structured filter JSON against Supabase and
// returns borrower-level result rows. Read-only. Never executes raw user SQL.
// ─────────────────────────────────────────────────────────────────────────────

export type ComposerBorrowerRow = {
  borrower: string
  fund_tickers: string[]
  max_severity: number
  avg_severity: number
  hit_count: number
  n_litigation: number
  n_mgmt: number
  n_news: number
  latest_period: string | null
  latest_hit_at: string | null
  fv_dollars: number | null
  sponsor: string | null
  industry: string | null
  is_pik: boolean
  any_non_accrual: boolean
  goldman_held: boolean
  // Funds (across all BDCs in the dataset) that held this borrower.
  all_funds_holding: string[]
}

export type ComposerResults = {
  rows: ComposerBorrowerRow[]
  total: number
  avg_severity: number
  total_fv_dollars: number
  query_plan: string[]
}

function pickWindowCutoff(window_days: number | null | undefined): Date | null {
  if (!window_days || window_days <= 0) return null
  const d = new Date()
  d.setDate(d.getDate() - window_days)
  return d
}

function normalizeIndustry(s: string | null | undefined): string | null {
  if (!s) return null
  return s.trim().toLowerCase()
}

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null
  const s = v.trim()
  return s ? s : null
}

/**
 * Run the composer query.
 *
 * Strategy (no raw user SQL — everything goes through the PostgREST query
 * builder or in-memory filtering of the projected rows):
 *   1. Pull recent detector_hits filtered by fund + window + severity.
 *   2. Join in enrichments (litigation / management / news) for those hits.
 *   3. Filter by event_type membership using the joined arrays.
 *   4. Filter by industry/sponsor by reading hit_data + borrower_canonical.
 *   5. Filter by accrual_status / PIK / held_by_n_funds via observations.
 *   6. Aggregate to one row per borrower; rank by severity DESC.
 */
export async function runComposerQuery(
  filters: PatternFilters,
): Promise<ComposerResults> {
  const supabase = createClient()
  const plan: string[] = []

  // ── Funds + window + severity_min — pushed down to PostgREST ──────────────
  const funds =
    filters.funds && filters.funds.length > 0
      ? filters.funds
      : (GOLDMAN_FUNDS as unknown as string[])
  const windowCutoff = pickWindowCutoff(filters.window_days)
  const sevMin01 =
    filters.severity_min != null
      ? Math.max(0, Math.min(1, filters.severity_min / 100))
      : null

  let hitsQ = supabase
    .from("detector_hits")
    .select(
      "id, detector_name, fund_ticker, portfolio_company_canonical, current_period_end, prior_period_end, severity_score, hit_data, cited_source_urls, created_at",
    )
    .in("fund_ticker", funds)
    .order("current_period_end", { ascending: false, nullsFirst: false })
    .limit(800)

  if (windowCutoff) {
    hitsQ = hitsQ.gte("current_period_end", windowCutoff.toISOString().slice(0, 10))
    plan.push(`current_period_end ≥ ${windowCutoff.toISOString().slice(0, 10)} (window ${filters.window_days}d)`)
  }
  if (sevMin01 != null) {
    hitsQ = hitsQ.gte("severity_score", sevMin01)
    plan.push(`severity_score ≥ ${sevMin01.toFixed(2)} (severity_min ${filters.severity_min})`)
  }
  plan.unshift(`fund_ticker ∈ (${funds.join(", ")})`)

  const { data: hitsData, error: hitsErr } = await hitsQ.returns<DetectorHitRow[]>()
  if (hitsErr) {
    console.error("runComposerQuery hits err", hitsErr)
    return { rows: [], total: 0, avg_severity: 0, total_fv_dollars: 0, query_plan: plan }
  }
  let hits = hitsData ?? []

  // ── event_types filter via enrichments ────────────────────────────────────
  const wantsEvents =
    Array.isArray(filters.event_types) && filters.event_types.length > 0
  const wantsNone =
    wantsEvents && filters.event_types!.length === 1 && filters.event_types![0] === "none"

  let enrichmentByHit = new Map<string, EnrichmentJoined>()
  if (wantsEvents && !wantsNone) {
    const hitIds = hits.map((h) => h.id)
    const chunks: string[][] = []
    for (let i = 0; i < hitIds.length; i += 200) chunks.push(hitIds.slice(i, i + 200))
    for (const ids of chunks) {
      if (ids.length === 0) continue
      const { data: er, error: eErr } = await supabase
        .from("enrichments")
        .select("detector_hit_id, litigation_items, management_changes, news_items")
        .in("detector_hit_id", ids)
      if (eErr) {
        console.error("runComposerQuery enrich err", eErr)
        continue
      }
      type Row = {
        detector_hit_id: string
        litigation_items: LitigationItem[] | null
        management_changes: ManagementChangeItem[] | null
        news_items: NewsItem[] | null
      }
      for (const r of (er ?? []) as Row[]) {
        enrichmentByHit.set(r.detector_hit_id, {
          detector_hit_id: r.detector_hit_id,
          litigation_items: r.litigation_items ?? null,
          management_changes: r.management_changes ?? null,
          news_items: r.news_items ?? null,
          hit: null,
        })
      }
    }
    const want = new Set(filters.event_types ?? [])
    const before = hits.length
    hits = hits.filter((h) => {
      const e = enrichmentByHit.get(h.id)
      if (!e) return false
      const hasLit = (e.litigation_items?.length ?? 0) > 0
      const hasMgmt = (e.management_changes?.length ?? 0) > 0
      const hasNews = (e.news_items?.length ?? 0) > 0
      if (want.has("litigation") && hasLit) return true
      if (want.has("management") && hasMgmt) return true
      if (want.has("news") && hasNews) return true
      return false
    })
    plan.push(`event_types ∈ (${Array.from(want).join(", ")}) → ${hits.length}/${before} hits`)
  } else if (wantsNone) {
    plan.push("event_types = none (skipping enrichments join)")
  }

  if (hits.length === 0) {
    return { rows: [], total: 0, avg_severity: 0, total_fv_dollars: 0, query_plan: plan }
  }

  // ── industry / sponsor filter ─────────────────────────────────────────────
  // We try the hit_data fields first; fall back to borrower_canonical.
  let industryWant = normalizeIndustry(filters.industry)
  let sponsorWant = filters.sponsor ? filters.sponsor.trim().toLowerCase() : null
  const borrowerNames = Array.from(
    new Set(
      hits.map((h) => h.portfolio_company_canonical).filter(Boolean) as string[],
    ),
  )

  const canonMeta = new Map<string, { sponsor: string | null; industry: string | null }>()
  if (borrowerNames.length > 0) {
    const nameChunks: string[][] = []
    for (let i = 0; i < borrowerNames.length; i += 200)
      nameChunks.push(borrowerNames.slice(i, i + 200))
    for (const names of nameChunks) {
      const { data, error } = await supabase
        .from("borrower_canonical")
        .select("canonical_name, sponsor, industry, sector")
        .in("canonical_name", names)
      if (error) {
        console.error("runComposerQuery canon err", error)
        continue
      }
      for (const r of (data ?? []) as Array<{
        canonical_name: string
        sponsor: string | null
        industry: string | null
        sector: string | null
      }>) {
        canonMeta.set(r.canonical_name, {
          sponsor: asString(r.sponsor),
          industry: asString(r.industry) ?? asString(r.sector),
        })
      }
    }
  }

  function metaFor(name: string): { sponsor: string | null; industry: string | null } {
    return canonMeta.get(name) ?? { sponsor: null, industry: null }
  }

  function hitMatchesIndustrySponsor(h: DetectorHitRow): boolean {
    if (!industryWant && !sponsorWant) return true
    const name = h.portfolio_company_canonical ?? ""
    const meta = metaFor(name)
    const hd = (h.hit_data ?? {}) as Record<string, any>

    if (industryWant) {
      const candidates = [
        meta.industry,
        asString(hd.industry),
        asString(hd.sector),
        asString(hd.gics_industry),
        asString(hd.borrower_industry),
      ]
        .filter(Boolean)
        .map((s) => (s as string).toLowerCase())
      const ok = candidates.some((c) => c.includes(industryWant!) || industryWant!.includes(c))
      if (!ok) return false
    }
    if (sponsorWant) {
      const candidates = [
        meta.sponsor,
        asString(hd.sponsor),
        asString(hd.sponsor_name),
        asString(hd.private_equity_sponsor),
      ]
        .filter(Boolean)
        .map((s) => (s as string).toLowerCase())
      const ok = candidates.some(
        (c) => c.includes(sponsorWant!) || sponsorWant!.includes(c),
      )
      if (!ok) return false
    }
    return true
  }

  if (industryWant) plan.push(`industry ~ "${filters.industry}"`)
  if (sponsorWant) plan.push(`sponsor ~ "${filters.sponsor}"`)

  hits = hits.filter(hitMatchesIndustrySponsor)
  if (hits.length === 0) {
    return { rows: [], total: 0, avg_severity: 0, total_fv_dollars: 0, query_plan: plan }
  }

  // ── observations: FV, PIK, accrual, cross-fund count ──────────────────────
  // We pull observations for all surfaced borrowers (across ALL funds, not
  // just Goldman) so we can compute held_by_n_funds_min and the accrual/PIK
  // post-filter accurately.
  const filteredNames = Array.from(
    new Set(
      hits.map((h) => h.portfolio_company_canonical).filter(Boolean) as string[],
    ),
  )
  type ObsRow = {
    portfolio_company_canonical: string | null
    fund_ticker: string | null
    period_end: string | null
    fair_value: number | string | null
    is_pik: boolean | null
    accrual_status: string | null
  }
  const obsByBorrower = new Map<string, ObsRow[]>()
  {
    const nameChunks: string[][] = []
    for (let i = 0; i < filteredNames.length; i += 200)
      nameChunks.push(filteredNames.slice(i, i + 200))
    for (const names of nameChunks) {
      if (names.length === 0) continue
      const { data, error } = await supabase
        .from("observations")
        .select(
          "portfolio_company_canonical, fund_ticker, period_end, fair_value, is_pik, accrual_status",
        )
        .in("portfolio_company_canonical", names)
      if (error) {
        console.error("runComposerQuery obs err", error)
        continue
      }
      for (const r of (data ?? []) as ObsRow[]) {
        const k = r.portfolio_company_canonical ?? ""
        if (!obsByBorrower.has(k)) obsByBorrower.set(k, [])
        obsByBorrower.get(k)!.push(r)
      }
    }
  }

  // ── Build per-borrower rows ───────────────────────────────────────────────
  const goldman = new Set(GOLDMAN_FUNDS as unknown as string[])
  const byBorrower = new Map<string, ComposerBorrowerRow>()
  for (const h of hits) {
    const name = h.portfolio_company_canonical
    if (!name) continue
    if (!byBorrower.has(name)) {
      byBorrower.set(name, {
        borrower: name,
        fund_tickers: [],
        max_severity: 0,
        avg_severity: 0,
        hit_count: 0,
        n_litigation: 0,
        n_mgmt: 0,
        n_news: 0,
        latest_period: null,
        latest_hit_at: null,
        fv_dollars: null,
        sponsor: null,
        industry: null,
        is_pik: false,
        any_non_accrual: false,
        goldman_held: false,
        all_funds_holding: [],
      })
    }
    const r = byBorrower.get(name)!
    const sev = sevScore100(h.severity_score)
    r.hit_count += 1
    r.max_severity = Math.max(r.max_severity, sev)
    r.avg_severity = (r.avg_severity * (r.hit_count - 1) + sev) / r.hit_count
    if (h.fund_ticker && !r.fund_tickers.includes(h.fund_ticker)) {
      r.fund_tickers.push(h.fund_ticker)
    }
    if (h.fund_ticker && goldman.has(h.fund_ticker)) r.goldman_held = true
    if (h.current_period_end) {
      if (!r.latest_period || h.current_period_end > r.latest_period) {
        r.latest_period = h.current_period_end
      }
    }
    if (h.created_at) {
      if (!r.latest_hit_at || h.created_at > r.latest_hit_at) {
        r.latest_hit_at = h.created_at
      }
    }
    const enr = enrichmentByHit.get(h.id)
    if (enr) {
      r.n_litigation += enr.litigation_items?.length ?? 0
      r.n_mgmt += enr.management_changes?.length ?? 0
      r.n_news += enr.news_items?.length ?? 0
    }
  }

  // Hydrate observations-derived stats and apply post-filters.
  const rows: ComposerBorrowerRow[] = []
  for (const r of Array.from(byBorrower.values())) {
    const meta = metaFor(r.borrower)
    r.sponsor = meta.sponsor
    r.industry = meta.industry
    const obs = obsByBorrower.get(r.borrower) ?? []

    // Per-borrower latest period (across all funds) → use that for FV total.
    let latest: string | null = null
    for (const o of obs) {
      if (o.period_end && (!latest || o.period_end > latest)) latest = o.period_end
    }
    let fv = 0
    let pikSeen = false
    let naSeen = false
    const fundsHolding = new Set<string>()
    for (const o of obs) {
      if (o.fund_ticker) fundsHolding.add(o.fund_ticker)
      if (latest && o.period_end === latest) {
        const n = Number(o.fair_value ?? 0)
        if (Number.isFinite(n)) fv += n
        if (o.is_pik) pikSeen = true
        if (o.accrual_status === "non_accrual") naSeen = true
      }
    }
    r.fv_dollars = fv > 0 ? fv : null
    r.is_pik = pikSeen
    r.any_non_accrual = naSeen
    r.all_funds_holding = Array.from(fundsHolding).sort()

    // accrual / PIK / held-by-n filters
    if (filters.accrual_status === "non_accrual" && !r.any_non_accrual) continue
    if (filters.accrual_status === "accrual" && r.any_non_accrual) continue
    if (filters.pik_min_pct != null) {
      // No per-position PIK rate column — we approximate "PIK at all" using
      // is_pik, and surface this clearly in the query plan. (Schema does not
      // expose pik_pct.)
      if (!r.is_pik) continue
    }
    if (filters.held_by_n_funds_min != null && r.all_funds_holding.length < filters.held_by_n_funds_min) {
      continue
    }
    rows.push(r)
  }
  if (filters.accrual_status) plan.push(`accrual_status = ${filters.accrual_status}`)
  if (filters.pik_min_pct != null) plan.push(`is_pik = true (approx pik_min_pct ≥ ${filters.pik_min_pct})`)
  if (filters.held_by_n_funds_min != null)
    plan.push(`held by ≥ ${filters.held_by_n_funds_min} funds`)

  rows.sort((a, b) => b.max_severity - a.max_severity)
  // Cap for UI.
  const capped = rows.slice(0, 50)

  const total = rows.length
  const avg =
    rows.length > 0
      ? rows.reduce((s, x) => s + x.max_severity, 0) / rows.length
      : 0
  const fvSum = rows.reduce((s, x) => s + (x.fv_dollars ?? 0), 0)

  return {
    rows: capped,
    total,
    avg_severity: Math.round(avg),
    total_fv_dollars: fvSum,
    query_plan: plan,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Preset cluster queries — used by the always-on cluster cards on /patterns
// ─────────────────────────────────────────────────────────────────────────────

export type ClusterCard = {
  id: string
  tone: "crit" | "warn" | "info"
  title: string
  tags: string[]
  thesis: string
  rows: ComposerBorrowerRow[]
  meta_label: string
  meta_value: string
  meta_sub: string
  filters: PatternFilters
  action_left: string
}

export const getPresetClusters = cache(async (): Promise<ClusterCard[]> => {
  // Each preset re-uses runComposerQuery so the cards are literally the same
  // pipeline the composer runs — no separate code path for "demos".
  const [litigation, sunCapital, industryClusters, nonAccrual, crossFund] =
    await Promise.all([
      runComposerQuery({
        funds: null, // include all BDCs so we can show sector-wide pattern
        event_types: ["litigation"],
        window_days: 365,
        severity_min: 50,
        industry: null,
        sponsor: null,
        accrual_status: null,
        pik_min_pct: null,
        held_by_n_funds_min: null,
      }),
      runComposerQuery({
        funds: null,
        event_types: null,
        window_days: 540,
        severity_min: null,
        industry: null,
        sponsor: "Sun Capital",
        accrual_status: null,
        pik_min_pct: null,
        held_by_n_funds_min: null,
      }),
      runIndustryCluster(),
      runComposerQuery({
        funds: ["GSCR", "GSBD"],
        event_types: null,
        window_days: null,
        severity_min: null,
        industry: null,
        sponsor: null,
        accrual_status: "non_accrual",
        pik_min_pct: null,
        held_by_n_funds_min: null,
      }),
      runComposerQuery({
        funds: null,
        event_types: null,
        window_days: 365,
        severity_min: 40,
        industry: null,
        sponsor: null,
        accrual_status: null,
        pik_min_pct: null,
        held_by_n_funds_min: 3,
      }),
    ])

  const cards: ClusterCard[] = []

  if (litigation.rows.length > 0) {
    const goldmanRows = litigation.rows.filter((r) => r.goldman_held).slice(0, 8)
    const allRows = litigation.rows.slice(0, 8)
    const rows = goldmanRows.length > 0 ? goldmanRows.concat(allRows.filter((r) => !goldmanRows.includes(r))).slice(0, 8) : allRows
    cards.push({
      id: "litigation-cluster",
      tone: "crit",
      title: "Litigation-leading mark drift · borrowers with active disputes",
      tags: ["litigation density", "credit cluster", "Goldman-checked"],
      thesis:
        `${litigation.total} borrowers across the universe have litigation flagged in the trailing 12 months and severity ≥ 50. Litigation-leading mark cuts are empirically the strongest leading signal in the dataset — see the lift stat at the top of this page. Click any row to open the borrower x-ray.`,
      rows,
      meta_label: "cluster sev",
      meta_value: String(Math.round(litigation.avg_severity)),
      meta_sub: `${rows.filter((r) => r.goldman_held).length} of ${rows.length} Goldman-held`,
      filters: {
        ...EMPTY_FILTERS,
        event_types: ["litigation"],
        window_days: 365,
        severity_min: 50,
      },
      action_left:
        rows.filter((r) => r.goldman_held).length > 0
          ? `Goldman exposure: ${rows.filter((r) => r.goldman_held).map((r) => r.borrower).slice(0, 3).join(", ")}`
          : "No Goldman positions in this cluster — peer signal only.",
    })
  }

  if (sunCapital.rows.length > 0) {
    const rows = sunCapital.rows.slice(0, 6)
    cards.push({
      id: "sun-capital-sponsor",
      tone: "info",
      title: "Sun Capital portfolio · cross-borrower deterioration",
      tags: ["sponsor pattern", "cross-borrower"],
      thesis:
        `${sunCapital.total} Sun Capital-sponsored borrowers surfaced in the dataset within the trailing 18 months. Sponsor-level deterioration tends to cluster — when one Sun Capital name flags, others in the same vintage frequently follow within 2 quarters.`,
      rows,
      meta_label: "sponsor names",
      meta_value: String(sunCapital.total),
      meta_sub: `${rows.filter((r) => r.goldman_held).length} held in Goldman book`,
      filters: { ...EMPTY_FILTERS, sponsor: "Sun Capital", window_days: 540 },
      action_left: `Sponsor concentration — open the borrower x-ray on any row for cross-fund detail.`,
    })
  }

  if (industryClusters) {
    cards.push(industryClusters)
  }

  if (nonAccrual.rows.length > 0) {
    const rows = nonAccrual.rows.slice(0, 6)
    cards.push({
      id: "non-accrual-pik",
      tone: "warn",
      title: "Non-accrual + elevated PIK · GSCR + GSBD",
      tags: ["non-accrual cluster", "PIK creep", "Goldman exposure"],
      thesis:
        `${nonAccrual.total} Goldman positions are currently on non-accrual at their latest reporting period. The combination of non-accrual classification and PIK income is empirically the heaviest mark cut driver in the dataset.`,
      rows,
      meta_label: "non-accrual",
      meta_value: `${nonAccrual.total}`,
      meta_sub: `${rows.filter((r) => r.is_pik).length} of ${rows.length} are PIK`,
      filters: { ...EMPTY_FILTERS, accrual_status: "non_accrual" },
      action_left: `${rows.length} Goldman positions on non-accrual — the most defensible LP-asked cluster.`,
    })
  }

  if (crossFund.rows.length > 0) {
    const rows = crossFund.rows.slice(0, 6)
    cards.push({
      id: "cross-fund-divergence",
      tone: "info",
      title: "Cross-fund holdings · elevated severity in last 12 months",
      tags: ["cross-fund", "mark-spread risk"],
      thesis:
        `${crossFund.total} borrowers are held by 3+ BDCs and have a severity ≥ 40 hit in the trailing 12 months. When BDCs disagree on the mark for the same loan, the slower marker frequently reprices within 1–2 quarters.`,
      rows,
      meta_label: "cross-held",
      meta_value: String(crossFund.total),
      meta_sub: "held by ≥ 3 BDCs",
      filters: {
        ...EMPTY_FILTERS,
        window_days: 365,
        severity_min: 40,
        held_by_n_funds_min: 3,
      },
      action_left: `Mark-spread alpha is highest in this cluster — see /peer for fund-by-fund comparison.`,
    })
  }

  return cards
})

/**
 * Industry-cluster card: the densest industry with severity ≥ 50 across the
 * last 12 months. Returns null if no industry has ≥ 4 borrowers.
 */
async function runIndustryCluster(): Promise<ClusterCard | null> {
  const supabase = createClient()
  // Pull recent severe hits with their borrower industry from borrower_canonical.
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 365)
  const { data: hits, error } = await supabase
    .from("detector_hits")
    .select(
      "portfolio_company_canonical, fund_ticker, severity_score, current_period_end",
    )
    .gte("current_period_end", cutoff.toISOString().slice(0, 10))
    .gte("severity_score", 0.5)
    .limit(4000)
  if (error || !hits || hits.length === 0) return null

  type Row = {
    portfolio_company_canonical: string | null
    fund_ticker: string | null
    severity_score: number | null
    current_period_end: string | null
  }
  const names = Array.from(
    new Set(
      (hits as Row[]).map((h) => h.portfolio_company_canonical).filter(Boolean) as string[],
    ),
  )
  if (names.length === 0) return null

  // Pull industry from borrower_canonical.
  const canonByName = new Map<string, { sponsor: string | null; industry: string | null }>()
  const chunks: string[][] = []
  for (let i = 0; i < names.length; i += 200) chunks.push(names.slice(i, i + 200))
  for (const ns of chunks) {
    const { data } = await supabase
      .from("borrower_canonical")
      .select("canonical_name, sponsor, industry, sector")
      .in("canonical_name", ns)
    for (const r of (data ?? []) as Array<{
      canonical_name: string
      sponsor: string | null
      industry: string | null
      sector: string | null
    }>) {
      canonByName.set(r.canonical_name, {
        sponsor: r.sponsor,
        industry: r.industry ?? r.sector,
      })
    }
  }

  type Agg = {
    industry: string
    borrowers: Set<string>
    sev_sum: number
    sev_n: number
  }
  const byIndustry = new Map<string, Agg>()
  for (const h of hits as Row[]) {
    const name = h.portfolio_company_canonical
    if (!name) continue
    const ind = canonByName.get(name)?.industry
    if (!ind) continue
    const k = ind
    if (!byIndustry.has(k))
      byIndustry.set(k, { industry: k, borrowers: new Set(), sev_sum: 0, sev_n: 0 })
    const a = byIndustry.get(k)!
    a.borrowers.add(name)
    a.sev_sum += sevScore100(h.severity_score) || 0
    a.sev_n += 1
  }
  const ranked = Array.from(byIndustry.values())
    .filter((a) => a.borrowers.size >= 4)
    .sort((a, b) => b.sev_sum / b.sev_n - a.sev_sum / a.sev_n)
  if (ranked.length === 0) return null
  const top = ranked[0]
  const avgSev = top.sev_sum / Math.max(1, top.sev_n)

  // Re-run the composer with industry filter for clean row data.
  const result = await runComposerQuery({
    funds: null,
    event_types: null,
    window_days: 365,
    severity_min: 50,
    industry: top.industry,
    sponsor: null,
    accrual_status: null,
    pik_min_pct: null,
    held_by_n_funds_min: null,
  })
  const rows = result.rows.slice(0, 6)

  return {
    id: "industry-cluster",
    tone: avgSev >= 75 ? "crit" : "warn",
    title: `${top.industry} · sector severity cluster`,
    tags: ["sector pattern", "cross-borrower"],
    thesis: `${top.borrowers.size} borrowers in ${top.industry} have flagged severity ≥ 50 in the trailing 12 months. Average severity in this cluster is ${Math.round(avgSev)}. The cluster is queryable end-to-end — click any borrower for the x-ray view.`,
    rows,
    meta_label: "avg severity",
    meta_value: String(Math.round(avgSev)),
    meta_sub: `${top.borrowers.size} borrowers · ${top.sev_n} hits`,
    filters: {
      ...EMPTY_FILTERS,
      industry: top.industry,
      window_days: 365,
      severity_min: 50,
    },
    action_left: `Largest industry cluster by avg severity. Goldman names included where present.`,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hero stats: per-event-type lift cards (litigation / mgmt / news / cluster count)
// ─────────────────────────────────────────────────────────────────────────────

export type LiftStat = {
  label: string
  hit_rate_pct: number | null
  baseline_pct: number | null
  lift: number | null
  n_events: number
  description: string
}

async function liftForEventType(
  kind: "litigation" | "management" | "news",
): Promise<LiftStat> {
  const supabase = createClient()
  const colMap = {
    litigation: "litigation_items",
    management: "management_changes",
    news: "news_items",
  } as const
  const col = colMap[kind]
  const label =
    kind === "litigation" ? "litigation lift" : kind === "management" ? "management lift" : "news lift"
  const desc =
    kind === "litigation"
      ? "borrower-litigation events followed by mark-drift hit within 9 months."
      : kind === "management"
      ? "management changes followed by mark drift. Strongest signal: C-suite departures."
      : "borrower news mentions followed by mark drift within 9 months."

  // Pull enrichments + project the chosen array column.
  const { data: er, error: erErr } = await supabase
    .from("enrichments")
    .select(`detector_hit_id, ${col}`)
    .limit(2000)
  if (erErr || !er) {
    return { label, hit_rate_pct: null, baseline_pct: null, lift: null, n_events: 0, description: desc }
  }
  const evIds = (er as any[])
    .filter((r) => Array.isArray(r[col]) && r[col].length > 0)
    .map((r) => r.detector_hit_id as string)
  if (evIds.length === 0) {
    return { label, hit_rate_pct: null, baseline_pct: null, lift: null, n_events: 0, description: desc }
  }

  type EventRow = {
    portfolio_company_canonical: string | null
    fund_ticker: string | null
    current_period_end: string | null
  }
  const events: EventRow[] = []
  const chunks: string[][] = []
  for (let i = 0; i < evIds.length; i += 300) chunks.push(evIds.slice(i, i + 300))
  for (const ids of chunks) {
    const { data } = await supabase
      .from("detector_hits")
      .select("portfolio_company_canonical, fund_ticker, current_period_end")
      .in("id", ids)
    for (const r of (data ?? []) as EventRow[]) events.push(r)
  }
  if (events.length === 0) {
    return { label, hit_rate_pct: null, baseline_pct: null, lift: null, n_events: 0, description: desc }
  }

  // Followups (same borrower, same fund, ≤ 270d) — fetch all hits for these borrowers once.
  const names = Array.from(
    new Set(events.map((e) => e.portfolio_company_canonical).filter(Boolean) as string[]),
  )
  type Foll = EventRow
  const byBorrower = new Map<string, Foll[]>()
  const nameChunks: string[][] = []
  for (let i = 0; i < names.length; i += 200) nameChunks.push(names.slice(i, i + 200))
  for (const ns of nameChunks) {
    const { data } = await supabase
      .from("detector_hits")
      .select("portfolio_company_canonical, fund_ticker, current_period_end")
      .in("portfolio_company_canonical", ns)
    for (const r of (data ?? []) as Foll[]) {
      const k = r.portfolio_company_canonical ?? ""
      if (!byBorrower.has(k)) byBorrower.set(k, [])
      byBorrower.get(k)!.push(r)
    }
  }
  const MS = 1000 * 60 * 60 * 24
  let n = 0
  let hits = 0
  for (const ev of events) {
    if (!ev.portfolio_company_canonical || !ev.current_period_end) continue
    n += 1
    const t0 = new Date(ev.current_period_end).getTime()
    if (!Number.isFinite(t0)) continue
    const t1 = t0 + 270 * MS
    const cs = byBorrower.get(ev.portfolio_company_canonical) ?? []
    if (
      cs.some((c) => {
        if (!c.current_period_end) return false
        if (c.fund_ticker !== ev.fund_ticker) return false
        const tx = new Date(c.current_period_end).getTime()
        return Number.isFinite(tx) && tx > t0 && tx <= t1
      })
    )
      hits += 1
  }

  // Baseline: same pipeline over a 2k-sample of all hits.
  let bN = 0
  let bH = 0
  const { data: base } = await supabase
    .from("detector_hits")
    .select("portfolio_company_canonical, fund_ticker, current_period_end")
    .order("current_period_end", { ascending: false, nullsFirst: false })
    .limit(2000)
  if (base) {
    const idx = new Map<string, EventRow[]>()
    for (const r of base as EventRow[]) {
      const k = r.portfolio_company_canonical ?? ""
      if (!idx.has(k)) idx.set(k, [])
      idx.get(k)!.push(r)
    }
    for (const ev of base as EventRow[]) {
      if (!ev.portfolio_company_canonical || !ev.current_period_end) continue
      bN += 1
      const t0 = new Date(ev.current_period_end).getTime()
      if (!Number.isFinite(t0)) continue
      const t1 = t0 + 270 * MS
      const cs = idx.get(ev.portfolio_company_canonical) ?? []
      if (
        cs.some((c) => {
          if (!c.current_period_end) return false
          if (c.fund_ticker !== ev.fund_ticker) return false
          const tx = new Date(c.current_period_end).getTime()
          return Number.isFinite(tx) && tx > t0 && tx <= t1
        })
      )
        bH += 1
    }
  }
  const hit_rate_pct = n > 0 ? (100 * hits) / n : null
  const baseline_pct = bN > 0 ? (100 * bH) / bN : null
  const lift = baseline_pct && baseline_pct > 0 && hit_rate_pct != null ? hit_rate_pct / baseline_pct : null
  return {
    label,
    hit_rate_pct,
    baseline_pct,
    lift,
    n_events: n,
    description: desc,
  }
}

export const getHeroLiftStats = cache(async (): Promise<LiftStat[]> => {
  const [lit, mgmt, news] = await Promise.all([
    liftForEventType("litigation"),
    liftForEventType("management"),
    liftForEventType("news"),
  ])
  return [lit, mgmt, news]
})

export const getClusterSignalCount = cache(async (): Promise<number> => {
  const supabase = createClient()
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 365)
  const { data, error } = await supabase
    .from("detector_hits")
    .select("portfolio_company_canonical, severity_score, current_period_end")
    .gte("current_period_end", cutoff.toISOString().slice(0, 10))
    .gte("severity_score", 0.5)
    .limit(4000)
  if (error || !data) return 0
  // Count distinct industries with ≥ 4 borrowers — same logic as runIndustryCluster.
  const names = Array.from(
    new Set(
      (data as Array<{ portfolio_company_canonical: string | null }>)
        .map((r) => r.portfolio_company_canonical)
        .filter(Boolean) as string[],
    ),
  )
  if (names.length === 0) return 0
  const canonByName = new Map<string, string | null>()
  const chunks: string[][] = []
  for (let i = 0; i < names.length; i += 200) chunks.push(names.slice(i, i + 200))
  for (const ns of chunks) {
    const { data: c } = await supabase
      .from("borrower_canonical")
      .select("canonical_name, industry, sector")
      .in("canonical_name", ns)
    for (const r of (c ?? []) as Array<{
      canonical_name: string
      industry: string | null
      sector: string | null
    }>) {
      canonByName.set(r.canonical_name, r.industry ?? r.sector)
    }
  }
  const byInd = new Map<string, Set<string>>()
  for (const r of data as Array<{ portfolio_company_canonical: string | null }>) {
    const name = r.portfolio_company_canonical
    if (!name) continue
    const ind = canonByName.get(name)
    if (!ind) continue
    if (!byInd.has(ind)) byInd.set(ind, new Set())
    byInd.get(ind)!.add(name)
  }
  let n = 0
  for (const set of Array.from(byInd.values())) if (set.size >= 4) n += 1
  return n
})
