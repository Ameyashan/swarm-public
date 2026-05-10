import "server-only"
import { createClient } from "@/lib/supabase/server"

export type SparklineSeries = { x: string; y: number }[]
export type SparklineMap = Record<string, SparklineSeries>

type DetectorHitLike = {
  id: string
  detector_name: string
  fund_ticker: string | null
  portfolio_company_canonical: string | null
}

/**
 * Build per-hit sparkline data for a list of detector hits.
 *
 * - For mark_drift_down / cross_fund_divergence: returns the borrower's total
 *   fair value (across all funds) over the last 8 periods.
 * - For pik_creep: returns the fund's FV-weighted PIK share over the last 8
 *   periods.
 *
 * The returned `byHitId` map keys by detector_hit.id so callers can look up
 * series without re-deriving keys themselves. Periods are formatted as
 * "YYYY-MM-DD".
 */
export async function fetchSparklineDataForHits(
  hits: DetectorHitLike[],
  quarters = 8,
): Promise<{ byHitId: Record<string, SparklineSeries> }> {
  const supabase = createClient()

  const borrowers = Array.from(
    new Set(
      hits
        .filter(
          (h) =>
            h.portfolio_company_canonical &&
            h.detector_name !== "pik_creep",
        )
        .map((h) => h.portfolio_company_canonical as string),
    ),
  )
  const pikTickers = Array.from(
    new Set(
      hits
        .filter((h) => h.detector_name === "pik_creep" && h.fund_ticker)
        .map((h) => h.fund_ticker as string),
    ),
  )

  const [borrowerRes, pikRes] = await Promise.all([
    borrowers.length > 0
      ? supabase.rpc("borrower_fv_series", {
          borrowers,
          quarters,
        })
      : Promise.resolve({ data: [] as any[] }),
    pikTickers.length > 0
      ? supabase.rpc("fund_pik_share_series", {
          tickers: pikTickers,
          quarters,
        })
      : Promise.resolve({ data: [] as any[] }),
  ])

  // Group by borrower / fund so we can map per-hit later.
  const byBorrower = new Map<string, SparklineSeries>()
  for (const r of (borrowerRes.data ?? []) as Array<{
    portfolio_company_canonical: string
    period_end: string
    fv_thousands: number | string
  }>) {
    const arr = byBorrower.get(r.portfolio_company_canonical) ?? []
    arr.push({ x: r.period_end, y: Number(r.fv_thousands) })
    byBorrower.set(r.portfolio_company_canonical, arr)
  }

  const byFundPik = new Map<string, SparklineSeries>()
  for (const r of (pikRes.data ?? []) as Array<{
    fund_ticker: string
    period_end: string
    pik_share: number | string
  }>) {
    const arr = byFundPik.get(r.fund_ticker) ?? []
    arr.push({ x: r.period_end, y: Number(r.pik_share) })
    byFundPik.set(r.fund_ticker, arr)
  }

  const byHitId: Record<string, SparklineSeries> = {}
  for (const h of hits) {
    if (h.detector_name === "pik_creep") {
      if (h.fund_ticker) {
        byHitId[h.id] = byFundPik.get(h.fund_ticker) ?? []
      } else {
        byHitId[h.id] = []
      }
    } else if (h.portfolio_company_canonical) {
      byHitId[h.id] = byBorrower.get(h.portfolio_company_canonical) ?? []
    } else {
      byHitId[h.id] = []
    }
  }

  return { byHitId }
}
