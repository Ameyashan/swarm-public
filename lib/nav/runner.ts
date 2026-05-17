import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAll, type FetchedPair } from "@/lib/nav/fetchers"
import {
  computeDailyMark,
  METHODOLOGY_VERSION,
  type BenchmarkSnapshot,
  type BenchmarkWeight,
  type DailyMarkResult,
  type IdioInput,
} from "@/lib/nav/methodology"
import { runReconciliation } from "@/lib/nav/reconcile"

// Yield-vs-price classification per benchmark code. FRED OAS / Treasury series
// are yields (percent); ETF closes are prices.
function classifyKind(code: string): "yield" | "price" {
  if (code.startsWith("BAML") || code.startsWith("DGS")) return "yield"
  return "price"
}

type MapRow = {
  fund_ticker: string
  portfolio_company_canonical: string
  benchmark_code: string
  weight: number
  duration_years: number
  alpha_dcf: number
}

type PositionAnchor = {
  fund_ticker: string
  portfolio_company_canonical: string
  fair_value: number | null
  cost: number | null
  period_end: string | null
  industry_canonical: string | null
  industry: string | null
}

type IndustryWeightRow = {
  industry: string
  w_hy: number
  w_ll: number
  w_sec: number
  duration_years: number
  alpha_dcf: number
}

type IdioHit = {
  portfolio_company_canonical: string
  severity_score: number | null
  created_at: string | null
}

export type RunSummary = {
  methodology_version: string
  mark_date: string
  benchmark_count: number
  benchmark_errors: Array<{ code: string; error: string }>
  positions_seen: number
  marks_written: number
  marks_skipped: number
  reconciliation_inserted: number
  errors: string[]
}

function nyTradingDate(now: Date = new Date()): string {
  // Convert UTC instant to America/New_York calendar date. Works without
  // pulling in a tz library by using Intl.DateTimeFormat.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  return fmt.format(now) // YYYY-MM-DD
}

function asNumber(v: any): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function daysBetween(iso: string | null, ref: string): number | null {
  if (!iso) return null
  const a = new Date(iso).getTime()
  const b = new Date(ref).getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.max(0, Math.round((b - a) / 86_400_000))
}

