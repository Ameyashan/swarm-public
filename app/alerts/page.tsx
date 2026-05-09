import Link from "next/link"
import { format } from "date-fns"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  DETECTOR_TABS,
  DETECTOR_LABELS,
  type DetectorHit,
  severityTier,
  severityBadgeClass,
  summarize,
  sourceFilingUrl,
  fundTickerLabel,
  companyLabel,
  formatSeverity,
} from "./alerts-helpers"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 20

type SearchParams = {
  detector?: string
  page?: string
}

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const detectorParam = searchParams.detector ?? "all"
  const activeDetector =
    DETECTOR_TABS.find((t) => t.key === detectorParam)?.key ?? "all"
  const pageNum = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1)
  const from = (pageNum - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const supabase = createClient()
  let query = supabase
    .from("detector_hits")
    .select(
      "id, detector_name, fund_ticker, portfolio_company_canonical, current_period_end, prior_period_end, severity_score, hit_data, cited_source_urls, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to)

  if (activeDetector !== "all") {
    query = query.eq("detector_name", activeDetector)
  }

  const { data, error, count } = await query.returns<DetectorHit[]>()

  const totalCount = count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  function buildHref(detector: string, page: number): string {
    const params = new URLSearchParams()
    if (detector !== "all") params.set("detector", detector)
    if (page > 1) params.set("page", String(page))
    const qs = params.toString()
    return qs ? `/alerts?${qs}` : "/alerts"
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-12 sm:py-16">
      <header className="mb-8">
        <div className="mb-2 text-sm">
          <Link
            href="/"
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            ← Home
          </Link>
        </div>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Alerts</h1>
        <p className="mt-2 text-muted-foreground">
          Detector hits across all BDC filings, sorted by most recent.
        </p>
      </header>

      <nav className="mb-8 flex flex-wrap gap-1 border-b">
        {DETECTOR_TABS.map((tab) => {
          const active = tab.key === activeDetector
          return (
            <Link
              key={tab.key}
              href={buildHref(tab.key, 1)}
              className={cn(
                "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          )
        })}
      </nav>

      {error ? (
        <p className="text-sm text-destructive">
          Failed to load alerts: {error.message}
        </p>
      ) : (data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No alerts found.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {(data ?? []).map((hit) => {
            const tier = severityTier(hit.detector_name, hit.severity_score)
            const filingUrl = sourceFilingUrl(hit)
            return (
              <Card key={hit.id}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={severityBadgeClass(tier)}>
                        {DETECTOR_LABELS[hit.detector_name] ??
                          hit.detector_name}
                      </Badge>
                      <span className="font-mono text-sm text-muted-foreground">
                        {fundTickerLabel(hit)}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {hit.current_period_end
                        ? format(
                            new Date(hit.current_period_end),
                            "MMM d, yyyy",
                          )
                        : format(new Date(hit.created_at), "MMM d, yyyy")}
                    </span>
                  </div>
                  <CardTitle className="mt-2 text-lg">
                    {filingUrl ? (
                      <a
                        href={filingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        {companyLabel(hit)}
                      </a>
                    ) : (
                      companyLabel(hit)
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-sm">{summarize(hit)}</p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      Severity:{" "}
                      <span className="font-medium text-foreground">
                        {formatSeverity(hit.detector_name, hit.severity_score)}
                      </span>
                    </span>
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
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {pageNum} of {totalPages} · {totalCount} total
          </span>
          <div className="flex gap-2">
            {pageNum > 1 ? (
              <Link
                href={buildHref(activeDetector, pageNum - 1)}
                className="rounded-md border px-3 py-1.5 hover:bg-muted"
              >
                ← Previous
              </Link>
            ) : (
              <span className="cursor-not-allowed rounded-md border px-3 py-1.5 text-muted-foreground opacity-50">
                ← Previous
              </span>
            )}
            {pageNum < totalPages ? (
              <Link
                href={buildHref(activeDetector, pageNum + 1)}
                className="rounded-md border px-3 py-1.5 hover:bg-muted"
              >
                Next →
              </Link>
            ) : (
              <span className="cursor-not-allowed rounded-md border px-3 py-1.5 text-muted-foreground opacity-50">
                Next →
              </span>
            )}
          </div>
        </div>
      )}
    </main>
  )
}
