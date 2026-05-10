import Link from "next/link"
import { notFound } from "next/navigation"
import { format } from "date-fns"
import { createClient } from "@/lib/supabase/server"
import { Badge } from "@/components/ui/badge"
import { AnimatedNumber } from "@/components/charts/AnimatedNumber"
import { decodeCanonicalSlug } from "@/lib/slug"
import type { DetectorHit } from "@/app/alerts/alerts-helpers"
import { WatchTabs } from "./watch-tabs"

export const dynamic = "force-dynamic"

type Observation = {
  id: string
  fund_ticker: string | null
  period_end: string | null
  portfolio_company_raw: string | null
  industry: string | null
  investment_type: string | null
  cost: number | null
  fair_value: number | null
  accrual_status: string | null
  is_pik: boolean | null
  source_page_url: string | null
}

type BorrowerCanonical = {
  canonical_name: string
  alternate_names: string[] | null
  sponsor: string | null
  industry_canonical: string | null
  notes: string | null
}

type Enrichment = {
  detector_hit_id: string
  research_summary: string | null
  news_items: any
  litigation_items: any
  sponsor_info: any
  management_changes: any
  generated_at: string
}

type EnrichmentQueueRow = {
  status: string
  requested_at: string
}

export default async function WatchPage({
  params,
  searchParams,
}: {
  params: { slug: string }
  searchParams: { tab?: string }
}) {
  let canonical: string
  try {
    canonical = decodeCanonicalSlug(params.slug)
  } catch {
    notFound()
  }
  if (!canonical) notFound()

  const supabase = createClient()

  const [obsRes, hitsRes, borrowerRes, queueRes] = await Promise.all([
    supabase
      .from("observations")
      .select(
        "id, fund_ticker, period_end, portfolio_company_raw, industry, investment_type, cost, fair_value, accrual_status, is_pik, source_page_url",
      )
      .eq("portfolio_company_canonical", canonical)
      .order("period_end", { ascending: true })
      .returns<Observation[]>(),
    supabase
      .from("detector_hits")
      .select(
        "id, detector_name, fund_ticker, portfolio_company_canonical, current_period_end, prior_period_end, severity_score, hit_data, cited_source_urls, created_at",
      )
      .eq("portfolio_company_canonical", canonical)
      .order("current_period_end", { ascending: false })
      .returns<DetectorHit[]>(),
    supabase
      .from("borrower_canonical")
      .select("canonical_name, alternate_names, sponsor, industry_canonical, notes")
      .eq("canonical_name", canonical)
      .maybeSingle<BorrowerCanonical>(),
    supabase
      .from("enrichment_queue")
      .select("status, requested_at")
      .eq("borrower_canonical", canonical)
      .order("requested_at", { ascending: false })
      .limit(1)
      .returns<EnrichmentQueueRow[]>(),
  ])

  const observations = obsRes.data ?? []
  const hits = hitsRes.data ?? []
  const borrower = borrowerRes.data ?? null
  const latestQueue = queueRes.data?.[0] ?? null

  if (observations.length === 0 && hits.length === 0) {
    notFound()
  }

  // Latest enrichment (most recent across this borrower's hits)
  let latestEnrichment: Enrichment | null = null
  if (hits.length > 0) {
    const enrichRes = await supabase
      .from("enrichments")
      .select(
        "detector_hit_id, research_summary, news_items, litigation_items, sponsor_info, management_changes, generated_at",
      )
      .in(
        "detector_hit_id",
        hits.map((h) => h.id),
      )
      .order("generated_at", { ascending: false })
      .limit(1)
      .returns<Enrichment[]>()
    latestEnrichment = enrichRes.data?.[0] ?? null
  }

  // ── Aggregate per-period FV per fund (stacked area input) ───────────────
  // Sum duplicate (fund, period) rows together. Some borrowers have multiple
  // tranches in the same fund's filing.
  const fundPeriodFv = new Map<string, Map<string, number>>() // fund → period → fv (thousands)
  for (const o of observations) {
    if (!o.fund_ticker || !o.period_end || o.fair_value == null) continue
    const fv = Number(o.fair_value)
    if (!Number.isFinite(fv)) continue
    let inner = fundPeriodFv.get(o.fund_ticker)
    if (!inner) {
      inner = new Map()
      fundPeriodFv.set(o.fund_ticker, inner)
    }
    inner.set(o.period_end, (inner.get(o.period_end) ?? 0) + fv)
  }
  const periodSet = new Set<string>()
  Array.from(fundPeriodFv.values()).forEach((inner) => {
    Array.from(inner.keys()).forEach((p) => periodSet.add(p))
  })
  const periods = Array.from(periodSet).sort()
  const fundTickers = Array.from(fundPeriodFv.keys()).sort()

  const stackedSeries: Array<Record<string, number | string>> = periods.map((p) => {
    const row: Record<string, number | string> = { period: p }
    let total = 0
    for (const t of fundTickers) {
      const v = fundPeriodFv.get(t)?.get(p)
      if (v != null) {
        row[t] = v
        total += v
      } else {
        row[t] = 0
      }
    }
    row.__total = total
    return row
  })

  // Detector markers: one entry per period that had at least one hit
  const periodHits = new Map<string, DetectorHit[]>()
  for (const h of hits) {
    if (!h.current_period_end) continue
    const arr = periodHits.get(h.current_period_end) ?? []
    arr.push(h)
    periodHits.set(h.current_period_end, arr)
  }

  // Per-fund summary (latest period each)
  type FundSummary = {
    ticker: string
    firstPeriod: string
    latestPeriod: string
    latestFv: number | null // thousands
    latestCost: number | null
    latestAccrual: string | null
    series: Array<{ period: string; fv: number | null; cost: number | null }>
    latestHit: DetectorHit | null
  }
  const fundMap = new Map<string, FundSummary>()
  for (const o of observations) {
    if (!o.fund_ticker || !o.period_end) continue
    let s = fundMap.get(o.fund_ticker)
    if (!s) {
      s = {
        ticker: o.fund_ticker,
        firstPeriod: o.period_end,
        latestPeriod: o.period_end,
        latestFv: null,
        latestCost: null,
        latestAccrual: null,
        series: [],
        latestHit: null,
      }
      fundMap.set(o.fund_ticker, s)
    }
    if (o.period_end < s.firstPeriod) s.firstPeriod = o.period_end
    if (o.period_end >= s.latestPeriod) {
      s.latestPeriod = o.period_end
      s.latestFv = o.fair_value != null ? Number(o.fair_value) : null
      s.latestCost = o.cost != null ? Number(o.cost) : null
      s.latestAccrual = o.accrual_status
    }
    s.series.push({
      period: o.period_end,
      fv: o.fair_value != null ? Number(o.fair_value) : null,
      cost: o.cost != null ? Number(o.cost) : null,
    })
  }
  Array.from(fundMap.values()).forEach((s) => {
    // Collapse duplicates within same period for the small-multiple chart
    const collapsed = new Map<string, { fv: number | null; cost: number | null }>()
    for (const row of s.series) {
      const cur = collapsed.get(row.period) ?? { fv: null, cost: null }
      cur.fv = (cur.fv ?? 0) + (row.fv ?? 0)
      cur.cost = (cur.cost ?? 0) + (row.cost ?? 0)
      // If everything was null, keep null instead of 0
      if (row.fv == null && cur.fv === 0) cur.fv = null
      if (row.cost == null && cur.cost === 0) cur.cost = null
      collapsed.set(row.period, cur)
    }
    s.series = Array.from(collapsed.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([period, v]) => ({ period, fv: v.fv, cost: v.cost }))
    // Latest hit for this fund
    const fundHits = hits.filter((h) => h.fund_ticker === s.ticker)
    s.latestHit = fundHits[0] ?? null
  })
  const fundSummaries = Array.from(fundMap.values()).sort((a, b) =>
    a.ticker.localeCompare(b.ticker),
  )

  // Latest aggregate FV (sum across funds at the latest shared period)
  const latestPeriod = periods[periods.length - 1] ?? null
  let latestTotalFv = 0
  if (latestPeriod) {
    const lastRow = stackedSeries[stackedSeries.length - 1]
    latestTotalFv = Number(lastRow?.__total ?? 0)
  }

  // Industry — most-common from observations, else canonical
  const industryCounts = new Map<string, number>()
  for (const o of observations) {
    if (o.industry)
      industryCounts.set(o.industry, (industryCounts.get(o.industry) ?? 0) + 1)
  }
  const topIndustry =
    Array.from(industryCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ??
    borrower?.industry_canonical ??
    null

  // Accrual % across funds at latest period
  let accrualCount = 0
  let totalCount = 0
  if (latestPeriod) {
    for (const o of observations) {
      if (o.period_end !== latestPeriod) continue
      if (!o.accrual_status) continue
      totalCount += 1
      if (o.accrual_status === "accrual") accrualCount += 1
    }
  }
  const accrualPct = totalCount > 0 ? accrualCount / totalCount : null

  // FV / Cost % at latest period
  let latestCostSum = 0
  let latestFvSum = 0
  if (latestPeriod) {
    for (const o of observations) {
      if (o.period_end !== latestPeriod) continue
      if (o.fair_value != null) latestFvSum += Number(o.fair_value)
      if (o.cost != null) latestCostSum += Number(o.cost)
    }
  }
  const fvOverCostPct = latestCostSum > 0 ? latestFvSum / latestCostSum : null

  // 4-quarter drift sparkline (total FV by period)
  const driftSeries = stackedSeries.slice(-4).map((row) => ({
    x: String(row.period),
    y: Number(row.__total ?? 0),
  }))

  // Alternating-side timeline data (chronological, oldest first)
  const timelineHits = [...hits].sort((a, b) => {
    const ad = a.current_period_end ?? a.created_at
    const bd = b.current_period_end ?? b.created_at
    return ad.localeCompare(bd)
  })

  const tab = (searchParams.tab ?? "overview").toLowerCase()
  const validTab =
    tab === "by-fund" || tab === "hits" || tab === "intel" ? tab : "overview"

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col px-6 py-10 sm:py-14">
      <div className="mb-2 text-sm">
        <Link
          href="/alerts"
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← Alerts
        </Link>
      </div>

      {/* Hero strip */}
      <header className="mb-8 border-b border-border pb-8">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono text-[11px]">
            Borrower watch
          </Badge>
          {latestPeriod && (
            <span className="font-mono text-[11px] text-muted-foreground">
              as of {format(new Date(latestPeriod + "T00:00:00"), "MMM d, yyyy")}
            </span>
          )}
        </div>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">
          {canonical}
        </h1>
        <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
          <HeroStat
            label="Sponsor"
            value={borrower?.sponsor ?? "—"}
            mono={false}
          />
          <HeroStat
            label="Industry"
            value={topIndustry ?? "—"}
            mono={false}
          />
          <HeroStat
            label="Funds holding"
            value={String(fundSummaries.length)}
            mono
          />
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Total current FV
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {latestTotalFv > 0 ? (
                <AnimatedNumber
                  value={latestTotalFv / 1000}
                  prefix="$"
                  suffix="M"
                  decimals={2}
                  duration={1.2}
                  numberClassName="text-2xl font-semibold tabular-nums"
                />
              ) : (
                "—"
              )}
            </div>
          </div>
        </div>
      </header>

      <WatchTabs
        canonical={canonical}
        initialTab={validTab}
        slug={params.slug}
        // Overview
        stackedSeries={stackedSeries}
        fundTickers={fundTickers}
        periodHits={Array.from(periodHits.entries()).map(([period, arr]) => ({
          period,
          hits: arr,
        }))}
        accrualPct={accrualPct}
        fvOverCostPct={fvOverCostPct}
        driftSeries={driftSeries}
        totalHits={hits.length}
        latestTotalFv={latestTotalFv}
        latestFvSum={latestFvSum}
        latestCostSum={latestCostSum}
        // By Fund
        fundSummaries={fundSummaries}
        // Hits timeline
        timelineHits={timelineHits}
        // Intelligence
        enrichment={latestEnrichment}
        latestQueue={latestQueue}
      />
    </main>
  )
}

function HeroStat({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono: boolean
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1 text-base font-semibold sm:text-lg ${
          mono ? "tabular-nums" : ""
        }`}
      >
        {value}
      </div>
    </div>
  )
}

