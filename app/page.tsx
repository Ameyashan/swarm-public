import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SubscribeForm } from "@/components/subscribe-form"
import { LiveStatCard } from "@/components/home/live-stat-card"
import { LiveTape, type TapeItem } from "@/components/home/live-tape"
import {
  DetectorActivity,
  type DetectorSeries,
} from "@/components/home/detector-activity"
import { TopBorrowers, type TopBorrower } from "@/components/home/top-borrowers"
import { RecentAlertCard } from "@/components/home/recent-alert-card"
import { type DetectorHit } from "./alerts/alerts-helpers"
import { fetchSparklineDataForHits } from "@/lib/sparkline-data"

// ISR: rebuild homepage at most every 5 minutes; queries are cached across
// requests within the window, dramatically reducing Supabase load.
export const revalidate = 300

// ---------- helpers ----------

function severityFor(pct: number): "critical" | "high" | "medium" | "low" {
  const abs = Math.abs(pct)
  if (abs > 0.5) return "critical"
  if (abs >= 0.3) return "high"
  if (abs >= 0.1) return "medium"
  return "low"
}

/**
 * Build a fixed window of the last 8 calendar quarters ending at the current
 * UTC quarter, padded with zeros where no hits exist.
 */
function buildLast8Quarters(
  rows: { quarter_start: string; hits: number }[],
): { quarter: string; hits: number }[] {
  const now = new Date()
  const buckets: { y: number; q: number }[] = []
  let y = now.getUTCFullYear()
  let q = Math.floor(now.getUTCMonth() / 3) + 1
  for (let i = 0; i < 8; i++) {
    buckets.unshift({ y, q })
    q -= 1
    if (q === 0) {
      q = 4
      y -= 1
    }
  }

  const map = new Map<string, number>()
  for (const r of rows) {
    const d = new Date(r.quarter_start)
    const ry = d.getUTCFullYear()
    const rq = Math.floor(d.getUTCMonth() / 3) + 1
    const key = `${ry}-Q${rq}`
    map.set(key, (map.get(key) ?? 0) + Number(r.hits))
  }

  return buckets.map(({ y, q }) => ({
    quarter: `Q${q}`,
    hits: map.get(`${y}-Q${q}`) ?? 0,
  }))
}

// ---------- page ----------

