import Link from "next/link"
import { notFound } from "next/navigation"
import { format } from "date-fns"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  DETECTOR_LABELS,
  type DetectorHit,
  severityTier,
  summarize,
  sourceFilingUrl,
  fundTickerLabel,
  companyLabel,
  formatSeverity,
} from "../alerts-helpers"
import { CopySummaryButton } from "./copy-summary-button"
import { encodeCanonicalSlug } from "@/lib/slug"
import { SeverityRing } from "@/components/charts/SeverityRing"
import { AnimatedNumber } from "@/components/charts/AnimatedNumber"
import { FvHistoryChart, type FvHistoryRow } from "@/components/charts/FvHistoryChart"

export const dynamic = "force-dynamic"

type Observation = {
  id: string
  fund_ticker: string
  period_end: string
  portfolio_company_raw: string | null
  portfolio_company_canonical: string | null
  industry: string | null
  investment_type: string | null
  interest_rate_text: string | null
  interest_rate_pct: number | null
  pik_rate_pct: number | null
  maturity_date: string | null
  principal_amount: number | null
  cost: number | null
  fair_value: number | null
  accrual_status: string | null
  is_pik: boolean | null
  source_page_url: string | null
}

type Enrichment = {
  detector_hit_id: string
  research_summary: string | null
  news_items: any[] | null
  litigation_items: any[] | null
  sponsor_info: Record<string, any> | null
  management_changes: any[] | null
  generated_at: string | null
}

type Filing = {
  fund_ticker: string
  period_end: string
  filing_type: string
  filing_date: string
  primary_doc_url: string | null
  accession_number: string
}

// Format $thousands → human ($1.2M / $3.4B / $850K)
function fmtUsdK(thousands: number | null): string {
  if (thousands == null || !Number.isFinite(thousands)) return "—"
  const millions = thousands / 1000
  if (Math.abs(millions) >= 1000)
    return `$${(millions / 1000).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    })}B`
  if (Math.abs(millions) >= 1)
    return `$${millions.toLocaleString(undefined, {
      maximumFractionDigits: 1,
    })}M`
  return `$${(thousands).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  })}K`
}

function fmtPct(p: number | null, digits = 2): string {
  if (p == null || !Number.isFinite(p)) return "—"
  return `${(p * 100).toFixed(digits)}%`
}

function fmtRawNum(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—"
  return n.toLocaleString()
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—"
  try {
    return format(new Date(s), "MMM d, yyyy")
  } catch {
    return s
  }
}

function buildMarkdownSummary(args: {
  hit: DetectorHit
  enrichment: Enrichment | null
  filings: { current?: Filing; prior?: Filing }
  detailUrl: string
}): string {
  const { hit, enrichment, filings, detailUrl } = args
  const lines: string[] = []
  const detector = DETECTOR_LABELS[hit.detector_name] ?? hit.detector_name
  const company = companyLabel(hit)
  const fund = fundTickerLabel(hit)

  lines.push(`**${detector}** — ${company} (${fund})`)
  lines.push("")
  lines.push(summarize(hit))
  lines.push("")
  lines.push(
    `Severity: ${formatSeverity(hit.detector_name, hit.severity_score)}  ·  Period: ${fmtDate(hit.current_period_end)}`,
  )

  const sponsor = enrichment?.sponsor_info?.sponsor_name
  if (sponsor) {
    const yr = enrichment?.sponsor_info?.acquisition_year
    lines.push("")
    lines.push(`Sponsor: ${sponsor}${yr ? ` (acquired ${yr})` : ""}`)
  }

  const news = (enrichment?.news_items ?? []).slice(0, 2)
  if (news.length > 0) {
    lines.push("")
    lines.push("Recent news:")
    for (const n of news) {
      const title = n?.title ?? "(untitled)"
      const url = n?.url
      const date = n?.date ? ` — ${n.date}` : ""
      lines.push(`- ${title}${date}${url ? ` ${url}` : ""}`)
    }
  }

  const mgmt = (enrichment?.management_changes ?? []).slice(0, 2)
  if (mgmt.length > 0) {
    lines.push("")
    lines.push("Management changes:")
    for (const m of mgmt) {
      const role = m?.role ?? "?"
      const name = m?.name ?? "?"
      const ct = m?.change_type ?? ""
      const date = m?.date ? ` (${m.date})` : ""
      lines.push(`- ${ct}: ${name} — ${role}${date}`)
    }
  }

  const lit = (enrichment?.litigation_items ?? []).slice(0, 2)
  if (lit.length > 0) {
    lines.push("")
    lines.push("Litigation:")
    for (const l of lit) {
      const cn = l?.case_name ?? "(case)"
      const court = l?.court ? ` — ${l.court}` : ""
      lines.push(`- ${cn}${court}`)
    }
  }

  if (filings.current?.primary_doc_url || filings.prior?.primary_doc_url) {
    lines.push("")
    lines.push("Source filings:")
    if (filings.prior?.primary_doc_url)
      lines.push(`- Prior ${filings.prior.filing_type} (${filings.prior.period_end}): ${filings.prior.primary_doc_url}`)
    if (filings.current?.primary_doc_url)
      lines.push(`- Current ${filings.current.filing_type} (${filings.current.period_end}): ${filings.current.primary_doc_url}`)
  }

  lines.push("")
  lines.push(`Full alert: ${detailUrl}`)
  return lines.join("\n")
}

