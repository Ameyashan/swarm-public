import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
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

// Always render with fresh data on each request.
export const dynamic = "force-dynamic"

type Fund = {
  ticker: string
  name: string
  cik: string
}

export default async function Home() {
  const supabase = createClient()
  const [fundsResult, alertsResult] = await Promise.all([
    supabase
      .from("funds")
      .select("ticker, name, cik")
      .order("ticker", { ascending: true })
      .returns<Fund[]>(),
    supabase
      .from("detector_hits")
      .select(
        "id, detector_name, fund_ticker, portfolio_company_canonical, current_period_end, prior_period_end, severity_score, hit_data, cited_source_urls, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(5)
      .returns<DetectorHit[]>(),
  ])

  const { data: funds, error } = fundsResult
  const { data: recentAlerts } = alertsResult

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-16 sm:py-24">
      <header className="mb-12">
        <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">
          Swarm Public
        </h1>
        <p className="mt-4 text-lg text-muted-foreground sm:text-xl">
          The agentic intelligence layer for public private credit
        </p>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <Link
            href="/case-studies"
            className="text-primary underline-offset-4 hover:underline"
          >
            Case studies →
          </Link>
          <span className="text-muted-foreground">·</span>
          <Link
            href="/alerts"
            className="text-primary underline-offset-4 hover:underline"
          >
            All alerts →
          </Link>
        </div>
      </header>

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
        {(recentAlerts ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No alerts yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {(recentAlerts ?? []).map((hit) => {
              const tier = severityTier(hit.detector_name, hit.severity_score)
              const filingUrl = sourceFilingUrl(hit)
              return (
                <div
                  key={hit.id}
                  className="rounded-lg border p-4"
                >
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
                  {filingUrl && (
                    <a
                      href={filingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block text-xs text-primary underline-offset-4 hover:underline"
                    >
                      View source filing →
                    </a>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="flex-1">
        <h2 className="mb-4 text-2xl font-semibold tracking-tight">Funds</h2>
        {error ? (
          <p className="text-sm text-destructive">
            Failed to load funds: {error.message}
          </p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">Ticker</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-[160px]">CIK</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(funds ?? []).map((f) => (
                  <TableRow key={f.ticker}>
                    <TableCell className="font-mono font-medium">
                      <Link
                        href={`/funds/${f.ticker}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {f.ticker}
                      </Link>
                    </TableCell>
                    <TableCell>{f.name}</TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {f.cik}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <footer className="mt-16 border-t pt-6 text-sm text-muted-foreground">
        Live data from SEC EDGAR. Powered by Perplexity Computer.
      </footer>
    </main>
  )
}