export async function runDailyMarks(opts: {
  fund?: string
  dryRun?: boolean
  methodology_version?: string
} = {}): Promise<RunSummary> {
  const fund = opts.fund ?? "GSCR"
  const dryRun = opts.dryRun ?? false
  const methodology_version = opts.methodology_version ?? METHODOLOGY_VERSION
  const supabase = createAdminClient()
  const mark_date = nyTradingDate()

  const summary: RunSummary = {
    methodology_version,
    mark_date,
    benchmark_count: 0,
    benchmark_errors: [],
    positions_seen: 0,
    marks_written: 0,
    marks_skipped: 0,
    reconciliation_inserted: 0,
    errors: [],
  }

  // ───────────── Load position_benchmark_map ───────────────────────────────
  const { data: mapRows, error: mapErr } = await supabase
    .from("position_benchmark_map")
    .select("fund_ticker, portfolio_company_canonical, benchmark_code, weight, duration_years, alpha_dcf")
    .eq("fund_ticker", fund)
    .limit(20_000)
  if (mapErr) {
    summary.errors.push(`load map: ${mapErr.message}`)
    return summary
  }
  const map = (mapRows ?? []) as MapRow[]
  if (map.length === 0) {
    summary.errors.push(`position_benchmark_map empty for fund ${fund} — run the seed SQL`)
    return summary
  }

  // ───────────── Fetch benchmarks (unique codes only) ──────────────────────
  const uniqueCodes = Array.from(new Set(map.map((r) => r.benchmark_code)))
  const fetched = await fetchAll(uniqueCodes)
  summary.benchmark_count = fetched.ok.length
  summary.benchmark_errors = fetched.errors

  // Persist benchmark_prices (best effort — failures don't block marks).
  if (fetched.ok.length > 0 && !dryRun) {
    const rows = fetched.ok.flatMap((p) => [
      { series_code: p.series_code, as_of_date: p.date_today, value: p.value_today, source: p.source },
      { series_code: p.series_code, as_of_date: p.date_prior, value: p.value_prior, source: p.source },
    ])
    const { error: bpErr } = await supabase
      .from("benchmark_prices")
      .upsert(rows, { onConflict: "series_code,as_of_date" })
    if (bpErr) summary.errors.push(`benchmark_prices upsert: ${bpErr.message}`)
  }

  const snapsByCode = new Map<string, FetchedPair>()
  for (const p of fetched.ok) snapsByCode.set(p.series_code, p)

  // ───────────── Load per-industry overrides for this methodology_version ──
  const industryOverrides = new Map<string, IndustryWeightRow>()
  {
    const { data: ovRows } = await supabase
      .from("methodology_industry_weights")
      .select("industry, w_hy, w_ll, w_sec, duration_years, alpha_dcf")
      .eq("methodology_version", methodology_version)
    for (const r of (ovRows ?? []) as IndustryWeightRow[]) {
      industryOverrides.set(r.industry.toLowerCase().trim(), r)
    }
  }

  // ───────────── Load anchor FV (latest observation) per position ──────────
  const positionKeys = Array.from(
    new Set(map.map((r) => `${r.fund_ticker}::${r.portfolio_company_canonical}`)),
  )
  const borrowers = Array.from(
    new Set(map.map((r) => r.portfolio_company_canonical)),
  )

  // Latest reported FV per (fund, borrower). We pull all rows in the most recent
  // 4 quarters and pick the max period_end per key client-side.
  const { data: obsRows, error: obsErr } = await supabase
    .from("observations")
    .select(
      "fund_ticker, portfolio_company_canonical, period_end, fair_value, cost, industry_canonical, industry",
    )
    .eq("fund_ticker", fund)
    .in("portfolio_company_canonical", borrowers)
    .order("period_end", { ascending: false })
    .limit(20_000)
  if (obsErr) {
    summary.errors.push(`load observations: ${obsErr.message}`)
    return summary
  }
  const anchorByKey = new Map<string, PositionAnchor>()
  for (const r of (obsRows ?? []) as PositionAnchor[]) {
    const key = `${r.fund_ticker}::${r.portfolio_company_canonical}`
    if (!anchorByKey.has(key)) anchorByKey.set(key, r)
  }

  // ───────────── Load prior daily_mark per position (yesterday-or-anchor) ──
  const { data: priorRows, error: priorErr } = await supabase
    .from("daily_marks")
    .select("fund_ticker, portfolio_company_canonical, mark_date, fair_value_estimated")
    .eq("fund_ticker", fund)
    .in("portfolio_company_canonical", borrowers)
    .lt("mark_date", mark_date)
    .order("mark_date", { ascending: false })
    .limit(2000)
  if (priorErr) {
    summary.errors.push(`load prior daily_marks: ${priorErr.message}`)
  }
  const priorByKey = new Map<string, { mark_date: string; fair_value_estimated: number }>()
  for (const r of (priorRows ?? []) as Array<{
    fund_ticker: string
    portfolio_company_canonical: string
    mark_date: string
    fair_value_estimated: number
  }>) {
    const key = `${r.fund_ticker}::${r.portfolio_company_canonical}`
    if (!priorByKey.has(key)) priorByKey.set(key, r)
  }

  // ───────────── Load recent high-severity detector_hits per borrower ──────
  const { data: hitRows, error: hitErr } = await supabase
    .from("detector_hits")
    .select("portfolio_company_canonical, severity_score, created_at")
    .eq("fund_ticker", fund)
    .in("portfolio_company_canonical", borrowers)
    .order("created_at", { ascending: false })
    .limit(2000)
  if (hitErr) summary.errors.push(`load detector_hits: ${hitErr.message}`)
  const idioByBorrower = new Map<string, IdioInput>()
  const FIVE_DAYS_AGO = new Date(Date.now() - 5 * 86_400_000).toISOString()
  for (const h of (hitRows ?? []) as IdioHit[]) {
    if (!h.created_at || h.created_at < FIVE_DAYS_AGO) continue
    const sev = asNumber(h.severity_score)
    if (sev === null) continue
    const sev100 = sev <= 1 ? Math.round(sev * 100) : Math.round(sev)
    if (sev100 < 70) continue
    const cur = idioByBorrower.get(h.portfolio_company_canonical)
    if (cur && (cur.latest_severity_100 ?? 0) >= sev100) continue
    idioByBorrower.set(h.portfolio_company_canonical, {
      latest_severity_100: sev100,
      age_days: daysBetween(h.created_at, mark_date),
    })
  }

  // ───────────── Group map rows by position, compute, write ────────────────
  const mapByKey = new Map<string, MapRow[]>()
  for (const r of map) {
    const key = `${r.fund_ticker}::${r.portfolio_company_canonical}`
    if (!mapByKey.has(key)) mapByKey.set(key, [])
    mapByKey.get(key)!.push(r)
  }
  summary.positions_seen = mapByKey.size

  const writes: Array<Record<string, any>> = []
  for (const [key, rows] of mapByKey) {
    const [fundTicker, borrower] = key.split("::")
    const anchor = anchorByKey.get(key)
    if (!anchor || asNumber(anchor.fair_value) === null) {
      summary.marks_skipped++
      continue
    }
    const anchorFv = anchor.fair_value as number
    const priorEntry = priorByKey.get(key)
    const priorFv = priorEntry ? Number(priorEntry.fair_value_estimated) : anchorFv

    // Apply per-industry override when one exists for this borrower's
    // industry under the active methodology_version. Falls back to the
    // baseline position_benchmark_map row otherwise.
    const industryKey = (anchor.industry_canonical ?? anchor.industry ?? "")
      .toLowerCase()
      .trim()
    const override = industryKey ? industryOverrides.get(industryKey) : undefined
    const weights: BenchmarkWeight[] = override
      ? [
          { benchmark_code: "BAMLH0A0HYM2", weight: override.w_hy },
          { benchmark_code: "BKLN", weight: override.w_ll },
          // sector ETF: whatever the map already picked, reweighted.
          ...rows
            .filter((r) => !["BAMLH0A0HYM2", "BKLN"].includes(r.benchmark_code))
            .map((r) => ({ benchmark_code: r.benchmark_code, weight: override.w_sec })),
        ]
      : rows.map((r) => ({
          benchmark_code: r.benchmark_code,
          weight: Number(r.weight),
        }))
    const benchmarks: BenchmarkSnapshot[] = weights
      .map((w) => snapsByCode.get(w.benchmark_code))
      .filter((p): p is FetchedPair => Boolean(p))
      .map((p) => ({
        series_code: p.series_code,
        value_today: p.value_today,
        value_prior: p.value_prior,
        kind: classifyKind(p.series_code),
      }))

    const duration = override ? override.duration_years : Number(rows[0].duration_years)
    const alpha = override ? override.alpha_dcf : Number(rows[0].alpha_dcf)
    const idio = idioByBorrower.get(borrower) ?? { latest_severity_100: null }

    const result: DailyMarkResult = computeDailyMark({
      fund_ticker: fundTicker,
      portfolio_company_canonical: borrower,
      mark_date,
      prior_fv: priorFv,
      fv_anchor: anchorFv,
      weights,
      benchmarks,
      duration_years: Number.isFinite(duration) ? duration : 3.5,
      alpha_dcf: Number.isFinite(alpha) ? alpha : 0.6,
      idio,
    })

    const cost = asNumber(anchor.cost)
    const mark_pct = cost && cost > 0 ? (result.fair_value_estimated / cost) * 100 : null

    writes.push({
      fund_ticker: fundTicker,
      portfolio_company_canonical: borrower,
      mark_date,
      fair_value_estimated: result.fair_value_estimated,
      mark_pct,
      prior_fv: priorFv,
      delta_bps: result.delta_bps,
      methodology_version,
      components: {
        ...(result.components as unknown as Record<string, any>),
        industry_override_applied: Boolean(override),
        industry_key: industryKey || null,
      },
      confidence: result.confidence,
      requires_review: result.requires_review,
    })
  }

  if (writes.length === 0) {
    return summary
  }

  if (dryRun) {
    summary.marks_written = 0
    summary.marks_skipped += writes.length
    return summary
  }

  const { error: writeErr, count } = await supabase
    .from("daily_marks")
    .upsert(writes, {
      onConflict: "fund_ticker,portfolio_company_canonical,mark_date,methodology_version",
      count: "exact",
    })
  if (writeErr) {
    summary.errors.push(`daily_marks upsert: ${writeErr.message}`)
    return summary
  }
  summary.marks_written = count ?? writes.length

  // Trailing reconciliation — opportunistic. Any new observations row with a
  // model mark at-or-before its period_end gets persisted as drift in bps.
  // Failures here are non-fatal; the daily marks are already written.
  try {
    const reco = await runReconciliation({ fund, methodology_version })
    summary.reconciliation_inserted = reco.rows_inserted
    if (reco.errors.length) summary.errors.push(...reco.errors.map((e) => `reconcile: ${e}`))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    summary.errors.push(`reconcile: ${msg}`)
  }

  return summary
}
