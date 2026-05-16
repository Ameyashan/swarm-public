// Pure methodology — daily NAV marking math, version v1.0.0.
//
// No I/O. Every dependency arrives via the input object. This file is the
// load-bearing logic and the only one that needs heavy unit tests. Pinned by
// methodology_version on every daily_marks row so old marks remain reproducible.
//
// Honest framing: decision-support, not a 40-Act fair-value mark.

export const METHODOLOGY_VERSION = "v1.0.0"

export const DAILY_RAIL_PCT = 0.02 // ±2% daily clamp
export const DRIFT_REVIEW_THRESHOLD = 0.10 // > 10% cumulative drift vs anchor → flag

export type BenchmarkSnapshot = {
  series_code: string
  // For yield series (HY OAS, IG OAS, Treasuries) value is in percent (e.g. 7.42).
  // For ETF series (BKLN, BIZD, sector ETFs) value is the close price.
  value_today: number
  value_prior: number
  // 'yield' for FRED OAS series, 'price' for ETF closes. Drives the conversion.
  kind: "yield" | "price"
}

export type BenchmarkWeight = {
  benchmark_code: string
  weight: number
  // Duration used to convert a price return into an implied yield delta.
  // Only used when kind === 'price'. Defaults to 4.5y for senior loan ETFs,
  // ~5y for HY ETFs, ~12y equity-vol-implied for sector ETFs.
  proxy_duration_years?: number
}

export type IdioInput = {
  // Highest detector severity (0..100) firing on this borrower in the last
  // lookback window. Null when no recent hit.
  latest_severity_100: number | null
  // Days since the hit fired. Used to attenuate stale signals.
  age_days?: number | null
}

export type DailyMarkInput = {
  fund_ticker: string
  portfolio_company_canonical: string
  mark_date: string // ISO date, NY trading day
  prior_fv: number // thousands, matches observations
  fv_anchor: number // most recent reported observation FV (thousands)
  weights: BenchmarkWeight[]
  benchmarks: BenchmarkSnapshot[]
  duration_years: number // position duration (loan-level, not ETF proxy)
  alpha_dcf: number // pillar A weight in the blend, 0..1
  idio: IdioInput
}

export type ComponentTrail = {
  series_code: string
  weight: number
  value_today: number
  value_prior: number
  delta_bps: number // sign convention: positive = wider spread = lower price
}

export type DailyMarkResult = {
  fair_value_estimated: number // thousands
  prior_fv: number
  delta_bps: number // total bps applied to FV (negative = price down)
  confidence: "low" | "med" | "high"
  requires_review: boolean
  components: {
    methodology_version: string
    pillar_a_spread_delta_bps: number
    pillar_b_spread_delta_bps: number
    blended_spread_delta_bps: number
    alpha_dcf: number
    duration_years: number
    benchmark_trail: ComponentTrail[]
    idio_shock_pct: number
    rails_fired: {
      daily_clamp_floor: boolean
      daily_clamp_ceiling: boolean
      drift_vs_anchor: boolean
    }
    fv_anchor: number
    anchor_drift_pct: number
  }
}

const DEFAULT_PROXY_DURATION: Record<string, number> = {
  BKLN: 4.5,
  HYG: 3.5,
  JNK: 3.5,
  ANGL: 5.5,
  FALN: 4.5,
  BIZD: 4.0,
  // SPDR sector ETFs — equity-vol proxy, broader sensitivity. We use ~12y
  // "duration-equivalent" so a 1% sector move maps to ~8bps spread.
  XLK: 12,
  XLI: 12,
  XLE: 12,
  XLV: 12,
  XLY: 12,
  XLF: 12,
  XLP: 12,
  XLU: 12,
  XLB: 12,
  XLRE: 12,
  XLC: 12,
}

function proxyDuration(snap: BenchmarkSnapshot, w: BenchmarkWeight): number {
  if (w.proxy_duration_years && w.proxy_duration_years > 0) return w.proxy_duration_years
  return DEFAULT_PROXY_DURATION[snap.series_code] ?? 5
}

// Convert a single benchmark snapshot to an implied spread delta in bps.
// Yield series (FRED OAS) → direct bps move (value is in percent).
// Price series (ETF) → -return / proxy_duration × 10000, expressed in bps.
function snapshotDeltaBps(snap: BenchmarkSnapshot, w: BenchmarkWeight): number {
  if (!Number.isFinite(snap.value_today) || !Number.isFinite(snap.value_prior)) return 0
  if (snap.value_prior <= 0) return 0
  if (snap.kind === "yield") {
    return (snap.value_today - snap.value_prior) * 100 // percent → bps
  }
  const ret = (snap.value_today - snap.value_prior) / snap.value_prior
  const d = proxyDuration(snap, w)
  if (d <= 0) return 0
  return (-ret / d) * 10000
}

