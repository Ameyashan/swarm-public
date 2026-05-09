import { createClient } from "@/lib/supabase/server"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

// Always render with fresh data on each request.
export const dynamic = "force-dynamic"

type Fund = {
  ticker: string
  name: string
  cik: string
}

export default async function Home() {
  const supabase = createClient()
  const { data: funds, error } = await supabase
    .from("funds")
    .select("ticker, name, cik")
    .order("ticker", { ascending: true })
    .returns<Fund[]>()

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-16 sm:py-24">
      <header className="mb-12">
        <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">
          Swarm Public
        </h1>
        <p className="mt-4 text-lg text-muted-foreground sm:text-xl">
          The agentic intelligence layer for public private credit
        </p>
      </header>

      <section className="flex-1">
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
                      {f.ticker}
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
