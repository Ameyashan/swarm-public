import "server-only"
import { cache } from "react"
import { createClient } from "@/lib/supabase/server"

export type DailyMarkRow = {
  id: string
  fund_ticker: string
  portfolio_company_canonical: string
  mark_date: string
  fair_value_estimated: number
  mark_pct: number | null
  prior_fv: number | null
  delta_bps: number | null
  methodology_version: string
  components: Record<string, any>
  confidence: "low" | "med" | "high"
  requires_review: boolean
  created_at: string
}

export type MarkOverrideRow = {
  id: string
  fund_ticker: string
  portfolio_company_canonical: string
  override_date: string
  original_mark: number
  override_mark: number
  reason: string
  approver: string | null
  status: "pending" | "approved" | "rejected"
  created_at: string
}

export type MethodologyVersion = {
  version: string
  effective_at: string
  formula_doc: string
  notes: string | null
}

export type DailyMarksSummary = {
  mark_date: string | null
  position_count: number
  total_fv_dollars: number
  total_delta_dollars: number
  movers_up: number
  movers_down: number
  review_count: number
}

// Latest mark_date present in daily_marks for a fund. Used to anchor the page
// to the most recent run so we don't show a half-empty table after weekends.
export const getLatestMarkDate = cache(async (fund: string): Promise<string | null> => {
  const supabase = createClient()
  const { data, error } = await supabase
    .from("daily_marks")
    .select("mark_date")
    .eq("fund_ticker", fund)
    .order("mark_date", { ascending: false })
    .limit(1)
  if (error || !data || data.length === 0) return null
  return data[0].mark_date as string
})

export const getDailyMarks = cache(
  async (fund: string, mark_date: string | null): Promise<DailyMarkRow[]> => {
    if (!mark_date) return []
    const supabase = createClient()
    const { data, error } = await supabase
      .from("daily_marks")
      .select(
        "id, fund_ticker, portfolio_company_canonical, mark_date, fair_value_estimated, mark_pct, prior_fv, delta_bps, methodology_version, components, confidence, requires_review, created_at",
      )
      .eq("fund_ticker", fund)
      .eq("mark_date", mark_date)
      .order("delta_bps", { ascending: true, nullsFirst: false })
    if (error) return []
    return (data ?? []) as DailyMarkRow[]
  },
)

export function summarize(rows: DailyMarkRow[]): DailyMarksSummary {
  if (rows.length === 0) {
    return {
      mark_date: null,
      position_count: 0,
      total_fv_dollars: 0,
      total_delta_dollars: 0,
      movers_up: 0,
      movers_down: 0,
      review_count: 0,
    }
  }
  let total_fv_thousands = 0
  let total_delta_thousands = 0
  let movers_up = 0
  let movers_down = 0
  let review_count = 0
  for (const r of rows) {
    total_fv_thousands += Number(r.fair_value_estimated) || 0
    const prior = Number(r.prior_fv) || 0
    total_delta_thousands += (Number(r.fair_value_estimated) || 0) - prior
    if ((Number(r.delta_bps) || 0) > 0) movers_up++
    else if ((Number(r.delta_bps) || 0) < 0) movers_down++
    if (r.requires_review) review_count++
  }
  return {
    mark_date: rows[0].mark_date,
    position_count: rows.length,
    total_fv_dollars: total_fv_thousands * 1000,
    total_delta_dollars: total_delta_thousands * 1000,
    movers_up,
    movers_down,
    review_count,
  }
}

// Fetch overrides for the rows currently on screen (keyed by fund + borrower
// + mark_date). We only need rows whose override_date matches the mark_date.
export const getOverridesForRows = cache(
  async (fund: string, mark_date: string | null): Promise<MarkOverrideRow[]> => {
    if (!mark_date) return []
    const supabase = createClient()
    const { data, error } = await supabase
      .from("mark_overrides")
      .select(
        "id, fund_ticker, portfolio_company_canonical, override_date, original_mark, override_mark, reason, approver, status, created_at",
      )
      .eq("fund_ticker", fund)
      .eq("override_date", mark_date)
      .order("created_at", { ascending: false })
    if (error) return []
    return (data ?? []) as MarkOverrideRow[]
  },
)

export type BacktestRunRow = {
  id: string
  methodology_version: string
  fund_ticker: string
  start_period: string
  end_period: string
  positions_evaluated: number
  quarter_pairs_evaluated: number
  mean_abs_drift_bps: number | null
  median_abs_drift_bps: number | null
  p95_abs_drift_bps: number | null
  weights_applied: Record<string, any> | null
  notes: string | null
  created_at: string
}

export const getBacktestRuns = cache(
  async (fund: string, limit: number = 10): Promise<BacktestRunRow[]> => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("backtest_runs")
      .select(
        "id, methodology_version, fund_ticker, start_period, end_period, positions_evaluated, quarter_pairs_evaluated, mean_abs_drift_bps, median_abs_drift_bps, p95_abs_drift_bps, weights_applied, notes, created_at",
      )
      .eq("fund_ticker", fund)
      .order("created_at", { ascending: false })
      .limit(limit)
    if (error) return []
    return (data ?? []) as BacktestRunRow[]
  },
)

export type BiggestMover = {
  id: string
  fund_ticker: string
  portfolio_company_canonical: string
  mark_date: string
  mark_pct: number | null
  delta_bps: number
  fair_value_estimated: number
  requires_review: boolean
}

// Top movers across both funds on the latest available mark_date. Used by the
// Briefing "biggest daily movers" tile. Includes the most negative AND most
// positive deltas (no symmetry assumed — most often the bottom dominates).
export const getBiggestMovers = cache(
  async (limit: number = 5): Promise<BiggestMover[]> => {
    const supabase = createClient()
    const { data: latest, error: latestErr } = await supabase
      .from("daily_marks")
      .select("mark_date")
      .order("mark_date", { ascending: false })
      .limit(1)
    if (latestErr || !latest || latest.length === 0) return []
    const latestDate = latest[0].mark_date as string
    const { data, error } = await supabase
      .from("daily_marks")
      .select(
        "id, fund_ticker, portfolio_company_canonical, mark_date, mark_pct, delta_bps, fair_value_estimated, requires_review",
      )
      .eq("mark_date", latestDate)
      .not("delta_bps", "is", null)
      .limit(2000)
    if (error || !data) return []
    const rows = (data as BiggestMover[]).filter((r) =>
      Number.isFinite(Number(r.delta_bps)),
    )
    rows.sort((a, b) => Math.abs(Number(b.delta_bps)) - Math.abs(Number(a.delta_bps)))
    return rows.slice(0, limit)
  },
)

export const getCurrentMethodology = cache(async (): Promise<MethodologyVersion | null> => {
  const supabase = createClient()
  const { data, error } = await supabase
    .from("methodology_versions")
    .select("version, effective_at, formula_doc, notes")
    .order("effective_at", { ascending: false })
    .limit(1)
  if (error || !data || data.length === 0) return null
  return data[0] as MethodologyVersion
})
