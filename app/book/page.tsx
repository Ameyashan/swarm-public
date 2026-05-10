import type { Metadata } from "next"
import {
  filterAndSortForTab,
  getFundBookPositions,
  getFundBookStats,
  getFundPositionCount,
  parseBookTab,
  parseFund,
  tabCounts,
} from "@/lib/book/queries"
import { BookTabs } from "@/components/book/book-tabs"
import { FundSwitch } from "@/components/book/fund-switch"
import { PositionsTable } from "@/components/book/positions-table"
import { StatCards } from "@/components/book/stat-cards"

export const revalidate = 300

export const metadata: Metadata = {
  title: "Position book",
  description:
    "Every GSCR + GSBD position, ranked by deterioration. Live from Supabase: fair value, PIK share, non-accrual, detector hits, and per-position mark drift.",
}

function fmtBillions(dollars: number): string {
  if (!Number.isFinite(dollars) || dollars <= 0) return "—"
  const b = dollars / 1_000_000_000
  if (b >= 1) return `$${b.toFixed(2)}B`
  const m = dollars / 1_000_000
  return `$${m.toFixed(1)}M`
}

export default async function PositionBookPage({
  searchParams,
}: {
  searchParams: { fund?: string; tab?: string }
}) {
  const fund = parseFund(searchParams.fund)
  const tab = parseBookTab(searchParams.tab)

  const [stats, positions, totalLive] = await Promise.all([
    getFundBookStats(fund),
    getFundBookPositions(fund),
    getFundPositionCount(fund),
  ])

  const counts = tabCounts(positions)
  const filtered = filterAndSortForTab(positions, tab)

  return (
    <main className="flex flex-col gap-6">
      <header
        className="flex flex-col gap-4 border-b pb-5 md:flex-row md:items-end md:justify-between"
        style={{ borderColor: "var(--line)" }}
      >
        <div>
          <div className="mb-[6px] font-mono text-[10.5px] uppercase tracking-[0.16em] text-text-faint">
            your fund · {totalLive.toLocaleString()} positions ·{" "}
            {stats ? fmtBillions(stats.total_fv_dollars) : "—"} FV
          </div>
          <h1 className="font-serif text-[34px] font-normal leading-[1.15] tracking-[-0.6px] text-text">
            <span className="text-gs">{fund}</span> position book
          </h1>
          <p className="mt-2 max-w-[720px] font-serif text-[15px] leading-[1.55] text-text-dim">
            Sorted by deterioration first. Look here when the question is{" "}
            <em>which of my names is breaking</em> — not <em>which are biggest</em>.
          </p>
        </div>
        <FundSwitch fund={fund} tab={tab} />
      </header>

      <BookTabs fund={fund} active={tab} counts={counts} totalLive={totalLive} />

      <StatCards stats={stats} hitCountTotal={positions.length} />

      <PositionsTable rows={filtered} tab={tab} />

      <footer
        className="flex flex-wrap items-center justify-between gap-2 border-t pt-4 font-mono text-[10.5px] text-text-faint"
        style={{ borderColor: "var(--line)" }}
      >
        <span>
          showing {filtered.length.toLocaleString()} of{" "}
          {positions.length.toLocaleString()} flagged borrowers · sorted by
          severity then mark drift
        </span>
        <span>live · SEC EDGAR · detector_hits + observations</span>
      </footer>
    </main>
  )
}
