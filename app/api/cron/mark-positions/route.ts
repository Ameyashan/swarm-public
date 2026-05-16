import { NextResponse, type NextRequest } from "next/server"
import { runDailyMarks } from "@/lib/nav/runner"

// Daily NAV cron — runs weekdays at 15:00 UTC via vercel.json.
// Auth: Bearer ${CRON_SECRET} header OR ?secret= query param (for manual smoke
// tests from a browser). Returns the RunSummary as JSON.
//
// Never expose CRON_SECRET to the browser. Vercel Cron sends the header
// automatically when CRON_SECRET is set as an environment variable.

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

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
  // `fund=GSCR,GSBD` (default: both Goldman BDCs) — explicit comma-separated list.
  // `fund=ALL` is sugar for the same. Single fund still supported.
  const fundParam = req.nextUrl.searchParams.get("fund")
  const funds = fundParam
    ? (fundParam.toUpperCase() === "ALL"
        ? ["GSCR", "GSBD"]
        : fundParam.split(",").map((s) => s.trim()).filter(Boolean))
    : ["GSCR", "GSBD"]
  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1"
  const methodology_version = req.nextUrl.searchParams.get("version") ?? undefined
  try {
    const results = []
    for (const fund of funds) {
      const summary = await runDailyMarks({ fund, dryRun, methodology_version })
      results.push(summary)
    }
    const allErrors = results.flatMap((r) => r.errors)
    const totalWritten = results.reduce((a, r) => a + r.marks_written, 0)
    const totalSeen = results.reduce((a, r) => a + r.positions_seen, 0)
    const ok =
      allErrors.length === 0 &&
      (totalWritten > 0 || totalSeen === 0 || dryRun)
    // Return single summary when only one fund requested, array otherwise.
    const body = results.length === 1 ? results[0] : { runs: results }
    return NextResponse.json(body, { status: ok ? 200 : 207 })
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
