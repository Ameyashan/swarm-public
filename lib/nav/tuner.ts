import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { runBacktest, type BacktestResult, type IndustryWeights } from "@/lib/nav/backtest"

// Phase 4 — per-industry weight tuner.
//
// Strategy:
//   1. Run a baseline backtest at v1.0.0 weights (HY 0.50 / LL 0.35 / Sec 0.15).
//   2. Group results by industry; bucket small industries together as "other".
//   3. For each industry with >= MIN_SAMPLES results, grid-search over a
//      coarse space of weight triples (each summing to 1) and durations
//      (2.0, 3.5, 5.0). Score = mean |drift| for that industry's quarter-pair
//      results in the new backtest run.
//   4. Persist per-industry winners to methodology_industry_weights under the
//      target methodology_version (v1.1.0).
//
// Practical scope: the grid is intentionally coarse so this stays under the
// 60s serverless budget on a few hundred quarter-pairs. The aggressive option
// is to factor out the grid into chunks and run each as a separate request.

const MIN_SAMPLES_PER_INDUSTRY = 5

// Coarse grid: 21 weight triples × 3 durations × 1 alpha = 63 backtest replays
// per industry. Each replay touches only that industry's quarter-pairs.
const WEIGHT_GRID: Array<[number, number, number]> = (() => {
  const grid: Array<[number, number, number]> = []
  for (let hy = 0.2; hy <= 0.8 + 1e-6; hy += 0.1) {
    for (let ll = 0.1; ll <= 0.7 + 1e-6; ll += 0.1) {
      const sec = 1 - hy - ll
      if (sec < 0.05 - 1e-6 || sec > 0.45 + 1e-6) continue
      grid.push([
        Math.round(hy * 100) / 100,
        Math.round(ll * 100) / 100,
        Math.round(sec * 100) / 100,
      ])
    }
  }
  return grid
})()

const DURATION_GRID = [2.0, 3.5, 5.0]
const ALPHA_GRID = [0.4, 0.6, 0.8]

export type TunerSummary = {
  methodology_version: string
  fund_ticker: string
  baseline_mean_abs_drift_bps: number | null
  tuned_mean_abs_drift_bps: number | null
  industries_tuned: number
  industries_skipped: number
  per_industry: Array<{
    industry: string
    sample_size: number
    baseline_mean_abs: number
    tuned_mean_abs: number
    weights: IndustryWeights
  }>
  errors: string[]
}

function meanAbs(rs: BacktestResult[]): number {
  if (rs.length === 0) return Number.POSITIVE_INFINITY
  let total = 0
  for (const r of rs) total += Math.abs(r.drift_bps)
  return total / rs.length
}

function bucketByIndustry(rs: BacktestResult[]): Map<string, BacktestResult[]> {
  const out = new Map<string, BacktestResult[]>()
  for (const r of rs) {
    const key = (r.industry ?? "Other").toLowerCase().trim() || "other"
    const arr = out.get(key) ?? []
    arr.push(r)
    out.set(key, arr)
  }
  return out
}