// Map detector severity (0..100) to an idio shock multiplier.
// 70 → -1%, 85 → -5%, 95+ → -10%. Linear in two segments.
function idioShockPct(idio: IdioInput): number {
  const sev = idio.latest_severity_100
  if (sev === null || sev === undefined || !Number.isFinite(sev)) return 0
  if (sev < 70) return 0
  // Stale-signal attenuation: half the shock if age > 5 days.
  const age = idio.age_days ?? 0
  const attenuation = age > 5 ? 0.5 : 1
  let raw: number
  if (sev >= 95) raw = -0.10
  else if (sev >= 85) raw = -0.05 + ((-0.10 + 0.05) * (sev - 85)) / 10 // -5% → -10% linear
  else raw = -0.01 + ((-0.05 + 0.01) * (sev - 70)) / 15 // -1% → -5% linear
  return raw * attenuation
}

function confidenceFor(args: {
  benchmark_coverage: number // sum of weights with actual data, 0..1
  idio_fired: boolean
  rail_fired: boolean
}): "low" | "med" | "high" {
  if (args.benchmark_coverage <= 0.5) return "low"
  if (args.idio_fired || args.rail_fired) return "low"
  if (args.benchmark_coverage < 0.85) return "med"
  return "high"
}

export function computeDailyMark(input: DailyMarkInput): DailyMarkResult {
  const snapsByCode = new Map<string, BenchmarkSnapshot>()
  for (const s of input.benchmarks) snapsByCode.set(s.series_code, s)

  // ─────────────────── Pillar B — market-comparable spread delta ────────────
  const trail: ComponentTrail[] = []
  let pillarB_bps = 0
  let covered = 0
  for (const w of input.weights) {
    const snap = snapsByCode.get(w.benchmark_code)
    if (!snap) continue
    const d_bps = snapshotDeltaBps(snap, w)
    pillarB_bps += w.weight * d_bps
    covered += w.weight
    trail.push({
      series_code: w.benchmark_code,
      weight: w.weight,
      value_today: snap.value_today,
      value_prior: snap.value_prior,
      delta_bps: d_bps,
    })
  }

  // ─────────────────── Pillar A — DCF spread delta ──────────────────────────
  // v1 collapse: same duration-adjusted price move using the HY OAS series as
  // the DCF discount-rate proxy. Phase 4 backtest will split this out into a
  // proper rf-curve + obligor-spread cash-flow PV.
  const hyOas = snapsByCode.get("BAMLH0A0HYM2")
  let pillarA_bps = 0
  if (hyOas && hyOas.kind === "yield") {
    pillarA_bps = (hyOas.value_today - hyOas.value_prior) * 100
  }

  // ─────────────────── Triangulate ──────────────────────────────────────────
  const alpha = Math.max(0, Math.min(1, input.alpha_dcf))
  const blended_bps = alpha * pillarA_bps + (1 - alpha) * pillarB_bps

  // Apply duration-adjusted price move.
  const fvMovePct = -input.duration_years * (blended_bps / 10000)
  let fv = input.prior_fv * (1 + fvMovePct)

  // ─────────────────── Idiosyncratic overlay ────────────────────────────────
  const idio_shock_pct = idioShockPct(input.idio)
  if (idio_shock_pct !== 0) {
    fv = fv * (1 + idio_shock_pct)
  }

  // ─────────────────── Governance rails ─────────────────────────────────────
  const floor = input.prior_fv * (1 - DAILY_RAIL_PCT)
  const ceiling = input.prior_fv * (1 + DAILY_RAIL_PCT)
  const rails_fired = {
    daily_clamp_floor: fv < floor,
    daily_clamp_ceiling: fv > ceiling,
    drift_vs_anchor: false,
  }
  if (fv < floor) fv = floor
  if (fv > ceiling) fv = ceiling

  const anchor_drift_pct = input.fv_anchor > 0 ? (fv - input.fv_anchor) / input.fv_anchor : 0
  if (Math.abs(anchor_drift_pct) > DRIFT_REVIEW_THRESHOLD) {
    rails_fired.drift_vs_anchor = true
  }

  const requires_review =
    rails_fired.daily_clamp_floor ||
    rails_fired.daily_clamp_ceiling ||
    rails_fired.drift_vs_anchor ||
    idio_shock_pct !== 0

  const total_delta_bps = input.prior_fv > 0
    ? ((fv - input.prior_fv) / input.prior_fv) * 10000
    : 0

  const confidence = confidenceFor({
    benchmark_coverage: covered,
    idio_fired: idio_shock_pct !== 0,
    rail_fired: rails_fired.daily_clamp_floor || rails_fired.daily_clamp_ceiling,
  })

  return {
    fair_value_estimated: fv,
    prior_fv: input.prior_fv,
    delta_bps: total_delta_bps,
    confidence,
    requires_review,
    components: {
      methodology_version: METHODOLOGY_VERSION,
      pillar_a_spread_delta_bps: pillarA_bps,
      pillar_b_spread_delta_bps: pillarB_bps,
      blended_spread_delta_bps: blended_bps,
      alpha_dcf: alpha,
      duration_years: input.duration_years,
      benchmark_trail: trail,
      idio_shock_pct,
      rails_fired,
      fv_anchor: input.fv_anchor,
      anchor_drift_pct,
    },
  }
}
