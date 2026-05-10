import "server-only"
import { cache } from "react"
import { createClient } from "@/lib/supabase/server"
import {
  GOLDMAN_FUNDS,
  type DetectorHitRow,
  type FundPeerStats,
  getPeerTelemetry,
} from "@/lib/briefing/queries"

export type PeerCohortFund = {
  fund_ticker: string
  pik_pct: number | null
  na_pct: number | null
  na_count: number
  total_fv_dollars: number
  position_count: number
  hit_count_recent: number
  mark_variance_pp: number | null // signed: positive = marks above median
  period_end: string | null
}

// Funds we always want included if available. The peer cohort is built from
// observations, and we select the BDC universe that includes both Goldman
// funds + the four named peers from the spec when present.
const PREFERRED_PEER_UNIVERSE = [
  "GSCR",
  "GSBD",
  "ARCC",
  "GBDC",
  "MAIN",
  "OBDC",
] as const

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function recentCutoffMs(months: number, now = Date.now()): number {
  return now - months * 30 * 24 * 60 * 60 * 1000
}

// ─────────────────────────────────────────────────────────────────────────────
// Main query: peer cohort with all four panel metrics.
// ─────────────────────────────────────────────────────────────────────────────

export const getPeerCohort = cache(async (): Promise<PeerCohortFund[]> => {
  const supabase = createClient()

  // 1) Use the existing briefing telemetry as the FV / PIK / NA base.
  const baseStats: FundPeerStats[] = await getPeerTelemetry()

  // 2) Pull a generous slice of recent detector hits to compute:
  //     - hit_count_recent (last ~6 months) per fund
  //     - mark variance (stddev of fv_change_pct on mark_drift_down)
  const sinceMs = recentCutoffMs(6)
  const { data: hits, error: hitsErr } = await supabase
    .from("detector_hits")
    .select(
      "fund_ticker, detector_name, current_period_end, severity_score, hit_data",
    )
    .order("current_period_end", { ascending: false, nullsFirst: false })
    .limit(20000)
  if (hitsErr) {
    console.error("getPeerCohort hits err", hitsErr)
  }
  type HitLite = {
    fund_ticker: string | null
    detector_name: string
    current_period_end: string | null
    severity_score: number | null
    hit_data: Record<string, any> | null
  }
  const recentHits = ((hits ?? []) as HitLite[]).filter((h) => {
    if (!h.current_period_end) return false
    const ms = new Date(h.current_period_end).getTime()
    return Number.isFinite(ms) && ms >= sinceMs
  })

  const hitCountByFund = new Map<string, number>()
  const driftChangesByFund = new Map<string, number[]>()
  for (const h of recentHits) {
    const t = h.fund_ticker ?? ""
    if (!t) continue
    hitCountByFund.set(t, (hitCountByFund.get(t) ?? 0) + 1)
    if (h.detector_name === "mark_drift_down") {
      const ch = Number(h.hit_data?.fv_change_pct)
      if (Number.isFinite(ch)) {
        if (!driftChangesByFund.has(t)) driftChangesByFund.set(t, [])
        driftChangesByFund.get(t)!.push(ch)
      }
    }
  }

  // 3) Position counts per fund at latest period (sample using the same
  //    latest-period heuristic the briefing uses — fetch one extra read).
  type ObsCountRow = { fund_ticker: string; period_end: string }
  const positionCountByFund = new Map<string, number>()
  {
    // We need position counts per fund at its latest period. Use a small per-fund
    // query — bounded by cohort size (≤ ~10 funds).
    const candidateTickers = Array.from(
      new Set([
        ...PREFERRED_PEER_UNIVERSE,
        ...baseStats.map((b) => b.fund_ticker),
      ]),
    )
    for (const t of candidateTickers) {
      const base = baseStats.find((s) => s.fund_ticker === t)
      if (!base?.period_end) continue
      const { count, error } = await supabase
        .from("observations")
        .select("id", { count: "exact", head: true })
        .eq("fund_ticker", t)
        .eq("period_end", base.period_end)
      if (!error && typeof count === "number") {
        positionCountByFund.set(t, count)
      }
    }
  }

  // 4) Mark variance — stddev of mark_drift_down fv_change_pct per fund.
  //    Compute the *signed* mean drift in percentage points: a positive mean
  //    means GSCR marks fell less than the cohort (held value higher).
  function stddev(xs: number[]): number {
    if (xs.length === 0) return 0
    const m = xs.reduce((a, b) => a + b, 0) / xs.length
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length)
  }
  // Cohort-wide median of mean drift for centering.
  const meanDriftByFund = new Map<string, number>()
  Array.from(driftChangesByFund.entries()).forEach(([t, vals]) => {
    const m = vals.reduce((a: number, b: number) => a + b, 0) / vals.length
    meanDriftByFund.set(t, m)
  })
  const meansArr = Array.from(meanDriftByFund.values()).sort((a, b) => a - b)
  let medianDrift = 0
  if (meansArr.length > 0) {
    const mid = Math.floor(meansArr.length / 2)
    medianDrift =
      meansArr.length % 2 === 0
        ? (meansArr[mid - 1] + meansArr[mid]) / 2
        : meansArr[mid]
  }
  // Variance expressed in percentage points relative to cohort median: positive
  // = this fund's marks dropped *less* than median (i.e., higher marks).
  const variancePpByFund = new Map<string, number>()
  Array.from(meanDriftByFund.entries()).forEach(([t, mean]) => {
    variancePpByFund.set(t, mean - medianDrift)
  })

  // 5) Assemble cohort. Restrict to the preferred 6-BDC universe when those
  //    funds exist in our data; otherwise widen to whatever we have.
  const baseByFund = new Map(baseStats.map((b) => [b.fund_ticker, b]))
  const allTickers = new Set([
    ...PREFERRED_PEER_UNIVERSE,
    ...baseStats.map((b) => b.fund_ticker),
  ])

  const cohort: PeerCohortFund[] = []
  for (const t of Array.from(allTickers)) {
    const base = baseByFund.get(t)
    if (!base) continue // skip tickers with no observation footprint
    cohort.push({
      fund_ticker: t,
      pik_pct: base.pik_pct,
      na_pct: base.na_pct,
      na_count: base.na_count ?? 0,
      total_fv_dollars: base.total_fv_dollars ?? 0,
      position_count: positionCountByFund.get(t) ?? 0,
      hit_count_recent: hitCountByFund.get(t) ?? 0,
      mark_variance_pp: variancePpByFund.has(t) ? variancePpByFund.get(t)! : null,
      period_end: base.period_end,
    })
  }

  // Pin GSCR + GSBD at top of the universe; otherwise keep cohort ordered by FV.
  const preferred = new Set(PREFERRED_PEER_UNIVERSE)
  const inUniverse = cohort.filter((f) => preferred.has(f.fund_ticker as any))
  const outsideUniverse = cohort
    .filter((f) => !preferred.has(f.fund_ticker as any))
    .sort((a, b) => b.total_fv_dollars - a.total_fv_dollars)

  // Prefer the inUniverse cohort. If we have <6, top up from outsideUniverse.
  const finalCohort: PeerCohortFund[] = []
  for (const f of inUniverse) finalCohort.push(f)
  while (finalCohort.length < 6 && outsideUniverse.length > 0) {
    finalCohort.push(outsideUniverse.shift()!)
  }

  return finalCohort
})

export { GOLDMAN_FUNDS }