export default async function AlertDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = createClient()

  const { data: hit } = await supabase
    .from("detector_hits")
    .select(
      "id, detector_name, fund_ticker, portfolio_company_canonical, current_period_end, prior_period_end, severity_score, hit_data, cited_source_urls, created_at",
    )
    .eq("id", params.id)
    .maybeSingle<DetectorHit>()

  if (!hit) notFound()

  const tier = severityTier(hit.detector_name, hit.severity_score)

  // ---------------------------------------------------------------------
  // Headline metric (animated number) and FV history series
  // ---------------------------------------------------------------------
  type Headline = {
    value: number
    prefix?: string
    suffix?: string
    decimals?: number
    label: string
    tone: "danger" | "warning" | "default"
  }
  let headline: Headline | null = null
  if (hit.detector_name === "mark_drift_down") {
    const prior = Number(hit.hit_data?.fv_prior ?? 0)
    const current = Number(hit.hit_data?.fv_current ?? 0)
    const drop = Math.max(0, prior - current)
    const dropM = drop / 1000
    if (Number.isFinite(dropM) && dropM > 0) {
      headline =
        Math.abs(dropM) >= 1000
          ? {
              value: dropM / 1000,
              prefix: "$",
              suffix: "B",
              decimals: 2,
              label: "Fair-value drop",
              tone: "danger",
            }
          : {
              value: dropM,
              prefix: "$",
              suffix: "M",
              decimals: dropM >= 10 ? 1 : 2,
              label: "Fair-value drop",
              tone: "danger",
            }
    }
  } else if (hit.detector_name === "pik_creep") {
    const deltaPp = Number(hit.hit_data?.delta_pp ?? 0)
    if (Number.isFinite(deltaPp)) {
      headline = {
        value: deltaPp,
        suffix: " pp",
        decimals: 1,
        label: "PIK share increase",
        tone: "warning",
      }
    }
  } else if (hit.detector_name === "cross_fund_divergence") {
    const spread = Number(hit.hit_data?.spread_pp ?? 0)
    if (Number.isFinite(spread)) {
      headline = {
        value: spread,
        suffix: " pp",
        decimals: 1,
        label: "FV/Cost spread across funds",
        tone: "warning",
      }
    }
  }

  // FV history (across all funds) for the borrower. For PIK creep we don't
  // have a borrower, so we skip the chart and show fund-level context elsewhere.
  let fvHistory: FvHistoryRow[] = []
  if (
    hit.detector_name !== "pik_creep" &&
    hit.portfolio_company_canonical
  ) {
    const { data: seriesRaw } = await supabase.rpc("borrower_fv_series", {
      borrowers: [hit.portfolio_company_canonical],
      quarters: 999,
    })
    type SeriesRow = {
      portfolio_company_canonical: string
      period_end: string
      fv_thousands: number | string
    }
    const grouped = new Map<string, number>()
    for (const r of (seriesRaw ?? []) as SeriesRow[]) {
      const prev = grouped.get(r.period_end) ?? 0
      grouped.set(r.period_end, prev + Number(r.fv_thousands))
    }
    fvHistory = Array.from(grouped.entries())
      .map(([period_end, fv_thousands]) => ({ period_end, fv_thousands }))
      .sort((a, b) => a.period_end.localeCompare(b.period_end))
  }

  // Find observations for this hit. For mark_drift_down we want both prior and
  // current period for the (fund, canonical) pair. For cross_fund_divergence
  // we want the current period across all funds in hit_data.funds[].
  let observationsQuery = supabase
    .from("observations")
    .select(
      "id, fund_ticker, period_end, portfolio_company_raw, portfolio_company_canonical, industry, investment_type, interest_rate_text, interest_rate_pct, pik_rate_pct, maturity_date, principal_amount, cost, fair_value, accrual_status, is_pik, source_page_url",
    )

  if (hit.detector_name === "cross_fund_divergence") {
    const tickers: string[] = (hit.hit_data?.funds ?? [])
      .map((f: any) => f?.ticker)
      .filter(Boolean)
    if (hit.portfolio_company_canonical && tickers.length > 0) {
      observationsQuery = observationsQuery
        .eq("portfolio_company_canonical", hit.portfolio_company_canonical)
        .in("fund_ticker", tickers)
        .eq("period_end", hit.current_period_end ?? "")
    }
  } else if (hit.portfolio_company_canonical && hit.fund_ticker) {
    const periods = [hit.prior_period_end, hit.current_period_end].filter(
      Boolean,
    ) as string[]
    observationsQuery = observationsQuery
      .eq("fund_ticker", hit.fund_ticker)
      .eq("portfolio_company_canonical", hit.portfolio_company_canonical)
      .in("period_end", periods)
  } else if (hit.fund_ticker && hit.current_period_end) {
    // fund-level (e.g. pik_creep) — return nothing observation-level here.
    observationsQuery = observationsQuery
      .eq("fund_ticker", hit.fund_ticker)
      .eq("period_end", hit.current_period_end)
      .limit(0)
  }

  const { data: observationsRaw } = await observationsQuery
    .order("period_end", { ascending: false })
    .returns<Observation[]>()
  const observations = observationsRaw ?? []

  const { data: enrichment } = await supabase
    .from("enrichments")
    .select(
      "detector_hit_id, research_summary, news_items, litigation_items, sponsor_info, management_changes, generated_at",
    )
    .eq("detector_hit_id", hit.id)
    .maybeSingle<Enrichment>()

  // Fetch filings — prior + current for the fund (or any tickers, for cross-fund)
  const filingTickers: string[] =
    hit.detector_name === "cross_fund_divergence"
      ? (hit.hit_data?.funds ?? [])
          .map((f: any) => f?.ticker)
          .filter(Boolean)
      : hit.fund_ticker
        ? [hit.fund_ticker]
        : []
  const filingPeriods = [hit.prior_period_end, hit.current_period_end].filter(
    Boolean,
  ) as string[]

  let filings: Filing[] = []
  if (filingTickers.length > 0 && filingPeriods.length > 0) {
    const { data: filingsRaw } = await supabase
      .from("filings")
      .select(
        "fund_ticker, period_end, filing_type, filing_date, primary_doc_url, accession_number",
      )
      .in("fund_ticker", filingTickers)
      .in("period_end", filingPeriods)
      .order("filing_date", { ascending: false })
      .returns<Filing[]>()
    filings = filingsRaw ?? []
  }

  // For the "Source filings" section we want one prior + one current for the
  // primary fund (mark_drift / pik_creep). For cross_fund we'll just list all.
  const primaryFund = hit.fund_ticker ?? filingTickers[0]
  const filingByPeriod: { current?: Filing; prior?: Filing } = {}
  if (primaryFund) {
    const forFund = filings.filter((f) => f.fund_ticker === primaryFund)
    filingByPeriod.current = forFund.find(
      (f) => f.period_end === hit.current_period_end,
    )
    filingByPeriod.prior = forFund.find(
      (f) => f.period_end === hit.prior_period_end,
    )
  }

  const filingUrl = sourceFilingUrl(hit)
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://swarm-public.vercel.app"
  const markdown = buildMarkdownSummary({
    hit,
    enrichment: enrichment ?? null,
    filings: filingByPeriod,
    detailUrl: `${baseUrl}/alerts/${hit.id}`,
  })

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-12">
      <div className="mb-6 text-sm">
        <Link
          href="/alerts"
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← All alerts
        </Link>
      </div>

      <header className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-start gap-5">
            <SeverityRing
              severity={hit.severity_score ?? 0}
              size={80}
              ariaLabel={`Severity ${formatSeverity(hit.detector_name, hit.severity_score)} (${tier})`}
            />
            <div>
              <div className="text-[11px] font-mono uppercase tracking-wider text-dim">
                {DETECTOR_LABELS[hit.detector_name] ?? hit.detector_name}
                {" · "}
                {fundTickerLabel(hit)}
                {" · severity "}
                <span className="text-default">
                  {formatSeverity(hit.detector_name, hit.severity_score)}
                </span>
              </div>
              <h1 className="mt-1 text-3xl font-bold tracking-tight text-default sm:text-4xl">
                {companyLabel(hit)}
              </h1>
              {hit.portfolio_company_canonical && (
                <Link
                  href={`/watch/${encodeCanonicalSlug(hit.portfolio_company_canonical)}`}
                  className="mt-1 inline-block text-sm text-accent underline-offset-4 hover:underline"
                >
                  Watch this borrower →
                </Link>
              )}
              <p className="mt-2 text-base text-muted">{summarize(hit)}</p>
              <p className="mt-1 text-sm text-dim">
                {hit.prior_period_end ? (
                  <>
                    {fmtDate(hit.prior_period_end)} →{" "}
                    {fmtDate(hit.current_period_end)}
                  </>
                ) : (
                  <>{fmtDate(hit.current_period_end)}</>
                )}
              </p>
            </div>
          </div>
          <CopySummaryButton markdown={markdown} />
        </div>

        {headline && (
          <div className="mt-6 rounded-lg border border-default bg-card px-6 py-5">
            <div className="text-[11px] font-mono uppercase tracking-wider text-dim">
              {headline.label}
            </div>
            <div className="mt-1">
              <AnimatedNumber
                value={headline.value}
                prefix={headline.prefix}
                suffix={headline.suffix}
                decimals={headline.decimals ?? 0}
                duration={1.5}
                numberClassName={
                  headline.tone === "danger"
                    ? "inline-flex items-baseline gap-0.5 text-4xl font-bold tabular-nums text-severity-critical sm:text-5xl"
                    : headline.tone === "warning"
                      ? "inline-flex items-baseline gap-0.5 text-4xl font-bold tabular-nums text-severity-high sm:text-5xl"
                      : "inline-flex items-baseline gap-0.5 text-4xl font-bold tabular-nums text-default sm:text-5xl"
                }
              />
            </div>
          </div>
        )}
      </header>

      {fvHistory.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold tracking-tight text-default">
            Fair-value history
          </h2>
          <Card className="border-default bg-card">
            <CardContent className="p-6">
              <FvHistoryChart
                data={fvHistory}
                height={300}
                color={tier === "severe" ? "#EF4444" : "#3B82F6"}
                title={`${companyLabel(hit)} · total fair value across all funds`}
              />
            </CardContent>
          </Card>
        </section>
      )}

      {/* Hit details (raw hit_data, exposed for transparency) */}
      <section className="mb-10">
        <h2 className="mb-3 text-xl font-semibold tracking-tight">
          Hit details
        </h2>
        <Card>
          <CardContent className="p-6">
            <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              <DetailRow label="Detector" value={DETECTOR_LABELS[hit.detector_name] ?? hit.detector_name} />
              <DetailRow label="Severity score" value={formatSeverity(hit.detector_name, hit.severity_score)} />
              <DetailRow label="Fund(s)" value={fundTickerLabel(hit)} />
              <DetailRow label="Borrower" value={companyLabel(hit)} />
              <DetailRow label="Current period" value={fmtDate(hit.current_period_end)} />
              <DetailRow label="Prior period" value={fmtDate(hit.prior_period_end)} />
              <DetailRow label="Detected" value={fmtDate(hit.created_at)} />
              {filingUrl ? (
                <DetailRow
                  label="Source"
                  value={
                    <a
                      href={filingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      View filing →
                    </a>
                  }
                />
              ) : null}
            </dl>
            {hit.hit_data && Object.keys(hit.hit_data).length > 0 ? (
              <details className="mt-6 text-sm">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Raw detector payload
                </summary>
                <pre className="mt-3 overflow-x-auto rounded-md bg-muted p-4 text-xs">
                  {JSON.stringify(hit.hit_data, null, 2)}
                </pre>
              </details>
            ) : null}
          </CardContent>
        </Card>
      </section>

      {/* Observations */}
      <section className="mb-10">
        <h2 className="mb-3 text-xl font-semibold tracking-tight">
          Observations
        </h2>
        {observations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No observation rows linked (this can happen for fund-level hits like
            PIK creep).
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <Th>Period</Th>
                  <Th>Fund</Th>
                  <Th>Investment type</Th>
                  <Th className="text-right">Coupon</Th>
                  <Th className="text-right">PIK %</Th>
                  <Th>Maturity</Th>
                  <Th className="text-right">Principal</Th>
                  <Th className="text-right">Cost</Th>
                  <Th className="text-right">Fair value</Th>
                  <Th className="text-right">FV / Cost</Th>
                  <Th>Accrual</Th>
                  <Th>PIK?</Th>
                </tr>
              </thead>
              <tbody>
                {observations.map((o) => {
                  const fvOverCost =
                    o.fair_value != null && o.cost != null && o.cost !== 0
                      ? o.fair_value / o.cost
                      : null
                  return (
                    <tr key={o.id} className="border-t">
                      <Td>{fmtDate(o.period_end)}</Td>
                      <Td className="font-mono">{o.fund_ticker}</Td>
                      <Td>{o.investment_type ?? "—"}</Td>
                      <Td className="text-right">
                        {o.interest_rate_text ?? fmtPct(o.interest_rate_pct)}
                      </Td>
                      <Td className="text-right">{fmtPct(o.pik_rate_pct)}</Td>
                      <Td>{fmtDate(o.maturity_date)}</Td>
                      <Td className="text-right">{fmtRawNum(o.principal_amount)}</Td>
                      <Td className="text-right">{fmtUsdK(o.cost)}</Td>
                      <Td className="text-right">{fmtUsdK(o.fair_value)}</Td>
                      <Td
                        className={
                          fvOverCost != null && fvOverCost < 0.85
                            ? "text-right text-destructive"
                            : "text-right"
                        }
                      >
                        {fvOverCost != null
                          ? `${(fvOverCost * 100).toFixed(1)}%`
                          : "—"}
                      </Td>
                      <Td>{o.accrual_status ?? "—"}</Td>
                      <Td>{o.is_pik ? "Yes" : "No"}</Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Intelligence (enrichment) */}
      <section className="mb-10">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold tracking-tight">
            Intelligence
          </h2>
          {enrichment?.generated_at ? (
            <span className="text-xs text-muted-foreground">
              Generated {fmtDate(enrichment.generated_at)}
            </span>
          ) : null}
        </div>

        {!enrichment ? (
          <p className="text-sm text-muted-foreground">
            No enrichment record yet for this hit.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <NewsCard items={enrichment.news_items ?? []} />
            <LitigationCard items={enrichment.litigation_items ?? []} />
            <SponsorCard info={enrichment.sponsor_info ?? null} />
            <ManagementCard items={enrichment.management_changes ?? []} />
          </div>
        )}
      </section>

      {/* Source filings */}
      <section className="mb-12">
        <h2 className="mb-3 text-xl font-semibold tracking-tight">
          Source filings
        </h2>
        {filings.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No filings found for this period.
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {filings.map((f) => {
              const isCurrent = f.period_end === hit.current_period_end
              const isPrior = f.period_end === hit.prior_period_end
              const tag = isCurrent ? "Current" : isPrior ? "Prior" : "Other"
              return (
                <li
                  key={`${f.fund_ticker}-${f.period_end}-${f.accession_number}`}
                  className="rounded-md border p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{tag}</Badge>
                    <span className="font-mono text-xs text-muted-foreground">
                      {f.fund_ticker}
                    </span>
                    <span className="text-sm font-medium">
                      {f.filing_type} · period ending {fmtDate(f.period_end)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      filed {fmtDate(f.filing_date)}
                    </span>
                  </div>
                  {f.primary_doc_url ? (
                    <a
                      href={f.primary_doc_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block text-sm text-primary underline-offset-4 hover:underline"
                    >
                      Open filing →
                    </a>
                  ) : (
                    <span className="mt-1 inline-block text-xs text-muted-foreground">
                      No URL
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </main>
  )
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function DetailRow({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  )
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <th
      className={
        "whitespace-nowrap px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground" +
        (className ? " " + className : "")
      }
    >
      {children}
    </th>
  )
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <td className={"whitespace-nowrap px-3 py-2" + (className ? " " + className : "")}>
      {children}
    </td>
  )
}

function NewsCard({ items }: { items: any[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">News ({items.length})</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No relevant news in the past 180 days.
          </p>
        ) : (
          <ul className="space-y-3">
            {items.map((n, i) => {
              const url = n?.url
              const inner = (
                <>
                  <div className="text-sm font-medium">
                    {n?.title ?? "(untitled)"}
                  </div>
                  {(n?.source || n?.date) && (
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {n?.source ?? ""}
                      {n?.source && n?.date ? " · " : ""}
                      {n?.date ?? ""}
                    </div>
                  )}
                  {n?.summary ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {String(n.summary)}
                    </p>
                  ) : null}
                </>
              )
              return (
                <li
                  key={i}
                  className="rounded-md border p-3 hover:bg-muted/40"
                >
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                    >
                      {inner}
                    </a>
                  ) : (
                    inner
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function LitigationCard({ items }: { items: any[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          Litigation ({items.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No litigation found in the past 12 months.
          </p>
        ) : (
          <ul className="space-y-3">
            {items.map((l, i) => {
              const url = l?.url
              const inner = (
                <>
                  <div className="text-sm font-medium">
                    {l?.case_name ?? "(case)"}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {l?.court ?? ""}
                    {l?.court && l?.filing_date ? " · " : ""}
                    {l?.filing_date ?? ""}
                  </div>
                  {l?.summary ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {String(l.summary)}
                    </p>
                  ) : null}
                </>
              )
              return (
                <li
                  key={i}
                  className="rounded-md border p-3 hover:bg-muted/40"
                >
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                    >
                      {inner}
                    </a>
                  ) : (
                    inner
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function SponsorCard({ info }: { info: Record<string, any> | null }) {
  const name = info?.sponsor_name
  const year = info?.acquisition_year
  const fund = info?.fund_name
  const url = info?.source_url
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Sponsor</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-sm">
        {!name ? (
          <p className="text-muted-foreground">Sponsor unknown.</p>
        ) : (
          <div>
            <div className="text-base font-medium">{name}</div>
            {year ? (
              <div className="mt-1 text-xs text-muted-foreground">
                Acquired {year}
              </div>
            ) : null}
            {fund ? (
              <div className="mt-1 text-xs text-muted-foreground">
                Fund: {fund}
              </div>
            ) : null}
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-xs text-primary underline-offset-4 hover:underline"
              >
                Source →
              </a>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ManagementCard({ items }: { items: any[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          Management changes ({items.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No leadership changes reported in the past 12 months.
          </p>
        ) : (
          <ul className="space-y-3">
            {items.map((m, i) => {
              const url = m?.source_url
              const inner = (
                <>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-medium">
                      {m?.name ?? "?"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {m?.role ?? ""}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {m?.change_type ?? ""}
                    {m?.change_type && m?.date ? " · " : ""}
                    {m?.date ?? ""}
                  </div>
                </>
              )
              return (
                <li
                  key={i}
                  className="rounded-md border p-3 hover:bg-muted/40"
                >
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                    >
                      {inner}
                    </a>
                  ) : (
                    inner
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
