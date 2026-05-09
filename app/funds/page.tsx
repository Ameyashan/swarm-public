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

export const dynamic = "force-dynamic"

type Fund = {
  ticker: string
  name: string
  cik: string
}

export default async function FundsIndexPage() {
  const supabase = createClient()
  const { data: funds, error } = await supabase
    .from("funds")
    .select("ticker, name, cik")
    .order("ticker", { ascending: true })
    .returns<Fund[]>()

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
    </main>
  )
}
