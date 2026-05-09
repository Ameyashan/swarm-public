import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ObservationsTable } from "./observations-table"

// Server-render every request so we always read the latest filing.
export const dynamic = "force-dynamic"

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

  // 4) Compute summary metrics on the server
  const totalPositions = observations.length
  const totalFairValue = observations.reduce(
    (sum, o) => sum + (o.fair_value ?? 0),
    0
  )
  const totalCost = observations.reduce((sum, o) => sum + (o.cost ?? 0), 0)
  const nonAccrualCount = observations.filter(
    (o) => o.accrual_status === "non_accrual"
  ).length
  const pikCount = observations.filter((o) => o.is_pik === true).length

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-12">
      <BackLink />

      <header className="mb-8">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          {fund.ticker}
        </h1>
        <p className="mt-2 text-lg text-muted-foreground">{fund.name}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Most recent filing:{" "}
          <span className="font-medium text-foreground">
            {filing.filing_type}
          </span>{" "}
          for period ending{" "}
          <span className="font-medium text-foreground">
            {filing.period_end}
          </span>{" "}
          (filed {filing.filing_date},{" "}
          <span className="font-mono">{filing.accession_number}</span>)
        </p>
      </header>

      {/* Summary cards */}
      <section className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-5">
        <SummaryCard
          label="Total positions"
          value={totalPositions.toLocaleString()}
        />
        <SummaryCard
          label="Total fair value"
          value={formatThousands(totalFairValue)}
          hint="$ in thousands"
        />
        <SummaryCard
          label="Total cost"
          value={formatThousands(totalCost)}
          hint="$ in thousands"
        />
        <SummaryCard
          label="Non-accrual"
          value={nonAccrualCount.toLocaleString()}
          accent={nonAccrualCount > 0 ? "danger" : "default"}
        />
        <SummaryCard label="PIK" value={pikCount.toLocaleString()} />
      </section>

      {/* Observations table (client component for sort + filter) */}
      <ObservationsTable observations={observations} />

      <footer className="mt-12 border-t pt-6 text-sm text-muted-foreground">
        Source: SEC EDGAR. Values reported as filed; SoI tables are denominated
        in thousands.
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
  value,
  hint,
  accent = "default",
}: {
  label: string
  value: string
  hint?: string
  accent?: "default" | "danger"
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={
            accent === "danger"
              ? "text-2xl font-bold text-destructive"
              : "text-2xl font-bold"
          }
        >
          {value}
        </div>
        {hint ? (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function formatThousands(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0"
  // values are stored in $thousands; $1,000 (k) = $1M
  const millions = n / 1_000
  if (Math.abs(millions) >= 1_000) {
    return `$${(millions / 1_000).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    })}B`
  }
  return `$${millions.toLocaleString(undefined, {
    maximumFractionDigits: 1,
  })}M`
}
