import Link from "next/link"
import { format } from "date-fns"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
  DETECTOR_TABS,
  DETECTOR_LABELS,
  type DetectorHit,
  summarize,
  sourceFilingUrl,
  fundTickerLabel,
  companyLabel,
  formatSeverity,
} from "./alerts-helpers"
import { encodeCanonicalSlug } from "@/lib/slug"
import { SeverityRing } from "@/components/charts/SeverityRing"
import { HitSparkline } from "@/components/charts/HitSparkline"
import { fetchSparklineDataForHits } from "@/lib/sparkline-data"
import { AlertsToast } from "./alerts-toast"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 20

type SearchParams = {
  detector?: string
  page?: string
  fund?: string
  quarter?: string
}

const FUND_TICKERS = ["ARCC", "OBDC", "GBDC", "GSBD", "GSCR", "MAIN"]

/** Add `n` months to a UTC ISO date and return a YYYY-MM-DD string. */
function addMonthsIso(iso: string, n: number): string | null {
  const d = new Date(iso + "T00:00:00Z")
  if (Number.isNaN(d.getTime())) return null
  const out = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()),
  )
  return out.toISOString().slice(0, 10)
}

/** Format "2025-04-01" → "Q2 '25". */
function quarterLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00Z")
  if (Number.isNaN(d.getTime())) return iso
  const q = Math.floor(d.getUTCMonth() / 3) + 1
  const yy = String(d.getUTCFullYear()).slice(-2)
  return `Q${q} '${yy}`
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

  const fundFilter =
    searchParams.fund && FUND_TICKERS.includes(searchParams.fund.toUpperCase())
      ? searchParams.fund.toUpperCase()
      : null

  // quarter must be a YYYY-MM-DD ISO string we can parse.
  const quarterFilter =
    searchParams.quarter && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.quarter)
      ? searchParams.quarter
      : null
  const quarterEnd = quarterFilter ? addMonthsIso(quarterFilter, 3) : null

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
  if (fundFilter) {
    query = query.eq("fund_ticker", fundFilter)
  }
  if (quarterFilter && quarterEnd) {
    query = query
      .gte("current_period_end", quarterFilter)
      .lt("current_period_end", quarterEnd)
  }

  const { data, error, count } = await query.returns<DetectorHit[]>()

  const totalCount = count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  const hits = data ?? []
  const { byHitId: sparkByHitId } =
    hits.length > 0
      ? await fetchSparklineDataForHits(hits)
      : { byHitId: {} as Record<string, { x: string; y: number }[]> }

  function buildHref(detector: string, page: number): string {
    const params = new URLSearchParams()
    if (detector !== "all") params.set("detector", detector)
    if (page > 1) params.set("page", String(page))
    if (fundFilter) params.set("fund", fundFilter)
    if (quarterFilter) params.set("quarter", quarterFilter)
    const qs = params.toString()
    return qs ? `/alerts?${qs}` : "/alerts"
  }

  function clearFilterHref(): string {
    const params = new URLSearchParams()
    if (activeDetector !== "all") params.set("detector", activeDetector)
    const qs = params.toString()
    return qs ? `/alerts?${qs}` : "/alerts"
  }

  const filterSignature = JSON.stringify({
    detector: activeDetector,
    fund: fundFilter,
    quarter: quarterFilter,
  })

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-12 sm:py-16">
      <AlertsToast count={totalCount} signature={filterSignature} />
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
          Alerts
        </h1>
        <p className="mt-2 text-muted">
          Detector hits across all BDC filings, sorted by most recent.
        </p>
      </header>

      {(fundFilter || quarterFilter) && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-mono uppercase tracking-wider text-dim">
            Filtered to:
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-accent bg-accent/10 px-3 py-1 text-xs text-accent">
            {fundFilter && (
              <span className="font-mono font-semibold">{fundFilter}</span>
            )}
            {fundFilter && quarterFilter && (
              <span className="text-accent/60">·</span>
            )}
            {quarterFilter && (
              <span className="font-mono">{quarterLabel(quarterFilter)}</span>
            )}
            <Link
              href={clearFilterHref()}
              aria-label="Clear fund and quarter filter"
              className="-mr-1 ml-1 rounded-full px-1 text-accent/80 hover:text-accent"
            >
              ×
            </Link>
          </span>
        </div>
      )}

      <nav className="mb-8 flex flex-wrap gap-1 border-b border-default">
        {DETECTOR_TABS.map((tab) => {
          const active = tab.key === activeDetector
          return (
            <Link
              key={tab.key}
              href={buildHref(tab.key, 1)}
              className={cn(
                "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-default text-default"
                  : "border-transparent text-muted hover:text-default",
              )}
              style={
                active
                  ? { borderColor: "#3B82F6", color: "#F3F4F6" }
                  : undefined
              }
            >
              {tab.label}
            </Link>
          )
        })}
      </nav>

      {error ? (
        <p className="text-sm text-severity-critical">
          Failed to load alerts: {error.message}
        </p>
      ) : hits.length === 0 ? (
        <p className="text-sm text-muted">No alerts found.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {hits.map((hit) => {
            const filingUrl = sourceFilingUrl(hit)
            const series = sparkByHitId[hit.id] ?? []
            return (
              <Card
                key={hit.id}
                className="relative border-default bg-card transition-colors hover:border-hover"
              >
                {/* Full-card click target. Anchors below sit above this with z-10. */}
                <Link
                  href={`/alerts/${hit.id}`}
                  aria-label={`View alert details for ${companyLabel(hit)}`}
                  className="absolute inset-0 z-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <SeverityRing
                        severity={hit.severity_score ?? 0}
                        size={40}
                        ariaLabel={`Severity ${formatSeverity(
                          hit.detector_name,
                          hit.severity_score,
                        )}`}
                      />
                      <div>
                        <div className="text-[11px] font-mono uppercase tracking-wider text-dim">
                          {DETECTOR_LABELS[hit.detector_name] ??
                            hit.detector_name}
                          {" · "}
                          {fundTickerLabel(hit)}
                        </div>
                        <CardTitle className="mt-0.5 text-lg text-default">
                          {companyLabel(hit)}
                        </CardTitle>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-xs text-dim">
                        {hit.current_period_end
                          ? format(
                              new Date(hit.current_period_end),
                              "MMM d, yyyy",
                            )
                          : format(new Date(hit.created_at), "MMM d, yyyy")}
                      </span>
                      <HitSparkline
                        detector={hit.detector_name}
                        data={series}
                        width={140}
                        height={36}
                      />
                      <span className="text-[10px] font-mono uppercase tracking-wider text-dim">
                        {hit.detector_name === "pik_creep"
                          ? "PIK share · 8q"
                          : "FV · 8q"}
                      </span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-sm text-default">{summarize(hit)}</p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                    <span>
                      Severity:{" "}
                      <span className="font-medium text-default">
                        {formatSeverity(
                          hit.detector_name,
                          hit.severity_score,
                        )}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      {hit.portfolio_company_canonical && (
                        <Link
                          href={`/watch/${encodeCanonicalSlug(hit.portfolio_company_canonical)}`}
                          className="relative z-10 underline-offset-4 hover:underline"
                        >
                          Watch borrower →
                        </Link>
                      )}
                      {filingUrl && (
                        <a
                          href={filingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="relative z-10 underline-offset-4 hover:underline"
                        >
                          Source filing →
                        </a>
                      )}
                      <span className="text-accent">View details →</span>
                    </span>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-between text-sm">
          <span className="text-muted">
            Page {pageNum} of {totalPages} · {totalCount} total
          </span>
          <div className="flex gap-2">
            {pageNum > 1 ? (
              <Link
                href={buildHref(activeDetector, pageNum - 1)}
                className="rounded-md border border-default px-3 py-1.5 text-default hover:border-hover"
              >
                ← Previous
              </Link>
            ) : (
              <span className="cursor-not-allowed rounded-md border border-default px-3 py-1.5 text-dim opacity-50">
                ← Previous
              </span>
            )}
            {pageNum < totalPages ? (
              <Link
                href={buildHref(activeDetector, pageNum + 1)}
                className="rounded-md border border-default px-3 py-1.5 text-default hover:border-hover"
              >
                Next →
              </Link>
            ) : (
              <span className="cursor-not-allowed rounded-md border border-default px-3 py-1.5 text-dim opacity-50">
                Next →
              </span>
            )}
          </div>
        </div>
      )}
    </main>
  )
}
