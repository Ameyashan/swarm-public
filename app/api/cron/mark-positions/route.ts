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
  const fund = req.nextUrl.searchParams.get("fund") ?? "GSCR"
  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1"
  try {
    const summary = await runDailyMarks({ fund, dryRun })
    const ok =
      summary.errors.length === 0 &&
      (summary.marks_written > 0 || summary.positions_seen === 0 || dryRun)
    return NextResponse.json(summary, { status: ok ? 200 : 207 })
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
