import { NextResponse, type NextRequest } from "next/server"
import { runBacktest } from "@/lib/nav/backtest"
import { runTuner } from "@/lib/nav/tuner"

// Phase 4 — kick off a backtest run, optionally followed by the per-industry
// tuner. Gated by CRON_SECRET like the daily cron.
//
// Query params:
//   fund=GSCR | GSBD     (default GSCR)
//   start_period=YYYY-MM-DD
//   end_period=YYYY-MM-DD
//   tune=1               also run the tuner after the baseline backtest
//   target_version=v1.1.0
//   fast=1               tuner fast mode (analytical re-score only)

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = req.headers.get("authorization")
  if (header === `Bearer ${secret}`) return true
  const qp = req.nextUrl.searchParams.get("secret")
  if (qp && qp === secret) return true
  return false
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const fund = req.nextUrl.searchParams.get("fund") ?? "GSCR"
  const start_period = req.nextUrl.searchParams.get("start_period") ?? undefined
  const end_period = req.nextUrl.searchParams.get("end_period") ?? undefined
  const tune = req.nextUrl.searchParams.get("tune") === "1"
  const fast = req.nextUrl.searchParams.get("fast") === "1"
  const summaryOnly = req.nextUrl.searchParams.get("summary_only") !== "0"
  const target_version = req.nextUrl.searchParams.get("target_version") ?? "v1.1.0"

  try {
    const backtest = await runBacktest({
      fund,
      start_period,
      end_period,
      persist: true,
      notes: "phase 4 baseline backtest",
    })
    // Compute the median of |drift| after dropping prepayment/restructure
    // events (|drift_pct| > 50%). This is the headline accuracy number —
    // the unfiltered mean is dominated by paydown events the model can't see.
    const cleanResults = backtest.results.filter(
      (r) => Math.abs(r.drift_pct) <= 0.5,
    )
    const absDrifts = cleanResults.map((r) => Math.abs(r.drift_bps)).sort((a, b) => a - b)
    const filteredMedian =
      absDrifts.length === 0
        ? null
        : absDrifts.length % 2 === 0
          ? (absDrifts[absDrifts.length / 2 - 1] + absDrifts[absDrifts.length / 2]) / 2
          : absDrifts[Math.floor(absDrifts.length / 2)]
    const backtestSummary = {
      run_id: backtest.run_id,
      methodology_version: backtest.methodology_version,
      fund_ticker: backtest.fund_ticker,
      start_period: backtest.start_period,
      end_period: backtest.end_period,
      positions_evaluated: backtest.positions_evaluated,
      quarter_pairs_evaluated: backtest.quarter_pairs_evaluated,
      mean_abs_drift_bps: backtest.mean_abs_drift_bps,
      median_abs_drift_bps: backtest.median_abs_drift_bps,
      p95_abs_drift_bps: backtest.p95_abs_drift_bps,
      // Prepayment-filtered cuts — these are the numbers to judge the model on.
      filtered_quarter_pairs: cleanResults.length,
      prepayments_filtered: backtest.results.length - cleanResults.length,
      filtered_median_abs_drift_bps: filteredMedian,
      errors: backtest.errors,
    }
    const backtestBody = summaryOnly ? backtestSummary : backtest
    if (!tune) {
      return NextResponse.json({ backtest: backtestBody })
    }
    const tuner = await runTuner({
      fund,
      target_version,
      notes: `Tuner output from backtest run ${backtest.run_id}`,
      fast,
    })
    return NextResponse.json({ backtest: backtestBody, tuner })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
