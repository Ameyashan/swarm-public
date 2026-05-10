import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ObservationsTable } from "./observations-table"
import { AnimatedNumber } from "@/components/charts/AnimatedNumber"
import { Sparkline, type SparklinePoint } from "@/components/charts/Sparkline"
import { format } from "date-fns"
import { toDollars, formatFV } from "@/lib/format"

import type { Metadata } from "next"

// Server-render every request so we always read the latest filing.
export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: {
  params: { ticker: string }
}): Promise<Metadata> {
  const ticker = params.ticker.toUpperCase()
  return {
    title: `${ticker} · Fund detail`,
    description: `${ticker} BDC — latest fair-value, cost, and detector hits per position, parsed from the most recent 10-K/10-Q filing.`,
  }
}

type Fund = {
  ticker: string
  name: string
  cik: string
}

type Filing = {
  id: string
  fund_ticker: string
  filing_type: string
  filing_date: string
  period_end: string
  accession_number: string
  primary_doc_url: string | null
  parse_status: string
}

export type Observation = {
  id: string
  filing_id: string
  fund_ticker: string
  period_end: string
  portfolio_company_raw: string | null
  portfolio_company_canonical: string | null
  industry: string | null
  investment_type: string | null
  interest_rate_text: string | null
  interest_rate_pct: number | null
  fair_value: number | null
  cost: number | null
  accrual_status: string | null
  is_pik: boolean | null
  source_page_url: string | null
}

const PAGE_SIZE = 1000

async function fetchAllObservations(
  supabase: ReturnType<typeof createClient>,
  filingId: string
): Promise<Observation[]> {
  const all: Observation[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("observations")
      .select(
        "id, filing_id, fund_ticker, period_end, portfolio_company_raw, portfolio_company_canonical, industry, investment_type, interest_rate_text, interest_rate_pct, fair_value, cost, accrual_status, is_pik, source_page_url"
      )
      .eq("filing_id", filingId)
      .order("fair_value", { ascending: false, nullsFirst: false })
      .range(offset, offset + PAGE_SIZE - 1)
      .returns<Observation[]>()

    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break
  }
  return all
}

