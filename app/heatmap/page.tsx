import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import {
  HeatmapMatrix,
  HeatmapLegend,
  type HeatmapCell,
  type HeatmapCellHit,
  type HeatmapRow,
} from "@/components/heatmap/heatmap-matrix"
import {
  DETECTOR_LABELS,
  formatSeverity,
  type DetectorHit,
} from "@/app/alerts/alerts-helpers"

export const dynamic = "force-dynamic"

const QUARTERS = 12

/** Format a Date as "Q2 '25". */
function quarterLabel(d: Date): string {
  const month = d.getUTCMonth() // 0..11
  const q = Math.floor(month / 3) + 1
  const yy = String(d.getUTCFullYear()).slice(-2)
  return `Q${q} '${yy}`
}

/** Add `n` months to a UTC date and return ISO YYYY-MM-DD. */
function addMonthsIso(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z")
  const out = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1),
  )
  return out.toISOString().slice(0, 10)
}

/** Build the last `n` quarter starts (oldest → newest) anchored to the latest quarter present. */
function buildQuarterStarts(latestIso: string, n: number): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    out.push(addMonthsIso(latestIso, -3 * i))
  }
  return out
}

type HeatmapRpcRow = {
  fund_ticker: string
  quarter_start: string
  hit_count: number | string
  severity_weighted: number | string
  top_hit_ids: string[] | null
}

type FundFvRow = {
  fund_ticker: string
  latest_period_end: string
  total_fv_thousands: number | string
}

