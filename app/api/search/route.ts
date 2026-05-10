import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export type SearchHit = {
  type: "fund" | "borrower"
  id: string
  label: string
  sublabel?: string
}

/**
 * Live search for the global Cmd-K palette.
 *
 * `?q=` is a free-text prefix. Returns up to 8 funds and 12 borrowers,
 * combining ticker prefix matches with name ILIKE matches.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const q = (url.searchParams.get("q") ?? "").trim()
  if (q.length === 0) {
    return NextResponse.json({ funds: [], borrowers: [] })
  }
  const ilike = `%${q.replace(/[%_]/g, "")}%`

  const supabase = createClient()

  const [fundsRes, borrowersRes] = await Promise.all([
    supabase
      .from("funds")
      .select("ticker, name")
      .or(`ticker.ilike.${ilike},name.ilike.${ilike}`)
      .limit(8),
    supabase
      .from("observations")
      .select("portfolio_company_canonical")
      .ilike("portfolio_company_canonical", ilike)
      .not("portfolio_company_canonical", "is", null)
      .limit(60), // overfetch then dedupe
  ])

  const funds: SearchHit[] = (fundsRes.data ?? []).map((f: any) => ({
    type: "fund",
    id: f.ticker,
    label: f.ticker,
    sublabel: f.name ?? undefined,
  }))

  const seen = new Set<string>()
  const borrowers: SearchHit[] = []
  for (const row of borrowersRes.data ?? []) {
    const name = (row as any).portfolio_company_canonical as string | null
    if (!name) continue
    if (seen.has(name)) continue
    seen.add(name)
    borrowers.push({ type: "borrower", id: name, label: name })
    if (borrowers.length >= 12) break
  }

  return NextResponse.json({ funds, borrowers })
}
