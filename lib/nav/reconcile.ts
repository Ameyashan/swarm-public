import "server-only"
import { cache } from "react"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { METHODOLOGY_VERSION } from "@/lib/nav/methodology"

// Trailing model-vs-reported reconciliation.
//
// When a new observations row lands (typically period_end + 45-60d delay),
// compare the most recent daily_mark at-or-before that period_end against the
// reported fair_value. Drift is reported in bps and persisted to
// nav_reconciliation. Surfaces as a "model accuracy" card on /nav and feeds
// the Phase 4 backtest harness.

export type ReconciliationRow = {
  id: string
  fund_ticker: string
  portfolio_company_canonical: string
  period_end: string
  reported_fv: number
  model_fv: number
  model_mark_date: string
  drift_bps: number
  drift_pct: number
  methodology_version: string
  created_at: string
}

export type ReconciliationStats = {
  methodology_version: string
  positions_reconciled: number
  latest_period_end: string | null
  mean_abs_drift_bps: number | null
  median_abs_drift_bps: number | null
  p95_abs_drift_bps: number | null
  // True if the absolute drift averages within 250 bps (a rough quality bar
  // for v1 — wide enough that a methodology that's any good clears it).
  within_quality_bar: boolean
}

export type RunReconcileSummary = {
  methodology_version: string
  fund: string
  candidates_seen: number
  rows_inserted: number
  rows_skipped: number
  errors: string[]
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]
}

function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const idx = Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))
  return s[idx]
}

// One pass: for every (fund, borrower, period_end) in observations that we
// haven't reconciled yet under the current methodology_version, find the
// daily_marks row with the latest mark_date <= period_end and persist drift.
export async function runReconciliation(opts: {
  fund: string
  methodology_version?: string
} = { fund: "GSCR" }): Promise<RunReconcileSummary> {
  const fund = opts.fund
  const methodology_version = opts.methodology_version ?? METHODOLOGY_VERSION
  const supabase = createAdminClient()

  const summary: RunReconcileSummary = {
    methodology_version,
    fund,
    candidates_seen: 0,
    rows_inserted: 0,
    rows_skipped: 0,
    errors: [],
  }

  // Pull mapped borrowers — we only reconcile positions in the benchmark map.
  const { data: mapRows, error: mapErr } = await supabase
    .from("position_benchmark_map")
    .select("portfolio_company_canonical")
    .eq("fund_ticker", fund)
    .limit(20_000)
  if (mapErr) {
    summary.errors.push(`load map: ${mapErr.message}`)
    return summary
  }
  const borrowers = Array.from(
    new Set((mapRows ?? []).map((r: any) => r.portfolio_company_canonical as string)),
  )
  if (borrowers.length === 0) return summary

  // Pull all observations for these borrowers (we only reconcile against the
  // most recent period_end per borrower).
  const { data: obsRows, error: obsErr } = await supabase
    .from("observations")
    .select("fund_ticker, portfolio_company_canonical, period_end, fair_value")
    .eq("fund_ticker", fund)
    .in("portfolio_company_canonical", borrowers)
    .order("period_end", { ascending: false })
    .limit(20_000)
  if (obsErr) {
    summary.errors.push(`load observations: ${obsErr.message}`)
    return summary
  }
  type ObsRow = { fund_ticker: string; portfolio_company_canonical: string; period_end: string; fair_value: number | null }
  const latestObsByBorrower = new Map<string, ObsRow>()
  for (const r of (obsRows ?? []) as ObsRow[]) {
    if (!r.period_end || r.fair_value === null) continue
    if (!latestObsByBorrower.has(r.portfolio_company_canonical)) {
      latestObsByBorrower.set(r.portfolio_company_canonical, r)
    }
  }
  summary.candidates_seen = latestObsByBorrower.size

  // Already-reconciled rows for this methodology version — skip those.
  const { data: existing } = await supabase
    .from("nav_reconciliation")
    .select("portfolio_company_canonical, period_end")
    .eq("fund_ticker", fund)
    .eq("methodology_version", methodology_version)
  const seenKeys = new Set<string>(
    (existing ?? []).map((r: any) => `${r.portfolio_company_canonical}::${r.period_end}`),
  )

  // Pull all daily_marks for these borrowers under the methodology version —
  // we'll pick the latest mark at-or-before each period_end in code.
  const { data: marks, error: marksErr } = await supabase
    .from("daily_marks")
    .select(
      "fund_ticker, portfolio_company_canonical, mark_date, fair_value_estimated",
    )
    .eq("fund_ticker", fund)
    .eq("methodology_version", methodology_version)
    .in("portfolio_company_canonical", borrowers)
    .order("mark_date", { ascending: false })
    .limit(20_000)
  if (marksErr) {
    summary.errors.push(`load daily_marks: ${marksErr.message}`)
    return summary
  }
  type MarkRow = { portfolio_company_canonical: string; mark_date: string; fair_value_estimated: number }
  const marksByBorrower = new Map<string, MarkRow[]>()
  for (const m of (marks ?? []) as MarkRow[]) {
    const arr = marksByBorrower.get(m.portfolio_company_canonical) ?? []
    arr.push(m)
    marksByBorrower.set(m.portfolio_company_canonical, arr)
  }

  const inserts: Array<Record<string, any>> = []
  for (const [borrower, obs] of Array.from(latestObsByBorrower.entries())) {
    const key = `${borrower}::${obs.period_end}`
    if (seenKeys.has(key)) {
      summary.rows_skipped++
      continue
    }
    const marksForBorrower = marksByBorrower.get(borrower) ?? []
    const eligible = marksForBorrower.filter((m) => m.mark_date <= obs.period_end)
    if (eligible.length === 0) {
      summary.rows_skipped++
      continue
    }
    const nearest = eligible[0] // already ordered desc
    const reported = Number(obs.fair_value)
    const modelFv = Number(nearest.fair_value_estimated)
    if (!Number.isFinite(reported) || !Number.isFinite(modelFv) || reported === 0) {
      summary.rows_skipped++
      continue
    }
    const drift_pct = (modelFv - reported) / reported
    inserts.push({
      fund_ticker: fund,
      portfolio_company_canonical: borrower,
      period_end: obs.period_end,
      reported_fv: reported,
      model_fv: modelFv,
      model_mark_date: nearest.mark_date,
      drift_bps: drift_pct * 10000,
      drift_pct,
      methodology_version,
    })
  }

  if (inserts.length === 0) return summary

  const { error: insErr, count } = await supabase
    .from("nav_reconciliation")
    .upsert(inserts, {
      onConflict: "fund_ticker,portfolio_company_canonical,period_end,methodology_version",
      count: "exact",
    })
  if (insErr) {
    summary.errors.push(`nav_reconciliation upsert: ${insErr.message}`)
    return summary
  }
  summary.rows_inserted = count ?? inserts.length
  return summary
}

