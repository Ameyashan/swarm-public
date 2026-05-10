import "server-only"
import { cache } from "react"
import { createClient } from "@/lib/supabase/server"
import type { DetectorHit } from "@/app/alerts/alerts-helpers"

/**
 * Per-request memoized query helpers.
 *
 * React.cache deduplicates calls within a single render — multiple components
 * (e.g. footer counters + page body) requesting the same data hit Supabase
 * exactly once. Combined with `export const revalidate = N` on a route, the
 * underlying RPC results are also reused across requests within the window.
 */

export const getHomeSummary = cache(async () => {
  const supabase = createClient()
  const { data, error } = await supabase.rpc("home_summary")
  if (error) {
    console.error("home_summary error", error)
    return null
  }
  return (data?.[0] ?? data) as
    | {
        total_fv_b: number | string
        total_positions: number | string
        total_hits_90d: number | string
        pct_at_risk: number | string
        latest_period_end: string | null
      }
    | null
})

export const getRecentAlerts = cache(async (limit = 5) => {
  const supabase = createClient()
  const { data, error } = await supabase
    .from("detector_hits")
    .select(
      "id, detector_name, fund_ticker, portfolio_company_canonical, current_period_end, prior_period_end, severity_score, hit_data, cited_source_urls, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<DetectorHit[]>()
  if (error) {
    console.error("getRecentAlerts error", error)
    return []
  }
  return data ?? []
})

export const getActiveFundList = cache(async () => {
  const supabase = createClient()
  const { data, error } = await supabase.rpc("fund_observation_counts")
  if (error) {
    console.error("fund_observation_counts error", error)
    return [] as Array<{ fund_ticker: string; n: number }>
  }
  return ((data ?? []) as Array<{ fund_ticker: string; n: number | string }>)
    .map((r) => ({ fund_ticker: r.fund_ticker, n: Number(r.n) }))
    .filter((r) => r.n > 0)
})

export const getTopCrossFundBorrowers = cache(
  async (cutoff_date: string, limit_n = 6) => {
    const supabase = createClient()
    const { data, error } = await supabase.rpc("top_cross_fund_borrowers", {
      cutoff_date,
      limit_n,
    })
    if (error) {
      console.error("top_cross_fund_borrowers error", error)
      return []
    }
    return data ?? []
  },
)