// Re-score an existing backtest result set under a hypothetical weight set
// WITHOUT re-running the backtest. We rely on the simplifying assumption that
// drift scales linearly with the |spread delta| applied — which is true under
// the v1.0.0 formula since FV move = -duration × spread × FV. The tuner is
// therefore an "analytical re-score": for each result, we read the per-pillar
// spread deltas from `components.weights_used` and re-blend.
//
// This is an approximation — it ignores compounding across the daily walk and
// the daily clamp rails — but it's accurate enough for ranking weight candidates
// and dramatically faster than a full re-backtest per grid point.
function rescore(
  baselineRow: BacktestResult,
  w_hy: number,
  w_ll: number,
  w_sec: number,
  duration_years: number,
  _alpha_dcf: number,
): number {
  // Pull per-pillar spread deltas from the baseline backtest. We need both
  // the HY OAS delta over the quarter and the average market-comp delta — the
  // existing backtest stores `last_day_delta_bps` as the cumulative move,
  // which doesn't decompose cleanly. So we approximate by treating the
  // baseline drift as composed at the baseline weights and rescaling.
  const baselineWeights = (baselineRow.components.weights_used ?? []) as Array<{
    benchmark_code: string
    weight: number
  }>
  const baseHy =
    baselineWeights.find((w) => w.benchmark_code === "BAMLH0A0HYM2")?.weight ?? 0.5
  const baseLl =
    baselineWeights.find((w) => w.benchmark_code === "BKLN")?.weight ?? 0.35
  const baseSec = Math.max(0, 1 - baseHy - baseLl)
  const baseDur = Number(baselineRow.components.duration_years ?? 3.5)
  const baseAlpha = Number(baselineRow.components.alpha_dcf ?? 0.6)

  // Recover an approximation of (pillar_a_spread, pillar_b_spread). We can't
  // recover them exactly without re-walking, so we approximate by treating the
  // baseline drift_bps as if it came from a blended duration-adjusted move at
  // the baseline weights, then back into a single "effective spread bps" that
  // we re-blend with the new weights. Since baseDur and the structure are
  // identical, this collapses to: scale drift_bps by (newDur/baseDur) and by
  // (newBlend / baseBlend) where blend = w_hy*1 + w_ll*1 + w_sec*1 = 1 always.
  // So the only real lever the analytical re-score gives us is duration.
  //
  // For real per-weight optimization we run a separate backtest below — this
  // function is a fast guard for the top-N duration candidates only.
  if (baseDur === 0) return Math.abs(baselineRow.drift_bps)
  const durScaled = (baselineRow.drift_bps * duration_years) / baseDur
  return Math.abs(durScaled)
}

// True grid search: a real backtest under the candidate weights, scoped to one
// industry's borrowers. Slower (~1 backtest per (industry, weight point)) but
// faithful to the daily-walk dynamics including rails.
async function backtestIndustryCandidate(
  fund: string,
  industry: string,
  candidate: IndustryWeights,
): Promise<BacktestResult[]> {
  const overrides = new Map<string, IndustryWeights>()
  overrides.set(industry.toLowerCase(), candidate)
  const summary = await runBacktest({
    fund,
    persist: false,
    industry_weights: overrides,
  })
  return summary.results.filter(
    (r) => (r.industry ?? "Other").toLowerCase().trim() === industry.toLowerCase(),
  )
}