export default async function Home() {
  const supabase = createClient()

  const [
    summaryRes,
    tapeRes,
    quarterlyRes,
    topBorrowersRes,
    recentAlertsRes,
  ] = await Promise.all([
    supabase.rpc("home_summary"),
    supabase
      .from("detector_hits")
      .select(
        "id, detector_name, fund_ticker, portfolio_company_canonical, severity_score, hit_data, created_at",
      )
      .eq("detector_name", "mark_drift_down")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.rpc("detector_quarterly_hits"),
    supabase.rpc("top_cross_fund_borrowers", {
      cutoff_date: "2025-09-30",
      limit_n: 6,
    }),
    supabase
      .from("detector_hits")
      .select(
        "id, detector_name, fund_ticker, portfolio_company_canonical, current_period_end, prior_period_end, severity_score, hit_data, cited_source_urls, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(5)
      .returns<DetectorHit[]>(),
  ])

  // ---------- Hero stats ----------
  const summary = (summaryRes.data ?? {}) as {
    latest_period?: string
    total_fv_b?: number
    positions?: number
    pct_at_risk?: number
  }
  const totalFvB = Number(summary.total_fv_b ?? 0)
  const positions = Number(summary.positions ?? 0)
  const pctAtRisk = Number(summary.pct_at_risk ?? 0)
  const latestPeriod = summary.latest_period ?? null

  // ---------- Live tape ----------
  const tapeItems: TapeItem[] = ((tapeRes.data ?? []) as Array<{
    id: string
    detector_name: string
    fund_ticker: string | null
    portfolio_company_canonical: string | null
    severity_score: number | null
    hit_data: any
  }>)
    .filter((h) => h.fund_ticker && h.portfolio_company_canonical)
    .map((h) => {
      const change = Number(
        h?.hit_data?.fv_change_pct ?? -(h.severity_score ?? 0),
      )
      return {
        id: h.id,
        fund: h.fund_ticker as string,
        company: h.portfolio_company_canonical as string,
        canonical: h.portfolio_company_canonical as string,
        changePct: change,
        tier: severityFor(change),
      }
    })

  // ---------- Detector activity ----------
  type QuarterlyRow = {
    detector_name: string
    quarter_start: string
    hits: number
  }
  const quarterlyRows = (quarterlyRes.data ?? []) as QuarterlyRow[]
  function rowsFor(detector: string) {
    return quarterlyRows.filter((r) => r.detector_name === detector)
  }
  const detectorSeries: DetectorSeries[] = [
    {
      detector: "mark_drift_down",
      label: "Mark Drift Down",
      description: "Fair value cuts vs. prior quarter",
      color: "#EF4444",
      data: buildLast8Quarters(rowsFor("mark_drift_down")),
    },
    {
      detector: "pik_creep",
      label: "PIK Creep",
      description: "Rising paid-in-kind interest share",
      color: "#F59E0B",
      data: buildLast8Quarters(rowsFor("pik_creep")),
    },
    {
      detector: "cross_fund_divergence",
      label: "Cross-Fund Divergence",
      description: "Same loan, different marks across funds",
      color: "#3B82F6",
      data: buildLast8Quarters(rowsFor("cross_fund_divergence")),
    },
  ]

  // ---------- Top borrowers ----------
  const topBorrowers: TopBorrower[] = ((topBorrowersRes.data ?? []) as Array<{
    portfolio_company_canonical: string
    fund_count: number
    funds: string[]
    total_fv_dollars: number | string
  }>).map((b) => ({
    canonical: b.portfolio_company_canonical,
    fund_count: Number(b.fund_count),
    funds: b.funds ?? [],
    total_fv_dollars: Number(b.total_fv_dollars),
  }))

  const recentAlerts = recentAlertsRes.data ?? []
  const { byHitId: recentAlertsSparklines } =
    recentAlerts.length > 0
      ? await fetchSparklineDataForHits(recentAlerts)
      : { byHitId: {} as Record<string, { x: string; y: number }[]> }

  // ---------- Render ----------
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-20 px-6 py-14 sm:py-20">
      {/* Section 1 — Hero */}
      <section className="flex flex-col items-start">
        <Badge
          variant="outline"
          className="mb-5 border-default bg-elevated font-mono text-[11px] uppercase tracking-wider text-muted"
        >
          <span className="mr-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-status-accrual" />
          Live · synced from EDGAR
        </Badge>
        <h1 className="max-w-4xl text-balance text-5xl font-bold tracking-tight text-default sm:text-6xl">
          The agentic intelligence layer for public private credit
        </h1>
        <p className="mt-5 max-w-3xl text-balance text-lg text-muted sm:text-xl">
          Live monitoring of every BDC filing on EDGAR. Three predictive
          detectors. Every alert cited.
        </p>

        {/* Stat cards */}
        <div className="mt-10 grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
          <LiveStatCard
            value={Number(totalFvB.toFixed(1))}
            decimals={1}
            prefix="$"
            suffix="B"
            label="Monitored"
            sublabel={
              latestPeriod ? `Latest filings · ${latestPeriod}` : "Latest filings"
            }
            accentRgb="59, 130, 246"
          />
          <LiveStatCard
            value={positions}
            label="Positions tracked"
            sublabel="Across 6 publicly-traded BDCs"
            accentRgb="16, 185, 129"
          />
          <LiveStatCard
            value={Number(pctAtRisk.toFixed(1))}
            decimals={1}
            suffix="%"
            label="of FV at risk"
            sublabel="Borrowers flagged in last 90 days"
            accentRgb="239, 68, 68"
          />
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button asChild>
            <Link href="/case-studies">See case studies</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/alerts">Browse alerts</Link>
          </Button>
        </div>
      </section>

      {/* Section 2 — Live tape */}
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-dim">
            Live tape · last 20 mark-drift hits
          </h2>
          <Link
            href="/alerts"
            className="text-xs text-accent underline-offset-4 hover:underline"
          >
            All alerts →
          </Link>
        </div>
        <LiveTape items={tapeItems} />
      </section>

      {/* Section 3 — Detector activity small-multiples */}
      <section>
        <div className="mb-5">
          <h2 className="text-2xl font-semibold tracking-tight text-default">
            Detector activity
          </h2>
          <p className="mt-1 text-sm text-muted">
            Quarterly hit counts across the last 8 quarters.
          </p>
        </div>
        <DetectorActivity series={detectorSeries} />
      </section>

      {/* Section 4 — Top borrowers across funds */}
      <section>
        <div className="mb-5">
          <h2 className="text-2xl font-semibold tracking-tight text-default">
            Top borrowers across funds
          </h2>
          <p className="mt-1 text-sm text-muted">
            Names held by 2+ BDCs at the latest filing — the loans where
            divergent marks matter most.
          </p>
        </div>
        <TopBorrowers borrowers={topBorrowers} />
      </section>

      {/* Section 5 — Recent alerts */}
      <section>
        <div className="mb-5 flex items-baseline justify-between">
          <h2 className="text-2xl font-semibold tracking-tight text-default">
            Recent alerts
          </h2>
          <Link
            href="/alerts"
            className="text-sm text-accent underline-offset-4 hover:underline"
          >
            View all →
          </Link>
        </div>
        {recentAlerts.length === 0 ? (
          <p className="text-sm text-muted">No alerts yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {recentAlerts.map((hit, idx) => (
              <RecentAlertCard
                key={hit.id}
                hit={hit}
                index={idx}
                series={recentAlertsSparklines[hit.id] ?? []}
              />
            ))}
          </div>
        )}
      </section>

      {/* Email signup */}
      <section className="rounded-xl border border-default bg-card p-6 sm:p-8">
        <h2 className="text-xl font-semibold tracking-tight text-default">
          Get the weekly alert digest
        </h2>
        <p className="mt-1 text-sm text-muted">
          Top signals from the prior week, every Monday. Free during the
          private beta.
        </p>
        <div className="mt-4">
          <SubscribeForm source="homepage" />
        </div>
      </section>
    </main>
  )
}
