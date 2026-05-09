import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SubscribeForm } from "@/components/subscribe-form"
import {
  DETECTOR_LABELS,
  type DetectorHit,
  severityTier,
  severityBadgeClass,
  summarize,
  sourceFilingUrl,
  fundTickerLabel,
  companyLabel,
} from "./alerts/alerts-helpers"

export const dynamic = "force-dynamic"

function fmtCount(n: number | null | undefined): string {
  if (n == null) return "—"
  return n.toLocaleString("en-US")
}

export default async function Home() {
  const supabase = createClient()
  const [fundsCountRes, obsCountRes, hitsCountRes, alertsResult] =
    await Promise.all([
      supabase.from("funds").select("ticker", { count: "exact", head: true }),
      supabase
        .from("observations")
        .select("id", { count: "exact", head: true }),
      supabase
        .from("detector_hits")
        .select("id", { count: "exact", head: true }),
      supabase
        .from("detector_hits")
        .select(
          "id, detector_name, fund_ticker, portfolio_company_canonical, current_period_end, prior_period_end, severity_score, hit_data, cited_source_urls, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(5)
        .returns<DetectorHit[]>(),
    ])

  const fundCount = fundsCountRes.count
  const obsCount = obsCountRes.count
  const hitCount = hitsCountRes.count
  const recentAlerts = alertsResult.data ?? []

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col px-6 py-16 sm:py-24">
      {/* Hero */}
      <section className="mb-16 flex flex-col items-start">
        <Badge
          variant="outline"
          className="mb-5 font-mono text-[11px] uppercase tracking-wider"
        >
          Live demo · 2026 Q1 filings ingested
        </Badge>
        <h1 className="max-w-4xl text-balance text-5xl font-bold tracking-tight sm:text-6xl">
          The agentic intelligence layer for public private credit
        </h1>
        <p className="mt-5 max-w-3xl text-balance text-lg text-muted-foreground sm:text-xl">
          $130B+ in BDC fair value monitored. Three predictive detectors. Every
          alert cited to source.
        </p>

        {/* Live stats */}
        <div className="mt-10 grid w-full max-w-3xl grid-cols-1 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
          <div className="bg-background px-5 py-4">
            <div className="text-3xl font-semibold tabular-nums">
              {fmtCount(fundCount)}
            </div>
            <div className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">
              BDCs monitored
            </div>
          </div>
          <div className="bg-background px-5 py-4">
            <div className="text-3xl font-semibold tabular-nums">
              {fmtCount(obsCount)}
            </div>
            <div className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">
              Position observations
            </div>
          </div>
          <div className="bg-background px-5 py-4">
            <div className="text-3xl font-semibold tabular-nums">
              {fmtCount(hitCount)}
            </div>
            <div className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">
              Detector hits
            </div>
          </div>
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

      {/* Email signup */}
      <section className="mb-16 rounded-xl border bg-muted/30 p-6 sm:p-8">
        <h2 className="text-xl font-semibold tracking-tight">
          Get the weekly alert digest
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Top signals from the prior week, every Monday. Free during the
          private beta.
        </p>
        <div className="mt-4">
          <SubscribeForm source="homepage" />
        </div>
      </section>

      {/* Recent alerts */}
      <section className="mb-12">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-2xl font-semibold tracking-tight">
            Recent alerts
          </h2>
          <Link
            href="/alerts"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            View all →
          </Link>
        </div>
        {recentAlerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No alerts yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {recentAlerts.map((hit) => {
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
                    <span className="text-sm font-medium">
                      {companyLabel(hit)}
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
                        View source filing →
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </main>
  )
}
