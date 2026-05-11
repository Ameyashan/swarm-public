import "server-only"
import { cache } from "react"
import { createClient } from "@/lib/supabase/server"
import {
  GOLDMAN_FUNDS,
  type GoldmanFund,
  type DetectorHitRow,
  sevScore100,
} from "@/lib/briefing/queries"

export { GOLDMAN_FUNDS }
export type { GoldmanFund }

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type FundBookStats = {
  fund_ticker: string
  period_end: string | null
  total_fv_dollars: number
  pik_pct: number | null
  na_count: number
  na_fv_dollars: number
  hit_count: number
  position_count: number
}

export type BookPositionRow = {
  hit_id: string
  borrower: string | null
  industry: string | null
  vintage: string | null
  sponsor: string | null
  fund_ticker: string | null
  severity_100: number
  severity_raw: number | null
  prior_fv: number | null
  current_fv: number | null
  fv_change_pct: number | null
  filing_label: string | null
  filing_url: string | null
  current_period_end: string | null
  prior_period_end: string | null
  accrual_status: string | null
  is_pik: boolean | null
  detector_name: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — parse JSONB hit_data robustly
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

function quarterLabel(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return null
  const m = d.getUTCMonth() // 0..11
  const q = Math.floor(m / 3) + 1
  const yy = String(d.getUTCFullYear()).slice(-2)
  return `${q}Q ’${yy}`
}

function filingLabel(hd: Record<string, any> | null | undefined, currentPeriod: string | null): string | null {
  if (!hd) return quarterLabel(currentPeriod)
  const form =
    asString(hd.current_filing_form) ||
    asString(hd.filing_form) ||
    asString(hd.form_type) ||
    null
  const q = quarterLabel(currentPeriod)
  if (q && form) return `${q} · ${form}`
  if (q) return q
  if (form) return form
  return null
}

function filingUrl(hd: Record<string, any> | null | undefined): string | null {
  if (!hd) return null
  return (
    asString(hd.current_filing_url) ||
    asString(hd.filing_url) ||
    asString(hd.primary_doc_url) ||
    asString(hd.source_url) ||
    null
  )
}

function rowFromHit(h: DetectorHitRow): BookPositionRow {
  const hd = h.hit_data ?? {}
  const sev100 = sevScore100(h.severity_score)
  // hit_data.{fv_prior,fv_current} are stored in **thousands** of dollars
  // (matching the observations.fair_value convention). Multiply by 1000 at
  // this boundary so the table can format with the same "$Xm/$XB" rules as
  // every other surface in the app.
  const priorFvK =
    asNumber(hd.prior_fv) ??
    asNumber(hd.prior_fair_value) ??
    asNumber(hd.fv_prior) ??
    null
  const currentFvK =
    asNumber(hd.current_fv) ??
    asNumber(hd.current_fair_value) ??
    asNumber(hd.fv_current) ??
    null
  const priorFv = priorFvK === null ? null : priorFvK * 1000
  const currentFv = currentFvK === null ? null : currentFvK * 1000
  // hit_data.fv_change_pct is stored as a fraction (-0.97 = −97%); when we
  // compute it ourselves from FV we already produce percentage points.
  // Normalize to percentage points here so the table can format directly.
  let fvChange = asNumber(hd.fv_change_pct)
  if (fvChange !== null && Math.abs(fvChange) <= 1.5) {
    fvChange = fvChange * 100
  }
  if (fvChange === null && priorFvK !== null && currentFvK !== null && priorFvK !== 0) {
    fvChange = ((currentFvK - priorFvK) / Math.abs(priorFvK)) * 100
  }
  const industry =
    asString(hd.industry) ||
    asString(hd.sector) ||
    asString(hd.gics_industry) ||
    asString(hd.borrower_industry) ||
    null
  const vintage =
    asString(hd.vintage) ||
    asString(hd.origination_quarter) ||
    asString(hd.origination_period) ||
    quarterLabel(asString(hd.origination_date))
  const sponsor =
    asString(hd.sponsor) ||
    asString(hd.sponsor_name) ||
    asString(hd.private_equity_sponsor) ||
    null
  const accrual =
    asString(hd.accrual_status) ||
    asString(hd.current_accrual_status) ||
    null
  const isPik =
    typeof hd.is_pik === "boolean"
      ? hd.is_pik
      : typeof hd.current_is_pik === "boolean"
        ? hd.current_is_pik
        : null

  return {
    hit_id: h.id,
    borrower: h.portfolio_company_canonical,
    industry,
    vintage,
    sponsor,
    fund_ticker: h.fund_ticker,
    severity_100: sev100,
    severity_raw: h.severity_score,
    prior_fv: priorFv,
    current_fv: currentFv,
    fv_change_pct: fvChange,
    filing_label: filingLabel(hd, h.current_period_end),
    filing_url: filingUrl(hd),
    current_period_end: h.current_period_end,
    prior_period_end: h.prior_period_end,
    accrual_status: accrual,
    is_pik: isPik,
    detector_name: h.detector_name,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Top-card stats for a fund at its latest reporting period.
 * Returns null fields where data is missing rather than throwing.
 */
export const getFundBookStats = cache(
  async (fund: GoldmanFund): Promise<FundBookStats | null> => {
    const supabase = createClient()

    // 1) Latest period for this fund.
    const { data: pData, error: pErr } = await supabase
      .from("observations")
      .select("period_end")
      .eq("fund_ticker", fund)
      .order("period_end", { ascending: false, nullsFirst: false })
      .limit(1)
    if (pErr) {
      console.error("getFundBookStats period err", fund, pErr)
      return null
    }
    const periodEnd = (pData?.[0]?.period_end ?? null) as string | null
    if (!periodEnd) {
      return {
        fund_ticker: fund,
        period_end: null,
        total_fv_dollars: 0,
        pik_pct: null,
        na_count: 0,
        na_fv_dollars: 0,
        hit_count: 0,
        position_count: 0,
      }
    }

    // 2) Observations for this fund at the latest period.
    type ObsRow = {
      fair_value: number | string | null
      is_pik: boolean | null
      accrual_status: string | null
    }
    const { data: obsData, error: obsErr } = await supabase
      .from("observations")
      .select("fair_value, is_pik, accrual_status")
      .eq("fund_ticker", fund)
      .eq("period_end", periodEnd)
    if (obsErr) {
      console.error("getFundBookStats obs err", fund, obsErr)
    }
    const rows = (obsData ?? []) as ObsRow[]
    let totalFv = 0
    let pikFv = 0
    let naFv = 0
    let naCount = 0
    for (const r of rows) {
      // observations.fair_value is in thousands of dollars — convert at the
      // boundary so the stat cards format with the same M/B rules as
      // everywhere else.
      const fv = Number(r.fair_value ?? 0) * 1000
      if (!Number.isFinite(fv)) continue
      totalFv += fv
      if (r.is_pik) pikFv += fv
      if (r.accrual_status === "non_accrual") {
        naFv += fv
        naCount += 1
      }
    }
    const pikPct = totalFv > 0 ? (pikFv / totalFv) * 100 : null

    // 3) Detector hit count for this fund in the latest reporting period.
    let hitCount = 0
    {
      const { count, error } = await supabase
        .from("detector_hits")
        .select("id", { count: "exact", head: true })
        .eq("fund_ticker", fund)
        .eq("current_period_end", periodEnd)
      if (!error && typeof count === "number") hitCount = count
    }

    return {
      fund_ticker: fund,
      period_end: periodEnd,
      total_fv_dollars: totalFv,
      pik_pct: pikPct,
      na_count: naCount,
      na_fv_dollars: naFv,
      hit_count: hitCount,
      position_count: rows.length,
    }
  },
)

/**
 * All detector hits for the selected fund, deduplicated by borrower so the book
 * shows one row per position. We keep the highest-severity (then largest
 * |fv_change_pct|) hit per borrower.
 */
export const getFundBookPositions = cache(
  async (fund: GoldmanFund): Promise<BookPositionRow[]> => {
    const supabase = createClient()

    // Pull a wide slice of recent hits for this fund.
    const { data, error } = await supabase
      .from("detector_hits")
      .select(
        "id, detector_name, fund_ticker, portfolio_company_canonical, current_period_end, prior_period_end, severity_score, hit_data, cited_source_urls, created_at",
      )
      .eq("fund_ticker", fund)
      .order("current_period_end", { ascending: false, nullsFirst: false })
      .order("severity_score", { ascending: false })
      .limit(4000)
      .returns<DetectorHitRow[]>()
    if (error) {
      console.error("getFundBookPositions err", fund, error)
      return []
    }

    const all = (data ?? []).map(rowFromHit)

    // Backfill missing accrual_status from the matching observation row.
    // detector_hits.hit_data doesn't always carry the value; the position's
    // own filing row does.
    {
      type ObsKey = { ticker: string; borrower: string; period: string }
      const needed: ObsKey[] = []
      for (const row of all) {
        if (row.accrual_status) continue
        if (!row.fund_ticker || !row.borrower || !row.current_period_end) continue
        needed.push({
          ticker: row.fund_ticker,
          borrower: row.borrower,
          period: row.current_period_end,
        })
      }
      if (needed.length > 0) {
        const borrowers = Array.from(new Set(needed.map((k) => k.borrower)))
        const periods = Array.from(new Set(needed.map((k) => k.period)))
        // One query bounded by the loaded hit set. The PostgREST `in` filter
        // is fine for hundreds of borrowers — same approach as the other
        // bulk lookups in this file.
        type ObsHit = {
          fund_ticker: string
          portfolio_company_canonical: string
          period_end: string
          accrual_status: string | null
          is_pik: boolean | null
        }
        const { data: obs, error: obsErr } = await supabase
          .from("observations")
          .select(
            "fund_ticker, portfolio_company_canonical, period_end, accrual_status, is_pik",
          )
          .eq("fund_ticker", fund)
          .in("portfolio_company_canonical", borrowers)
          .in("period_end", periods)
        if (obsErr) {
          console.error("getFundBookPositions obs accrual err", fund, obsErr)
        }
        const accrualIdx = new Map<string, string | null>()
        const pikIdx = new Map<string, boolean | null>()
        for (const r of (obs ?? []) as ObsHit[]) {
          const key = `${r.fund_ticker}|${r.portfolio_company_canonical}|${r.period_end}`
          if (r.accrual_status) accrualIdx.set(key, r.accrual_status)
          // Treat is_pik as positive only when any tranche is PIK at this period.
          if (r.is_pik === true) pikIdx.set(key, true)
        }
        for (const row of all) {
          if (!row.fund_ticker || !row.borrower || !row.current_period_end) continue
          const key = `${row.fund_ticker}|${row.borrower}|${row.current_period_end}`
          if (!row.accrual_status && accrualIdx.has(key)) {
            row.accrual_status = accrualIdx.get(key) ?? null
          }
          if (row.is_pik === null && pikIdx.has(key)) {
            row.is_pik = pikIdx.get(key) ?? null
          }
        }
      }
    }

    // Dedupe by borrower; keep the most informative hit (highest severity,
    // tie-broken by most negative fv_change_pct).
    const byBorrower = new Map<string, BookPositionRow>()
    for (const row of all) {
      const key = row.borrower ?? `_hit_${row.hit_id}`
      const existing = byBorrower.get(key)
      if (!existing) {
        byBorrower.set(key, row)
        continue
      }
      const a = existing
      const b = row
      const aSev = a.severity_100
      const bSev = b.severity_100
      if (bSev > aSev) {
        byBorrower.set(key, b)
        continue
      }
      if (bSev === aSev) {
        const aCh = a.fv_change_pct ?? 0
        const bCh = b.fv_change_pct ?? 0
        if (bCh < aCh) byBorrower.set(key, b) // more negative wins
      }
    }

    return Array.from(byBorrower.values())
  },
)

/**
 * Per-fund total live position count (used for the "All <n>" tab).
 * Cheap, uses latest period from observations.
 */
export const getFundPositionCount = cache(async (fund: GoldmanFund): Promise<number> => {
  const supabase = createClient()
  const { data: p, error: pErr } = await supabase
    .from("observations")
    .select("period_end")
    .eq("fund_ticker", fund)
    .order("period_end", { ascending: false, nullsFirst: false })
    .limit(1)
  if (pErr || !p || p.length === 0) return 0
  const periodEnd = (p[0] as { period_end: string }).period_end
  const { count, error } = await supabase
    .from("observations")
    .select("id", { count: "exact", head: true })
    .eq("fund_ticker", fund)
    .eq("period_end", periodEnd)
  if (error) return 0
  return count ?? 0
})

// ─────────────────────────────────────────────────────────────────────────────
// Tab filtering / grouping (operates on already-loaded rows)
// ─────────────────────────────────────────────────────────────────────────────

export type BookTab =
  | "deteriorating"
  | "watchlist"
  | "non_accrual"
  | "vintage"
  | "sector"
  | "sponsor"
  | "all"

export const BOOK_TAB_ORDER: BookTab[] = [
  "deteriorating",
  "watchlist",
  "non_accrual",
  "vintage",
  "sector",
  "sponsor",
  "all",
]

export const BOOK_TAB_LABEL: Record<BookTab, string> = {
  deteriorating: "Deteriorating",
  watchlist: "Watchlist",
  non_accrual: "Non-accrual",
  vintage: "By vintage",
  sector: "By sector",
  sponsor: "By sponsor",
  all: "All",
}

export function parseBookTab(input: string | string[] | undefined): BookTab {
  const v = Array.isArray(input) ? input[0] : input
  if (!v) return "deteriorating"
  const lc = v.toLowerCase()
  if (BOOK_TAB_ORDER.includes(lc as BookTab)) return lc as BookTab
  return "deteriorating"
}

export function parseFund(input: string | string[] | undefined): GoldmanFund {
  const v = Array.isArray(input) ? input[0] : input
  const upper = (v ?? "").toUpperCase()
  if (upper === "GSBD") return "GSBD"
  return "GSCR"
}

/** Rank by deterioration: severity desc, then most negative fv_change_pct. */
function deteriorationSort(a: BookPositionRow, b: BookPositionRow) {
  if (b.severity_100 !== a.severity_100) return b.severity_100 - a.severity_100
  const ac = a.fv_change_pct ?? 0
  const bc = b.fv_change_pct ?? 0
  return ac - bc // more negative first
}

export function filterAndSortForTab(
  rows: BookPositionRow[],
  tab: BookTab,
): BookPositionRow[] {
  switch (tab) {
    case "deteriorating":
      return rows
        .filter(
          (r) =>
            r.severity_100 >= 60 ||
            (r.fv_change_pct !== null && r.fv_change_pct <= -25),
        )
        .sort(deteriorationSort)
    case "watchlist":
      return rows
        .filter((r) => {
          const sevWatch = r.severity_100 >= 40 && r.severity_100 < 70
          const pikWatch = r.is_pik === true
          const modestDrop =
            r.fv_change_pct !== null &&
            r.fv_change_pct <= -10 &&
            r.fv_change_pct > -25
          return sevWatch || pikWatch || modestDrop
        })
        .sort(deteriorationSort)
    case "non_accrual":
      return rows
        .filter((r) => r.accrual_status === "non_accrual")
        .sort(deteriorationSort)
    case "vintage":
      return [...rows].sort((a, b) => {
        const av = a.vintage ?? "~"
        const bv = b.vintage ?? "~"
        if (av < bv) return -1
        if (av > bv) return 1
        return deteriorationSort(a, b)
      })
    case "sector":
      return [...rows].sort((a, b) => {
        const av = (a.industry ?? "~").toLowerCase()
        const bv = (b.industry ?? "~").toLowerCase()
        if (av < bv) return -1
        if (av > bv) return 1
        return deteriorationSort(a, b)
      })
    case "sponsor":
      return [...rows].sort((a, b) => {
        const av = (a.sponsor ?? "~").toLowerCase()
        const bv = (b.sponsor ?? "~").toLowerCase()
        if (av < bv) return -1
        if (av > bv) return 1
        return deteriorationSort(a, b)
      })
    case "all":
    default:
      return [...rows].sort(deteriorationSort)
  }
}

/** Tab pill counts. */
export function tabCounts(rows: BookPositionRow[]): Record<BookTab, number> {
  return {
    deteriorating: filterAndSortForTab(rows, "deteriorating").length,
    watchlist: filterAndSortForTab(rows, "watchlist").length,
    non_accrual: filterAndSortForTab(rows, "non_accrual").length,
    vintage: rows.length,
    sector: rows.length,
    sponsor: rows.length,
    all: rows.length,
  }
}
