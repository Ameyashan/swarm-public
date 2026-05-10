import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import type { Metadata } from "next"
export const revalidate = 300

export const metadata: Metadata = {
  title: "Funds",
  description:
    "BDCs ingested from SEC EDGAR — every position, every quarter, parsed and indexed.",
}

type Fund = {
  ticker: string
  name: string
  cik: string
}

export default async function FundsIndexPage() {
  const supabase = createClient()

  // Pull funds and per-ticker observation counts in parallel.
  const [{ data: funds, error }, { data: obsRows }] = await Promise.all([
    supabase
      .from("funds")
      .select("ticker, name, cik")
      .order("ticker", { ascending: true })
      .returns<Fund[]>(),
    supabase.rpc("fund_observation_counts"),
  ])

  const countsByTicker = new Map<string, number>()
  for (const r of (obsRows ?? []) as Array<{
    fund_ticker: string
    n: number | string
  }>) {
    countsByTicker.set(r.fund_ticker, Number(r.n))
  }

  const all = funds ?? []
  const active = all
    .filter((f) => (countsByTicker.get(f.ticker) ?? 0) > 0)
    .sort((a, b) => {
      const na = countsByTicker.get(a.ticker) ?? 0
      const nb = countsByTicker.get(b.ticker) ?? 0
      if (nb !== na) return nb - na
      return a.ticker.localeCompare(b.ticker)
    })
  const comingSoon = all.filter(
    (f) => (countsByTicker.get(f.ticker) ?? 0) === 0,
  )

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-4xl flex-col px-6 py-12 sm:py-16">
      <header className="mb-8">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Funds</h1>
        <p className="mt-2 text-muted-foreground">
          BDCs currently ingested from SEC EDGAR.
        </p>
      </header>

      {error ? (
        <p className="text-sm text-destructive">
          Failed to load funds: {error.message}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">Ticker</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-[160px]">CIK</TableHead>
                  <TableHead className="w-[120px] text-right">
                    Positions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {active.map((f) => (
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
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                      {(countsByTicker.get(f.ticker) ?? 0).toLocaleString(
                        "en-US",
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {comingSoon.length > 0 && (
            <section className="mt-10">
              <h2 className="mb-3 text-xs font-mono uppercase tracking-[0.2em] text-dim">
                Coming soon
              </h2>
              <div className="overflow-x-auto rounded-lg border border-dashed border-default/60 bg-card/40">
                <Table>
                  <TableBody>
                    {comingSoon.map((f) => (
                      <TableRow key={f.ticker} className="opacity-70">
                        <TableCell className="w-[120px] font-mono font-medium">
                          {f.ticker}
                        </TableCell>
                        <TableCell>{f.name}</TableCell>
                        <TableCell className="w-[160px] font-mono text-muted-foreground">
                          {f.cik}
                        </TableCell>
                        <TableCell className="w-[140px] text-right">
                          <Badge variant="outline" className="font-mono">
                            Coming soon
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="mt-2 text-xs text-dim">
                These funds are queued for ingestion — filings parsed, no
                positions yet.
              </p>
            </section>
          )}
        </>
      )}
    </main>
  )
}