// Read-side: aggregate stats for the /nav model-accuracy card.
export const getReconciliationStats = cache(
  async (fund: string, methodology_version?: string): Promise<ReconciliationStats> => {
    const version = methodology_version ?? METHODOLOGY_VERSION
    const supabase = createClient()
    const { data, error } = await supabase
      .from("nav_reconciliation")
      .select("period_end, drift_bps")
      .eq("fund_ticker", fund)
      .eq("methodology_version", version)
      .order("period_end", { ascending: false })
      .limit(2000)
    const empty: ReconciliationStats = {
      methodology_version: version,
      positions_reconciled: 0,
      latest_period_end: null,
      mean_abs_drift_bps: null,
      median_abs_drift_bps: null,
      p95_abs_drift_bps: null,
      within_quality_bar: false,
    }
    if (error || !data || data.length === 0) return empty
    const abs = (data as Array<{ drift_bps: number }>).map((r) => Math.abs(Number(r.drift_bps)))
    const finite = abs.filter((x) => Number.isFinite(x))
    if (finite.length === 0) return empty
    const mean = finite.reduce((a, b) => a + b, 0) / finite.length
    return {
      methodology_version: version,
      positions_reconciled: finite.length,
      latest_period_end: (data[0] as any).period_end as string,
      mean_abs_drift_bps: mean,
      median_abs_drift_bps: median(finite),
      p95_abs_drift_bps: percentile(finite, 0.95),
      within_quality_bar: mean <= 250,
    }
  },
)
