import Link from "next/link"
import { notFound } from "next/navigation"
import { format } from "date-fns"
import { createClient } from "@/lib/supabase/server"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { FvTrajectoryChart } from "@/components/fv-trajectory-chart"
import type { FvPoint } from "@/lib/case-studies"
import { decodeCanonicalSlug } from "@/lib/slug"
import {
  DETECTOR_LABELS,
  type DetectorHit,
  severityTier,
  severityBadgeClass,
  formatSeverity,
  summarize,
  sourceFilingUrl,
  fundTickerLabel,
} from "@/app/alerts/alerts-helpers"

export const dynamic = "force-dynamic"

type Observation = {
  id: string
  fund_ticker: string | null
  period_end: string | null
  portfolio_company_raw: string | null
  industry: string | null
  investment_type: string | null
  interest_rate_text: string | null
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

function fmtUsd(dollars: number | null | undefined): string {
  if (dollars == null || Number.isNaN(dollars)) return "—"
  const m = dollars / 1_000_000
  if (Math.abs(m) >= 1000) return `$${(m / 1000).toFixed(2)}B`
  if (Math.abs(m) >= 10) return `$${m.toFixed(1)}M`
  return `$${m.toFixed(2)}M`
}

function fmtPeriod(s: string | null): string {
  if (!s) return "—"
  try {
    return format(new Date(s + "T00:00:00"), "MMM d, yyyy")
  } catch {
    return s
  }
}

export default async function WatchPage({
  params,
}: {
  params: { slug: string }
}) {
  let canonical: string
  try {
    canonical = decodeCanonicalSlug(params.slug)
  } catch {
    notFound()
  }
  if (!canonical) notFound()

  const supabase = createClient()

  const [obsRes, hitsRes, borrowerRes] = await Promise.all([
    supabase
      .from("observations")
      .select(
        "id, fund_ticker, period_end, portfolio_company_raw, industry, investment_type, interest_rate_text, cost, fair_value, accrual_status, is_pik, source_page_url",
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
  ])

  const observations = obsRes.data ?? []
  const hits = hitsRes.data ?? []
  const borrower = borrowerRes.data ?? null

  if (observations.length === 0 && hits.length === 0) {
    notFound()
  }

  // Latest enrichment for this borrower (most recent hit's enrichment)
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

  // Aggregate FV and cost by period across all funds
  const periodMap = new Map<
    string,
    { fv: number; cost: number; fired: boolean; hasFv: boolean }
  >()
  for (const o of observations) {
    if (!o.period_end) continue
    const k = o.period_end
    const cur =
      periodMap.get(k) ?? { fv: 0, cost: 0, fired: false, hasFv: false }
    if (o.fair_value != null) {
      cur.fv += Number(o.fair_value)
      cur.hasFv = true
    }
    if (o.cost != null) cur.cost += Number(o.cost)
    periodMap.set(k, cur)
  }
  // Mark periods where any detector fired
  for (const h of hits) {
    if (!h.current_period_end) continue
    const cur = periodMap.get(h.current_period_end)
    if (cur) cur.fired = true
  }

  const periods = Array.from(periodMap.keys()).sort()
  const trajectory: FvPoint[] = periods.map((p) => {
    const v = periodMap.get(p)!
    return {
      period_end: p,
      fv_thousands: v.hasFv ? v.fv / 1000 : null,
      detector_fired: v.fired,
      cost_thousands: v.cost > 0 ? v.cost / 1000 : null,
    }
  })

  // Funds holding this borrower (latest period each)
  type FundHolding = {
    ticker: string
    latestPeriod: string
    latestFv: number | null
    latestCost: number | null
    latestAccrual: string | null
    rawName: string | null
  }
  const fundMap = new Map<string, FundHolding>()
  for (const o of observations) {
    if (!o.fund_ticker || !o.period_end) continue
    const cur = fundMap.get(o.fund_ticker)
    if (!cur || o.period_end > cur.latestPeriod) {
      fundMap.set(o.fund_ticker, {
        ticker: o.fund_ticker,
        latestPeriod: o.period_end,
        latestFv: o.fair_value != null ? Number(o.fair_value) : null,
        latestCost: o.cost != null ? Number(o.cost) : null,
        latestAccrual: o.accrual_status,
        rawName: o.portfolio_company_raw,
      })
    }
  }
  const fundHoldings = Array.from(fundMap.values()).sort((a, b) =>
    a.ticker.localeCompare(b.ticker),
  )

  // Latest aggregate
  const latestPeriod = periods.length > 0 ? periods[periods.length - 1] : null
  const latestAgg = latestPeriod ? periodMap.get(latestPeriod)! : null

  // Industry / investment-type tag (most-common)
  const industryCounts = new Map<string, number>()
  for (const o of observations) {
    if (o.industry)
      industryCounts.set(o.industry, (industryCounts.get(o.industry) ?? 0) + 1)
  }
  const topIndustry =
    Array.from(industryCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ??
    borrower?.industry_canonical ??
    null

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col px-6 py-12 sm:py-16">
      <header className="mb-8">
        <div className="mb-2 text-sm">
          <Link
            href="/alerts"
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            ← Alerts
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono text-[11px]">
            Borrower watch
          </Badge>
        </div>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          {canonical}
        </h1>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
          {borrower?.sponsor && (
            <span>
              Sponsor: <span className="text-foreground">{borrower.sponsor}</span>
            </span>
          )}
          {topIndustry && (
            <span>
              Industry: <span className="text-foreground">{topIndustry}</span>
            </span>
          )}
          {latestPeriod && (
            <span>
              Latest filing: {fmtPeriod(latestPeriod)}
            </span>
          )}
        </div>
      </header>

      {/* Summary stats */}
      <section className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
        <div className="bg-background px-4 py-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Funds holding
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {fundHoldings.length}
          </div>
        </div>
        <div className="bg-background px-4 py-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Detector hits
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {hits.length}
          </div>
        </div>
        <div className="bg-background px-4 py-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Latest aggregate FV
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {fmtUsd(latestAgg?.fv ?? null)}
          </div>
        </div>
        <div className="bg-background px-4 py-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            FV / Cost
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {latestAgg && latestAgg.cost > 0
              ? `${((latestAgg.fv / latestAgg.cost) * 100).toFixed(1)}%`
              : "—"}
          </div>
        </div>
      </section>

      {/* Trajectory chart */}
      <section className="mb-10">
        <Card>
          <CardHeader>
            <CardTitle>Fair value trajectory</CardTitle>
            <CardDescription>
              Aggregate FV across all funds holding this borrower. Dashed lines
              mark periods where one of our detectors fired.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {trajectory.length > 0 ? (
              <FvTrajectoryChart data={trajectory} />
            ) : (
              <p className="text-sm text-muted-foreground">No FV history.</p>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Funds holding */}
      <section className="mb-10">
        <h2 className="mb-3 text-xl font-semibold tracking-tight">
          Funds holding {canonical}
        </h2>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[110px]">Fund</TableHead>
                <TableHead>Latest period</TableHead>
                <TableHead className="text-right">Latest FV</TableHead>
                <TableHead className="text-right">Latest cost</TableHead>
                <TableHead>Accrual</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fundHoldings.map((f) => (
                <TableRow key={f.ticker}>
                  <TableCell className="font-mono font-medium">
                    <Link
                      href={`/funds/${f.ticker}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {f.ticker}
                    </Link>
                  </TableCell>
                  <TableCell>{fmtPeriod(f.latestPeriod)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtUsd(f.latestFv)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtUsd(f.latestCost)}
                  </TableCell>
                  <TableCell>
                    {f.latestAccrual ? (
                      <Badge
                        variant={
                          f.latestAccrual.toLowerCase().includes("non")
                            ? "destructive"
                            : "outline"
                        }
                      >
                        {f.latestAccrual}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* Detector hits */}
      <section className="mb-10">
        <h2 className="mb-3 text-xl font-semibold tracking-tight">
          All detector hits ({hits.length})
        </h2>
        {hits.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No detector hits on this borrower.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {hits.map((hit) => {
              const tier = severityTier(hit.detector_name, hit.severity_score)
              const filingUrl = sourceFilingUrl(hit)
              return (
                <div key={hit.id} className="rounded-lg border p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge className={severityBadgeClass(tier)}>
                      {DETECTOR_LABELS[hit.detector_name] ?? hit.detector_name}
                    </Badge>
                    <span className="font-mono text-sm text-muted-foreground">
                      {fundTickerLabel(hit)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {fmtPeriod(hit.current_period_end)}
                    </span>
                    <span className="ml-auto text-xs font-medium">
                      Severity:{" "}
                      {formatSeverity(hit.detector_name, hit.severity_score)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {summarize(hit)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs">
                    <Link
                      href={`/alerts/${hit.id}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      Alert details →
                    </Link>
                    {filingUrl && (
                      <a
                        href={filingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        Source filing →
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Latest enrichment */}
      {latestEnrichment && (
        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold tracking-tight">
            Latest enrichment
          </h2>
          <Card>
            <CardHeader>
              <CardDescription>
                Generated {fmtPeriod(latestEnrichment.generated_at.slice(0, 10))}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {latestEnrichment.research_summary && (
                <p className="leading-7">{latestEnrichment.research_summary}</p>
              )}
              <EnrichmentList
                title="News"
                items={asArray(latestEnrichment.news_items)}
              />
              <EnrichmentList
                title="Litigation"
                items={asArray(latestEnrichment.litigation_items)}
              />
              <EnrichmentList
                title="Management changes"
                items={asArray(latestEnrichment.management_changes)}
              />
              {latestEnrichment.sponsor_info &&
                Object.keys(latestEnrichment.sponsor_info).length > 0 && (
                  <div>
                    <h3 className="mb-1 text-sm font-semibold">Sponsor</h3>
                    <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs text-muted-foreground">
                      {JSON.stringify(latestEnrichment.sponsor_info, null, 2)}
                    </pre>
                  </div>
                )}
            </CardContent>
          </Card>
        </section>
      )}
    </main>
  )
}

function asArray(x: any): any[] {
  if (Array.isArray(x)) return x
  return []
}

function EnrichmentList({ title, items }: { title: string; items: any[] }) {
  if (!items || items.length === 0) return null
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <ul className="space-y-2">
        {items.slice(0, 8).map((it, i) => {
          const headline =
            it?.headline || it?.title || it?.summary || it?.description || ""
          const url = it?.url || it?.source_url || it?.link
          const date = it?.date || it?.published_at || it?.published_date
          return (
            <li key={i} className="text-sm leading-6">
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {headline || url}
                </a>
              ) : (
                <span>{headline || "(no headline)"}</span>
              )}
              {date && (
                <span className="ml-2 text-xs text-muted-foreground">
                  {date}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
