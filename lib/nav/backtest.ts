import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  computeDailyMark,
  METHODOLOGY_VERSION,
  type BenchmarkSnapshot,
  type BenchmarkWeight,
} from "@/lib/nav/methodology"

// Phase 4 — Backtest engine.
//
// For each (fund, borrower) in position_benchmark_map, walk the position
// forward through reported quarterly observations using historical FRED/Yahoo
// closes. Between two consecutive period_ends, replay the daily model with
// the reported FV at the prior period_end as the anchor, then compare the
// model's accumulated FV at the next period_end vs the actually reported FV.
//
// One backtest_results row per (position, quarter_pair). Aggregate stats
// written to backtest_runs.

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type BacktestOpts = {
  methodology_version?: string
  fund?: string
  start_period?: string // inclusive YYYY-MM-DD, default 2 years ago
  end_period?: string   // inclusive, default today
  // Optional industry → weights override map. When present, takes precedence
  // over position_benchmark_map weights for positions whose industry matches.
  industry_weights?: Map<string, IndustryWeights>
  // When true, persist backtest_runs + backtest_results rows. When false, the
  // tuner can call this in-memory without DB writes.
  persist?: boolean
  notes?: string
}

export type IndustryWeights = {
  industry: string
  w_hy: number
  w_ll: number
  w_sec: number
  duration_years: number
  alpha_dcf: number
}

export type BacktestResult = {
  fund_ticker: string
  portfolio_company_canonical: string
  industry: string | null
  period_end: string
  prior_period_end: string
  reported_fv: number
  model_fv: number
  drift_bps: number
  drift_pct: number
  components: Record<string, any>
}

export type BacktestSummary = {
  run_id: string | null
  methodology_version: string
  fund_ticker: string
  start_period: string
  end_period: string
  positions_evaluated: number
  quarter_pairs_evaluated: number
  mean_abs_drift_bps: number | null
  median_abs_drift_bps: number | null
  p95_abs_drift_bps: number | null
  results: BacktestResult[]
  errors: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

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

function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const idx = Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))
  return s[idx]
}

function classifyKind(code: string): "yield" | "price" {
  if (code.startsWith("BAML") || code.startsWith("DGS")) return "yield"
  return "price"
}

function defaultStart(): string {
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear() - 2)
  return d.toISOString().slice(0, 10)
}

function defaultEnd(): string {
  return new Date().toISOString().slice(0, 10)
}

