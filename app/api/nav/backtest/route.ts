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
  const target_version = req.nextUrl.searchParams.get("target_version") ?? "v1.1.0"

  try {
    const backtest = await runBacktest({
      fund,
      start_period,
      end_period,
      persist: true,
      notes: "phase 4 baseline backtest",
    })
    if (!tune) {
      return NextResponse.json({ backtest })
    }
    const tuner = await runTuner({
      fund,
      target_version,
      notes: `Tuner output from backtest run ${backtest.run_id}`,
      fast,
    })
    return NextResponse.json({ backtest, tuner })
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
