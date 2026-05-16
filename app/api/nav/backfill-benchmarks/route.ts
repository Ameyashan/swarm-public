import { NextResponse, type NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllHistorical } from "@/lib/nav/historical-fetchers"

// Phase 4 — bulk historical backfill of benchmark_prices.
// Pulls every series we use for FRED + Yahoo over the requested window and
// upserts into benchmark_prices. Run this once before /api/nav/backtest.
//
// Query params:
//   start=YYYY-MM-DD   default = 2 years ago
//   end=YYYY-MM-DD     default = today

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = req.headers.get("authorization")
  if (header === `Bearer ${secret}`) return true
  const qp = req.nextUrl.searchParams.get("secret")
  if (qp && qp === secret) return true
  return false
}

function defaultStart(): string {
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear() - 2)
  return d.toISOString().slice(0, 10)
}
function defaultEnd(): string {
  return new Date().toISOString().slice(0, 10)
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const start = req.nextUrl.searchParams.get("start") ?? defaultStart()
  const end = req.nextUrl.searchParams.get("end") ?? defaultEnd()

  try {
    const { ok, errors } = await fetchAllHistorical(start, end)
    if (ok.length === 0) {
      return NextResponse.json(
        { inserted: 0, fetched: 0, errors, start, end },
        { status: 207 },
      )
    }
    const supabase = createAdminClient()
    const rows = ok.map((p) => ({
      series_code: p.series_code,
      as_of_date: p.as_of_date,
      value: p.value,
      source: p.source,
    }))
    let inserted = 0
    const batchSize = 1000
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize)
      const { error, count } = await supabase
        .from("benchmark_prices")
        .upsert(batch, { onConflict: "series_code,as_of_date", count: "exact" })
      if (error) {
        errors.push({ code: `batch ${i}`, error: error.message })
        break
      }
      inserted += count ?? batch.length
    }
    return NextResponse.json({
      fetched: ok.length,
      inserted,
      errors,
      start,
      end,
    })
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