export default async function FundPage({
  params,
}: {
  params: { ticker: string }
}) {
  const ticker = params.ticker.toUpperCase()
  const supabase = createClient()

  // 1) Fund metadata
  const { data: fund } = await supabase
    .from("funds")
    .select("ticker, name, cik")
    .eq("ticker", ticker)
    .maybeSingle<Fund>()

  if (!fund) notFound()

  // 2) Most recent successfully-parsed filing
  const { data: filing } = await supabase
    .from("filings")
    .select(
      "id, fund_ticker, filing_type, filing_date, period_end, accession_number, primary_doc_url, parse_status"
    )
    .eq("fund_ticker", ticker)
    .eq("parse_status", "parsed")
    .order("period_end", { ascending: false })
    .limit(1)
    .maybeSingle<Filing>()

  if (!filing) {
    return (
      <main className="mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-12">
        <BackLink />
        <header className="mb-8">
          <h1 className="text-4xl font-bold tracking-tight">
            {fund.ticker}{" "}
            <span className="font-normal text-muted-foreground">
              {fund.name}
            </span>
          </h1>
        </header>
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          No parsed filings yet for {fund.ticker}.
        </div>
      </main>
    )
  }

  // 3) All observations for that filing
  const observations = await fetchAllObservations(supabase, filing.id)

  // 4) Compute summary metrics on the server (normalized to whole dollars)
  const totalPositions = observations.length
  const totalFairValue = observations.reduce(
    (sum, o) => sum + (toDollars(o.fair_value, ticker) ?? 0),
    0
  )
  const totalCost = observations.reduce(
    (sum, o) => sum + (toDollars(o.cost, ticker) ?? 0),
    0
  )
  const nonAccrualCount = observations.filter(
    (o) => o.accrual_status === "non_accrual"
  ).length
  const pikCount = observations.filter((o) => o.is_pik === true).length

  // 5) Fund-level history series for the sparkline (FV by period)
  type FundFvRow = {
    period_end: string
    fv_thousands: number | string
    positions: number | string
    non_accrual_count: number | string
  }
  const { data: fundSeriesRaw } = await supabase.rpc("fund_fv_series", {
    ticker,
  })
  // Sparkline rows from RPC come back at storage scale; normalize per-ticker.
  const fundSeries: SparklinePoint[] = ((fundSeriesRaw ?? []) as FundFvRow[])
    .map((r) => ({
      x: r.period_end,
      y: toDollars(Number(r.fv_thousands), ticker) ?? 0,
    }))
    .sort((a, b) => String(a.x).localeCompare(String(b.x)))

  // Headline values for AnimatedNumber: split FV/cost into B-or-M scale on
  // whole-dollar inputs so the count-up animation has a sensible target.
  function headline(dollars: number): {
    value: number
    suffix: "B" | "M" | "K"
    decimals: number
  } {
    const abs = Math.abs(dollars)
    if (abs >= 1_000_000_000)
      return { value: dollars / 1_000_000_000, suffix: "B", decimals: 1 }
    if (abs >= 1_000_000)
      return { value: dollars / 1_000_000, suffix: "M", decimals: 1 }
    return { value: dollars / 1_000, suffix: "K", decimals: 1 }
  }
  const fvHead = headline(totalFairValue)
  const costHead = headline(totalCost)

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-12">
      <BackLink />

      <header className="mb-8 flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-default sm:text-5xl">
            {fund.ticker}
          </h1>
          <p className="mt-2 text-lg text-muted">{fund.name}</p>
          <p className="mt-1 text-sm text-dim">
            Most recent filing:{" "}
            <span className="font-medium text-default">
              {filing.filing_type}
            </span>{" "}
            for period ending{" "}
            <span className="font-medium text-default">
              {filing.period_end}
            </span>{" "}
            (filed {filing.filing_date},{" "}
            <span className="font-mono">{filing.accession_number}</span>)
          </p>
        </div>
        {fundSeries.length > 1 && (
          <div className="flex flex-col items-end gap-1">
            <span className="text-[11px] font-mono uppercase tracking-wider text-dim">
              Total fair value · history
            </span>
            <Sparkline
              data={fundSeries}
              width={280}
              height={56}
              color="#3B82F6"
              formatValue={(v) => formatFV(v)}
              formatLabel={(x) => {
                try {
                  return format(new Date(String(x)), "MMM yyyy")
                } catch {
                  return String(x)
                }
              }}
            />
            <span className="text-[10px] font-mono uppercase tracking-wider text-dim">
              {fundSeries.length} periods
            </span>
          </div>
        )}
      </header>

      {/* Summary cards */}
      <section className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-5">
        <SummaryCard label="Total positions">
          <AnimatedNumber
            value={totalPositions}
            duration={1.5}
            numberClassName="inline-flex items-baseline gap-0.5 text-2xl font-bold tabular-nums text-default"
          />
        </SummaryCard>
        <SummaryCard label="Total fair value">
          <AnimatedNumber
            value={Number(fvHead.value.toFixed(fvHead.decimals))}
            prefix="$"
            suffix={fvHead.suffix}
            decimals={fvHead.decimals}
            duration={1.5}
            numberClassName="inline-flex items-baseline gap-0.5 text-2xl font-bold tabular-nums text-default"
          />
        </SummaryCard>
        <SummaryCard label="Total cost">
          <AnimatedNumber
            value={Number(costHead.value.toFixed(costHead.decimals))}
            prefix="$"
            suffix={costHead.suffix}
            decimals={costHead.decimals}
            duration={1.5}
            numberClassName="inline-flex items-baseline gap-0.5 text-2xl font-bold tabular-nums text-default"
          />
        </SummaryCard>
        <SummaryCard label="Non-accrual">
          <AnimatedNumber
            value={nonAccrualCount}
            duration={1.5}
            numberClassName={
              nonAccrualCount > 0
                ? "inline-flex items-baseline gap-0.5 text-2xl font-bold tabular-nums text-severity-critical"
                : "inline-flex items-baseline gap-0.5 text-2xl font-bold tabular-nums text-default"
            }
          />
        </SummaryCard>
        <SummaryCard label="PIK">
          <AnimatedNumber
            value={pikCount}
            duration={1.5}
            numberClassName="inline-flex items-baseline gap-0.5 text-2xl font-bold tabular-nums text-default"
          />
        </SummaryCard>
      </section>

      {/* Observations table (client component for sort + filter) */}
      <ObservationsTable observations={observations} />

      <footer className="mt-12 border-t pt-6 text-sm text-muted-foreground">
        Source: SEC EDGAR. Values normalized to whole dollars from the
        as-filed scale (ARCC reports in $millions; all other BDCs in
        $thousands).
      </footer>
    </main>
  )
}

function BackLink() {
  return (
    <Link
      href="/"
      className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      ← All funds
    </Link>
  )
}

function SummaryCard({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <Card className="border-default bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-[11px] font-mono uppercase tracking-wider text-dim">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {children}
        {hint ? (
          <p className="mt-1 text-xs text-dim">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}