export async function runTuner(opts: {
  target_version: string
  fund?: string
  notes?: string
  fast?: boolean // when true: skip the candidate-backtest pass; rely on analytical re-score only
} = { target_version: "v1.1.0" }): Promise<TunerSummary> {
  const fund = opts.fund ?? "GSCR"
  const target_version = opts.target_version
  const errors: string[] = []
  const supabase = createAdminClient()

  // Ensure target methodology_version exists.
  {
    const { data: ver } = await supabase
      .from("methodology_versions")
      .select("version")
      .eq("version", target_version)
      .maybeSingle()
    if (!ver) {
      const { error: insErr } = await supabase
        .from("methodology_versions")
        .insert({
          version: target_version,
          effective_at: new Date().toISOString(),
          formula_doc: `Tuned methodology — per-industry weights derived from ${fund} backtest. Same formula as v1.0.0 with industry-specific (w_hy, w_ll, w_sec) and duration.`,
          notes: opts.notes ?? `Tuner output. Source backtest ran on ${new Date().toISOString().slice(0, 10)}.`,
        })
      if (insErr) errors.push(`create ${target_version}: ${insErr.message}`)
    }
  }

  // 1) Baseline backtest at v1.0.0 weights (no override map).
  const baseline = await runBacktest({
    methodology_version: "v1.0.0",
    fund,
    persist: false,
    notes: "tuner baseline",
  })
  errors.push(...baseline.errors)
  const baselineByIndustry = bucketByIndustry(baseline.results)
  const baselineMean = meanAbs(baseline.results)

  // 2) Per-industry tuning.
  const perIndustry: TunerSummary["per_industry"] = []
  let skipped = 0
  for (const [industry, rows] of Array.from(baselineByIndustry.entries())) {
    if (rows.length < MIN_SAMPLES_PER_INDUSTRY) {
      skipped++
      continue
    }
    const baselineIndAbs = meanAbs(rows)

    // 2a) Fast analytical pre-pass: rank duration candidates only.
    let bestDuration = 3.5
    let bestDurAbs = baselineIndAbs
    for (const d of DURATION_GRID) {
      let total = 0
      for (const r of rows) total += rescore(r, 0.5, 0.35, 0.15, d, 0.6)
      const mean = total / rows.length
      if (mean < bestDurAbs) {
        bestDurAbs = mean
        bestDuration = d
      }
    }

    // 2b) Full grid over weights × alpha at the best-duration prior.
    // Run as real candidate backtests to capture rails/compounding behavior.
    let best: { cand: IndustryWeights; abs: number } = {
      cand: {
        industry,
        w_hy: 0.5,
        w_ll: 0.35,
        w_sec: 0.15,
        duration_years: bestDuration,
        alpha_dcf: 0.6,
      },
      abs: baselineIndAbs,
    }

    if (!opts.fast) {
      const totalCandidates = WEIGHT_GRID.length * ALPHA_GRID.length
      let candidatesRun = 0
      for (const [w_hy, w_ll, w_sec] of WEIGHT_GRID) {
        for (const alpha of ALPHA_GRID) {
          const cand: IndustryWeights = {
            industry,
            w_hy,
            w_ll,
            w_sec,
            duration_years: bestDuration,
            alpha_dcf: alpha,
          }
          try {
            const candidateResults = await backtestIndustryCandidate(fund, industry, cand)
            if (candidateResults.length === 0) continue
            const score = meanAbs(candidateResults)
            if (score < best.abs) {
              best = { cand, abs: score }
            }
          } catch (err) {
            errors.push(`tune ${industry} cand ${w_hy}/${w_ll}/${w_sec}: ${err instanceof Error ? err.message : String(err)}`)
          }
          candidatesRun++
        }
      }
      void totalCandidates
      void candidatesRun
    } else {
      // Fast mode — just use the duration-only analytical fit.
      best = {
        cand: {
          industry,
          w_hy: 0.5,
          w_ll: 0.35,
          w_sec: 0.15,
          duration_years: bestDuration,
          alpha_dcf: 0.6,
        },
        abs: bestDurAbs,
      }
    }

    perIndustry.push({
      industry,
      sample_size: rows.length,
      baseline_mean_abs: baselineIndAbs,
      tuned_mean_abs: best.abs,
      weights: best.cand,
    })

    // 2c) Persist row to methodology_industry_weights (idempotent upsert).
    const { error: upErr } = await supabase
      .from("methodology_industry_weights")
      .upsert(
        {
          methodology_version: target_version,
          industry,
          w_hy: best.cand.w_hy,
          w_ll: best.cand.w_ll,
          w_sec: best.cand.w_sec,
          duration_years: best.cand.duration_years,
          alpha_dcf: best.cand.alpha_dcf,
          fit_mean_abs_drift_bps: best.abs,
          sample_size: rows.length,
        },
        { onConflict: "methodology_version,industry" },
      )
    if (upErr) errors.push(`upsert ${industry}: ${upErr.message}`)
  }

  // 3) Final aggregate of tuned drift across all industries.
  const tunedTotal = perIndustry.reduce(
    (a, p) => a + p.tuned_mean_abs * p.sample_size,
    0,
  )
  const tunedDenom = perIndustry.reduce((a, p) => a + p.sample_size, 0)
  const tunedMean = tunedDenom > 0 ? tunedTotal / tunedDenom : null

  return {
    methodology_version: target_version,
    fund_ticker: fund,
    baseline_mean_abs_drift_bps: Number.isFinite(baselineMean) ? baselineMean : null,
    tuned_mean_abs_drift_bps: tunedMean,
    industries_tuned: perIndustry.length,
    industries_skipped: skipped,
    per_industry: perIndustry,
    errors,
  }
}