export default async function HeatmapPage() {
  const supabase = createClient()

  const [heatmapRes, fvRes] = await Promise.all([
    supabase.rpc("fund_quarter_hit_heatmap", { quarters: QUARTERS }),
    supabase.rpc("fund_latest_fv"),
  ])

  if (heatmapRes.error) {
    return (
      <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-12">
        <h1 className="text-3xl font-bold text-default">Heatmap</h1>
        <p className="mt-4 text-sm text-severity-critical">
          Failed to load heatmap: {heatmapRes.error.message}
        </p>
      </main>
    )
  }

  const heatmapRows = (heatmapRes.data ?? []) as HeatmapRpcRow[]
  const fvRows = (fvRes.data ?? []) as FundFvRow[]

  // Determine the latest quarter present in the data, fallback to today.
  let latestQuarter: string | null = null
  for (const r of heatmapRows) {
    if (!latestQuarter || r.quarter_start > latestQuarter) {
      latestQuarter = r.quarter_start
    }
  }
  if (!latestQuarter) {
    const now = new Date()
    const month = now.getUTCMonth()
    const qStartMonth = Math.floor(month / 3) * 3
    latestQuarter = new Date(
      Date.UTC(now.getUTCFullYear(), qStartMonth, 1),
    )
      .toISOString()
      .slice(0, 10)
  }

  const quarterStarts = buildQuarterStarts(latestQuarter, QUARTERS)
  const quarterLabels = quarterStarts.map((q) =>
    quarterLabel(new Date(q + "T00:00:00Z")),
  )

  // Group heatmap rows by (fund, quarter_start) — only quarters within range
  const cellByKey = new Map<string, HeatmapRpcRow>()
  const fundsInData = new Set<string>()
  const validQuarters = new Set(quarterStarts)
  for (const r of heatmapRows) {
    if (!validQuarters.has(r.quarter_start)) continue
    fundsInData.add(r.fund_ticker)
    cellByKey.set(`${r.fund_ticker}|${r.quarter_start}`, r)
  }

  // Total FV per fund for sort ordering and label display.
  const fvByFund = new Map<string, number>()
  for (const r of fvRows) {
    fvByFund.set(r.fund_ticker, Number(r.total_fv_thousands))
  }

  // Universe of funds = funds with any hit OR any FV (so empty rows still appear if relevant).
  const allFunds = new Set<string>()
  fundsInData.forEach((f) => allFunds.add(f))
  fvByFund.forEach((_v, k) => allFunds.add(k))
  // Only show funds with FV > 0 OR with any heatmap hits — drop ghost tickers like HTGC/FSK/PSEC at $0 with 0 hits.
  const fundsList = Array.from(allFunds).filter((f) => {
    const fv = fvByFund.get(f) ?? 0
    return fv > 0 || fundsInData.has(f)
  })

  // Sort funds by total FV desc; tiebreak alphabetically.
  fundsList.sort((a, b) => {
    const fa = fvByFund.get(a) ?? 0
    const fb = fvByFund.get(b) ?? 0
    if (fb !== fa) return fb - fa
    return a.localeCompare(b)
  })

  // Collect all top_hit_ids for one batched detector_hits fetch.
  const allHitIds = new Set<string>()
  for (const r of heatmapRows) {
    for (const id of r.top_hit_ids ?? []) {
      if (id) allHitIds.add(id)
    }
  }

  let hitDetailsById = new Map<string, DetectorHit>()
  if (allHitIds.size > 0) {
    const { data: hitData } = await supabase
      .from("detector_hits")
      .select(
        "id, detector_name, fund_ticker, portfolio_company_canonical, current_period_end, prior_period_end, severity_score, hit_data, cited_source_urls, created_at",
      )
      .in("id", Array.from(allHitIds))
      .returns<DetectorHit[]>()
    for (const h of hitData ?? []) {
      hitDetailsById.set(h.id, h)
    }
  }

  // Build rows.
  let maxSeverity = 0
  const rows: HeatmapRow[] = fundsList.map((fund) => {
    const cells: HeatmapCell[] = quarterStarts.map((qStart, idx) => {
      const r = cellByKey.get(`${fund}|${qStart}`)
      const hitCount = r ? Number(r.hit_count) : 0
      const severityWeighted = r ? Number(r.severity_weighted) : 0
      if (severityWeighted > maxSeverity) maxSeverity = severityWeighted

      const topHits: HeatmapCellHit[] = (r?.top_hit_ids ?? [])
        .map((id) => hitDetailsById.get(id))
        .filter((h): h is DetectorHit => Boolean(h))
        .slice(0, 3)
        .map((h) => ({
          id: h.id,
          detector: h.detector_name,
          detectorLabel:
            DETECTOR_LABELS[h.detector_name] ?? h.detector_name,
          borrower:
            h.portfolio_company_canonical ?? h.fund_ticker ?? "Unknown",
          severityLabel: formatSeverity(h.detector_name, h.severity_score),
          severityScore: Math.abs(h.severity_score ?? 0),
        }))

      return {
        fund,
        quarterStart: qStart,
        quarterLabel: quarterLabels[idx],
        hitCount,
        severityWeighted,
        topHits,
      }
    })
    const totalFvThousands = fvByFund.get(fund) ?? 0
    return {
      fund,
      totalFvB: totalFvThousands / 1_000_000, // thousands → billions
      cells,
    }
  })

  // Aggregate stats for the header strip.
  const totalHits = rows.reduce(
    (sum, row) =>
      sum + row.cells.reduce((s, c) => s + c.hitCount, 0),
    0,
  )
  const fundsWithHits = rows.filter((row) =>
    row.cells.some((c) => c.hitCount > 0),
  ).length
  const newestQuarter = quarterLabels[quarterLabels.length - 1]
  const oldestQuarter = quarterLabels[0]

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-12 sm:py-16">
      <header className="mb-8">
        <div className="mb-2 text-sm">
          <Link
            href="/"
            className="text-muted underline-offset-4 hover:text-default hover:underline"
          >
            ← Home
          </Link>
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-default sm:text-5xl">
          Heatmap
        </h1>
        <p className="mt-2 max-w-3xl text-muted">
          Severity-weighted detector hits per fund per quarter. Cells are tinted
          by Σ |severity| of all hits in that fund-quarter; the number is the
          raw hit count. Hover for the top three contributors. Click any cell to
          drill into the matching alerts.
        </p>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Funds tracked" value={String(rows.length)} />
        <Stat
          label="Funds with hits"
          value={`${fundsWithHits} / ${rows.length}`}
        />
        <Stat label="Total hits" value={totalHits.toLocaleString("en-US")} />
        <Stat
          label="Window"
          value={`${oldestQuarter} → ${newestQuarter}`}
          mono
        />
      </div>

      <HeatmapMatrix
        rows={rows}
        quarterLabels={quarterLabels}
        maxSeverity={maxSeverity}
      />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <HeatmapLegend maxSeverity={maxSeverity} />
        <p className="text-[11px] font-mono uppercase tracking-wider text-dim">
          Click any cell → /alerts filtered to that fund and quarter
        </p>
      </div>
    </main>
  )
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="rounded-lg border border-default bg-card p-4">
      <div className="text-[11px] font-mono uppercase tracking-wider text-dim">
        {label}
      </div>
      <div
        className={
          "mt-1 text-2xl font-semibold text-default " +
          (mono ? "font-mono text-base" : "")
        }
      >
        {value}
      </div>
    </div>
  )
}