// Walk dates forward from prior+1d through period_end inclusive, picking the
// most recent available benchmark snapshot for each trading day. We don't fail
// if a day's benchmark is missing; we reuse the prior day's value.
function buildTradingDays(start: string, end: string, benchmarkDates: Set<string>): string[] {
  const out: string[] = []
  const startMs = new Date(start + "T00:00:00Z").getTime()
  const endMs = new Date(end + "T00:00:00Z").getTime()
  for (let t = startMs; t <= endMs; t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10)
    if (benchmarkDates.has(d)) out.push(d)
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Backtest runner
// ─────────────────────────────────────────────────────────────────────────────

export async function runBacktest(opts: BacktestOpts = {}): Promise<BacktestSummary> {
  const methodology_version = opts.methodology_version ?? METHODOLOGY_VERSION
  const fund = opts.fund ?? "GSCR"
  const start_period = opts.start_period ?? defaultStart()
  const end_period = opts.end_period ?? defaultEnd()
  const persist = opts.persist ?? true

  const supabase = createAdminClient()
  const errors: string[] = []

  // 1) Load position_benchmark_map for this fund (per-position weights).
  const { data: mapRows, error: mapErr } = await supabase
    .from("position_benchmark_map")
    .select(
      "portfolio_company_canonical, benchmark_code, weight, duration_years, alpha_dcf",
    )
    .eq("fund_ticker", fund)
  if (mapErr) errors.push(`load map: ${mapErr.message}`)

  type MapRow = {
    portfolio_company_canonical: string
    benchmark_code: string
    weight: number
    duration_years: number
    alpha_dcf: number
  }
  const mapByBorrower = new Map<string, MapRow[]>()
  for (const r of (mapRows ?? []) as MapRow[]) {
    const arr = mapByBorrower.get(r.portfolio_company_canonical) ?? []
    arr.push(r)
    mapByBorrower.set(r.portfolio_company_canonical, arr)
  }
  const borrowers = Array.from(mapByBorrower.keys())
  if (borrowers.length === 0) {
    return emptySummary(methodology_version, fund, start_period, end_period, [
      "position_benchmark_map empty",
    ])
  }

  // 2) Load observations for those borrowers in the period window.
  const { data: obsRows, error: obsErr } = await supabase
    .from("observations")
    .select(
      "portfolio_company_canonical, period_end, fair_value, industry_canonical, industry",
    )
    .eq("fund_ticker", fund)
    .in("portfolio_company_canonical", borrowers)
    .gte("period_end", start_period)
    .lte("period_end", end_period)
    .order("period_end", { ascending: true })
    .limit(50_000)
  if (obsErr) errors.push(`load observations: ${obsErr.message}`)

  type ObsRow = {
    portfolio_company_canonical: string
    period_end: string
    fair_value: number | null
    industry_canonical: string | null
    industry: string | null
  }
  // Sum fair_value across all tranches per (borrower, period_end). Carry
  // industry forward from whichever row had one.
  type PeriodAgg = {
    borrower: string
    period_end: string
    fv: number
    industry: string | null
  }
  const aggByBorrowerPeriod = new Map<string, PeriodAgg>()
  for (const r of (obsRows ?? []) as ObsRow[]) {
    const fv = asNumber(r.fair_value)
    if (fv === null) continue
    const k = `${r.portfolio_company_canonical}::${r.period_end}`
    const existing = aggByBorrowerPeriod.get(k)
    if (existing) {
      existing.fv += fv
      if (!existing.industry) {
        existing.industry = r.industry_canonical ?? r.industry ?? null
      }
    } else {
      aggByBorrowerPeriod.set(k, {
        borrower: r.portfolio_company_canonical,
        period_end: r.period_end,
        fv,
        industry: r.industry_canonical ?? r.industry ?? null,
      })
    }
  }

  // Group periods per borrower, sorted ascending.
  const periodsByBorrower = new Map<string, PeriodAgg[]>()
  for (const agg of Array.from(aggByBorrowerPeriod.values())) {
    const arr = periodsByBorrower.get(agg.borrower) ?? []
    arr.push(agg)
    periodsByBorrower.set(agg.borrower, arr)
  }
  for (const arr of Array.from(periodsByBorrower.values())) {
    arr.sort((a, b) => a.period_end.localeCompare(b.period_end))
  }

  // 3) Load benchmark_prices in the period window. Index by date+code.
  const benchmarkCodes = Array.from(
    new Set((mapRows ?? []).map((r: any) => r.benchmark_code as string)),
  )
  const { data: bpRows, error: bpErr } = await supabase
    .from("benchmark_prices")
    .select("series_code, as_of_date, value")
    .in("series_code", benchmarkCodes)
    .gte("as_of_date", start_period)
    .lte("as_of_date", end_period)
    .order("as_of_date", { ascending: true })
    .limit(200_000)
  if (bpErr) errors.push(`load benchmark_prices: ${bpErr.message}`)

  type BPRow = { series_code: string; as_of_date: string; value: number }
  const bpByCode = new Map<string, Map<string, number>>()
  const dateSet = new Set<string>()
  for (const r of (bpRows ?? []) as BPRow[]) {
    if (!bpByCode.has(r.series_code)) bpByCode.set(r.series_code, new Map())
    bpByCode.get(r.series_code)!.set(r.as_of_date, Number(r.value))
    dateSet.add(r.as_of_date)
  }
  if (dateSet.size === 0) {
    return emptySummary(methodology_version, fund, start_period, end_period, [
      ...errors,
      "no benchmark_prices in window — run historical backfill first",
    ])
  }

  // Helper: most recent value at or before a date for a series.
  function valueAtOrBefore(code: string, date: string): number | null {
    const series = bpByCode.get(code)
    if (!series) return null
    // Walk back at most ~7 calendar days (skip weekends).
    let d = date
    for (let i = 0; i < 14; i++) {
      const v = series.get(d)
      if (typeof v === "number" && Number.isFinite(v)) return v
      const prev = new Date(d + "T00:00:00Z")
      prev.setUTCDate(prev.getUTCDate() - 1)
      d = prev.toISOString().slice(0, 10)
    }
    return null
  }

  // 4) For each borrower, walk consecutive period pairs.
  const results: BacktestResult[] = []
  let positionsEvaluated = 0
  for (const borrower of borrowers) {
    const periods = periodsByBorrower.get(borrower) ?? []
    if (periods.length < 2) continue
    positionsEvaluated++
    const baseMap = mapByBorrower.get(borrower) ?? []
    if (baseMap.length === 0) continue
    const industry = periods.find((p) => p.industry)?.industry ?? null

    // Resolve weights for this borrower: industry override > position map.
    const override = industry && opts.industry_weights
      ? opts.industry_weights.get(industry.toLowerCase())
      : undefined
    const weights: BenchmarkWeight[] = override
      ? [
          { benchmark_code: "BAMLH0A0HYM2", weight: override.w_hy },
          { benchmark_code: "BKLN", weight: override.w_ll },
          // sector ETF: read whatever sector the position_benchmark_map chose;
          // override only adjusts the weight applied to that sector.
          ...baseMap
            .filter((m) => !["BAMLH0A0HYM2", "BKLN"].includes(m.benchmark_code))
            .map((m) => ({ benchmark_code: m.benchmark_code, weight: override.w_sec })),
        ]
      : baseMap.map((m) => ({
          benchmark_code: m.benchmark_code,
          weight: Number(m.weight),
        }))

    const duration_years = override
      ? override.duration_years
      : Number(baseMap[0].duration_years)
    const alpha_dcf = override ? override.alpha_dcf : Number(baseMap[0].alpha_dcf)

    // Walk consecutive period pairs.
    for (let i = 1; i < periods.length; i++) {
      const prior = periods[i - 1]
      const curr = periods[i]
      const anchorFv = prior.fv
      const reportedFv = curr.fv

      // Determine the daily walk dates between prior+1d and curr inclusive,
      // intersected with available benchmark dates.
      const walkStart = (() => {
        const d = new Date(prior.period_end + "T00:00:00Z")
        d.setUTCDate(d.getUTCDate() + 1)
        return d.toISOString().slice(0, 10)
      })()
      const tradingDays = buildTradingDays(walkStart, curr.period_end, dateSet)
      if (tradingDays.length === 0) continue

      // Run the model day-by-day.
      let fv = anchorFv
      let lastDelta = 0
      for (let d = 0; d < tradingDays.length; d++) {
        const today = tradingDays[d]
        const prior_d = d === 0 ? prior.period_end : tradingDays[d - 1]
        const benchmarks: BenchmarkSnapshot[] = []
        for (const w of weights) {
          const vToday = valueAtOrBefore(w.benchmark_code, today)
          const vPrior = valueAtOrBefore(w.benchmark_code, prior_d)
          if (vToday === null || vPrior === null) continue
          benchmarks.push({
            series_code: w.benchmark_code,
            value_today: vToday,
            value_prior: vPrior,
            kind: classifyKind(w.benchmark_code),
          })
        }
        const out = computeDailyMark({
          fund_ticker: fund,
          portfolio_company_canonical: borrower,
          mark_date: today,
          prior_fv: fv,
          fv_anchor: anchorFv,
          weights,
          benchmarks,
          duration_years,
          alpha_dcf,
          idio: { latest_severity_100: null },
        })
        fv = out.fair_value_estimated
        lastDelta = out.delta_bps
      }

      const drift_pct = reportedFv > 0 ? (fv - reportedFv) / reportedFv : 0
      results.push({
        fund_ticker: fund,
        portfolio_company_canonical: borrower,
        industry,
        period_end: curr.period_end,
        prior_period_end: prior.period_end,
        reported_fv: reportedFv,
        model_fv: fv,
        drift_bps: drift_pct * 10000,
        drift_pct,
        components: {
          weights_used: weights,
          duration_years,
          alpha_dcf,
          industry_override_applied: Boolean(override),
          last_day_delta_bps: lastDelta,
          trading_days_walked: tradingDays.length,
        },
      })
    }
  }

  const abs = results
    .map((r) => Math.abs(r.drift_bps))
    .filter((x) => Number.isFinite(x))
  const mean_abs = abs.length > 0 ? abs.reduce((a, b) => a + b, 0) / abs.length : null

  // 5) Persist (when requested).
  let run_id: string | null = null
  if (persist && results.length > 0) {
    const { data: runRow, error: runErr } = await supabase
      .from("backtest_runs")
      .insert({
        methodology_version,
        fund_ticker: fund,
        start_period,
        end_period,
        positions_evaluated: positionsEvaluated,
        quarter_pairs_evaluated: results.length,
        mean_abs_drift_bps: mean_abs,
        median_abs_drift_bps: median(abs),
        p95_abs_drift_bps: percentile(abs, 0.95),
        weights_applied: opts.industry_weights
          ? Object.fromEntries(Array.from(opts.industry_weights.entries()))
          : null,
        notes: opts.notes ?? null,
      })
      .select("id")
      .single()
    if (runErr) {
      errors.push(`backtest_runs insert: ${runErr.message}`)
    } else {
      run_id = runRow!.id as string
      // Batch-insert results 500 at a time so we don't blow request size.
      const batchSize = 500
      for (let i = 0; i < results.length; i += batchSize) {
        const batch = results.slice(i, i + batchSize).map((r) => ({
          backtest_run_id: run_id,
          ...r,
          components: r.components as Record<string, any>,
        }))
        const { error: resErr } = await supabase
          .from("backtest_results")
          .insert(batch)
        if (resErr) {
          errors.push(`backtest_results batch ${i}: ${resErr.message}`)
          break
        }
      }
    }
  }

  return {
    run_id,
    methodology_version,
    fund_ticker: fund,
    start_period,
    end_period,
    positions_evaluated: positionsEvaluated,
    quarter_pairs_evaluated: results.length,
    mean_abs_drift_bps: mean_abs,
    median_abs_drift_bps: median(abs),
    p95_abs_drift_bps: percentile(abs, 0.95),
    results,
    errors,
  }
}

function emptySummary(
  methodology_version: string,
  fund: string,
  start_period: string,
  end_period: string,
  errors: string[],
): BacktestSummary {
  return {
    run_id: null,
    methodology_version,
    fund_ticker: fund,
    start_period,
    end_period,
    positions_evaluated: 0,
    quarter_pairs_evaluated: 0,
    mean_abs_drift_bps: null,
    median_abs_drift_bps: null,
    p95_abs_drift_bps: null,
    results: [],
    errors,
  }
}
